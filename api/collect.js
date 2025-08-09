import { Redis } from "@upstash/redis";
import Parser from "rss-parser";
import { Resend } from "resend";

const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
const parser = new Parser();
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const ZSET = "mentions:z";
const SEEN_ID = "mentions:seen";          // legacy ID de-dupe
const SEEN_LINK = "mentions:seen:canon";   // canonical URL de-dupe
const MAX_MENTIONS = 5000;

const RSS_FEEDS = (process.env.RSS_FEEDS || "").split(",").map(s=>s.trim()).filter(Boolean);
const KEYWORDS  = (process.env.KEYWORDS  || "").split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);
const URGENT    = (process.env.ALERT_KEYWORDS_URGENT || "").split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);

// ---- Section rules by hostname ----
const SECTION_RULES = {
  // Top-tier crypto (your original five stay as-is too)
  "coindesk.com": "Top Crypto News",
  "theblock.co": "Top Crypto News",
  "cointelegraph.com": "Top Crypto News",
  "decrypt.co": "Top Crypto News",
  "blockworks.co": "Top Crypto News",
  // New: major sources
  "news.bitcoin.com": "Major Sources",
  "crypto.news": "Major Sources",
  "newsbtc.com": "Major Sources",
  "u.today": "Major Sources",
  "bitcoinist.com": "Major Sources",
  "99bitcoins.com": "Major Sources",
  // Aggregators / meta
  "cryptopanic.com": "Aggregators",
  // Specialized / exchange blogs
  "bitcoinnews.com": "Specialized",
};

function normalizeUrl(u) {
  try {
    const url = new URL(u);
    url.hash = "";
    ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","utm_id",
     "mc_cid","mc_eid","ref","fbclid","gclid","igshid"].forEach(p=>url.searchParams.delete(p));
    if ([...url.searchParams.keys()].length === 0) url.search = "";
    url.hostname = url.hostname.toLowerCase();
    let s = url.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch { return (u || "").trim(); }
}

function hostOf(u) {
  try { return new URL(u).hostname.toLowerCase(); } catch { return ""; }
}

function normalizeHost(h) {
  // collapse common subdomains so www.coindesk.com → coindesk.com
  return (h || "")
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/^amp\./, "");
}

function sectionFor(link, fallbackSourceTitle) {
  const raw = hostOf(link);
  const host = normalizeHost(raw);

  // Use SECTION_RULES; match exact host or any subdomain of a rule key
  for (const [key, sec] of Object.entries(SECTION_RULES)) {
    if (host === key || host.endsWith("." + key)) return sec;
  }

  // Fallback heuristic
  if ((fallbackSourceTitle || "").toLowerCase().includes("bitcoin")) return "Major Sources";
  return "Other";
}


function matchKeywords(text){ const t=(text||"").toLowerCase(); return KEYWORDS.filter(k=>t.includes(k)); }
function isUrgent(m){ if(!URGENT.length) return false; const set=new Set(m.map(x=>x.toLowerCase())); return URGENT.some(u=>set.has(u)); }
function idFromCanonical(canon) { let h=0; for (let i=0;i<canon.length;i++) h=(h*31+canon.charCodeAt(i))>>>0; return `m_${h.toString(16)}`; }
function toEpoch(d){ const t=Date.parse(d); return Number.isFinite(t)?Math.floor(t/1000):Math.floor(Date.now()/1000); }

// Optional sentiment (lexicon-based via tiny inline dict to avoid extra deps)
const ENABLE_SENTIMENT = (process.env.ENABLE_SENTIMENT || "").toLowerCase() === "true";
const POS = ["win","surge","rally","gain","positive","bull","record","secure","approve","partnership"];
const NEG = ["hack","breach","lawsuit","fine","down","drop","negative","bear","investigate","halt","outage","delay","ban"];
function sentimentScore(text){
  const t = (text||"").toLowerCase();
  let s = 0;
  for (const w of POS) if (t.includes(w)) s += 1;
  for (const w of NEG) if (t.includes(w)) s -= 1;
  return s; // -N..+N
}

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
           <p>Section: ${m.section}</p>
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

        // Canonical URL de-dupe first
        const addCanon = await redis.sadd(SEEN_LINK, canon); // 1=new, 0=seen
        if (addCanon !== 1) continue;

        const mid = idFromCanonical(canon);
        await redis.sadd(SEEN_ID, mid); // back-compat

        const ts = toEpoch(e.isoDate || e.pubDate || e.published || e.updated);
        const section = sectionFor(link, source);
        const m = {
          id: mid,
          canon,
          section,
          title: title || "(untitled)",
          link,
          source,
          matched,
          published_ts: ts,
          published: new Date(ts*1000).toISOString()
        };

        if (ENABLE_SENTIMENT) {
          m.sentiment = sentimentScore(`${title} ${sum}`);
        }

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
