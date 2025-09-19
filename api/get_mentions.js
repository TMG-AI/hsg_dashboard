// /api/get_mentions.js
// FINAL VERSION - Uses correct Meltwater response structure (result.documents)
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

async function getMeltwaterFromAPI() {
  const MELTWATER_API_KEY = process.env.MELTWATER_API_KEY;
  const SEARCH_ID = '27558498';
  
  if (!MELTWATER_API_KEY) {
    console.log('No Meltwater API key configured');
    return [];
  }

  try {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    const startDate = yesterday.toISOString().replace(/\.\d{3}Z$/, '');
    const endDate = now.toISOString().replace(/\.\d{3}Z$/, '');

    const response = await fetch(`https://api.meltwater.com/v3/search/${SEARCH_ID}`, {
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
        },
        page_size: 200
      })
    });

    if (!response.ok) {
      console.error('Meltwater API error:', response.status);
      return [];
    }

    const meltwaterData = await response.json();
    
    // FIXED: Get articles from result.documents (your Meltwater structure)
    let articles = [];
    if (meltwaterData.result && meltwaterData.result.documents) {
      articles = meltwaterData.result.documents;
      console.log(`Got ${articles.length} articles from Meltwater API (${meltwaterData.result.document_count} total available)`);
    } else {
      console.log('No documents in Meltwater response');
      return [];
    }

    // Transform to match your format
    return articles.map(article => {
      // Extract data from the nested content structure
      const content = article.content || {};
      const metadata = article.metadata || {};
      const source = article.source || {};
      
      return {
        id: `mw_api_${article.id || metadata.id || Date.now()}_${Math.random()}`,
        title: content.title || article.title || metadata.headline || 'Untitled',
        link: article.url || metadata.url || content.link || '#',
        source: source.name || article.source_name || 'Meltwater',
        section: 'Meltwater (Live)',
        origin: 'meltwater',
        published: article.publish_date || metadata.published_date || new Date().toISOString(),
        published_ts: article.publish_date ? Math.floor(Date.parse(article.publish_date) / 1000) : Math.floor(Date.now() / 1000),
        matched: extractKeywords(article),
        reach: source.reach || metadata.reach || 0,
        sentiment: normalizeSentiment(metadata),
        sentiment_label: metadata.sentiment || null,
        is_from_api: true
      };
    });
  } catch (error) {
    console.error('Meltwater API error:', error);
    return [];
  }
}

function normalizeSentiment(metadata) {
  if (metadata && typeof metadata.sentiment_score === 'number') {
    return metadata.sentiment_score;
  }
  const sentiment = (metadata?.sentiment || '').toLowerCase();
  if (sentiment === 'positive') return 1;
  if (sentiment === 'negative') return -1;
  if (sentiment === 'neutral') return 0;
  return undefined;
}

function extractKeywords(article) {
  const keywords = [];
  const content = article.content || {};
  const metadata = article.metadata || {};
  
  // Add emojis as keywords if present
  if (content.emojis && Array.isArray(content.emojis)) {
    keywords.push(...content.emojis);
  }
  
  // Add hashtags
  if (content.hashtags && Array.isArray(content.hashtags)) {
    keywords.push(...content.hashtags);
  }
  
  // Add sentiment
  if (metadata.sentiment) {
    keywords.push(`sentiment-${metadata.sentiment.toLowerCase()}`);
  }
  
  // Look for crypto keywords in title
  const title = (content.title || '').toLowerCase();
  const cryptoKeywords = ['bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'cryptocurrency', 'coinbase', 'blockchain'];
  cryptoKeywords.forEach(keyword => {
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

    // 1. Get fresh Meltwater from API
    const meltwaterAPIItems = await getMeltwaterFromAPI();
    
    // 2. Create Sets for deduplication
    const apiUrls = new Set(meltwaterAPIItems.map(item => item.link).filter(Boolean));
    const apiTitles = new Set(meltwaterAPIItems.map(item => item.title.toLowerCase()).filter(Boolean));
    
    // 3. Get data from Redis
    let redisItems = [];
    try {
      const raw = await redis.zrange(ZSET, 0, limit * 2, { rev: true });
      redisItems = raw.map(toObj).filter(Boolean);
      console.log(`Found ${redisItems.length} items in Redis`);
    } catch (redisError) {
      console.error("Redis fetch error:", redisError);
    }
    
    // 4. Filter out duplicate Meltwater items from Redis
    const filteredRedisItems = redisItems.filter(item => {
      // Keep all non-Meltwater items
      if (item.origin !== 'meltwater') return true;
      
      // For Meltwater items from Redis, exclude if we have fresh version from API
      if (item.link && apiUrls.has(item.link)) return false;
      if (item.title && apiTitles.has(item.title.toLowerCase())) return false;
      
      // If it's old Meltwater not in API results, exclude it too (it's stale)
      return false; // Don't keep ANY old Meltwater since we have fresh data
    });
    
    // 5. Combine fresh Meltwater with other sources
    let allItems = [...meltwaterAPIItems, ...filteredRedisItems];
    
    // 6. Apply filters
    if (origin) {
      allItems = allItems.filter(m => (m.origin || "").toLowerCase() === origin);
    }
    if (section) {
      allItems = allItems.filter(m => (m.section || "") === section);
    }
    if (q) {
      allItems = allItems.filter(m => 
        (m.title || "").toLowerCase().includes(q) || 
        (m.source || "").toLowerCase().includes(q) ||
        (m.matched || []).some(tag => tag.toLowerCase().includes(q))
      );
    }

    // 7. Sort by date (newest first)
    allItems.sort((a, b) => {
      const tsA = b.published_ts || 0;
      const tsB = a.published_ts || 0;
      return tsA - tsB;
    });

    // 8. Apply limit and return
    const out = allItems.slice(0, limit).map(m => ({
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

    console.log(`Returning ${out.length} items (${meltwaterAPIItems.length} from Meltwater API)`);
    res.status(200).json(out);
  } catch (e) {
    console.error('Handler error:', e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
