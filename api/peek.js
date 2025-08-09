import { Redis } from "@upstash/redis";

const r = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN
});
const ZSET = "mentions:z";

function toStringAny(v) {
  if (typeof v === "string") return v;
  if (Buffer.isBuffer(v))   return v.toString("utf-8");
  if (v == null)            return "";
  return String(v);
}

export default async function handler(req, res) {
  try {
    const rows = await r.zrange(ZSET, 0, 0, { rev: true, withScores: true });
    const row = rows?.[0];

    let member = null;
    if (row && typeof row === "object" && "member" in row) member = row.member;
    else member = row;

    const isObj = member && typeof member === "object" && !Buffer.isBuffer(member);
    const text  = isObj ? JSON.stringify(member).slice(0, 200) : toStringAny(member).slice(0, 200);

    res.status(200).json({
      has_member: !!member,
      member_js_type: isObj ? "object" : typeof member,
      preview: text
    });
  } catch (e) {
    res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}
