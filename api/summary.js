import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN
});
const ZSET = "mentions:z";

// Start of "today" in ET (EDT offset used during summer)
function startOfTodayET(){
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now).reduce((o,p)=>{ if(p.type!=="literal") o[p.type]=p.value; return o; }, {});
  const iso = `${parts.year}-${parts.month}-${parts.day}T00:00:00-04:00`;
  return Math.floor(new Date(iso).getTime()/1000);
}

const safeParse = (s) => { try { return JSON.parse(s); } catch { return null; } };

function detectOrigin(m){
  if (m.origin) return m.origin;
  const tags = Array.isArray(m.matched) ? m.matched.map(x => String(x).toLowerCase()) : [];
  if (tags.includes("meltwater-alert")) return "meltwater";
  try {
    const u = m.link ? new URL(m.link) : null;
    if (u && /news\.google\./i.test(u.hostname)) return "google_alerts";
  } catch {}
  return "rss";
}

export default async function handler(req, res){
  try{
    const window = (req.query.window || "today").toLowerCase();
    const end = Math.floor(Date.now()/1000);
    const start = window === "today" ? startOfTodayET() : (end - 24*3600);

    // ✅ Upstash SDK: use zrange with { byScore: true }
    const raw = await redis.zrange(ZSET, start, end, { byScore: true });
    const items = raw.map(safeParse).filter(Boolean);

    // Remove obvious test data (UI screenshots you sent)
    const clean = items.filter(m => {
      const t = (m?.title||"").toLowerCase();
      const s = (m?.source||"").toLowerCase();
      const l = (m?.link||"").toLowerCase();
      const i = (m?.id||"").toLowerCase();
      if (i.startsWith("debug_")) return false;
      if (s.includes("example news") || s.includes("debug source")) return false;
      if (l.includes("example.com")) return false;
      if (t.includes("forced write test") || t.includes("mw clamp test")
          || t.includes("sanity write") || t.includes("browser → n8n test")
          || t.includes("browser -> n8n test")) return false;
      // Hide "coinbase headline" only when it was from Example News
      if (t.includes("coinbase headline") && s.includes("example news")) return false;
      return true;
    });

    const by_origin = { meltwater:0, google_alerts:0, rss:0, reddit:0, x:0, other:0 };
    for (const m of clean){
      const o = detectOrigin(m);
      if (by_origin[o] == null) by_origin.other++; else by_origin[o]++;
    }

    // Top publishers (Meltwater) using reach if available
    const pubs = new Map();
    for (const m of clean){
      if (detectOrigin(m) !== "meltwater") continue;
      const pub = m.source || "Unknown";
      const reach = Number(m?.provider_meta?.reach ?? m?.meta?.reach ?? 0) || 0;
      const arr = pubs.get(pub) || [];
      arr.push({ title: m.title, link: m.link || null, reach });
      pubs.set(pub, arr);
    }
    const top_publishers = [...pubs.entries()].map(([publisher, arr]) => ({
      publisher,
      total_reach: arr.reduce((a,b)=>a+(b.reach||0),0),
      article_count: arr.length,
      articles: arr.slice(0,5)
    })).sort((a,b)=> (b.total_reach||0)-(a.total_reach||0)).slice(0,5);

    res.status(200).json({
      ok: true,
      window,
      totals: { all: clean.length, by_origin },
      top_publishers,
      generated_at: new Date().toISOString()
    });
  }catch(e){
    res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}
