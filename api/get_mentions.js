// /api/get_mentions.js
// HYBRID VERSION: Pulls from Redis (Google Alerts, RSS) AND Meltwater API
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const ZSET = "mentions:z";

function toObj(x) {
  if (!x) return null;
  if (typeof x === "object" && x.id) return x;
  try { return JSON.parse(typeof x === "string" ? x : x.toString("utf-8")); }
  catch { return null; }
}

async function getMeltwaterArticles() {
  const MELTWATER_API_KEY = process.env.MELTWATER_API_KEY;
  const SEARCH_ID = '27558498';
  
  if (!MELTWATER_API_KEY) {
    console.log('Meltwater API key not configured, skipping Meltwater fetch');
    return [];
  }

  try {
    // Calculate last 24 hours
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    const startDate = yesterday.toISOString().split('.')[0];
    const endDate = now.toISOString().split('.')[0];

    // Call Meltwater API
    const meltwaterResponse = await fetch(`https://api.meltwater.com/v3/search/${SEARCH_ID}`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'apikey': MELTWATER_API_KEY
      },
      body: JSON.stringify({
        start: startDate,
        end: endDate,
        tz: "America/New_York",
        sort_by: "date",
        sort_order: "desc",
        template: {
          name: "api.json"
        }
      })
    });

    if (!meltwaterResponse.ok) {
      console.error('Meltwater API error:', meltwaterResponse.status);
      return [];
    }

    const meltwaterData = await meltwaterResponse.json();
    
    // Extract articles from response
    let articles = [];
    if (meltwaterData.results) {
      articles = meltwaterData.results;
    } else if (meltwaterData.documents) {
      articles = meltwaterData.documents;
    } else if (Array.isArray(meltwaterData)) {
      articles = meltwaterData;
    } else if (meltwaterData.data && Array.isArray(meltwaterData.data)) {
      articles = meltwaterData.data;
    }

    // Transform to match your data format
    return articles.map(article => ({
      id: `mw_api_${article.id || article.document_id || Date.now()}_${Math.random()}`,
      title: article.title || article.headline || 'Untitled',
      link: article.url || article.link || article.permalink || '#',
      source: article.source_name || article.source || article.media_name || 'Meltwater',
      section: 'Meltwater',
      origin: 'meltwater',
      published: article.published_date || article.date || article.published_at || new Date().toISOString(),
      published_ts: article.published_timestamp || 
                    (article.published_date ? Math.floor(Date.parse(article.published_date) / 1000) : Math.floor(Date.now() / 1000)),
      matched: extractKeywords(article),
      reach: article.reach || article.circulation || article.audience || 0,
      sentiment: normalizeSentiment(article),
      sentiment_label: article.sentiment || article.sentiment_label || null
    }));
  } catch (error) {
    console.error('Error fetching from Meltwater API:', error);
    return [];
  }
}

function normalizeSentiment(article) {
  if (typeof article.sentiment_score === 'number') {
    return article.sentiment_score;
  }
  const sentiment = (article.sentiment || '').toLowerCase();
  if (sentiment === 'positive') return 1;
  if (sentiment === 'negative') return -1;
  if (sentiment === 'neutral') return 0;
  return undefined;
}

function extractKeywords(article) {
  const keywords = [];
  if (article.source_type) keywords.push(article.source_type);
  if (article.sentiment) keywords.push(`sentiment-${article.sentiment.toLowerCase()}`);
  if (article.country) keywords.push(article.country);
  if (article.tags && Array.isArray(article.tags)) keywords.push(...article.tags);
  
  const title = (article.title || '').toLowerCase();
  const coinbaseKeywords = ['bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'cryptocurrency', 'coinbase'];
  coinbaseKeywords.forEach(keyword => {
    if (title.includes(keyword)) keywords.push(keyword);
  });
  
  return [...new Set(keywords)];
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    const limit = Math.max(1, Math.min(1000, parseInt(url.searchParams.get("limit") || "300", 10)));
    const origin = (url.searchParams.get("origin") || "").toLowerCase().trim();
    const section = (url.searchParams.get("section") || "").trim();
    const q = (url.searchParams.get("q") || "").toLowerCase().trim();

    // Get data from Redis (Google Alerts, RSS feeds, etc.)
    let redisItems = [];
    try {
      const raw = await redis.zrange(ZSET, 0, limit - 1, { rev: true });
      redisItems = raw.map(toObj).filter(Boolean);
    } catch (redisError) {
      console.error("Redis fetch error:", redisError);
    }

    // Get fresh Meltwater data from API
    const meltwaterItems = await getMeltwaterArticles();
    
    // Filter out old Meltwater items from Redis (to avoid duplicates)
    redisItems = redisItems.filter(item => {
      const itemOrigin = (item.origin || "").toLowerCase();
      return itemOrigin !== 'meltwater';
    });
    
    // Combine all items
    let items = [...meltwaterItems, ...redisItems];
    
    // Apply filters
    if (origin) {
      items = items.filter(m => (m.origin || "").toLowerCase() === origin);
    }
    if (section) {
      items = items.filter(m => (m.section || "") === section);
    }
    if (q) {
      items = items.filter(m => 
        (m.title || "").toLowerCase().includes(q) || 
        (m.source || "").toLowerCase().includes(q) ||
        (m.matched || []).some(tag => tag.toLowerCase().includes(q))
      );
    }

    // Sort by date (newest first)
    items.sort((a, b) => {
      const tsA = b.published_ts || 0;
      const tsB = a.published_ts || 0;
      return tsA - tsB;
    });

    // Apply limit
    const out = items.slice(0, limit).map(m => ({
      id: m.id,
      title: m.title || "(untitled)",
      link: m.link || null,
      source: m.source || "",
      section: m.section || "",
      origin: m.origin || "",
      matched: Array.isArray(m.matched) ? m.matched : [],
      published: m.published || (m.published_ts ? new Date(m.published_ts * 1000).toISOString() : null),
      published_ts: typeof m.published_ts === "number" ? m.published_ts : (m.published ? Math.floor(Date.parse(m.published) / 1000) : 0),
      reach: m.reach || 0,
      sentiment: m.sentiment,
      sentiment_label: m.sentiment_label || null
    }));

    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
