// /api/meltwater_debug.js
// Debug endpoint to see what the analysis is actually doing
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.STORAGE_KV_REST_API_URL,
  token: process.env.STORAGE_KV_REST_API_TOKEN,
});

const ZSET = "mentions:z";

function toObj(x) {
  if (!x) return null;
  if (typeof x === "object" && x.id) return x;
  try {
    return JSON.parse(x);
  } catch {
    return null;
  }
}

function detectOrigin(m) {
  if (m && typeof m.origin === "string" && m.origin && m.origin !== "") {
    return m.origin;
  }

  if (
    m?.section === "Newsletter" ||
    (Array.isArray(m?.matched) && m.matched.includes("newsletter")) ||
    (m?.id && m.id.startsWith("newsletter_"))
  ) {
    return "newsletter";
  }

  const prov = (m?.provider || "").toLowerCase();
  if (
    prov.includes("meltwater") ||
    m?.section === "Meltwater" ||
    (Array.isArray(m?.matched) && m.matched.includes("meltwater-alert")) ||
    (m?.id && m.id.startsWith("mw_stream_"))
  ) {
    return "meltwater";
  }

  if (m?.section === "Congress" || (m?.id && m.id.startsWith("congress_"))) {
    return "congress";
  }

  return "google_alerts";
}

export default async function handler(req, res) {
  try {
    // Get last 7 days
    const days = 7;
    const now = Math.floor(Date.now() / 1000);
    const startTime = now - days * 24 * 60 * 60;

    // Fetch all articles from Redis
    const raw = await redis.zrange(ZSET, 0, 10000, { rev: true });
    const items = raw.map(toObj).filter(Boolean);

    // Filter to time window
    const recentItems = items.filter((m) => {
      const ts = Number(m?.published_ts ?? NaN);
      return Number.isFinite(ts) && ts >= startTime && ts <= now;
    });

    // Separate by origin
    const meltwaterArticles = [];
    const googleAlertsArticles = [];
    const newsletterArticles = [];

    recentItems.forEach((item) => {
      const origin = detectOrigin(item);
      if (origin === "meltwater") {
        meltwaterArticles.push(item);
      } else if (origin === "google_alerts") {
        googleAlertsArticles.push(item);
      } else if (origin === "newsletter") {
        newsletterArticles.push(item);
      }
    });

    // Sample articles for debugging
    const sampleMeltwater = meltwaterArticles.slice(0, 3).map(m => ({
      id: m.id,
      title: m.title,
      summary: typeof m.summary === 'string' ? m.summary?.substring(0, 200) : JSON.stringify(m.summary)?.substring(0, 200),
      link: m.link,
      source: m.source || m.provider,
      origin: detectOrigin(m)
    }));

    const sampleGoogleAlerts = googleAlertsArticles.slice(0, 3).map(m => ({
      id: m.id,
      title: m.title,
      summary: typeof m.summary === 'string' ? m.summary?.substring(0, 200) : JSON.stringify(m.summary)?.substring(0, 200),
      link: m.link,
      source: m.source || m.provider,
      origin: detectOrigin(m)
    }));

    const sampleNewsletters = newsletterArticles.slice(0, 3).map(m => ({
      id: m.id,
      title: m.title,
      summary: typeof m.summary === 'string' ? m.summary?.substring(0, 200) : JSON.stringify(m.summary)?.substring(0, 200),
      link: m.link,
      source: m.source || m.provider,
      origin: detectOrigin(m)
    }));

    res.status(200).json({
      ok: true,
      time_period: {
        days: days,
        start: new Date(startTime * 1000).toISOString(),
        end: new Date(now * 1000).toISOString(),
      },
      counts: {
        total: recentItems.length,
        meltwater: meltwaterArticles.length,
        google_alerts: googleAlertsArticles.length,
        newsletters: newsletterArticles.length,
      },
      samples: {
        meltwater: sampleMeltwater,
        google_alerts: sampleGoogleAlerts,
        newsletters: sampleNewsletters,
      },
      analysis: {
        has_meltwater: meltwaterArticles.length > 0,
        has_google_alerts: googleAlertsArticles.length > 0,
        has_newsletters: newsletterArticles.length > 0,
        potential_issue: meltwaterArticles.length > 0 && googleAlertsArticles.length === 0 && newsletterArticles.length === 0 ?
          "No Google Alerts or Newsletter articles found to compare against. Meltwater will appear 100% unique by default." : null
      }
    });
  } catch (e) {
    console.error("Meltwater debug error:", e);
    res.status(500).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
}
