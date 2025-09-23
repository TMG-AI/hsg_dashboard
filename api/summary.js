// /api/summary.js - Updated to use streamed counts
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const ZSET = "mentions:z";
const STREAM_ZSET = "mentions:streamed:z";

function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `meltwater:stream:daily:${year}-${month}-${day}`;
}

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

// Get count of streamed Meltwater mentions for today
async function getStreamedMeltwaterCount(window) {
  try {
    if (window === "today") {
      // Get today's counter directly from Redis
      const todayKey = getTodayKey();
      const count = await redis.get(todayKey);
      console.log(`Streamed Meltwater count for today: ${count || 0}`);
      return parseInt(count || 0);
    } else {
      // For 24h window, count from the streamed set
      const now = Math.floor(Date.now() / 1000);
      const dayAgo = now - (24 * 60 * 60);
      
      // Get streamed mentions from the last 24 hours
      const streamedMentions = await redis.zrangebyscore(
        STREAM_ZSET, 
        dayAgo, 
        now
      );
      
      console.log(`Streamed Meltwater count (24h): ${streamedMentions.length}`);
      return streamedMentions.length;
    }
  } catch (error) {
    console.error('Error getting streamed count:', error);
    return 0;
  }
}

export default async function handler(req, res) {
  try {
    const win = (req.query?.window || req.query?.w || "today").toString();
    const [start, end] = win === "24h" ? range24h() : rangeTodayET();

    // Fetch ALL from Redis (main set)
    const raw = await redis.zrange(ZSET, 0, 5000, { rev: true });
    const items = raw.map(toObj).filter(Boolean);
    console.log(`Total items in Redis: ${items.length}`);

    // Filter to time window
    const inWin = items.filter((m) => {
      const ts = Number(m?.published_ts ?? NaN);
      return Number.isFinite(ts) ? ts >= start && ts < end : true;
    });

    // Initialize counts
    const by = { meltwater: 0, google_alerts: 0, rss: 0, reddit: 0, x: 0, other: 0 };

    // Count non-Meltwater items from Redis
    for (const m of inWin) {
      const o = detectOrigin(m);
      if (o === "meltwater") {
        // Skip - we'll use the streamed count
        continue;
      } else if (by.hasOwnProperty(o)) {
        by[o] += 1;
      } else {
        by.other += 1;
      }
    }

    // Get Meltwater count from streaming data
    const streamedCount = await getStreamedMeltwaterCount(win);
    by.meltwater = streamedCount;

    console.log(`Final counts: MW=${by.meltwater} (streamed), GA=${by.google_alerts}, RSS=${by.rss}`);

    const total = Object.values(by).reduce((a, b) => a + b, 0);

    // Get real-time stats if available
    const realtimeStats = {
      streaming_active: streamedCount > 0,
      last_streamed: await redis.get('meltwater:last_stream_time') || null,
      total_streamed_today: streamedCount
    };

    res.status(200).json({
      ok: true,
      window: win === "24h" ? "24h" : "today",
      totals: { 
        all: total, 
        by_origin: by 
      },
      realtime: realtimeStats,
      top_publishers: [],
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('Summary error:', e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
