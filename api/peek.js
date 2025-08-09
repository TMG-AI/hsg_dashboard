import { Redis } from "@upstash/redis";
const r = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
const ZSET = "mentions:z";

export default async function handler(req, res) {
  try {
    const first = await r.zrange(ZSET, 0, 0, { rev: true });
    const member = first?.[0] || null;
    res.status(200).json({
      has_member: !!member,
      member_len: member ? member.length : 0,
      starts_with_brace: member ? member.trim().startsWith("{") : null,
      sample: member ? member.slice(0, 200) : null
    });
  } catch (e) {
    res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}
