import { Redis } from "@upstash/redis";
const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
const ZSET = "mentions:z";

function windowToSeconds(w = "24h") {
  const x = String(w).toLowerCase();
  if (x === "7d") return 7 * 24 * 3600;
  if (x === "30d") return 30 * 24 * 3600;
  return 24 * 3600; // 24h default
}

export default async function handler(req, res){
  try{
    if (req.method !== "GET") { res.status(405).send("Use GET"); return; }

    const win = String(req.query.window || "24h");
    const now = Math.floor(Date.now()/1000);
    const since = now - windowToSeconds(win);

    // Fetch most recent 1000 items (newest first), then filter by published_ts
    const rows = await redis.zrange(ZSET, 0, 1000, { rev: true });

    let total = 0;
    const byOrigin = { meltwater: 0, rss: 0, reddit: 0, x: 0, other: 0 };
    const byPublisher = {};          // { publisher: { reach, count } }
    const articlesByPublisher = {};  // { publisher: [ { title, link, reach } ] }

    for (const member of rows) {
      let m;
      try { m = JSON.parse(typeof member === "string" ? member : String(member)); }
      catch { continue; }

      const ts = Number(m?.published_ts || 0);
      if (!Number.isFinite(ts) || ts < since) continue; // keep only window items

      const origin = (m.origin || "").toLowerCase();
      total++;
      if (byOrigin[origin] === undefined) byOrigin.other++;
      else byOrigin[origin]++;

      // Rank only news outlets (meltwater + rss)
      if (origin === "meltwater" || origin === "rss") {
        const pub = (m.source || "Unknown").trim();
        const reach = parseInt(m?.provider_meta?.reach || 0, 10) || 0;

        if (!byPublisher[pub]) byPublisher[pub] = { reach: 0, count: 0 };
        byPublisher[pub].reach += reach;
        byPublisher[pub].count++;

        if (!articlesByPublisher[pub]) articlesByPublisher[pub] = [];
        articlesByPublisher[pub].push({
          title: m.title || "(untitled)",
          link: m.link || m?.provider_meta?.permalink || null,
          reach
        });
      }
    }

    const top_publishers = Object.entries(byPublisher)
      .sort((a, b) => b[1].reach - a[1].reach)
      .slice(0, 5)
      .map(([publisher, stats]) => ({
        publisher,
        total_reach: stats.reach,
        article_count: stats.count,
        articles: (articlesByPublisher[publisher] || [])
          .slice(0, 5)
          .map(a => ({ title: a.title, link: a.link, reach: a.reach }))
      }));

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
