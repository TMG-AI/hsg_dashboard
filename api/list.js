import { Redis } from "@upstash/redis";
const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
const ZSET = "mentions:z";

function windowToSeconds(w = "24h") {
  const x = String(w).toLowerCase();
  if (x === "7d") return 7 * 24 * 3600;
  if (x === "30d") return 30 * 24 * 3600;
  return 24 * 3600;
}

export default async function handler(req, res){
  try{
    if (req.method !== "GET") { res.status(405).send("Use GET"); return; }

    const win    = (req.query.window || "24h");
    const origin = String(req.query.origin || "all").toLowerCase(); // meltwater|rss|reddit|x|all
    const limit  = Math.min(parseInt(req.query.limit || "50", 10) || 50, 200);

    const now = Math.floor(Date.now()/1000);
    const since = now - windowToSeconds(win);

    const rows = await redis.zrange(ZSET, since, now, { byScore: true });

    const items = [];
    for (const raw of rows) {
      try {
        const m = JSON.parse(raw);
        const o = (m.origin || "").toLowerCase();
        if (origin !== "all" && o !== origin) continue;

        // prefer public link; fallback to Meltwater permalink
        const link = m.link || m?.provider_meta?.permalink || null;

        items.push({
          id: m.id,
          origin: o || null,
          source: m.source || null,
          title: m.title || "(untitled)",
          link,
          reach: m?.provider_meta?.reach ?? null,
          published_ts: m.published_ts,
          published: m.published
        });
      } catch {}
    }

    // newest first
    items.sort((a,b) => (b.published_ts||0) - (a.published_ts||0));

    res.status(200).json({
      ok: true,
      window: win,
      origin,
      count: Math.min(items.length, limit),
      items: items.slice(0, limit),
      generated_at: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}
