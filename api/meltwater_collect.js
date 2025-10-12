// /api/meltwater_collect.js
// Collects articles from Meltwater API for searchid 27861003
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.STORAGE_KV_REST_API_URL,
  token: process.env.STORAGE_KV_REST_API_TOKEN,
});

const ZSET = "mentions:z";
const SEEN_ID = "mentions:seen";
const SEEN_LINK = "mentions:seen:canon";
const MAX_MENTIONS = 5000;

// Meltwater API configuration
const MELTWATER_API_KEY = process.env.MELTWATER_API_KEY;
const MELTWATER_SEARCH_ID = "27861003";

// Helper functions
function normalizeUrl(u) {
  try {
    const url = new URL(u);
    url.hash = "";
    ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","utm_id",
     "mc_cid","mc_eid","ref","fbclid","gclid","igshid"].forEach(p => url.searchParams.delete(p));
    if ([...url.searchParams.keys()].length === 0) url.search = "";
    url.hostname = url.hostname.toLowerCase();
    let s = url.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return (u || "").trim();
  }
}

function hostOf(u) {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function normalizeHost(h) {
  return (h || "").toLowerCase().replace(/^www\./, "").replace(/^amp\./, "");
}

function displaySource(link, fallback) {
  const h = normalizeHost(hostOf(link));
  return h || (fallback || "Meltwater");
}

function idFromCanonical(c) {
  let h = 0;
  for (let i = 0; i < c.length; i++) h = (h * 31 + c.charCodeAt(i)) >>> 0;
  return `mw_api_${h.toString(16)}`;
}

function toEpoch(d) {
  const t = Date.parse(d);
  return Number.isFinite(t) ? Math.floor(t / 1000) : Math.floor(Date.now() / 1000);
}

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

  // Extract China-related keywords from content
  const content = (doc.content || doc.title || '').toLowerCase();
  const chinaKeywords = ['china', 'chinese', 'beijing', 'xi jinping', 'ccp'];

  chinaKeywords.forEach(keyword => {
    if (content.includes(keyword)) {
      keywords.push(keyword);
    }
  });

  // Add source type
  if (doc.source_type) {
    keywords.push(`type-${doc.source_type.toLowerCase()}`);
  }

  return [...new Set(keywords)]; // Remove duplicates
}

export default async function handler(req, res) {
  try {
    // Check if Meltwater API is configured
    if (!MELTWATER_API_KEY) {
      console.log('MELTWATER_API_KEY not configured - skipping Meltwater collection');
      return res.status(200).json({
        ok: true,
        message: "Meltwater collection disabled - API key not configured",
        found: 0,
        stored: 0,
        errors: [],
        disabled: true,
        generated_at: new Date().toISOString()
      });
    }

    console.log(`Meltwater collection starting for search ID: ${MELTWATER_SEARCH_ID}`);

    let found = 0, stored = 0, skipped = 0;
    const errors = [];

    // Fetch articles from Meltwater API
    // Fetch recent articles (last 24 hours by default)
    const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const response = await fetch(`https://api.meltwater.com/v2/searches/${MELTWATER_SEARCH_ID}/documents?from=${fromDate}&limit=100`, {
      method: 'GET',
      headers: {
        'apikey': MELTWATER_API_KEY,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Meltwater API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log(`Meltwater API response:`, {
      status: response.status,
      documentCount: data.documents?.length || 0
    });

    // Process documents (adjust field names based on actual Meltwater API response)
    const documents = data.documents || data.results || data.data || [];

    for (const doc of documents) {
      try {
        found++;

        // Extract article data
        const title = doc.title || doc.headline || (doc.content ? doc.content.substring(0, 100) : 'Untitled');
        const link = doc.url || doc.link || '#';
        const content = doc.content || doc.description || doc.snippet || '';
        const source = doc.source?.name || doc.source_name || 'Meltwater';
        const publishedDate = doc.published_date || doc.publishedDate || doc.date || new Date().toISOString();

        // Deduplicate
        const canon = normalizeUrl(link);
        if (!canon) {
          skipped++;
          continue;
        }

        const addCanon = await redis.sadd(SEEN_LINK, canon);
        if (addCanon !== 1) {
          skipped++;
          continue; // Already stored
        }

        const mid = idFromCanonical(canon);
        await redis.sadd(SEEN_ID, mid);

        const ts = toEpoch(publishedDate);

        const mention = {
          id: mid,
          canon,
          section: 'Meltwater',
          title: title,
          link: link,
          source: source,
          matched: extractKeywords(doc),
          summary: content.substring(0, 500),
          origin: 'meltwater',
          published_ts: ts,
          published: new Date(ts * 1000).toISOString(),
          reach: doc.metrics?.reach || doc.metrics?.circulation || 0,
          sentiment: normalizeSentiment(doc),
          sentiment_label: doc.sentiment || null,
          searchid: MELTWATER_SEARCH_ID,
          received_at: new Date().toISOString()
        };

        await redis.zadd(ZSET, {
          score: ts,
          member: JSON.stringify(mention)
        });

        // Trim old entries
        const count = await redis.zcard(ZSET);
        if (count > MAX_MENTIONS) {
          await redis.zremrangebyrank(ZSET, 0, count - MAX_MENTIONS - 1);
        }

        stored++;
        console.log(`[Meltwater] Stored: "${title}" from ${source}`);
      } catch (error) {
        console.error('Error processing Meltwater document:', error, doc);
        errors.push({
          document_id: doc.id || 'unknown',
          error: error?.message || String(error)
        });
      }
    }

    console.log(`Meltwater collection complete: ${found} articles found, ${stored} stored, ${skipped} skipped`);

    res.status(200).json({
      ok: true,
      search_id: MELTWATER_SEARCH_ID,
      found,
      stored,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
      generated_at: new Date().toISOString()
    });
  } catch (e) {
    console.error('Meltwater collection error:', e);
    res.status(500).json({
      ok: false,
      error: `Meltwater collection failed: ${e?.message || e}`
    });
  }
}
