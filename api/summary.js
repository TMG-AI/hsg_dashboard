// /api/summary.js

function startOfTodayET(){
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now).reduce((o,p)=>{ if(p.type!=="literal") o[p.type]=p.value; return o; }, {});
  // EDT offset for summer; fine for "today" tiles
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

// Your RSS domains (from your list) – include www. variants
const RSS_DOMAINS = new Set([
  "coindesk.com","www.coindesk.com",
  "theblock.co","www.theblock.co",
  "cointelegraph.com","www.cointelegraph.com",
  "decrypt.co","www.decrypt.co",
  "blockworks.co","www.blockworks.co",
  "news.bitcoin.com","www.news.bitcoin.com","bitcoin.com","www.bitcoin.com", // feed host may vary
  "crypto.news","www.crypto.news",
  "newsbtc.com","www.newsbtc.com",
  "u.today","www.u.today",
  "cryptopanic.com","www.cryptopanic.com",
  "bitcoinist.com","www.bitcoinist.com",
  "99bitcoins.com","www.99bitcoins.com",
  "bitcoinnews.com","www.bitcoinnews.com"
]);

function hostFromUrl(u){
  try { return new URL(u).hostname.toLowerCase(); } catch { return ""; }
}
function domainLike(s){
  const x = String(s||"").toLowerCase();
  return x.includes(".") ? x : "";
}

function detectOrigin(m){
  // 1) Explicit Meltwater hints
  const sec  = (m?.section  || "").toLowerCase();
  const prov = (m?.provider || "").toLowerCase();
  const tags = Array.isArray(m?.matched) ? m.matched.map(x => String(x).toLowerCase()) : [];
  if ((m && m.origin === "meltwater") || sec === "meltwater" || prov === "meltwater" || tags.includes("meltwater-alert")) {
    return "meltwater";
  }

  // 2) If link host matches one of your RSS domains → rss
  const host = hostFromUrl(m?.link);
  if (host && RSS_DOMAINS.has(host)) return "rss";

  // 3) If source looks like a domain and matches your RSS set → rss
  const srcDom = domainLike(m?.source);
  if (srcDom && RSS_DOMAINS.has(srcDom)) return "rss";

  // 4) Everything else → google_alerts (your request)
  return "google_alerts";
}

export default async function handler(req, res){
  try{
    // Read from the same feed your page uses (no Redis assumptions)
    const host  = req.headers["x-forwarded-host"] || req.headers.host;
    const proto = req.headers["x-forwarded-proto"] || "https";
    const url   = `${proto}://${host}/api/get_mentions?limit=1000&nocache=1&_=${Date.now()}`;

    const r = await fetch(url, { cache: "no-store", headers: { "accept": "application/json" } });
    if (!r.ok) {
      return res.status(200).json({
        ok: true,
        window: "today",
        totals: { all: 0, by_origin: { meltwater:0, google_alerts:0, rss:0, other:0 } },
        top_publishers: [],
        note: `get_mentions returned ${r.status}`
      });
    }

    let list;
    try { list = await r.json(); } catch { list = []; }
    if (!Array.isArray(list) && list && Array.isArray(list.items)) list = list.items;
    if (!Array.isArray(list)) list = [];

    const startToday = startOfTodayET();

    // Keep today's, drop test rows
    const today = list.filter(m => toTs(m) >= startToday && !isMock(m));

    // Tally using your new rule
    const by_origin = { meltwater:0, google_alerts:0, rss:0, other:0 };
    for (const m of today){
      const o = detectOrigin(m);
      if (by_origin[o] == null) by_origin.other++; else by_origin[o]++;
    }

    // Top publishers (Meltwater only)
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

    return res.status(200).json({
      ok: true,
      window: "today",
      totals: { all: today.length, by_origin },
      top_publishers,
      generated_at: new Date().toISOString()
    });

  } catch (e){
    // Never 500 → safe zeros so tiles render
    return res.status(200).json({
      ok: true,
      window: "today",
      totals: { all: 0, by_origin: { meltwater:0, google_alerts:0, rss:0, other:0 } },
      top_publishers: [],
      note: "summary fallback",
      error_message: e?.message || String(e)
    });
  }
}
