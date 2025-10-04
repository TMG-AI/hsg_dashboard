// /api/meltwater_webhook.js - Correct Git 
// Receives real-time mentions from Meltwater Streaming API
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const ZSET = "mentions:z";
const STREAM_ZSET = "mentions:streamed:z"; // Separate set for streamed mentions
const COUNTER_KEY = "meltwater:stream:count";
const DAILY_COUNTER_KEY = "meltwater:stream:daily";

// Helper to get today's date key for daily counters
function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${DAILY_COUNTER_KEY}:${year}-${month}-${day}`;
}

// Verify webhook signature (optional but recommended)
function verifyWebhookSignature(req, secret) {
  // Meltwater may send a signature header for verification
  // Implement based on their documentation
  const signature = req.headers['x-meltwater-signature'];
  if (!signature || !secret) return true; // Skip if not configured
  
  // Implement HMAC verification if Meltwater provides it
  // const expectedSignature = crypto.createHmac('sha256', secret)
  //   .update(JSON.stringify(req.body))
  //   .digest('hex');
  // return signature === expectedSignature;
  
  return true; // For now, accept all
}

export default async function handler(req, res) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Optional: Verify webhook signature
    const webhookSecret = process.env.MELTWATER_WEBHOOK_SECRET;
    if (webhookSecret && !verifyWebhookSignature(req, webhookSecret)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Parse the webhook payload
    const payload = req.body;
    console.log('Received Meltwater webhook:', {
      type: payload.type,
      documentCount: payload.documents?.length || 0
    });

    // Handle different webhook event types
    if (payload.type === 'test' || payload.test === true) {
      // This is a test webhook from Meltwater
      console.log('Test webhook received');
      return res.status(200).json({ 
        status: 'success', 
        message: 'Test webhook received successfully' 
      });
    }

    // Extract documents/mentions from the payload
    let documents = [];
    
    // Meltwater may send documents in different formats
    if (payload.documents && Array.isArray(payload.documents)) {
      documents = payload.documents;
    } else if (payload.results && Array.isArray(payload.results)) {
      documents = payload.results;
    } else if (Array.isArray(payload)) {
      documents = payload;
    } else if (payload.data && Array.isArray(payload.data)) {
      documents = payload.data;
    }

    console.log(`Processing ${documents.length} documents from webhook`);

    // Process and store each document
    const storedMentions = [];
    const timestamp = Math.floor(Date.now() / 1000);
    const todayKey = getTodayKey();

    for (const doc of documents) {
      try {
        // Enhanced logging for troubleshooting
        console.log('=== MELTWATER WEBHOOK DEBUG ===');
        console.log(`Title mapping: summary.title="${doc.summary?.title}" | title="${doc.title}" | headline="${doc.headline}"`);
        console.log(`Source mapping: source.name="${doc.source?.name}" | source_name="${doc.source_name}"`);
        console.log(`Summary mapping: summary.opening_text="${doc.summary?.opening_text}" | document_opening_text="${doc.document_opening_text}"`);
        console.log(`Final values: title="${doc.summary?.title || doc.document_title || doc.title || doc.headline || 'Untitled'}" | source="${doc.source?.name || doc.source_name || doc.media_name || 'Meltwater'}"`);
        console.log('=== END WEBHOOK DEBUG ===');

        // Transform Meltwater document to your format
        // Handle title extraction - sometimes it's in summary.title
        let extractedTitle = doc.summary?.title || doc.document_title || doc.title || doc.headline;
        if (!extractedTitle || extractedTitle === 'Untitled') {
          // If we have a summary object, try to extract title from it
          if (doc.summary && typeof doc.summary === 'object') {
            extractedTitle = doc.summary.title || extractedTitle || 'Untitled';
          }
        }

        // Handle summary extraction - try multiple fields and handle both string and object
        let extractedSummary = '';
        if (doc.summary) {
          if (typeof doc.summary === 'string') {
            extractedSummary = doc.summary;
          } else if (typeof doc.summary === 'object') {
            // Try opening_text first, then other fields
            extractedSummary = doc.summary.opening_text ||
                               doc.summary.byline ||
                               doc.summary.content ||
                               '';
          }
        }
        if (!extractedSummary) {
          extractedSummary = doc.document_opening_text || doc.content || doc.description || '';
        }

        const mention = {
          id: `mw_stream_${doc.document_id || doc.id || timestamp}_${Math.random()}`,
          title: extractedTitle || 'Untitled',
          link: doc.document_url || doc.url || doc.link || doc.permalink || '#',
          source: doc.source?.name || doc.source_name || doc.media_name || 'Meltwater',
          section: 'Meltwater',
          origin: 'meltwater',
          published: doc.document_publish_date || doc.published_date || doc.date || doc.published_at || new Date().toISOString(),
          published_ts: doc.published_timestamp ||
                        (doc.document_publish_date ? Math.floor(Date.parse(doc.document_publish_date) / 1000) :
                         doc.published_date ? Math.floor(Date.parse(doc.published_date) / 1000) : timestamp),
          matched: extractKeywords(doc),
          summary: extractedSummary,
          reach: doc.reach || doc.circulation || doc.audience || 0,
          sentiment: normalizeSentiment(doc),
          sentiment_label: doc.sentiment || doc.sentiment_label || null,
          streamed: true, // Mark as streamed
          received_at: new Date().toISOString()
        };

        // Store in Redis with timestamp as score
        const mentionJson = JSON.stringify(mention);
        
        // Add to both main set and streamed set
        await redis.zadd(ZSET, {
          score: mention.published_ts,
          member: mentionJson
        });
        
        await redis.zadd(STREAM_ZSET, {
          score: timestamp,
          member: mentionJson
        });

        // Increment counters
        await redis.incr(COUNTER_KEY);
        await redis.incr(todayKey);

        storedMentions.push(mention);
        
        console.log(`Stored mention: ${mention.title}`);
      } catch (error) {
        console.error('Error processing document:', error, doc);
      }
    }

    // Set expiry on daily counter (expires after 7 days)
    if (documents.length > 0) {
      await redis.expire(todayKey, 7 * 24 * 60 * 60);
    }

    // Optional: Trigger real-time update to connected clients
    // This could be via WebSockets, Server-Sent Events, or Pusher
    if (storedMentions.length > 0) {
      await notifyClients(storedMentions);
    }

    // Respond to Meltwater
    res.status(200).json({
      status: 'success',
      processed: storedMentions.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Webhook processing error:', error);
    
    // Return 200 to prevent Meltwater from retrying
    // Log the error for debugging
    res.status(200).json({
      status: 'error',
      message: 'Internal processing error, logged for review'
    });
  }
}

// Helper functions
function normalizeSentiment(doc) {
  if (typeof doc.sentiment_score === 'number') {
    return doc.sentiment_score;
  }
  const sentiment = (doc.sentiment || '').toLowerCase();
  if (sentiment === 'positive') return 1;
  if (sentiment === 'negative') return -1;
  if (sentiment === 'neutral') return 0;
  return undefined;
}

function extractKeywords(doc) {
  const keywords = [];
  
  if (doc.source_type) keywords.push(doc.source_type);
  if (doc.sentiment) keywords.push(`sentiment-${doc.sentiment.toLowerCase()}`);
  if (doc.country) keywords.push(doc.country);
  if (doc.language) keywords.push(doc.language);
  
  // Add tags if present
  if (doc.tags && Array.isArray(doc.tags)) {
    keywords.push(...doc.tags);
  }
  
  // Extract crypto-related keywords from title
  const title = (doc.title || '').toLowerCase();
  const cryptoKeywords = [
    'bitcoin', 'btc', 'ethereum', 'eth', 
    'crypto', 'cryptocurrency', 'blockchain',
    'coinbase', 'defi', 'nft', 'web3'
  ];
  
  cryptoKeywords.forEach(keyword => {
    if (title.includes(keyword)) {
      keywords.push(keyword);
    }
  });
  
  // Add source type
  if (doc.source_type) {
    keywords.push(`type-${doc.source_type.toLowerCase()}`);
  }
  
  return [...new Set(keywords)]; // Remove duplicates
}

// Optional: Notify connected clients of new mentions
async function notifyClients(mentions) {
  // If using Pusher or similar service
  if (process.env.PUSHER_APP_ID) {
    // const Pusher = require('pusher');
    // const pusher = new Pusher({
    //   appId: process.env.PUSHER_APP_ID,
    //   key: process.env.PUSHER_KEY,
    //   secret: process.env.PUSHER_SECRET,
    //   cluster: process.env.PUSHER_CLUSTER
    // });
    // 
    // await pusher.trigger('mentions', 'new-mentions', {
    //   mentions: mentions,
    //   count: mentions.length,
    //   timestamp: new Date().toISOString()
    // });
  }
  
  // Or store in a Redis pub/sub channel for SSE
  if (mentions.length > 0) {
    try {
      await redis.publish('mentions:updates', JSON.stringify({
        type: 'new_mentions',
        count: mentions.length,
        mentions: mentions.slice(0, 5) // Send preview of first 5
      }));
    } catch (error) {
      console.error('Error publishing update:', error);
    }
  }
}
