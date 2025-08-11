// /api/summary.js
function startOfTodayET(){
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now).reduce((o,p)=>{ if(p.type!=="literal") o[p.type]=p.value; return o; }, {});
  // EDT offset; good for summer
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

function detectOrigin(m){
  if (m.origin) return m.origin;
  const tags = Array.isArray(m.matched) ? m.matched.map(x=>String(x).toLowerCase()) : [];
  if (tags.includes("meltwater-alert")) return "meltwater";
  try {
    const u = m.link ? new URL(m.link) : null;
    const host = u ? u.hostname.toLowerCase() : "";
    // Google Alerts patterns
    if (/(^|\.)news\.google\./.test(host)) return "google_alerts";
    if (/(^|\.)feedproxy\.google\./.test(host)) return "google_alerts";
    if (host === "www.google.com" && (u.search||"").includes("ct=ga")) return "google_alerts";
  } catch {}
  return "rss";
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

export default async function handler(req, res){
  try{
    // Build absolute URL to your own get_mentions
    const host  = req.headers["x-forwarded-host"] || req.headers.host;
    const proto = req.headers["x-forwarded-proto"] || "https";
    const url   = `${proto}://${host}/api/get_mentions?limit=1000&nocache=1&_=${Date.now()}`;

    const r = await fetch(url, { cache: "no-store", headers: { "accept": "application/json" } });
    if (!r.ok) {
      res.status(502).json({ ok:false, error:`get_mentions ${r.status}` });
      return;
    }

    let list = await r.json();
    // /api/get_mentions returns an array; if it ever returns {items:[]}, handle that too
    if (!Array.isArray(list) && list && Array.isArray(list.items)) list = list.items;
    if (!Array.isArray(list)) list = [];

    const startToday = startOfTodayET();

    // keep today + drop tests
    const today = list.filter(m => toTs(m) >= startToday && !isMock(m));

    // counts
    const by_origin = { meltwater:0, google_alerts:0, rss:0, reddit:0, x:0, other:0 };
    for (const m of today){
      const o = detectOrigin(m);
      if (by_origin[o] == null) by_origin.other++; else by_origin[o]++;
    }

    // top publishers (Meltwater only), using reach if present
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
    // Log server error and return a safe payload so tiles don't show dashes forever
    console.error("summary error:", e);
    res.status(200).json({
      ok: false,
      window: "today",
      totals: { all: 0, by_origin: { meltwater:0, google_alerts:0, rss:0, reddit:0, x:0, other:0 } },
      top_publishers: [],
      error: e?.message || String(e)
    });
  }
}
