// Debug script to find and analyze scmp.com articles
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
  } catch { return null; }
}

export default async function handler(req, res) {
  try {
    // Get all articles
    const raw = await redis.zrange(ZSET, 0, -1);
    const articles = raw.map(toObj).filter(Boolean);

    // Find all scmp.com articles
    const scmpArticles = articles.filter(a =>
      (a.source && a.source.toLowerCase().includes('scmp')) ||
      (a.link && a.link.toLowerCase().includes('scmp.com')) ||
      (a.provider && a.provider.toLowerCase().includes('scmp'))
    );

    // Group by origin
    const byOrigin = {};
    const byDate = {};

    scmpArticles.forEach(a => {
      const origin = a.origin || 'unknown';
      if (!byOrigin[origin]) byOrigin[origin] = [];
      byOrigin[origin].push(a);

      const date = new Date(a.published_ts * 1000).toISOString().split('T')[0];
      if (!byDate[date]) byDate[date] = [];
      byDate[date].push(a);
    });

    // Get most recent
    const sorted = scmpArticles.sort((a, b) => b.published_ts - a.published_ts);
    const mostRecent = sorted.slice(0, 10);

    return res.status(200).json({
      ok: true,
      total_articles: articles.length,
      scmp_articles_found: scmpArticles.length,
      by_origin: Object.entries(byOrigin).map(([origin, arts]) => ({
        origin,
        count: arts.length
      })),
      by_date: Object.entries(byDate).map(([date, arts]) => ({
        date,
        count: arts.length
      })).sort((a, b) => b.date.localeCompare(a.date)),
      most_recent_scmp: mostRecent.map(a => ({
        title: a.title,
        source: a.source,
        origin: a.origin,
        published: a.published,
        published_ts: a.published_ts,
        link: a.link
      }))
    });

  } catch (e) {
    console.error('Debug SCMP error:', e);
    res.status(500).json({
      ok: false,
      error: e?.message || String(e)
    });
  }
}
