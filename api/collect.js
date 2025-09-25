import { Redis } from "@upstash/redis";
import Parser from "rss-parser";
import { Resend } from "resend";

// ---- clients ----
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN
});

// Enable YouTube/media fields & add requestOptions for UA
const parser = new Parser({
  customFields: {
    item: [
      ['media:group', 'media', { keepArray: false }],
      ['media:description', 'mediaDescription'],
      ['media:content', 'mediaContent', { keepArray: false }],
      ['media:thumbnail', 'mediaThumb', { keepArray: false }],
    ]
  },
  requestOptions: {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8',
    },
    timeout: 10000
  }
});

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// ---- storage keys ----
const ZSET = "mentions:z";
const SEEN_ID = "mentions:seen";
const SEEN_LINK = "mentions:seen:canon";
const MAX_MENTIONS = 5000;

// ---- config ----
const RSS_FEEDS = (process.env.RSS_FEEDS || "").split(",").map(s => s.trim()).filter(Boolean);
const KEYWORDS  = (process.env.KEYWORDS  || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
const URGENT    = (process.env.ALERT_KEYWORDS_URGENT || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

// ---- section rules ----
const SECTION_RULES = {
  "coindesk.com": "Top Crypto News",
  "theblock.co": "Top Crypto News",
  "cointelegraph.com": "Top Crypto News",
  "decrypt.co": "Top Crypto News",
  "blockworks.co": "Top Crypto News",
  "news.bitcoin.com": "Major Sources",
  "crypto.news": "Major Sources",
  "newsbtc.com": "Major Sources",
  "u.today": "Major Sources",
  "bitcoinist.com": "Major Sources",
  "99bitcoins.com": "Major Sources",
  "cryptopanic.com": "Aggregators",
  "bitcoinnews.com": "Specialized",
};

// ---- helpers ----
function normalizeUrl(u) {
  try {
    const url = new URL(u);
    url.hash = "";
    ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","utm_id",
     "mc_cid","mc_eid","ref","fbclid","gclid","igshid"].forEach(p => url.searchParams.delete(p));
    if ([...url.searchParams.keys()].length === 0) url.search = "";
    url.hostname = url.hostname.toLowerCase();
    let s = url.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return (u || "").trim();
  }
}
function hostOf(u) { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } }
function normalizeHost(h) { return (h || "").toLowerCase().replace(/^www\./, "").replace(/^amp\./, ""); }
function sectionFor(link, fallback) {
  const raw = hostOf(link);
  const host = normalizeHost(raw);
  for (const [key, sec] of Object.entries(SECTION_RULES)) {
    if (host === key || host.endsWith("." + key)) return sec;
  }
  if ((fallback || "").toLowerCase().includes("bitcoin")) return "Major Sources";
  return "Other";
}
function unwrapGoogleAlert(u) {
  try {
    const url = new URL(u);
    if (url.hostname.endsWith("google.com") && url.pathname === "/url") {
      return url.searchParams.get("q") || url.searchParams.get("url") || u;
    }
    return u;
  } catch { return u; }
}
function displaySource(link, fallback) { const h = normalizeHost(hostOf(link)); return h || (fallback || ""); }
function buildYouTubeWatchUrl(s) {
  s = (s || "").trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return `https://www.youtube.com/watch?v=${s}`;
  return s;
}
function extractItemLink(e) {
  let raw =
    (e.link && typeof e.link === "object" && e.link.href) ? e.link.href :
    (Array.isArray(e.link) && e.link[0]?.href)            ? e.link[0].href :
    (e.links && e.links[0]?.href)                         ? e.links[0].href :
    (typeof e.link === "string" ? e.link : "") ||
    (typeof e.id === "string" ? e.id : "");

  raw = unwrapGoogleAlert(raw);

  const ytId =
    e["yt:videoId"] ||
    e.videoId ||
    (typeof e.id === "string" && e.id.startsWith("yt:video:") ? e.id.split("yt:video:")[1] : "");

  if (!/^https?:\/\//i.test(raw) && ytId) raw = buildYouTubeWatchUrl(ytId);
  else {
    const h = hostOf(raw);
    if (h.includes("youtube.com") || h.includes("youtu.be")) raw = buildYouTubeWatchUrl(raw);
  }
  return (raw || "").trim();
}
function matchKeywords(text) { const t = (text || "").toLowerCase(); return KEYWORDS.filter(k => t.includes(k)); }
function isUrgent(m) { if (!URGENT.length) return false; const set = new Set(m.map(x => x.toLowerCase())); return URGENT.some(u => set.has(u)); }
function idFromCanonical(c) { let h=0; for (let i=0;i<c.length;i++) h=(h*31+c.charCodeAt(i))>>>0; return `m_${h.toString(16)}`; }
function toEpoch(d){ const t=Date.parse(d); return Number.isFinite(t)?Math.floor(t/1000):Math.floor(Date.now()/1000); }
const ENABLE_SENTIMENT = (process.env.ENABLE_SENTIMENT || "").toLowerCase() === "true";
const POS = ["win","surge","rally","gain","positive","bull","record","secure","approve","partnership"];
const NEG = ["hack","breach","lawsuit","fine","down","drop","negative","bear","investigate","halt","outage","delay","ban"];
function sentimentScore(text){
  const t = (text||"").toLowerCase();
  let s = 0;
  for (const w of POS) if (t.includes(w)) s += 1;
  for (const w of NEG) if (t.includes(w)) s -= 1;
  return s;
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

// ---- handler ----
export default async function handler(req, res) {
  try {
    let found = 0, stored = 0, emailed = 0, errors = [];

    // Check if RSS feeds are configured
    if (!RSS_FEEDS.length) {
      console.log('RSS_FEEDS not configured - skipping RSS collection');
      res.status(200).json({
        ok: true,
        message: "RSS collection disabled - no feeds configured",
        found: 0,
        stored: 0,
        emailed: 0,
        errors: [],
        rss_disabled: true,
        generated_at: new Date().toISOString()
      });
      return;
    }

    if (!KEYWORDS.length) {
      console.log('KEYWORDS not configured - skipping RSS collection');
      res.status(200).json({
        ok: true,
        message: "RSS collection disabled - no keywords configured",
        found: 0,
        stored: 0,
        emailed: 0,
        errors: [],
        keywords_disabled: true,
        generated_at: new Date().toISOString()
      });
      return;
    }

    console.log(`RSS collection starting: ${RSS_FEEDS.length} feeds, ${KEYWORDS.length} keywords`);

    for (const url of RSS_FEEDS) {
      try {
        const feed = await parser.parseURL(url);
        const feedTitle = feed?.title || url;

        for (const e of feed?.items || []) {
          const title = (e.title || "").trim();
          const ytDesc = e.mediaDescription || e?.media?.description || e?.mediaContent?.description || "";
          const sum = ytDesc || e.contentSnippet || e.content || e.summary || "";
          const link = extractItemLink(e);

          let matched = matchKeywords(`${title}\n${sum}\n${feedTitle}\n${link}`);
          const isYT = /youtube\.com|youtu\.be/.test((new URL(link)).hostname);
          const isOfficialYT = isYT && /coinbase|^base\b|build on base/i.test(feedTitle || "");
          if (!matched.length && isOfficialYT) matched = ["coinbase"];
          if (!matched.length) continue;

          const canon = normalizeUrl(link || title);
          if (!canon) continue;

          const addCanon = await redis.sadd(SEEN_LINK, canon);
          if (addCanon !== 1) continue;

          const mid = idFromCanonical(canon);
          await redis.sadd(SEEN_ID, mid);

          const ts = toEpoch(e.isoDate || e.pubDate || e.published || e.updated);
          const section = sectionFor(link, feedTitle);

          const m = {
            id: mid,
            canon,
            section,
            title: title || "(untitled)",
            link,
            source: displaySource(link, feedTitle),
            matched,
            summary: sum,
            published_ts: ts,
            published: new Date(ts * 1000).toISOString()
          };

          if (ENABLE_SENTIMENT) m.sentiment = sentimentScore(`${title} ${sum}`);
          await redis.zadd(ZSET, { score: ts, member: JSON.stringify(m) });

          const count = await redis.zcard(ZSET);
          if (count > MAX_MENTIONS) await redis.zremrangebyrank(ZSET, 0, count - MAX_MENTIONS - 1);

          if (isUrgent(matched)) { try { await sendEmail(m); emailed++; } catch {} }
          found++; stored++;
        }
      } catch (err) {
        errors.push({ url, error: err?.message || String(err) });
      }
    }
    res.status(200).json({ ok:true, feeds: RSS_FEEDS.length, found, stored, emailed, errors });
  } catch (e) {
    res.status(500).json({ ok:false, error:`collect failed: ${e?.message || e}` });
  }
}
