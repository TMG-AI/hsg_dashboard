// /api/get_mentions.js
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const ZSET = "mentions:z";

function toObj(x){
  if (!x) return null;
  if (typeof x === "object" && x.id) return x;
  try { return JSON.parse(typeof x === "string" ? x : x.toString("utf-8")); }
  catch { return null; }
}

export default async function handler(req, res){
  try{
    const url = new URL(req.url, "http://localhost");
    const limit  = Math.max(1, Math.min(1000, parseInt(url.searchParams.get("limit") || "300", 10)));
    const origin = (url.searchParams.get("origin") || "").toLowerCase().trim(); // e.g. "meltwater"
    const section= (url.searchParams.get("section")||"").trim();
    const q      = (url.searchParams.get("q")||"").toLowerCase().trim();

    // newest first
    const raw = await redis.zrange(ZSET, 0, limit - 1, { rev: true });
    let items = raw.map(toObj).filter(Boolean);

    // filters
    if (origin)  items = items.filter(m => (m.origin||"").toLowerCase() === origin);
    if (section) items = items.filter(m => (m.section||"") === section);
    if (q)       items = items.filter(m => ((m.title||"").toLowerCase().includes(q) || (m.source||"").toLowerCase().includes(q)));

    // ensure fields front-end expects, including reach & sentiment
    const out = items.map(m => {
      const reach = (typeof m.reach === "number")
        ? m.reach
        : (typeof m.provider_meta?.reach === "number" ? m.provider_meta.reach : 0);

      const sentiment = (typeof m.sentiment === "number")
        ? m.sentiment
        : (typeof m.provider_meta?.sentiment === "number" ? m.provider_meta.sentiment : undefined);

      const sentiment_label = m.sentiment_label || m.provider_meta?.sentiment_label || null;

      return {
        id: m.id,
        title: m.title || "(untitled)",
        link: m.link || null,
        source: m.source || "",
        section: m.section || "",
        origin: m.origin || "",
        matched: Array.isArray(m.matched) ? m.matched : [],
        published: m.published || (m.published_ts ? new Date(m.published_ts*1000).toISOString() : null),
        published_ts: typeof m.published_ts === "number" ? m.published_ts : (m.published ? Math.floor(Date.parse(m.published)/1000) : 0),

        // NEW: expose to UI
        reach,
        sentiment,         // -1, 0, 1 (or undefined if not present)
        sentiment_label,   // "Positive" | "Neutral" | "Negative" | null
      };
    });

    res.status(200).json(out);
  }catch(e){
    res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}
