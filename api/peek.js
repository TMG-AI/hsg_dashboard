import { Redis } from "@upstash/redis";

const r = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN
});
const ZSET = "mentions:z";

function toStringAny(v) {
  if (typeof v === "string") return v;
  if (Buffer.isBuffer(v)) return v.toString("utf-8");
  if (v == null) return "";
  return String(v);
}

export default async function handler(req, res) {
  try {
    const rows = await r.zrange(ZSET, 0, 0, { rev: true, withScores: true }); // get top 1
    const row = rows?.[0];

    // Support either {member, score} or bare value
    const member = row && typeof row === "object" && "member" in row ? row.member : row;
    const memberStr = toStringAny(member);
    const startsWithBrace = memberStr.trim().startsWith("{");

    res.status(200).json({
      has_member: !!memberStr,
      member_type: typeof member,
      starts_with_brace: startsWithBrace,
      sample: memberStr.slice(0, 200)
    });
  } catch (e) {
    res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}
