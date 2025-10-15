// Clear all flagged articles from Redis
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.STORAGE_KV_REST_API_URL,
  token: process.env.STORAGE_KV_REST_API_TOKEN,
});

const FLAGGED_SET = "articles:flagged:ids";
const FLAGGED_HASH = "articles:flagged:data";
const OLD_FLAGGED_SET = "articles:flagged"; // Legacy set to clean up

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed. Use POST." });
    }

    console.log(`Clearing all flagged articles from Redis`);

    // Delete both new structures and old legacy set
    const setResult = await redis.del(FLAGGED_SET);
    const hashResult = await redis.del(FLAGGED_HASH);
    const oldResult = await redis.del(OLD_FLAGGED_SET);

    console.log(`Delete results - Set: ${setResult}, Hash: ${hashResult}, Old Set: ${oldResult}`);

    return res.status(200).json({
      ok: true,
      message: "All flagged articles cleared",
      deleted: {
        set: setResult,
        hash: hashResult,
        old_set: oldResult
      }
    });

  } catch (e) {
    console.error('Clear flagged articles error:', e);
    res.status(500).json({
      ok: false,
      error: e?.message || String(e)
    });
  }
}
