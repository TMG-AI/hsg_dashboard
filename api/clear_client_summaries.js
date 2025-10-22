// Clear all client summaries from Redis
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.STORAGE_KV_REST_API_URL,
  token: process.env.STORAGE_KV_REST_API_TOKEN,
});

const SUMMARIES_ZSET = "client:summaries:z"; // Sorted set by timestamp

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed. Use POST." });
    }

    console.log(`Clearing all client summaries from Redis`);

    // Delete the entire sorted set
    const result = await redis.del(SUMMARIES_ZSET);

    console.log(`Delete result: ${result}`);

    return res.status(200).json({
      ok: true,
      message: "All client summaries cleared",
      deleted: result
    });

  } catch (e) {
    console.error('Clear client summaries error:', e);
    res.status(500).json({
      ok: false,
      error: e?.message || String(e)
    });
  }
}
