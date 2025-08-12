// /api/cleanup_recent.js
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN
});

const ZSET = "mentions:z";

// Aggregators we prefer to drop if an original exists
const AGG_DOMAINS = new Set(["cryptopanic.com","www.cryptopanic.com"]);

function startOfTodayET(){
  const now = new Date();
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year:"numeric", month:"2-digit", day:"2-digit"
  }).formatToParts(now).reduce((o,p)=>{ if(p.type!=="literal") o[p.type]=p.value; return o; },{});
  // -04:00 is fine for summer; this is for "today" UX, not archival accuracy
  const iso = `${p.year}-${p.month}-${p.day}T00:00:00-04:00`;
  return Math.floor(new Date(iso).getTime()/1000);
}
function hostFromUrl(u){ try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } }
function norm(s){ return String(s||"").trim().toLowerCase(); }

export default async function handler(req,res){
  try{
    // Protect with your existing secret
    const key = (req.headers["x-admin-key"] || req.query?.key || "").toString();
    const allow = key && (key === process.env.MW_WEBHOOK_SECRET);
    if (!allow) return res.status(401).json({ ok:false, error:"unauthorized" });

    // Window
    const win = (req.query?.window || "today").toString();
    const hours = Number(req.query?.hours || 24);
    let start = 0;
    if (win === "today") start = startOfTodayET();
    else if (win === "24h" || Number.isFinite(hours)) start = Math.floor(Date.now()/1000) - (hours*3600);

    // Load all, then filter to window (avoid zrangeByScore client mismatch)
    const all = await redis.zrange(ZSET, 0, -1);
    const recent = [];
    for (const raw of all){
      try{
        const m = JSON.parse(raw);
        const ts = Number(m?.published_ts || 0);
        if (ts >= start) recent.push({ raw, obj: m, ts });
      }catch{}
    }

    // Pass 1: by canonical URL
    const byCanon = new Map(); // canon -> [{raw,obj,ts}]
    for (const it of recent){
      const canon = norm(it.obj?.canon || it.obj?.link || "");
      if (!canon) continue;
      if (!byCanon.has(canon)) byCanon.set(canon, []);
      byCanon.get(canon).push(it);
    }
    const dropCanon = new Set();
    for (const [canon, arr] of byCanon.entries()){
      if (arr.length <= 1) continue;
      arr.sort((a,b)=> b.ts - a.ts);
      // keep newest, drop the rest
      for (let i=1;i<arr.length;i++) dropCanon.add(arr[i].raw);
    }

    // Pass 2: by title with aggregator suppression
    const byTitle = new Map(); // title -> {nonAgg:[], agg:[]}
    for (const it of recent){
      const title = norm(it.obj?.title);
      if (!title) continue;
      const host = hostFromUrl(it.obj?.canon || it.obj?.link || "");
      const isAgg = AGG_DOMAINS.has(host);
      if (!byTitle.has(title)) byTitle.set(title, { nonAgg:[], agg:[] });
      (isAgg ? byTitle.get(title).agg : byTitle.get(title).nonAgg).push(it);
    }
    const dropTitle = new Set();
    for (const [title, groups] of byTitle.entries()){
      const { nonAgg, agg } = groups;
      const sortNew = arr => arr.sort((a,b)=> b.ts - a.ts);

      if (nonAgg.length){
        sortNew(nonAgg);
        // keep newest non-agg, drop older non-agg
        for (let i=1;i<nonAgg.length;i++) dropTitle.add(nonAgg[i].raw);
        // drop all aggregators for this title
        for (const it of agg) dropTitle.add(it.raw);
      } else if (agg.length){
        sortNew(agg);
        // only aggregators exist → keep newest agg, drop older agg
        for (let i=1;i<agg.length;i++) dropTitle.add(agg[i].raw);
      }
    }

    // Union of drops
    const dropSet = new Set([...dropCanon, ...dropTitle]);

    const modeDelete = String(req.query?.do||"").toLowerCase() === "delete";
    let removed = 0;

    if (modeDelete){
      for (const member of dropSet){
        try{
          const r = await redis.zrem(ZSET, member);
          if (r === 1) removed++;
        }catch{}
      }
    }

    // Small sample for inspection
    const sample = [];
    let count = 0;
    for (const raw of dropSet){
      if (count >= 10) break;
      try{
        const m = JSON.parse(raw);
        sample.push({
          title: m?.title || null,
          source: m?.source || null,
          link: m?.link || null,
          canon: m?.canon || null
        });
        count++;
      }catch{}
    }

    return res.status(200).json({
      ok: true,
      mode: modeDelete ? "delete" : "preview",
      window: win,
      scanned: recent.length,
      to_remove: dropSet.size,
      would_remove_by_canon: dropCanon.size,
      would_remove_by_title: dropTitle.size,
      removed,
      sample // up to 10 items
    });
  }catch(e){
    return res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}
