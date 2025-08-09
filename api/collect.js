import { Redis } from "@upstash/redis";
import Parser from "rss-parser";
import { Resend } from "resend";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN
});
const parser = new Parser();
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const ZSET = "mentions:z";
const SEEN = "mentions:seen";        // keep for back-compat (ID-based)
const SEEN_LINK = "mentions:seen:link"; // NEW: canonical-link based de-dupe
const MAX_MENTIONS = 5000;

const RSS_FEEDS = (process.env.RSS_FEEDS || "").split(",").map(s=>s.trim()).filter(Boolean);
const KEYWORDS  = (process.env.KEYWORDS  || "").split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);
const URGENT    = (process.env.ALERT_KEYWORDS_URGENT || "").split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);

// ---- helpers ----
function normalizeUrl(u) {
  try {
    const url = new URL(u);
    url.hash = "";
    // Strip typical tracking params
    ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","utm_id","mc_cid","mc_eid","ref","fbclid","gclid","igshid"].forEach(p=>url.searchParams.delete(p));
    // Remove empty query
    if ([...url.searchParams.keys()].length === 0) url.search = "";
    // Lowercase host, strip trailing slash
    url.hostname = url.hostname.toLowerCase();
    let s = url.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch { return (u || "").trim(); }
}
function matchKeywords(text){ const t=(text||"").toLowerCase(); return KEYWORDS.filter(k=>t.includes(k)); }
function isUrgent(m){ if(!URGENT.length) return false; const set=new Set(m.map(x=>x.toLowerCase())); return URGENT.some(u=>set.has(u)); }
function idFromCanonical(canon){
  // small fast hash
  let h=0; for (let i=0;i<canon.length;i++) h=(h*31+canon.charCodeAt(i))>>>0;
  return `m_${h.toString(16)}`;
}
function toEpoch(d){ const t=Date.parse(d); return Number.isFinite(t)?Math.floor(t/1000):Math.floor(Date.now()/1000); }

async function sendEmail(m){
  if(!resend || !process.env.ALERT_EMAIL_FROM || !process.env.ALERT_EMAIL_TO) return;
  const to = process.env.ALERT_EMAIL_TO.split(",").map(s=>s.trim()).filter(Boolean);
  if(!to.length) return;
  await resend.emails.send({
    from: process.env.ALERT_EMAIL_FROM,
    to,
    subject: `[URGENT] ${m.title}`,
    html: `<p><b>${m.title}</b></p>
           <p>Source: ${m.source} · ${m.published}</p>
           <p>Keywords: ${m.matched.join(", ")}</p>
           <p><a href="${m.link}">Open article</a></p>`
  });
}

export default async function handler(req, res) {
  try {
    if (!RSS_FEEDS.length || !KEYWORDS.length) {
      res.status(400).json({ ok:false, error:"Missing RSS_FEEDS or KEYWORDS" }); return;
    }
    let found=0, stored=0, emailed=0;

    for (const url of RSS_FEEDS) {
      const feed = await parser.parseURL(url);
      const source = feed?.title || url;

      for (const e of feed?.items || []) {
        const title = (e.title||"").trim();
        const link  = (e.link ||"").trim();
        const sum   = e.contentSnippet || e.content || e.summary || "";
        const matched = matchKeywords(`${title}\n${sum}\n${link}`);
        if (!matched.length) continue;

        const canon = normalizeUrl(link || title);
        if (!canon) continue;

        // PRIMARY de-dupe: canonical URL (prevents same article with different IDs)
        const addedCanon = await redis.sadd(SEEN_LINK, canon); // 1=new, 0=seen
        if (addedCanon !== 1) continue;

        // Stable ID from canonical URL
        const mid = idFromCanonical(canon);

        // (Legacy) backstop de-dupe by ID
        await redis.sadd(SEEN, mid);

        const ts = toEpoch(e.isoDate || e.pubDate || e.published || e.updated);
        const m = {
          id: mid,
          canon,
          title: title || "(untitled)",
          link,
          source,
          matched,
          published_ts: ts,
          published: new Date(ts*1000).toISOString()
        };

        await redis.zadd(ZSET, { score: ts, member: JSON.stringify(m) });

        const count = await redis.zcard(ZSET);
        if (count > MAX_MENTIONS) await redis.zremrangebyrank(ZSET, 0, count - MAX_MENTIONS - 1);

        if (isUrgent(matched)) { try { await sendEmail(m); emailed++; } catch {} }
        found++; stored++;
      }
    }
    res.status(200).json({ ok:true, feeds: RSS_FEEDS.length, found, stored, emailed });
  } catch (e) {
    res.status(500).json({ ok:false, error:`collect failed: ${e?.message || e}` });
  }
}
