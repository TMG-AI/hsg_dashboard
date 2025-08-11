import { Redis } from "@upstash/redis";

const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
const ZSET = "mentions:z";

function startOfTodayET(){
  // Today at 00:00 ET in epoch seconds
  const now = new Date();
  const et = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year:'numeric', month:'2-digit', day:'2-digit' })
               .formatToParts(now)
               .reduce((o,p)=>{ if(p.type!=='literal') o[p.type]=p.value; return o; },{});
  const s = `${et.year}-${et.month}-${et.day}T00:00:00-04:00`; // handles DST during summer; good enough for daily counting
  return Math.floor(new Date(s).getTime()/1000);
}

function safeParse(x){ try { return JSON.parse(x); } catch { return null; } }

function detectOrigin(m){
  if (m.origin) return m.origin;

  const tags = Array.isArray(m.matched) ? m.matched.map(s=>String(s).toLowerCase()) : [];
  if (tags.includes('meltwater-alert')) return 'meltwater';

  // Google Alerts recognition: host patterns or tag
  try {
    const u = m.link ? new URL(m.link) : null;
    const host = u ? u.hostname : '';
    if (/news\.google\./i.test(host) || /google\./i.test(host) && /alerts/i.test(m.title||'')) return 'google_alerts';
  } catch {}

  // Fallback
  return 'rss';
}

export default async function handler(req, res){
  try{
    const window = (req.query.window || 'today').toLowerCase();
    const end = Math.floor(Date.now()/1000);
    const start = window === 'today' ? startOfTodayET() : (end - 24*3600);

    // pull today's members
    const raw = await redis.zrangebyscore(ZSET, start, end, { withScores: false });
    const items = raw.map(safeParse).filter(Boolean);

    // filter out obvious test/debug
    const clean = items.filter(m => !(String(m.id||'').startsWith('debug_') || (m.source||'').includes('Example News')));

    // counts
    const by_origin = { meltwater:0, google_alerts:0, rss:0, reddit:0, x:0, other:0 };
    for (const m of clean){
      const origin = detectOrigin(m);
      if (by_origin[origin] == null) by_origin.other++;
      else by_origin[origin]++;
    }
    const total = clean.length;

    // simple top publishers (Meltwater only) by reach
    const pubs = new Map();
    for (const m of clean){
      const origin = detectOrigin(m);
      if (origin !== 'meltwater') continue;
      const pub = m.source || 'Unknown';
      const reach = Number(m?.provider_meta?.reach) || 0;
      const arr = pubs.get(pub) || [];
      arr.push({ title: m.title, link: m.link || null, reach });
      pubs.set(pub, arr);
    }
    const top_publishers = [...pubs.entries()].map(([publisher, arr]) => ({
      publisher,
      total_reach: arr.reduce((a,b)=>a+(b.reach||0),0),
      article_count: arr.length,
      articles: arr.slice(0,5)
    }))
    .sort((a,b)=> (b.total_reach||0)-(a.total_reach||0))
    .slice(0,5);

    res.status(200).json({
      ok:true,
      window,
      totals:{ all: total, by_origin },
      top_publishers,
      generated_at: new Date().toISOString()
    });
  }catch(e){
    res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}
