import { Redis } from "@upstash/redis";

const ZSET = "mentions:z";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export default async function handler(req, res) {
  try {
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || "200", 10)));
    const raw = (await redis.zrange(ZSET, -limit, -1, { byScore: false, withScores: false })) || [];

    // zrange from low→high; we want newest first. Reverse and parse JSON rows.
    const out = [];
    for (const s of raw.reverse()) {
      try {
        out.push(JSON.parse(s));
      } catch { /* skip malformed rows */ }
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).send(JSON.stringify(out));
  } catch (e) {
    res.status(500).json({ ok: false, error: `get_mentions failed: ${e?.message || e}` });
  }
}
