import { Redis } from "@upstash/redis";
const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

const ZSET = "mentions:z";
const SEEN_LINK = "mentions:seen:canon";

function normalizeUrl(u){
  try{
    const url = new URL(u);
    url.hash = "";
    ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","utm_id","mc_cid","mc_eid","ref","fbclid","gclid","igshid"].forEach(p=>url.searchParams.delete(p));
    if (![...url.searchParams.keys()].length) url.search = "";
    url.hostname = url.hostname.toLowerCase();
    let s = url.toString();
    if (s.endsWith("/")) s = s.slice(0,-1);
    return s;
  } catch {
    return (u||"").trim();
  }
}

function idFromCanonical(canon){ let h=0; for (let i=0;i<canon.length;i++) h=(h*31+canon.charCodeAt(i))>>>0; return `m_${h.toString(16)}`; }
function toEpoch(d){ const t=Date.parse(d); return Number.isFinite(t)?Math.floor(t/1000):Math.floor(Date.now()/1000); }

export default async function handler(req, res){
  try{
    if (req.method !== "POST") { res.status(405).send("Use POST"); return; }

    // Shared-secret
    if (process.env.MW_WEBHOOK_SECRET) {
      const got = req.headers["x-mw-secret"];
      if (!got || got !== process.env.MW_WEBHOOK_SECRET) { res.status(401).send("bad secret"); return; }
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const items = Array.isArray(body?.results) ? body.results
               : Array.isArray(body?.items)   ? body.items
               : body?.result ? [body.result]
               : [];

    let stored = 0;

    for (const it of items){
      const title     = it.title || it.headline || it.summaryTitle || "(untitled)";
      const link      = it.url   || it.link    || it.permalink   || "";
      const source    = it.source_name || it.source || it.publisher || "Meltwater";
      const published = it.published_at || it.date || it.published || new Date().toISOString();

      const canon = normalizeUrl(link || title);
      if (!canon) continue;

      const added = await redis.sadd(SEEN_LINK, canon);
      if (added !== 1) continue;

      const mid = idFromCanonical(canon);
      const ts  = toEpoch(published);

      const provider_meta = {
        alert: it?.alert_name || it?.search_name || null,
        workspace: it?.workspace || null,
        id: it?.id || it?.document_id || null,
        permalink: it?.permalink || it?.meltwater_url || null
      };

      const mention = {
        id: mid,
        canon,
        section: "Meltwater",
        title,
        link,
        source,
        matched: ["meltwater-alert"],
        published_ts: ts,
        published: new Date(ts*1000).toISOString(),

        origin: "meltwater",
        provider: "Meltwater",
        provider_meta
      };

      await redis.zadd(ZSET, { score: ts, member: JSON.stringify(mention) });
      stored++;
    }

    res.status(200).json({ ok:true, stored });
  }catch(e){
    res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}
