import { Redis } from "@upstash/redis";
import Parser from "rss-parser";
import { Resend } from "@resend/node";

const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
const parser = new Parser();
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const ZSET = "mentions:z";
const SEEN = "mentions:seen";
const MAX_MENTIONS = 5000;

const RSS_FEEDS = (process.env.RSS_FEEDS || "").split(",").map(s=>s.trim()).filter(Boolean);
const KEYWORDS  = (process.env.KEYWORDS  || "").split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);
const URGENT    = (process.env.ALERT_KEYWORDS_URGENT || "").split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);

function matchKeywords(text){ const t=(text||"").toLowerCase(); return KEYWORDS.filter(k=>t.includes(k)); }
function isUrgent(m){ if(!URGENT.length) return false; const set=new Set(m.map(x=>x.toLowerCase())); return URGENT.some(u=>set.has(u)); }
function mentionId(link,title){ const s=(link||title||""); let h=0; for(let i=0;i<s.length;i++){h=(h*31+s.charCodeAt(i))>>>0;} return `m_${h.toString(16)}`; }
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

        const mid = mentionId(link, title);
        const added = await redis.sadd(SEEN, mid);  // 1=new, 0=seen
        if (added !== 1) continue;

        const ts = toEpoch(e.isoDate || e.pubDate || e.published || e.updated);
        const m = {
          id: mid, title: title || "(untitled)", link, source,
          matched, published_ts: ts, published: new Date(ts*1000).toISOString()
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
