// Check what Congress articles are actually in Redis ZSET
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.STORAGE_KV_REST_API_URL,
  token: process.env.STORAGE_KV_REST_API_TOKEN,
});

const ZSET = "mentions:z";

export default async function handler(req, res) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const fourteenDaysAgo = now - (14 * 24 * 60 * 60); // Full retention window
    const sevenDaysAgo = now - (7 * 24 * 60 * 60); // get_mentions window

    console.log(`Checking ZSET from ${fourteenDaysAgo} (14 days ago) to ${now} (now)`);

    // Get all items from last 14 days
    const raw = await redis.zrange(ZSET, fourteenDaysAgo, now, { byScore: true, withScores: true });

    console.log(`Fetched ${raw.length} items from Redis`);

    // Parse and filter for Congress articles
    const congressArticles = [];
    for (let i = 0; i < raw.length; i += 2) {
      const member = raw[i];
      const score = raw[i + 1];

      try {
        const parsed = typeof member === 'string' ? JSON.parse(member) : member;
        if (parsed && parsed.origin === 'congress') {
          congressArticles.push({
            ...parsed,
            redis_score: score,
            score_date: new Date(score * 1000).toISOString(),
            is_within_7_days: score >= sevenDaysAgo
          });
        }
      } catch (e) {
        console.error('Error parsing item:', e);
      }
    }

    console.log(`Found ${congressArticles.length} Congress articles`);

    return res.status(200).json({
      ok: true,
      now_timestamp: now,
      now_date: new Date(now * 1000).toISOString(),
      seven_days_ago_timestamp: sevenDaysAgo,
      seven_days_ago_date: new Date(sevenDaysAgo * 1000).toISOString(),
      fourteen_days_ago_timestamp: fourteenDaysAgo,
      fourteen_days_ago_date: new Date(fourteenDaysAgo * 1000).toISOString(),
      total_items_in_14_day_window: raw.length / 2,
      congress_articles_found: congressArticles.length,
      congress_articles: congressArticles
    });
  } catch (e) {
    console.error('Check Congress Redis error:', e);
    res.status(500).json({
      ok: false,
      error: e?.message || String(e)
    });
  }
}
