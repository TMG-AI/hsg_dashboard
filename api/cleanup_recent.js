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
    timeZone: "America/New_York", year:"numeric", month:"2-digit", day:"2-digit"
  }).formatToParts(now).reduce((o,p)=>{ if(p.type!=="literal") o[p.type]=p.value; return o; },{});
  const iso = `${p.year}-${p.month}-${p.day}T00:00:00-04:00`;
  return Math.floor(new Date(iso).getTime()/1000);
}
function hostFromUrl(u){ try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } }
function normStr(s){ return String(s||"").trim().toLowerCase(); }

// Normalize titles to a comparable “key”
function normalizeTitleKey(t){
  let s = String(t||"").toLowerCase();
  // unify punctuation and unicode
  s = s.replace(/[\u2018\u2019\u201C\u201D]/g, "'").replace(/[\u2013\u2014]/g, "-");
  // drop site suffixes: "title - site", "title — site", "title | site"
  s = s.split(" - ")[0].split(" — ")[0].split(" | ")[0];
  // remove quotes/brackets
  s = s.replace(/["'“”‘’()[\]]/g, " ");
  // collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// token signature for fuzzy matching (words ≥4 chars)
function titleTokens(t){
  const s = normalizeTitleKey(t);
  const m = s.match(/[a-z0-9]{4,}/g);
  return new Set(m || []);
}
function jaccard(aSet, bSet){
  let inter = 0;
  for (const x of aSet) if (bSet.has(x)) inter++;
  const union = aSet.size + bSet.size - inter || 1;
  return inter / union;
}

export default async function handler(req,res){
  try{
    // Protect with your existing secret (via key=... or x-admin-key)
    const key = (req.headers["x-admin-key"] || req.query?.key || "").toString();
    const allow = key && (key === process.env.MW_WEBHOOK_SECRET);
    if (!allow) return res.status(401).json({ ok:false, error:"unauthorized" });

    // Window
    const win = (req.query?.window || "today").toString();
    const hours = Number(req.query?.hours || 24);
    const modeDelete = String(req.query?.do||"").toLowerCase() === "delete";

    let start = 0;
    if (win === "today") start = startOfTodayET();
    else if (win === "24h" || Number.isFinite(hours)) start = Math.floor(Date.now()/1000) - (hours*3600);

    // Load all, filter to window
    const all = await redis.zrange(ZSET, 0, -1);
    const recent = [];
    for (const raw of all){
      try{
        const m = JSON.parse(raw);
        const ts = Number(m?.published_ts || 0);
        if (ts >= start) recent.push({ raw, obj: m, ts });
      }catch{}
    }

    // Index by canonical URL (strict)
    const byCanon = new Map(); // canon -> [items]
    for (const it of recent){
      const canon = normStr(it.obj?.canon || it.obj?.link || "");
      if (!canon) continue;
      if (!byCanon.has(canon)) byCanon.set(canon, []);
      byCanon.get(canon).push(it);
    }
    const dropCanon = new Set();
    for (const [canon, arr] of byCanon.entries()){
      if (arr.length <= 1) continue;
      arr.sort((a,b)=> b.ts - a.ts);
      for (let i=1;i<arr.length;i++) dropCanon.add(arr[i].raw); // keep newest
    }

    // Bucket by normalized title key; capture tokens for fuzzy compare
    const buckets = new Map(); // key -> {nonAgg:[], agg:[]}
    for (const it of recent){
      const key = normalizeTitleKey(it.obj?.title);
      if (!key) continue;
      const host = hostFromUrl(it.obj?.canon || it.obj?.link || "");
      const isAgg = AGG_DOMAINS.has(host);
      const tokenSet = titleTokens(it.obj?.title);
      const wrapped = { ...it, isAgg, host, key, tokenSet };
      if (!buckets.has(key)) buckets.set(key, { nonAgg:[], agg:[] });
      (isAgg ? buckets.get(key).agg : buckets.get(key).nonAgg).push(wrapped);
    }

    // Exact-key logic (fast path)
    const dropTitleExact = new Set();
    for (const [key, grp] of buckets.entries()){
      const sortNew = arr => arr.sort((a,b)=> b.ts - a.ts);

      if (grp.nonAgg.length){
        sortNew(grp.nonAgg);
        // keep newest non-agg, drop older non-agg
        for (let i=1;i<grp.nonAgg.length;i++) dropTitleExact.add(grp.nonAgg[i].raw);
        // drop all aggregators with same key
        for (const it of grp.agg) dropTitleExact.add(it.raw);
      } else if (grp.agg.length){
        sortNew(grp.agg);
        // only aggregators → keep newest agg, drop older agg
        for (let i=1;i<grp.agg.length;i++) dropTitleExact.add(grp.agg[i].raw);
      }
    }

    // Fuzzy logic for near-duplicates where titles differ slightly
    // Build non-agg index by tokens for quick compare
    const nonAggAll = [];
    for (const { nonAgg } of buckets.values()) nonAggAll.push(...nonAgg);

    const dropTitleFuzzy = new Set();
    const FUZZY_THRESHOLD = 0.55; // 55% token overlap
    for (const { agg } of buckets.values()){
      for (const a of agg){
        for (const n of nonAggAll){
          const sim = jaccard(a.tokenSet, n.tokenSet);
          if (sim >= FUZZY_THRESHOLD) {
            // aggregator highly similar to a non-agg → drop aggregator
            dropTitleFuzzy.add(a.raw);
            break;
          }
        }
      }
    }

    // Union of all “drop” candidates
    const dropSet = new Set([...dropCanon, ...dropTitleExact, ...dropTitleFuzzy]);

    let removed = 0;
    if (modeDelete){
      for (const member of dropSet){
        try{
          const r = await redis.zrem(ZSET, member);
          if (r === 1) removed++;
        }catch{}
      }
    }

    // sample up to 10 removed candidates
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
      removed,
      by_canon: dropCanon.size,
      by_title_exact: dropTitleExact.size,
      by_title_fuzzy: dropTitleFuzzy.size,
      sample
    });
  }catch(e){
    return res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}
