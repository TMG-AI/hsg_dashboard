import { Redis } from "@upstash/redis";
const r = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
const ZSET = "mentions:z";
const SEEN_ID = "mentions:seen";
const SEEN_LINK = "mentions:seen:canon";

function toObj(x){
  if (!x) return null;
  if (typeof x === "object" && x.id && x.link) return x;
  try { return JSON.parse(typeof x === "string" ? x : x.toString("utf-8")); } catch { return null; }
}
function normalizeUrl(u){
  try{
    const url=new URL(u); url.hash="";
    ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","utm_id","mc_cid","mc_eid","ref","fbclid","gclid","igshid"].forEach(p=>url.searchParams.delete(p));
    if ([...url.searchParams.keys()].length===0) url.search="";
    url.hostname = url.hostname.toLowerCase();
    let s = url.toString(); if (s.endsWith("/")) s=s.slice(0,-1);
    return s;
  }catch{return (u||"").trim();}
}

export default async function handler(req, res) {
  try {
    // scan a window (adjust if you want deeper cleanup)
    const raw = await r.zrange(ZSET, 0, 2000, { rev: true });
    const items = raw.map(toObj).filter(Boolean);

    const keep = new Map(); // canon -> first (newest)
    const drop = [];
    for (const m of items) {
      const canon = m.canon || normalizeUrl(m.link || "");
      if (!canon) continue;
      if (!keep.has(canon)) keep.set(canon, m);
      else drop.push(m);
    }

    let removed = 0;
    for (const m of drop) {
      try {
        await r.zrem(ZSET, JSON.stringify(m));
        await r.srem(SEEN_ID, m.id);
        const canon = m.canon || normalizeUrl(m.link || "");
        if (canon) await r.srem(SEEN_LINK, canon);
        removed++;
      } catch {}
    }

    res.status(200).json({ ok:true, scanned: items.length, unique: keep.size, removed });
  } catch (e) {
    res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}
