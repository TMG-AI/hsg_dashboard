import { Redis } from "@upstash/redis";
const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
const ZSET = "mentions:z";

function etBoundsToday() {
  const nowUtc = new Date();
  const etNow = new Date(nowUtc.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const y = etNow.getFullYear(), m = etNow.getMonth(), d = etNow.getDate();
  const offsetMs = etNow.getTime() - nowUtc.getTime();      // -4h/-5h
  const startUtcMs = Date.UTC(y, m, d) - offsetMs;          // midnight ET in UTC
  return { since: Math.floor(startUtcMs/1000), until: Math.floor(Date.now()/1000) };
}

function windowToRange(win = "24h") {
  const now = Math.floor(Date.now()/1000);
  const w = String(win).toLowerCase();
  if (w === "today" || w === "today_et") return etBoundsToday();
  if (w === "7d")  return { since: now - 7*24*3600,  until: now };
  if (w === "30d") return { since: now - 30*24*3600, until: now };
  return { since: now - 24*3600, until: now };
}

function parseMember(member) {
  if (member == null) return null;
  if (typeof member === "object") return member;         // already an object (Upstash sometimes does this)
  if (typeof member === "string") {
    try { return JSON.parse(member); } catch { return null; }
  }
  try { return JSON.parse(String(member)); } catch { return null; }
}

export default async function handler(req, res){
  try{
    if (req.method !== "GET") { res.status(405).send("Use GET"); return; }

    const win = req.query.window || "24h";
    const { since, until } = windowToRange(win);

    // Pull newest first (up to 2000), then filter by each item's published_ts
    const rows = await redis.zrange(ZSET, 0, 2000, { rev: true });

    let total = 0;
    const byOrigin = { meltwater: 0, rss: 0, reddit: 0, x: 0, other: 0 };
    const byPublisher = {};
    const articlesByPublisher = {};

    for (const member of rows) {
      const m = parseMember(member);
      if (!m) continue;

      const ts = Number(m.published_ts ?? 0);
      if (!Number.isFinite(ts) || ts < since || ts > until) continue;

      const origin = String(m.origin || "").toLowerCase();
      total++;
      if (byOrigin[origin] === undefined) byOrigin.other++;
      else byOrigin[origin]++;

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
      window: String(win),
      totals: { all: total, by_origin: byOrigin },
      top_publishers,
      generated_at: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}
