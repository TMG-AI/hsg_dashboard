// /api/meltwater_webhook.js
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN
});

const ZSET     = "mentions:z";
const SEEN_MW  = "mentions:seen:mw";
const SEEN_URL = "mentions:seen:canon";

// ---------- helpers ----------
function normalizeUrl(u){
  try{
    const url = new URL(u);
    // unwrap Meltwater redirect links
    if (/t\.notifications\.meltwater\.com/i.test(url.hostname) && url.searchParams.get("u")) {
      return normalizeUrl(decodeURIComponent(url.searchParams.get("u")));
    }
    url.hash = "";
    [
      "utm_source","utm_medium","utm_campaign","utm_term","utm_content","utm_id",
      "mc_cid","mc_eid","ref","fbclid","gclid","igshid"
    ].forEach(p=>url.searchParams.delete(p));
    if (![...url.searchParams.keys()].length) url.search = "";
    url.hostname = url.hostname.toLowerCase();
    let s = url.toString();
    if (s.endsWith("/")) s = s.slice(0,-1);
    return s;
  }catch{
    return (u||"").trim();
  }
}
function idFromCanonical(canon){ let h=0; for (let i=0;i<canon.length;i++) h=(h*31+canon.charCodeAt(i))>>>0; return `m_${h.toString(16)}`; }
function toEpoch(d){
  let t = Date.parse(d||"");
  if (!Number.isFinite(t) && d) {
    const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(String(d));
    if (m) t = Date.parse(`${m[1]}T${m[2]}Z`);
  }
  let sec = Math.floor((Number.isFinite(t) ? t : Date.now())/1000);
  const now = Math.floor(Date.now()/1000);
  if (sec > now) sec = now;
  return sec;
}
function parseReach(s){
  if (!s) return 0;
  const m = String(s).match(/([\d.,]+)\s*([KMB])?\s*(?:Reach|mentions)/i);
  if (!m) return 0;
  let n = parseFloat(m[1].replace(/,/g,""));
  const u = (m[2]||"").toUpperCase();
  if (u==="K") n*=1e3; if (u==="M") n*=1e6; if (u==="B") n*=1e9;
  return Math.round(n);
}
function hostFromUrl(u){ try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } }

function pickFields(it){
  const title = it.title || it.headline || it.summaryTitle || "(untitled)";
  const linkRaw =
    it.url || it.link || it.permalink ||
    (it.links && (it.links.article || it.links.source || it.links.app)) ||
    "";
  const link = normalizeUrl(linkRaw);
  const source =
    it.source_name || it.source || it.publisher || it.authorName ||
    hostFromUrl(link) || "Meltwater";
  const publishedISO =
    it.published_at || it.date || it.published || new Date().toISOString();
  const mwId = it.id || it.document_id || it.documentId || null;
  const mwPermalink = it.permalink || (it.links && it.links.app) || null;
  const reach = parseReach(it.statusLine || it.reach || "");

  return { title, link, source, publishedISO, mwId, mwPermalink, reach };
}

// Accept any of these shapes: array, {results:[]}, {items:[]}, {result:{}}, single object,
// OR wrapper objects like { body: {...} } / { data: {...} } / { payload: {...} }
function extractItems(body){
  const root = (body && (body.body || body.data || body.payload)) || body;

  if (Array.isArray(root)) return root;
  if (Array.isArray(root?.results)) return root.results;
  if (Array.isArray(root?.items)) return root.items;
  if (root?.result) return [root.result];

  // single-object alert payload (has title/links/url)
  if (root && (root.title || root.headline || root.url || root.link || root.permalink || root.links)) {
    return [root];
  }

  return [];
}

// ---------- handler ----------
export default async function handler(req, res){
  try{
    if (req.method !== "POST") return res.status(405).send("Use POST");

    // shared-secret
    if (process.env.MW_WEBHOOK_SECRET) {
      const got = (req.headers["x-mw-secret"] || "").toString().trim();
      if (!got || got !== process.env.MW_WEBHOOK_SECRET) return res.status(401).send("bad secret");
    }

    const urlObj = new URL(req.url, "http://localhost");
    const forceParam = urlObj.searchParams.get("force");
    const force = (forceParam === "1" || forceParam === "true");

   let rawBody = req.body;
// accept strings, including ones that start with '=' from n8n
if (typeof rawBody === "string") {
  let s = rawBody.trim();
  if (s.startsWith("=")) s = s.slice(1);           // strip leading '='
  // if it came double-quoted (e.g., "\"{...}\""), unquote once
  if (s.startsWith('"') && s.endsWith('"')) {
    try { s = JSON.parse(s); } catch { /* keep s as-is */ }
  }
  if (typeof s === "string") {
    try { rawBody = JSON.parse(s); }
    catch { rawBody = {}; } // fall through; extractor will return []
  } else {
    rawBody = s;
  }
}
    const items = extractItems(rawBody);

    if (!items.length){
      return res.status(200).json({
        ok: true,
        stored: 0,
        note: "no items",
        received_keys: rawBody && typeof rawBody==="object" ? Object.keys(rawBody) : null
      });
    }

    let stored = 0;

    for (const it of items){
      const f = pickFields(it);
      const canon = normalizeUrl(f.link || f.title);
      if (!canon) continue;

      if (!force) {
        if (f.mwId) {
          const first = await redis.sadd(SEEN_MW, String(f.mwId));
          if (first !== 1) continue;
        } else {
          const first = await redis.sadd(SEEN_URL, canon);
          if (first !== 1) continue;
        }
      }

      const mid = f.mwId ? `mw_${String(f.mwId)}` : idFromCanonical(canon);
      const ts  = toEpoch(f.publishedISO);

      const mention = {
        id: mid,
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
        provider_meta: { id: f.mwId, permalink: f.mwPermalink, reach: f.reach },
        provider_raw: it
      };

      await redis.zadd(ZSET, { score: ts, member: JSON.stringify(mention) });
      stored++;
    }

    const first = items[0] || {};
    return res.status(200).json({
      ok: true,
      stored,
      sample: {
        title: first.title || first.headline || null,
        link: (first.url || first.link || (first.links && (first.links.article || first.links.source || first.links.app))) || null
      }
    });
  }catch(e){
    return res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}
