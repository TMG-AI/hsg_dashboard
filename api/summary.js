import { Redis } from "@upstash/redis";
const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
const ZSET = "mentions:z";

// ---- helpers ----
function etBoundsToday() {
  const nowUtc = new Date();
  const etNow = new Date(nowUtc.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const y = etNow.getFullYear(), m = etNow.getMonth(), d = etNow.getDate();
  const offsetMs = etNow.getTime() - nowUtc.getTime(); // ET–UTC offset
  const startUtcMs = Date.UTC(y, m, d) - offsetMs;     // midnight ET in UTC
  return { since: Math.floor(startUtcMs/1000), until: Math.floor(Date.now()/1000) };
}
function parseMember(member) {
  if (member == null) return null;
  if (typeof member === "object") return member;
  if (typeof member === "string") { try { return JSON.parse(member); } catch { return null; } }
  try { return JSON.parse(String(member)); } catch { return null; }
}
function hostOf(u){
  try { return new URL(u).hostname.toLowerCase(); } catch { return ""; }
}

export default async function handler(req, res){
  try{
    if (req.method !== "GET") { res.status(405).send("Use GET"); return; }

    // always Today (ET)
    const { since, until } = etBoundsToday();

    // newest first; evaluate by each item's published_ts
    const rows = await redis.zrange(ZSET, 0, 2000, { rev: true });

    // requested buckets
    const counts = { google_alerts: 0, meltwater: 0, rss: 0, reddit: 0, x: 0 };
    let total = 0;

    // for "Top Outlets (Today)" (news only: Meltwater news + RSS)
    const byPublisher = {};          // { publisher: { reach, count } }
    const articlesByPublisher = {};  // { publisher: [ { title, link, reach } ] }

    for (const member of rows) {
      const m = parseMember(member);
      if (!m) continue;

      const ts = Number(m?.published_ts ?? 0);
      if (!Number.isFinite(ts) || ts < since || ts > until) continue;

      const section   = String(m.section || "").toLowerCase().trim();
      const provider  = String(m.provider || "").toLowerCase().trim();
      const rawOrigin = String(m.origin || "").toLowerCase().trim();
      const sourceTxt = String(m.source || "").toLowerCase().trim();
      const link      = m.link || m?.provider_meta?.permalink || null;
      const h         = hostOf(link);

      const isMwLike =
        section === "meltwater" ||
        provider === "meltwater" ||
        (Array.isArray(m.matched) && m.matched.includes("meltwater-alert")) ||
        (m?.provider_meta?.permalink && String(m.provider_meta.permalink).includes("meltwater")) ||
        (m?.provider_meta?.links?.app && String(m.provider_meta.links.app).includes("meltwater"));

      const isTwitter = sourceTxt === "twitter" || sourceTxt === "x" ||
                        sourceTxt.includes("twitter") || h.includes("twitter.com") || h.includes("x.com");
      const isReddit  = sourceTxt.includes("reddit") || h.includes("reddit.com");

      // Google Alerts detection (subset of RSS)
      const isGoogleAlert = (sourceTxt.includes("google alerts") ||
                             (h.includes("google.com") && String(link||"").toLowerCase().includes("/alerts")));

      // classify into one of the requested buckets
      if (isMwLike) {
        if (isTwitter) { counts.x++; total++; }
        else if (isReddit) { counts.reddit++; total++; }
        else { counts.meltwater++; total++; }
      } else if (rawOrigin === "rss" || section === "rss") {
        if (isGoogleAlert) { counts.google_alerts++; total++; }
        else { counts.rss++; total++; }
      } else {
        // ignore other origins for these totals (keeps "Today" focused on your asked buckets)
      }

      // Build Top Outlets (Today): Meltwater *news* + all RSS
      const isNewsForTop =
        (isMwLike && !isTwitter && !isReddit) || // MW news only
        (rawOrigin === "rss" || section === "rss");

      if (isNewsForTop) {
        const pub = (m.source || "Unknown").trim();
        const reach = parseInt(m?.provider_meta?.reach || 0, 10) || 0;
        if (!byPublisher[pub]) byPublisher[pub] = { reach: 0, count: 0 };
        byPublisher[pub].reach += reach;
        byPublisher[pub].count++;
        if (!articlesByPublisher[pub]) articlesByPublisher[pub] = [];
        articlesByPublisher[pub].push({
          title: m.title || "(untitled)",
          link,
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
      window: "today",
      totals: {
        all: total,
        by_origin: {
          google_alerts: counts.google_alerts,
          meltwater: counts.meltwater,
          rss: counts.rss,
          reddit: counts.reddit,   // from Meltwater
          x: counts.x              // from Meltwater
        }
      },
      top_publishers,
      generated_at: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}
