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
  return String(v);
}

// Accepts: strings, Buffers, {member, score}, or direct objects
function normalizeAndParse(items) {
  const out = [];
  for (const row of items || []) {
    // Case 1: SDK returns {member, score}
    if (row && typeof row === "object" && "member" in row) {
      const m = row.member;
      if (looksLikeMention(m)) { out.push(m); continue; }
      const s = toStringAny(m);
      try { out.push(JSON.parse(s)); } catch {}
      continue;
    }
    // Case 2: SDK returns direct object as member
    if (looksLikeMention(row)) { out.push(row); continue; }
    // Case 3: plain string/buffer
    const s = toStringAny(row);
    try { out.push(JSON.parse(s)); } catch {}
  }
  return out;
}

export default async function handler(req, res) {
  try {
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || "200", 10)));
    // Newest-first
    const raw = await redis.zrange(ZSET, 0, limit - 1, { rev: true, withScores: true });
    const out = normalizeAndParse(raw);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).send(JSON.stringify(out));
  } catch (e) {
    res.status(500).json({ ok: false, error: `get_mentions failed: ${e?.message || e}` });
  }
}
