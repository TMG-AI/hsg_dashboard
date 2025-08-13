import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const ZSET_MENTIONS = "mentions:z";
const SEEN_MW  = "mentions:seen:mw";
const SEEN_URL = "mentions:seen:canon";

/* ---------- helpers ---------- */
function normalizeUrl(u){
  try{
    const url = new URL(u);
    // unwrap Meltwater redirect
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
  if (!Number.isFinite(t) && d){
    const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(String(d));
    if (m) t = Date.parse(`${m[1]}T${m[2]}Z`);
  }
  let sec = Math.floor((Number.isFinite(t) ? t : Date.now())/1000);
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
function parseSentiment(s){
  const t = String(s || "").toLowerCase();
  if (t.includes("positive")) return { score: 1, label: "Positive" };
  if (t.includes("negative")) return { score: -1, label: "Negative" };
  if (t.includes("neutral"))  return { score: 0, label: "Neutral" };
  return { score: 0, label: null };
}

/* extract fields from a Meltwater item */
function pickFields(it){
  const title = it.title || it.headline || it.summaryTitle || "(untitled)";
  const linkRaw = it.url || it.link || it.permalink ||
                  (it.links && (it.links.article || it.links.source || it.links.app)) || "";
  const link = normalizeUrl(linkRaw);
  const source = it.source_name || it.source || it.publisher || it.authorName ||
                 hostFromUrl(link) || "Meltwater";
  const publishedISO = it.published_at || it.date || it.published || new Date().toISOString();
  const mwId = it.id || it.document_id || it.documentId || null;
  const mwPermalink = it.permalink || (it.links && it.links.app) || null;

  const reach = parseReach(it.statusLine || it.reach || "");
  const s = parseSentiment(it.statusLine || it.sentiment || it.Sentiment);

  return {
    title, link, source, publishedISO, mwId, mwPermalink,
    reach,
    sentimentScore: s.score,
    sentimentLabel: s.label
  };
}

/* accept plain JSON (object or array) */
function extractItems(body){
  const root = body || {};
  if (Array.isArray(root)) return root;
  if (Array.isArray(root.results)) return root.results;
  if (Array.isArray(root.items))   return root.items;
  if (root.result) return [root.result];
  if (root.title || root.headline || root.url || root.link || root.permalink || root.links) return [root];
  return [];
}

/* ---------- handler ---------- */
export default async function handler(req, res){
  try{
    if (req.method === "GET"){
      const hasSecret = !!(process.env.MW_WEBHOOK_SECRET || process.env.MW_WEBHOOK_TOKEN);
      return res.status(200).json({ ok:true, route:"/api/meltwater_webhook", accepts:"POST", secret_set:hasSecret });
    }
    if (req.method !== "POST"){ res.status(405).send("Use POST"); return; }

    // secret: header x-mw-secret OR ?key=
    const SECRET = (process.env.MW_WEBHOOK_SECRET || process.env.MW_WEBHOOK_TOKEN || "").trim();
    if (SECRET){
      const u = new URL(req.url, "http://localhost");
      const q = (u.searchParams.get("key") || "").trim();
      const h = (req.headers["x-mw-secret"] || "").trim();
      const got = h || q;
      if (!got || got !== SECRET) return res.status(401).send("bad secret");
    }

    // body may be object or stringified JSON
    let body = req.body;
    if (typeof body === "string"){
      let s = body.trim();
      if (s.startsWith("=")) s = s.slice(1);
      if (s.startsWith('"') && s.endsWith('"')) { try { s = JSON.parse(s); } catch {} }
      if (typeof s === "string"){ try { body = JSON.parse(s); } catch { body = {}; } }
      else body = s;
    }

    const items = extractItems(body);
    if (!items.length) return res.status(200).json({ ok:true, stored:0, note:"no items" });

    const u2 = new URL(req.url, "http://localhost");
    const force = (u2.searchParams.get("force")==="1" || u2.searchParams.get("force")==="true");

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

      const id = f.mwId ? `mw_${String(f.mwId)}` : idFromCanonical(canon);
      const ts = toEpoch(f.publishedISO);

      const mention = {
        id, canon,
        section: "Meltwater",
        origin: "meltwater",
        provider: "Meltwater",
        title: f.title,
        link: f.link || null,
        source: f.source,
        matched: ["meltwater-alert"],
        published_ts: ts,
        published: new Date(ts*1000).toISOString(),
        reach: f.reach || 0,
        sentiment: f.sentimentScore,
        sentiment_label: f.sentimentLabel || null,
        provider_meta: { id: f.mwId, permalink: f.mwPermalink, reach: f.reach || 0 },
        provider_raw: it
      };

      await redis.zadd(ZSET_MENTIONS, { score: ts, member: JSON.stringify(mention) });
      stored++;
    }

    res.status(200).json({ ok:true, stored });
  }catch(e){
    res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}
