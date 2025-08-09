import { Redis } from "@upstash/redis";
const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
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
  return JSON.stringify(v);
}
function normalizeUrl(u){
  try{
    const url=new URL(u); url.hash="";
    ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","utm_id","mc_cid","mc_eid","ref","fbclid","gclid","igshid"]
      .forEach(p=>url.searchParams.delete(p));
    if ([...url.searchParams.keys()].length===0) url.search="";
    url.hostname = url.hostname.toLowerCase();
    let s = url.toString(); if (s.endsWith("/")) s=s.slice(0,-1);
    return s;
  }catch{return (u||"").trim();}
}

export default async function handler(req, res) {
  try {
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || "200", 10)));

    // Newest first; members only
    const raw = await redis.zrange(ZSET, 0, limit - 1, { rev: true });

    const parsed = [];
    for (const row of raw || []) {
      if (looksLikeMention(row)) { parsed.push(row); continue; }
      const s = toStringAny(row);
      try { parsed.push(JSON.parse(s)); } catch {}
    }

    // Distinct by canonical URL (canon if present, else normalized link)
    const seenCanon = new Set();
    const unique = [];
    for (const m of parsed) {
      const canon = m.canon || normalizeUrl(m.link || "");
      if (!canon) { unique.push(m); continue; } // edge case
      if (seenCanon.has(canon)) continue;
      seenCanon.add(canon);
      unique.push(m);
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).send(JSON.stringify(unique));
  } catch (e) {
    res.status(500).json({ ok: false, error: `get_mentions failed: ${e?.message || e}` });
  }
}
