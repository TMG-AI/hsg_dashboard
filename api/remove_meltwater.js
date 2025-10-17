// Remove all Meltwater articles from Redis
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
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST to remove Meltwater articles" });
  }

  try {
    console.log("Fetching all articles from Redis...");

    // Get all articles from Redis
    const raw = await redis.zrange(ZSET, 0, -1);
    const allArticles = raw.map(toObj).filter(Boolean);

    console.log(`Total articles found: ${allArticles.length}`);

    // Find Meltwater articles
    const meltwaterArticles = allArticles.filter(a => {
      const origin = (a.origin || '').toLowerCase();
      return origin === 'meltwater';
    });

    console.log(`Meltwater articles to remove: ${meltwaterArticles.length}`);

    if (meltwaterArticles.length === 0) {
      return res.status(200).json({
        ok: true,
        message: "No Meltwater articles found",
        removed: 0,
        remaining: allArticles.length
      });
    }

    // Remove each Meltwater article from the sorted set
    let removed = 0;
    for (const article of meltwaterArticles) {
      const articleStr = JSON.stringify(article);
      const result = await redis.zrem(ZSET, articleStr);
      if (result > 0) {
        removed++;
      }
    }

    console.log(`Successfully removed ${removed} Meltwater articles`);

    // Get final count
    const remainingRaw = await redis.zrange(ZSET, 0, -1);
    const remaining = remainingRaw.length;

    return res.status(200).json({
      ok: true,
      message: `Removed ${removed} Meltwater articles`,
      removed,
      remaining,
      breakdown: {
        total_before: allArticles.length,
        meltwater_found: meltwaterArticles.length,
        successfully_removed: removed,
        total_after: remaining
      }
    });

  } catch (e) {
    console.error("Error removing Meltwater articles:", e);
    res.status(500).json({
      ok: false,
      error: e?.message || String(e)
    });
  }
}
