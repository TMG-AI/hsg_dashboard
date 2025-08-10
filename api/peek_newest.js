import { Redis } from "@upstash/redis";
const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
const ZSET = "mentions:z";

export default async function handler(req, res){
  try{
    if (req.method !== "GET") { res.status(405).send("Use GET"); return; }

    // Newest 10 members (no scores)
    const rows = await redis.zrange(ZSET, 0, 9, { rev: true });

    const items = [];
    let found_json = 0;

    for (const member of rows) {
      let parsed = null;
      try { parsed = JSON.parse(typeof member === "string" ? member : String(member)); found_json++; }
      catch { parsed = { raw: String(member) }; }
      items.push({ item: parsed });
    }

    res.status(200).json({ ok: true, count: rows.length, found_json, items });
  } catch (e) {
    res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}
