import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN
});
const ZSET = "mentions:z";

export default async function handler(req, res) {
  try {
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || "200", 10)));
    // Newest-first directly from Redis: rev=true, rank 0..limit-1
    const raw = (await redis.zrange(ZSET, 0, limit - 1, { rev: true })) || [];
    const out = raw.map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).send(JSON.stringify(out));
  } catch (e) {
    res.status(500).json({ ok: false, error: `get_mentions failed: ${e?.message || e}` });
  }
}
