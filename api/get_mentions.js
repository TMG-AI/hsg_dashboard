import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN
});
const ZSET = "mentions:z";

// Normalize whatever ZRANGE returns into a JSON-parsed object array
function normalizeAndParse(items) {
  const out = [];
  for (const it of items || []) {
    // Case A: { member, score }
    if (it && typeof it === "object" && "member" in it) {
      const s = typeof it.member === "string"
        ? it.member
        : Buffer.isBuffer(it.member)
          ? it.member.toString("utf-8")
          : String(it.member);
      try { out.push(JSON.parse(s)); } catch {}
      continue;
    }
    // Case B: plain string / buffer / other
    const s = typeof it === "string"
      ? it
      : Buffer.isBuffer(it)
        ? it.toString("utf-8")
        : String(it);
    try { out.push(JSON.parse(s)); } catch {}
  }
  return out;
}

export default async function handler(req, res) {
  try {
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || "200", 10)));

    // Newest-first directly from Redis
    // Works whether the client returns strings or {member, score}
    const raw = await redis.zrange(ZSET, 0, limit - 1, { rev: true, withScores: false });

    const out = normalizeAndParse(raw);

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).send(JSON.stringify(out));
  } catch (e) {
    res.status(500).json({ ok: false, error: `get_mentions failed: ${e?.message || e}` });
  }
}
