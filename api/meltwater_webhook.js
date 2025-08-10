import { Redis } from "@upstash/redis";
const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

const ZSET = "mentions:z";
const SEEN_MW  = "mentions:seen:mw";
const SEEN_URL = "mentions:seen:canon";

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

function toEpoch(d){
  // Try normal parse
  let t = Date.parse(d);

  // Fallback: if format like "YYYY-MM-DD HH:mm:ss", treat as UTC
  if (!Number.isFinite(t) && d) {
    const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(String(d));
    if (m) t = Date.parse(`${m[1]}T${m[2]}Z`);
  }

  // Default to now if still invalid
  let sec = Math.floor((Number.isFinite(t) ? t : Date.now()) / 1000);

  // Clamp future times to now so they appear in the 24h window
  const now = Math.floor(Date.now() / 1000);
  if (sec > now) sec = now;

  return sec;
}

// Extract fields from Meltwater JSON (handles both Smart Alerts and CSV-like keys)
function pickFields(it){
  const title = it.title || it.headline || it.summaryTitle || it["Headline"] || it["Title"] || "(untitled)";
  const url   = it.url || it.link || it.permalink || it?.links?.article || it["URL"] || "";
  const source= it.source_name || it.source || it.publisher || it["Source Name"] || it["Publisher"] || "Meltwater";

  const publishedISO =
    it.published_at || it.date || it.published ||
    (it["Date"] && it["Time"] ? `${it["Date"]} ${it["Time"]}` : new Date().toISOString());

  const mwId = it.id || it.document_id || it.documentId || it["Document ID"] || null;
  const mwPermalink = it.permalink || it.meltwater_url || it?.links?.app || it["Permalink"] || null;

  const meta = {
    alert: it.alert_name || it.search_name || it.source || it["Input Name"] || null,
    keywords: it.keywords || it["Keywords"] || null,
    information_type: it.information_type || it["Information Type"] || null,
    source_type: it.source_type || it["Source Type"] || null,
    source_domain: it.source_domain || it["Source Domain"] || null,
    content_type: it.content_type || it["Content Type"] || null,
    author: it.author || it["Author Name"] || it.authorName || null,
    language: it.language || it["Language"] || null,
    region: it.region || it["Region"] || null,
    country: it.country || it["Country"] || null,
    sentiment: it.sentiment || it["Sentiment"] || null,
    reach: it.reach || it["Reach"] || null,
    global_reach: it.global_reach || it["Global Reach"] || null,
    national_reach: it.national_reach || it["National Reach"] || null,
    local_reach: it.local_reach || it["Local Reach"] || null,
    ave: it.ave || it["AVE"] || null,
    social_echo: it.social_echo || it["Social Echo"] || null,
    editorial_echo: it.editorial_echo || it["Editorial Echo"] || null,
    engagement: it.engagement || it["Engagement"] || null,
    shares: it.shares || it["Shares"] || null,
    quotes: it.quotes || it["Quotes"] || null,
    likes: it.likes || it["Likes"] || null,
    replies: it.replies || it["Replies"] || null,
    reposts: it.reposts || it["Reposts"] || null,
    comments: it.comments || it["Comments"] || null,

    // Meltwater Smart Alerts extras
    providerType: it.providerType || null,
    statusLine: it.statusLine || null,
    links: it.links || null,
  };

  return { title, url, source, publishedISO, mwId, mwPermalink, meta };
}

export default async function handler(req, res){
  try{
    if (req.method !== "POST") { res.status(405).send("Use POST"); return; }

    // Shared-secret
    if (process.env.MW_WEBHOOK_SECRET) {
      const got = req.headers["x-mw-secret"];
      if (!got || got !== process.env.MW_WEBHOOK_SECRET) { res.status(401).send("bad secret"); return; }
    }

    // Body & force switch
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const urlObj = new URL(req.url, "http://localhost");
    const forceParam = urlObj.searchParams.get("force");
    const force = (forceParam === "1" || forceParam === "true" || (body && body.force === true));

    // Accept arrays, array wrappers, or single-object payloads
    const items = Array.isArray(body?.results) ? body.results
                : Array.isArray(body?.items)   ? body.items
                : body?.result                 ? [body.result]
                : Array.isArray(body)          ? body
                : (body && typeof body === "object" ? [body] : []);

    let stored = 0;

    for (const it of items){
      const { title, url, source, publishedISO, mwId, mwPermalink, meta } = pickFields(it);

      const canon = normalizeUrl(url || title);
      const ts = toEpoch(publishedISO);

      // De-dupe unless 'force' is set
      if (!force) {
        if (mwId) {
          const first = await redis.sadd(SEEN_MW, String(mwId));
          if (first !== 1) continue;
        } else if (canon) {
          const first = await redis.sadd(SEEN_URL, canon);
          if (first !== 1) continue;
        }
      }

      const mid = mwId ? `mw_${String(mwId)}` : idFromCanonical(canon || title);

      const mention = {
        id: mid,
        canon: canon || null,
        section: "Meltwater",
        title,
        link: url || null,
        source,
        matched: ["meltwater-alert"],
        published_ts: ts,
        published: new Date(ts * 1000).toISOString(),

        origin: "meltwater",
        provider: "Meltwater",
        provider_meta: {
          ...meta,
          id: mwId,
          permalink: mwPermalink
        },

        // Keep raw for future needs
        provider_raw: it
      };

      // WRITE as JSON string scored by published_ts
      await redis.zadd(ZSET, { score: ts, member: JSON.stringify(mention) });
      stored++;
    }

    res.status(200).json({ ok:true, stored });
  } catch(e){
    res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}
