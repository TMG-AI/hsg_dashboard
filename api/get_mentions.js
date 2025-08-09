import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN
});
const ZSET = "mentions:z";

function looksLikeMention(o) {
  return o && typeof o === "object" &&
    ("title" in o) && ("link" in o) && ("source" in o) &&
    ("published" in o || "published_ts" in o);
}

function toStringAny(v) {
  if (typeof v === "string") return v;
  if (Buffer.isBuffer(v))   return v.toString("utf-8");
  if (v == null)            return "";
  return JSON.stringify(v); // last resort for objects
}

export default async function handler(req, res) {
  try {
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || "200", 10)));

    // Newest-first; DO NOT request scores (avoids pair/tuple formats)
    const raw = await redis.zrange(ZSET, 0, limit - 1, { rev: true });

    const out = [];
    for (const row of raw || []) {
      // Case A: SDK already returned the member as an object
      if (looksLikeMention(row)) { out.push(row); continue; }

      // Case B: Member is an object wrapper (rare) — stringify then parse
      if (row && typeof row === "object" && !Buffer.isBuffer(row)) {
        try { out.push(JSON.parse(JSON.stringify(row))); } catch {}
        continue;
      }

      // Case C: String / Buffer JSON
      const s = toStringAny(row);
      try { out.push(JSON.parse(s)); } catch {}
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).send(JSON.stringify(out));
  } catch (e) {
    res.status(500).json({ ok: false, error: `get_mentions failed: ${e?.message || e}` });
  }
}
