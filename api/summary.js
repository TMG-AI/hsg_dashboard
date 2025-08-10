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

    const win = req.query.window || "24h";
    const now = Math.floor(Date.now()/1000);
    const since = now - windowToSeconds(win);

    const rows = await redis.zrange(ZSET, since, now, { byScore: true });

    let total = 0;
    const byOrigin = { meltwater: 0, rss: 0, reddit: 0, x: 0, other: 0 };
    const byPublisher = {};

    for (const raw of rows) {
      try {
        const m = JSON.parse(raw);
        total++;

        const o = (m.origin || "").toLowerCase();
        if (byOrigin[o] === undefined) byOrigin.other++;
        else byOrigin[o]++;

        const pub = (m.source || "Unknown").trim();
        byPublisher[pub] = (byPublisher[pub] || 0) + 1;
      } catch {}
    }

    const top_publishers = Object.entries(byPublisher)
      .sort((a,b)=>b[1]-a[1])
      .slice(0,10)
      .map(([publisher,count])=>({ publisher, count }));

    res.status(200).json({
      ok: true,
      window: win,
      totals: { all: total, by_origin: byOrigin },
      top_publishers,
      generated_at: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}
