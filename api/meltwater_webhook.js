// /api/meltwater_webhook.js
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// primary mentions set (the dashboard already reads this)
const ZSET_MENTIONS = "mentions:z";

// de-dupe sets
const SEEN_MW  = "mentions:seen:mw";    // by Meltwater id
const SEEN_URL = "mentions:seen:canon";  // by canonical URL

/* ---------------- helpers ---------------- */
function normalizeUrl(u){
  try{
    const url = new URL(u);
    // unwrap Meltwater redirect links if present
    if (/t\.notifications\.meltwater\.com/i.test(url.hostname) && url.searchParams.get("u")) {
      return normalizeUrl(decodeURIComponent(url.searchParams.get("u")));
    }
    url.hash = "";
    ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","utm_id",
     "mc_cid","mc_eid","ref","fbclid","gclid","igshid"].forEach(p=>url.searchParams.delete(p));
    if (![...url.searchParams.keys()].length) url.search = "";
    url.hostname = url.hostname.toLowerCase();
    let s = url.toString();
    if (s.endsWith("/")) s = s.slice(0,-1);
    return s;
  }catch{ return (u||"").trim(); }
}
function hostFromUrl(u){ try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } }
function idFromCanonical(canon){ let h=0; for (let i=0;i<canon.length;i++) h=(h*31+canon.charCodeAt(i))>>>0; return `m_${h.toString(16)}`; }
function toEpoch(d){
  let t = Date.parse(d||"");
  if (!Number.isFinite(t) && d){
    const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(String(d));
    if (m) t = Date.parse(`${m[1]}T${m[2]}Z`);
  }
  let sec = Math.floor((Number.isFinite(t) ? t : Date.now())/1000);
  const now = Math.floor(Date.now()/1000);
  if (sec > now) sec = now;
  return sec;
}

/* pick the fields we need from a Meltwater item */
function pickFields(it){
  const title = it.title || it.headline || it.summaryTitle || "(untitled)";
  const linkRaw =
    it.url || it.link || it.permalink ||
    (it.links && (it.links.article || it.links.source || it.links.app)) || "";
  const link = normalizeUrl(linkRaw);
  const source =
    it.source_name || it.source || it.publisher || it.authorName ||
    hostFromUrl(link) || "Meltwater";
  const publishedISO =
    it.published_at || it.date || it.published || new Date().toISOString();
  const mwId = it.id || it.document_id || it.documentId || null;
  const mwPermalink = it.permalink || (it.links && it.links.app) || null;

  return { title, link, source, publishedISO, mwId, mwPermalink };
}

/* accept JSON, n8n-style wrappers, or form-encoded bodies with payload/data */
function extractBody(req){
  let raw = req.body;

  // strings (including ="...") → try JSON
  if (typeof raw === "string"){
    let s = raw.trim();
    if (s.startsWith("=")) s = s.slice(1);
    if (s.startsWith('"') && s.endsWith('"')) { try { s = JSON.parse(s); } catch {} }
    if (typeof s === "string"){ try { raw = JSON.parse(s); } catch { raw = {}; } }
    else raw = s;
  }

  const ctype = (req.headers["content-type"] || "").toLowerCase();
  if (ctype.includes("application/x-www-form-urlencoded")){
    // Next/Vercel gives an object. Find a JSON string inside common keys.
    if (raw && typeof raw === "object" && !Array.isArray(raw)){
      const inner = raw.payload || raw.data || raw.json || raw.body || raw.result || null;
      if (typeof inner === "string"){
        try { return JSON.parse(inner); } catch { return {}; }
      }
    }
  }

  // unwrap common wrappers
  if (raw && typeof raw === "object"){
    if (raw.body && typeof raw.body === "object")    return raw.body;
    if (raw.data && typeof raw.data === "object")    return raw.data;
    if (raw.payload && typeof raw.payload === "object") return raw.payload;
  }

  return raw || {};
}

/* turn a body into a flat list of items */
function extractItems(body){
  const root = (body && (body.body || body.data || body.payload)) || body;
  if (Array.isArray(root))             return root;
  if (Array.isArray(root?.results))    return root.results;
  if (Array.isArray(root?.items))      return root.items;
  if (root?.result)                    return [root.result];
  if (root && (root.title || root.headline || root.url || root.link || root.permalink || root.links)) return [root];
  return [];
}

/* ---------------- handler ---------------- */
export default async function handler(req, res){
  try{
    if (req.method === "GET"){
      // simple health ping for your browser
      const hasSecret = !!(process.env.MW_WEBHOOK_SECRET || process.env.MW_WEBHOOK_TOKEN);
      return res.status(200).json({ ok:true, route:"/api/meltwater_webhook", accepts:"POST", secret_set:hasSecret });
    }
    if (req.method !== "POST"){ res.status(405).send("Use POST"); return; }

    // unified secret check: header x-mw-secret OR ?key=   (with dbg support)
{
  const SECRET_RAW = (process.env.MW_WEBHOOK_SECRET || process.env.MW_WEBHOOK_TOKEN || "").toString();
  const u   = new URL(req.url, "http://localhost");
  const q   = (u.searchParams.get("key") || "").toString();
  const h   = (req.headers["x-mw-secret"] || "").toString();
  const got = h || q; // header wins if present

  // normalize by trimming only spaces/newlines
  const SECRET = SECRET_RAW.trim();
  const GOT    = got.trim();

  const dbg = u.searchParams.get("dbg") === "1";

  if (SECRET) {
    if (!GOT || GOT !== SECRET) {
      if (dbg) {
        return res.status(401).json({
          ok: false,
          why: "bad secret",
          using: process.env.MW_WEBHOOK_SECRET ? "MW_WEBHOOK_SECRET"
               : (process.env.MW_WEBHOOK_TOKEN ? "MW_WEBHOOK_TOKEN" : null),
          got_len: GOT.length,
          secret_len: SECRET.length,
          got_first: GOT.slice(0,1) || null,
          got_last:  GOT.slice(-1)  || null,
          secret_first: SECRET.slice(0,1) || null,
          secret_last:  SECRET.slice(-1)  || null
        });
      }
      return res.status(401).send("bad secret");
    }
  }
}
// end secret check
    if (SECRET){
      const u = new URL(req.url, "http://localhost");
      const q = ((u.searchParams.get("key") || "") + "").trim();
      const h = ((req.headers["x-mw-secret"] || "") + "").trim();
      const got = h || q; // header wins if present; Meltwater can use ?key
      if (!got || got !== SECRET){ res.status(401).send("bad secret"); return; }
    }

    // optional ?force=1 to skip dedupe during testing
    const u2 = new URL(req.url, "http://localhost");
    const force = (u2.searchParams.get("force")==="1" || u2.searchParams.get("force")==="true");

    const body  = extractBody(req);
    const items = extractItems(body);
    if (!items.length){
      return res.status(200).json({ ok:true, stored:0, note:"no items", saw:Object.keys(body||{}) });
    }

    let stored = 0;
    for (const it of items){
      const f = pickFields(it);
      const canon = normalizeUrl(f.link || f.title);
      if (!canon) continue;

      if (!force){
        if (f.mwId){
          const first = await redis.sadd(SEEN_MW, String(f.mwId));
          if (first !== 1) continue;
        } else {
          const first = await redis.sadd(SEEN_URL, canon);
          if (first !== 1) continue;
        }
      }

      const id  = f.mwId ? `mw_${String(f.mwId)}` : idFromCanonical(canon);
      const ts  = toEpoch(f.publishedISO);

      const mention = {
        id,
        canon,
        section: "Meltwater",
        origin: "meltwater",
        provider: "Meltwater",
        title: f.title,
        link: f.link || null,
        source: f.source,
        matched: ["meltwater-alert"],
        published_ts: ts,
        published: new Date(ts*1000).toISOString(),
        provider_meta: { id: f.mwId, permalink: f.mwPermalink },
        provider_raw: it
      };

      await redis.zadd(ZSET_MENTIONS, { score: ts, member: JSON.stringify(mention) });
      stored++;
    }

    // light response with one sample
    const first = items[0] || {};
    res.status(200).json({
      ok:true,
      stored,
      sample: {
        title: first.title || first.headline || null,
        link: (first.url || first.link || (first.links && (first.links.article || first.links.source || first.links.app))) || null
      }
    });
  }catch(e){
    res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}
