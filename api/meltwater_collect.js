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
const RETENTION_DAYS = 14; // Keep articles for 14 days

// Meltwater API configuration
// Environment variables will be loaded inside handler for better reliability

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


export default async function handler(req, res) {
  // Load environment variables inside handler for better reliability
  const MELTWATER_API_KEY = process.env.MELTWATER_API_KEY;
  const MELTWATER_SEARCH_ID = "27861003"; // HSG dashboard search ID

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

    // Fetch articles from Meltwater API v3
    // Fetch recent articles (last 24 hours by default)
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Format properly for Meltwater (remove milliseconds)
    const startDate = yesterday.toISOString().replace(/\.\d{3}Z$/, '');
    const endDate = now.toISOString().replace(/\.\d{3}Z$/, '');

    const requestBody = {
      start: startDate,
      end: endDate,
      tz: "America/New_York",
      sort_by: "date",
      sort_order: "desc",
      template: {
        name: "api.json"
      },
      page_size: 100
    };

    const response = await fetch(`https://api.meltwater.com/v3/search/${MELTWATER_SEARCH_ID}`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'apikey': MELTWATER_API_KEY
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Meltwater API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // FIXED: Meltwater v3 API returns data.result.documents, not data.results
    const documents = data.result?.documents || [];

    console.log(`Meltwater API v3 response:`, {
      status: response.status,
      totalResults: data.result?.document_count || 0,
      documentCount: documents.length
    });

    for (const doc of documents) {
      try {
        found++;

        // Filter: Skip non-US articles
        const country = doc.country || doc.media?.country || doc.source?.country || '';
        if (country && country.toLowerCase() !== 'us' && country.toLowerCase() !== 'usa' && country.toLowerCase() !== 'united states') {
          console.log(`[Meltwater] Skipping non-US article from ${country}`);
          skipped++;
          continue;
        }

        // Extract article data from Meltwater v3 API structure
        const title = doc.content?.title || doc.title || doc.headline || 'Untitled';
        const link = doc.content?.url || doc.url || doc.link || '#';
        // Get full article text/summary (don't truncate)
        const contentText = doc.content?.text || doc.content?.byline || doc.description || doc.snippet || '';
        const source = doc.source?.name || doc.source_name || doc.media?.name || 'Meltwater';
        const publishedDate = doc.document?.published_date || doc.published_date || doc.date || new Date().toISOString();

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
          summary: contentText,
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

        // Trim articles older than RETENTION_DAYS
        const cutoffTimestamp = Math.floor(Date.now() / 1000) - (RETENTION_DAYS * 24 * 60 * 60);
        await redis.zremrangebyscore(ZSET, '-inf', cutoffTimestamp);

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
