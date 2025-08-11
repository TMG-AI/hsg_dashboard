// /api/summary.js

function startOfTodayET(){
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now).reduce((o,p)=>{ if(p.type!=="literal") o[p.type]=p.value; return o; }, {});
  // Summer EDT offset; good for "today" counting now
  const iso = `${parts.year}-${parts.month}-${parts.day}T00:00:00-04:00`;
  return Math.floor(new Date(iso).getTime()/1000);
}

function toTs(m){
  if (m && m.published_ts != null) {
    const n = Number(m.published_ts);
    if (Number.isFinite(n)) return n;
  }
  const t = Date.parse(m?.published || "");
  return Number.isFinite(t) ? Math.floor(t/1000) : 0;
}

function isMock(m){
  const t = (m?.title||"").toLowerCase();
  const s = (m?.source||"").toLowerCase();
  const l = (m?.link||"").toLowerCase();
  const i = (m?.id||"").toLowerCase();
  if (i.startsWith("debug_")) return true;
  if (s.includes("example news") || s.includes("debug source")) return true;
  if (l.includes("example.com")) return true;
  if (t.includes("forced write test") || t.includes("mw clamp test")
      || t.includes("sanity write") || t.includes("browser → n8n test")
      || t.includes("browser -> n8n test")) return true;
  if (t.includes("coinbase headline") && s.includes("example news")) return true;
  return false;
}

// *** Replace-only block: origin detection ***
function detectOrigin(m){
  // 1) Keep explicit origin if the item has it
  if (m && m.origin) return m.origin;

  // 2) Meltwater: several independent hints
  const sec  = (m?.section  || "").toLowerCase();
  const prov = (m?.provider || "").toLowerCase();
  const tags = Array.isArray(m?.matched) ? m.matched.map(x => String(x).toLowerCase()) : [];
  if (sec === "meltwater" || prov === "meltwater" || tags.includes("meltwater-alert")) {
    return "meltwater";
  }

  // 3) Google Alerts: URL patterns and common labels
  try {
    const u = m?.link ? new URL(m.link) : null;
    const host = u ? u.hostname.toLowerCase() : "";
    if (/(^|\.)news\.google\./.test(host)) return "google_alerts";
    if (/(^|\.)feedproxy\.google\./.test(host)) return "google_alerts";
    if (host === "www.google.com") {
      const q = u.search || "";
      if (q.includes("ct=ga") || q.includes("tbm=nws")) return "google_alerts";
    }
  } catch {}

  const src = (m?.source || "").toLowerCase();
  if (src.includes("google alerts") || src === "google") return "google_alerts";

  // 4) Optional: honor common social buckets if your items set them
  if ((m?.section||"").toLowerCase()==="reddit" || src==="reddit") return "reddit";
  if ((m?.section||"").toLowerCase()==="x" || src==="x" || src==="twitter") return "x";

  // 5) Default
  return "rss";
}

export default async function handler(req, res){
  try{
    // Build absolute URL to your existing feed so we count exactly what the page shows
    const host  = req.headers["x-forwarded-host"] || req.headers.host;
    const proto = req.headers["x-forwarded-proto"] || "https";
    const url   = `${proto}://${host}/api/get_mentions?limit=1000&nocache=1&_=${Date.now()}`;

    const r = await fetch(url, { cache: "no-store", headers: { "accept": "application/json" } });
    if (!r.ok) {
      res.status(502).json({ ok:false, error:`get_mentions ${r.status}` });
      return;
    }

    let list = await r.json();
    // /api/get_mentions returns an array in your repo; handle {items:[]} just in case
    if (!Array.isArray(list) && list && Array.isArray(list.items)) list = list.items;
    if (!Array.isArray(list)) list = [];

    const startToday = startOfTodayET();

    // Keep today's items by each item's own timestamp; drop known test rows
    const today = list.filter(m => toTs(m) >= startToday && !isMock(m));

    // Tally by origin
    const by_origin = { meltwater:0, google_alerts:0, rss:0, reddit:0, x:0, other:0 };
    for (const m of today){
      const o = detectOrigin(m);
      if (by_origin[o] == null) by_origin.other++; else by_origin[o]++;
    }

    // Top publishers (Meltwater only), using Reach if present
    const pubs = new Map();
    for (const m of today){
      if (detectOrigin(m) !== "meltwater") continue;
      const pub = m.source || "Unknown";
      const reach = Number(m?.provider_meta?.reach ?? m?.meta?.reach ?? 0) || 0;
      const arr = pubs.get(pub) || [];
      arr.push({ title: m.title, link: m.link || null, reach });
      pubs.set(pub, arr);
    }
    const top_publishers = [...pubs.entries()].map(([publisher, arr]) => ({
      publisher,
      total_reach: arr.reduce((a,b)=>a+(b.reach||0),0),
      article_count: arr.length,
      articles: arr.slice(0,5)
    })).sort((a,b)=> (b.total_reach||0)-(a.total_reach||0)).slice(0,5);

    res.status(200).json({
      ok: true,
      window: "today",
      totals: { all: today.length, by_origin },
      top_publishers,
      generated_at: new Date().toISOString()
    });
  }catch(e){
    // Return safe payload so tiles render; include error message for debugging
    res.status(200).json({
      ok: false,
      window: "today",
      totals: { all: 0, by_origin: { meltwater:0, google_alerts:0, rss:0, reddit:0, x:0, other:0 } },
      top_publishers: [],
      error: e?.message || String(e)
    });
  }
}
