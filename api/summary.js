// /api/summary.js
// HYBRID VERSION: Counts from Redis (Google Alerts, RSS) AND Meltwater API
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const ZSET = "mentions:z";

/* --- time windows (ET "today") --- */
function rangeTodayET() {
  const now = new Date();
  const nowET = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const startET = new Date(nowET.getFullYear(), nowET.getMonth(), nowET.getDate(), 0, 0, 0, 0);
  const delta = nowET.getTime() - now.getTime();
  const start = Math.floor((startET.getTime() - delta) / 1000);
  const end = start + 24 * 60 * 60;
  return [start, end];
}

function range24h() {
  const end = Math.floor(Date.now() / 1000);
  const start = end - 24 * 60 * 60;
  return [start, end];
}

/* --- helpers --- */
function toObj(x) {
  if (!x) return null;
  if (typeof x === "object" && x.id) return x;
  try { return JSON.parse(String(x)); } catch { return null; }
}

function safeHost(u) { 
  try { 
    const url = new URL(u);
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch { 
    return ""; 
  }
}

/* RSS hosts */
const RSS_HOSTS = new Set([
  "coindesk.com",
  "theblock.co",
  "cointelegraph.com",
  "decrypt.co",
  "blockworks.co",
  "news.bitcoin.com",
  "crypto.news",
  "newsbtc.com",
  "u.today",
  "cryptopanic.com",
  "bitcoinist.com",
  "99bitcoins.com",
  "bitcoinnews.com",
]);

function detectOrigin(m) {
  if (m && typeof m.origin === "string" && m.origin) return m.origin;

  const prov = (m?.provider || "").toLowerCase();
  if (
    prov.includes("meltwater") ||
    m?.section === "Meltwater" ||
    (Array.isArray(m?.matched) && m.matched.includes("meltwater-alert"))
  ) {
    return "meltwater";
  }

  const host = safeHost(m?.link || m?.canon || "");
  if (host && RSS_HOSTS.has(host)) return "rss";

  return "google_alerts";
}

async function getMeltwaterCount(window) {
  const MELTWATER_API_KEY = process.env.MELTWATER_API_KEY;
  const SEARCH_ID = '27558498';
  
  if (!MELTWATER_API_KEY) {
    console.log('Meltwater API key not configured');
    return 0;
  }

  try {
    const now = new Date();
    let startDate, endDate;
    
    if (window === "today") {
      const todayET = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
      todayET.setHours(0, 0, 0, 0);
      startDate = todayET.toISOString().split('.')[0];
      endDate = now.toISOString().split('.')[0];
    } else {
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split('.')[0];
      endDate = now.toISOString().split('.')[0];
    }

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
        page_size: 100
      })
    });

    if (!response.ok) {
      console.error('Meltwater API error:', response.status);
      return 0;
    }

    const data = await response.json();
    
    let articles = [];
    if (data.results) articles = data.results;
    else if (data.documents) articles = data.documents;
    else if (Array.isArray(data)) articles = data;
    else if (data.data && Array.isArray(data.data)) articles = data.data;
    
    return articles.length;
  } catch (error) {
    console.error('Error fetching Meltwater count:', error);
    return 0;
  }
}

export default async function handler(req, res) {
  try {
    const win = (req.query?.window || req.query?.w || "today").toString();
    const [start, end] = win === "24h" ? range24h() : rangeTodayET();

    // Fetch from Redis (Google Alerts, RSS feeds)
    const raw = await redis.zrange(ZSET, 0, 5000, { rev: true });
    const items = raw.map(toObj).filter(Boolean);

    // Filter to window and exclude old Meltwater data from Redis
    const inWin = items.filter((m) => {
      // Exclude Meltwater items from Redis (we'll get fresh from API)
      if ((m.origin || "").toLowerCase() === "meltwater") return false;
      
      const ts = Number(m?.published_ts ?? NaN);
      return Number.isFinite(ts) ? ts >= start && ts < end : true;
    });

    // Count Redis items by origin
    const by = { meltwater: 0, google_alerts: 0, rss: 0, reddit: 0, x: 0, other: 0 };
    for (const m of inWin) {
      const o = detectOrigin(m);
      if (by.hasOwnProperty(o)) by[o] += 1;
      else by.other += 1;
    }
    
    // Get fresh Meltwater count from API
    const meltwaterCount = await getMeltwaterCount(win === "24h" ? "24h" : "today");
    by.meltwater = meltwaterCount;
    
    const total = Object.values(by).reduce((a, b) => a + b, 0);

    res.status(200).json({
      ok: true,
      window: win === "24h" ? "24h" : "today",
      totals: { all: total, by_origin: by },
      top_publishers: [],
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
