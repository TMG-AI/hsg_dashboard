// /api/summary.js
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN
});

const ZSET = "mentions:z";

// --- time windows ---
function rangeTodayET(){
  const now = new Date();
  const nowET = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const startET = new Date(nowET.getFullYear(), nowET.getMonth(), nowET.getDate(), 0, 0, 0, 0);
  const delta = nowET.getTime() - now.getTime(); // ET minus UTC
  const start = Math.floor((startET.getTime() - delta) / 1000);
  const end   = start + 24*60*60; // exclusive
  return [start, end];
}
function range24h(){
  const end = Math.floor(Date.now()/1000);
  const start = end - 24*60*60;
  return [start, end];
}

// --- utils ---
function safeHost(u){ try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } }
function toObj(x){ if (!x) return null; try { return (typeof x === "string") ? JSON.parse(x) : x; } catch { return null; } }

// Your RSS hosts (normalize to bare host)
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
  "bitcoinnews.com"
]);

function detectOrigin(m){
  // 1) explicit origin if present
  if (m && typeof m.origin === "string" && m.origin) return m.origin;

  // 2) Meltwater signals
  const prov = (m?.provider || "").toLowerCase();
  if (prov.includes("meltwater") || m?.section === "Meltwater" ||
      (Array.isArray(m?.matched) && m.matched.includes("meltwater-alert"))) {
    return "meltwater";
  }

  // 3) RSS host check
  const host = safeHost(m?.link || m?.canon || "");
  if (host && RSS_HOSTS.has(host)) return "rss";

  // 4) default bucket for non-RSS/non-Meltwater
  return "google_alerts";
}

export default async function handler(req, res){
  try{
    const win = (req.query?.window || req.query?.w || "today").toString();
    const [start, end] = (win === "24h") ? range24h() : rangeTodayET();

    // Upstash JS client: zrange by score
    // Returns newest..oldest? We'll get all and filter in code.
    const raw = await redis.zrange(ZSET, start, end, { byscore: true });
    const items = raw.map(toObj).filter(Boolean);

    // Filter to window by published_ts if present, otherwise trust zset score
    const inWin = items.filter(m => {
      const ts = Number(m?.published_ts || 0);
      return Number.isFinite(ts) ? (ts >= start && ts < end) : true;
    });

    const by = { meltwater: 0, google_alerts: 0, rss: 0, reddit: 0, x: 0, other: 0 };
    for (const m of inWin){
      const o = detectOrigin(m);
      if (by[o] === undefined) by.other++;
      else by[o]++;
    }

    const total = Object.values(by).reduce((a,b)=>a+b, 0);

    res.status(200).json({
      ok: true,
      window: win === "24h" ? "24h" : "today",
      totals: { all: total, by_origin: by },
      top_publishers: [], // (optional, omitted here)
      generated_at: new Date().toISOString()
    });
  }catch(e){
    res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}
