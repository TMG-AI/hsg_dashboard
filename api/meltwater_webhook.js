// /api/meltwater_webhook.js
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN
});

const ZSET_MENTIONS = "mentions:z";
const ZSET_SPIKES   = "mw:spikes:z";
const ZSET_SENT     = "mw:sentiment:z";

const SEEN_MW       = "mentions:seen:mw";
const SEEN_URL      = "mentions:seen:canon";
const SEEN_SPIKE    = "mw:spikes:seen";
const SEEN_SENT     = "mw:sentiment:seen";

// ---------- helpers ----------
function normalizeUrl(u){
  try{
    const url = new URL(u);
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
  }catch{ return (u||"").trim(); }
}
function hostFromUrl(u){ try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } }
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
function parseSpikeInfo(s){
  if (!s) return { mentions:null, pct:null };
  const m1 = String(s).match(/([\d,]+)\s+(?:Social\s+)?mentions/i);
  const mentions = m1 ? parseInt(m1[1].replace(/,/g,""),10) : null;
  const m2 = String(s).match(/[↑+]\s*([0-9]+(?:\.[0-9]+)?)\s*%/);
  const pct = m2 ? Math.round(parseFloat(m2[1])) : null;
  return { mentions, pct };
}
function parseSentimentDir(t,txt,sl){
  const hay = [t,txt,sl].filter(Boolean).join(" ").toLowerCase();
  if (hay.includes("more positive") || hay.includes("positive shift")) return "positive";
  if (hay.includes("more negative") || hay.includes("negative shift")) return "negative";
  return null;
}
function normalizeTitleKey(t){
  let s = String(t||"").toLowerCase();
  s = s.replace(/[\u2018\u2019\u201C\u201D]/g,"'").replace(/[\u2013\u2014]/g,"-");
  s = s.split(" - ")[0].split(" — ")[0].split(" | ")[0];
  s = s.replace(/["'“”‘’()[\]]/g," ").replace(/\s+/g," ").trim();
  return s;
}

// pick basic fields for news/mentions
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
  const reach = parseReach(it.statusLine || it.reach || "");
  return { title, link, source, publishedISO, mwId, mwPermalink, reach };
}

// accept many body shapes; tolerate n8n quirks
function extractBody(req){
  let rawBody = req.body;
  if (typeof rawBody === "string") {
    let s = rawBody.trim();
    if (s.startsWith("=")) s = s.slice(1);
    if (s.startsWith('"') && s.endsWith('"')) { try { s = JSON.parse(s); } catch {} }
    if (typeof s === "string") { try { rawBody = JSON.parse(s); } catch { rawBody = {}; } }
    else { rawBody = s; }
  }
  return rawBody;
}
function extractItems(body){
  const root = (body && (body.body || body.data || body.payload)) || body;
  if (Array.isArray(root)) return root;
  if (Array.isArray(root?.results)) return root.results;
  if (Array.isArray(root?.items))   return root.items;
  if (root?.result) return [root.result];
  if (root && (root.title || root.headline || root.url || root.link || root.permalink || root.links)) return [root];
  return [];
}

// classify special Meltwater insights
function classify(it){
  const t = (it.title || "").toLowerCase();
  const sl = (it.statusLine || "").toLowerCase();
  const txt = (it.text || "").toLowerCase();
  const type = (it.type || it.providerType || "").toLowerCase();

  // spikes
  if (t.includes("spike") || sl.includes("mentions") || type.includes("spike")) {
    const { mentions, pct } = parseSpikeInfo(it.statusLine || it.text || it.title);
    let platform = "social";
    if (t.includes("x repost") || t.includes("twitter")) platform = "x";
    if (t.includes("reddit")) platform = "reddit";
    return { kind:"spike", info:{ mentions, pct, platform } };
  }

  // sentiment shift
  if (t.includes("sentiment shift") || type.includes("sentiment")) {
    return { kind:"sentiment", info:{ direction: parseSentimentDir(it.title, it.text, it.statusLine) } };
  }

  return { kind:"news", info:{} };
}

// ---------- handler ----------
export default async function handler(req, res){
  try{
    if (req.method !== "POST") return res.status(405).send("Use POST");

    // shared-secret (accept header OR ?key=)
    if (process.env.MW_WEBHOOK_SECRET) {
      const urlObj = new URL(req.url, "http://localhost");
      const fromQuery  = urlObj.searchParams.get("key");
      const fromHeader = req.headers["x-mw-secret"];
      const got = (fromHeader || fromQuery || "").toString().trim();
      if (!got || got !== process.env.MW_WEBHOOK_SECRET) { res.status(401).send("bad secret"); return; }
    }

    const urlObj = new URL(req.url, "http://localhost");
    const forceParam = urlObj.searchParams.get("force");
    const force = (forceParam === "1" || forceParam === "true");

    const body  = extractBody(req);
    const items = extractItems(body);
    if (!items.length) return res.status(200).json({ ok:true, stored:0, note:"no items" });

    let stored_news = 0, stored_spikes = 0, stored_sent = 0;

    for (const it of items){
      const cls = classify(it);
      const f = pickFields(it);
      const canon = normalizeUrl(f.link || f.title);
      const ts = toEpoch(f.publishedISO);
      const mwKey = f.mwId ? String(f.mwId) : normalizeTitleKey(f.title);

      if (cls.kind === "spike") {
        // de-dupe spikes on mw id or title key + date
        const dayKey = `${new Date(ts*1000).toISOString().slice(0,10)}:${mwKey}`;
        const first = await redis.sadd(SEEN_SPIKE, f.mwId ? mwKey : dayKey);
        if (first === 1 || force) {
          const spike = {
            id: f.mwId ? `sp_${f.mwId}` : `sp_${idFromCanonical(canon)}`,
            title: f.title,
            platform: cls.info.platform || "social",
            spike_percentage: cls.info.pct,
            mention_count: cls.info.mentions,
            link: f.mwPermalink || f.link || null,
            detected_at: new Date(ts*1000).toISOString(),
            ts,
            origin:"meltwater", provider:"Meltwater"
          };
          await redis.zadd(ZSET_SPIKES, { score: ts, member: JSON.stringify(spike) });
          stored_spikes++;
        }
        continue;
      }

      if (cls.kind === "sentiment") {
        const dayKey = `${new Date(ts*1000).toISOString().slice(0,10)}:${mwKey}`;
        const first = await redis.sadd(SEEN_SENT, f.mwId ? mwKey : dayKey);
        if (first === 1 || force) {
          const sent = {
            id: f.mwId ? `se_${f.mwId}` : `se_${idFromCanonical(canon)}`,
            title: f.title,
            direction: cls.info.direction, // "positive"/"negative"/null
            link: f.mwPermalink || f.link || null,
            detected_at: new Date(ts*1000).toISOString(),
            ts,
            origin:"meltwater", provider:"Meltwater"
          };
          await redis.zadd(ZSET_SENT, { score: ts, member: JSON.stringify(sent) });
          stored_sent++;
        }
        continue;
      }

      // default: news/mention
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
      await redis.zadd(ZSET_MENTIONS, { score: ts, member: JSON.stringify(mention) });
      stored_news++;
    }

    return res.status(200).json({ ok:true, stored_news, stored_spikes, stored_sent });
  }catch(e){
    return res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}
