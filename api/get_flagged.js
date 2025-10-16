// Get flagged articles - NEW ENDPOINT to bypass cache
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.STORAGE_KV_REST_API_URL,
  token: process.env.STORAGE_KV_REST_API_TOKEN,
});

const FLAGGED_SET = "articles:flagged:ids";
const FLAGGED_HASH = "articles:flagged:data";

export default async function handler(req, res) {
  try {
    console.log('NEW GET_FLAGGED endpoint called');

    // Get all article IDs from Set
    const articleIds = await redis.smembers(FLAGGED_SET) || [];
    console.log(`Retrieved ${articleIds.length} article IDs:`, articleIds);

    if (!articleIds || articleIds.length === 0) {
      return res.status(200).json({
        ok: true,
        flagged_count: 0,
        articles: []
      });
    }

    // Get all hash data
    const allHashData = await redis.hgetall(FLAGGED_HASH);
    console.log('Hash data type:', typeof allHashData, 'keys:', Object.keys(allHashData || {}));

    // Extract articles for the IDs we have
    const articles = articleIds
      .map(id => {
        const data = allHashData?.[id];
        if (!data) {
          console.warn(`No data for article ID: ${id}`);
          return null;
        }
        // Upstash auto-deserializes, so data might already be an object
        if (typeof data === 'object') {
          return data;
        }
        // If it's a string, parse it
        try {
          return JSON.parse(data);
        } catch (e) {
          console.error(`Failed to parse article ${id}:`, e);
          return null;
        }
      })
      .filter(Boolean);

    console.log(`Successfully loaded ${articles.length} articles`);

    // Sort by flagged_at (newest first)
    articles.sort((a, b) => new Date(b.flagged_at) - new Date(a.flagged_at));

    return res.status(200).json({
      ok: true,
      flagged_count: articles.length,
      articles
    });

  } catch (e) {
    console.error('Get flagged error:', e);
    res.status(500).json({
      ok: false,
      error: e?.message || String(e)
    });
  }
}
