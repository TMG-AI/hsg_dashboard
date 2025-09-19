// /api/meltwater_webhook.js
// This endpoint receives real-time updates from Meltwater webhooks
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const ZSET = "mentions:z";
const ZSET_SENT = "mw:sentiment:z";
const ZSET_SPIKES = "mw:spikes:z";

// Verify webhook signature if configured
function verifyWebhookSignature(req, signature) {
  // If you have a webhook secret from Meltwater
  const secret = process.env.MELTWATER_WEBHOOK_SECRET;
  if (!secret) return true; // Skip verification if no secret configured
  
  // Implement signature verification based on Meltwater's method
  // This is a placeholder - check Meltwater docs for exact implementation
  return true;
}

// Transform Meltwater document to your mention format
function transformMeltwaterDocument(doc) {
  const now = Date.now();
  
  // Extract all relevant fields from Meltwater
  const mention = {
    id: `mw_${doc.id || doc.document_id || now}_${Math.random()}`,
    title: doc.title || doc.headline || "(untitled)",
    link: doc.url || doc.link || doc.permalink || null,
    source: doc.source_name || doc.source || doc.media_name || "Meltwater",
    section: "Meltwater",
    origin: "meltwater",
    
    // Keywords/tags
    matched: [
      "meltwater-alert",
      ...(doc.tags || []),
      ...(doc.keywords || []),
      ...(doc.entities || [])
    ].filter(Boolean).slice(0, 50),
    
    // Timestamps
    published: doc.published_date || doc.date || doc.published_at || new Date().toISOString(),
    published_ts: doc.published_timestamp || 
                  (doc.published_date ? Math.floor(Date.parse(doc.published_date) / 1000) : Math.floor(now / 1000)),
    
    // Metrics
    reach: doc.reach || doc.circulation || doc.audience || 0,
    sentiment: doc.sentiment_score !== undefined ? doc.sentiment_score : 
               doc.sentiment === "positive" ? 1 : 
               doc.sentiment === "negative" ? -1 : 
               doc.sentiment === "neutral" ? 0 : undefined,
    sentiment_label: doc.sentiment || doc.sentiment_label || null,
    
    // Additional metadata
    country: doc.country || doc.country_code || null,
    language: doc.language || doc.language_code || null,
    
    // Store original provider metadata
    provider_meta: {
      document_id: doc.id || doc.document_id,
      search_id: doc.search_id,
      reach: doc.reach,
      sentiment: doc.sentiment_score,
      sentiment_label: doc.sentiment,
      influencer_score: doc.influencer_score,
      source_type: doc.source_type || doc.media_type
    }
  };
  
  return mention;
}

// Detect spikes in mention volume
async function detectSpike(searchId, count) {
  try {
    // Get recent counts for this search
    const recentKey = `mw:counts:${searchId}`;
    const recent = await redis.lrange(recentKey, 0, 10);
    
    if (recent.length >= 5) {
      const counts = recent.map(r => parseInt(r) || 0);
      const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
      const stdDev = Math.sqrt(counts.reduce((sum, c) => sum + Math.pow(c - avg, 2), 0) / counts.length);
      
      // Detect if current count is 2+ standard deviations above average
      if (count > avg + (2 * stdDev) && stdDev > 0) {
        const spike = {
          ts: Math.floor(Date.now() / 1000),
          type: 'volume',
          severity: count > avg + (3 * stdDev) ? 'high' : 'medium',
          source: 'meltwater',
          metric: 'mention_count',
          value: count,
          baseline: avg,
          deviation: (count - avg) / stdDev,
          message: `Spike detected: ${count} mentions (${((count - avg) / avg * 100).toFixed(0)}% above average)`,
          details: { search_id: searchId }
        };
        
        // Store spike
        await redis.zadd(ZSET_SPIKES, {
          score: spike.ts,
          member: JSON.stringify(spike)
        });
        
        return spike;
      }
    }
    
    // Store current count for future comparisons
    await redis.lpush(recentKey, count);
    await redis.ltrim(recentKey, 0, 20); // Keep last 20 counts
    await redis.expire(recentKey, 86400); // Expire after 24 hours
    
    return null;
  } catch (e) {
    console.error("Spike detection error:", e);
    return null;
  }
}

// Update sentiment tracking
async function updateSentiment(documents) {
  const sentiment = { positive: 0, neutral: 0, negative: 0, total: 0 };
  
  documents.forEach(doc => {
    sentiment.total++;
    if (doc.sentiment === "positive" || doc.sentiment_score > 0) sentiment.positive++;
    else if (doc.sentiment === "negative" || doc.sentiment_score < 0) sentiment.negative++;
    else sentiment.neutral++;
  });
  
  if (sentiment.total > 0) {
    const sentData = {
      ts: Math.floor(Date.now() / 1000),
      sentiment,
      source: 'meltwater_webhook'
    };
    
    await redis.zadd(ZSET_SENT, {
      score: sentData.ts,
      member: JSON.stringify(sentData)
    });
  }
}

export default async function handler(req, res) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    // Verify webhook signature if needed
    const signature = req.headers['x-meltwater-signature'];
    if (!verifyWebhookSignature(req, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    // Parse webhook payload
    const payload = req.body;
    
    // Handle different Meltwater webhook types
    let documents = [];
    let searchId = null;
    
    if (payload.documents && Array.isArray(payload.documents)) {
      // Standard document delivery
      documents = payload.documents;
      searchId = payload.search_id || payload.search?.id;
    } else if (payload.results && Array.isArray(payload.results)) {
      // Alternative format
      documents = payload.results;
      searchId = payload.search_id;
    } else if (payload.data && Array.isArray(payload.data)) {
      // Another possible format
      documents = payload.data;
      searchId = payload.metadata?.search_id;
    } else if (payload.document) {
      // Single document update
      documents = [payload.document];
      searchId = payload.search_id;
    }
    
    if (documents.length === 0) {
      console.log("No documents in webhook payload");
      return res.status(200).json({ 
        ok: true, 
        message: 'No documents to process',
        received: new Date().toISOString()
      });
    }
    
    // Transform and store documents
    const mentions = [];
    const timestamp = Math.floor(Date.now() / 1000);
    
    for (const doc of documents) {
      const mention = transformMeltwaterDocument(doc);
      mentions.push(mention);
      
      // Store in Redis sorted set
      await redis.zadd(ZSET, {
        score: mention.published_ts || timestamp,
        member: JSON.stringify(mention)
      });
    }
    
    // Update sentiment tracking
    await updateSentiment(documents);
    
    // Check for spikes
    let spike = null;
    if (searchId) {
      spike = await detectSpike(searchId, documents.length);
    }
    
    // Log webhook receipt
    console.log(`Meltwater webhook: ${mentions.length} documents processed${spike ? ' (spike detected)' : ''}`);
    
    // Return success response
    res.status(200).json({
      ok: true,
      processed: mentions.length,
      search_id: searchId,
      spike_detected: spike !== null,
      received: new Date().toISOString()
    });
    
  } catch (e) {
    console.error("Webhook error:", e);
    res.status(500).json({ 
      ok: false, 
      error: process.env.NODE_ENV === 'development' ? e?.message : 'Processing error'
    });
  }
}
