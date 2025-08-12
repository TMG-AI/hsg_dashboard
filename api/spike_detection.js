// /api/spike_detection.js

function startOfTodayET(){
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now).reduce((o,p)=>{ if(p.type!=="literal") o[p.type]=p.value; return o; }, {});
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

function isMW(m){
  const sec  = (m?.section  || "").toLowerCase();
  const prov = (m?.provider || "").toLowerCase();
  const tags = Array.isArray(m?.matched) ? m.matched.map(x => String(x).toLowerCase()) : [];
  return (m?.origin==="meltwater" || sec==="meltwater" || prov==="meltwater" || tags.includes("meltwater-alert"));
}

function detectPlatform(m, sl){
  const s = `${(m?.title||"")} ${sl}`.toLowerCase();
  if (s.includes("twitter") || s.includes("x ")) return "x";
  if (s.includes("reddit")) return "reddit";
  if (s.includes("social")) return "social";
  if (s.includes("news")) return "news";
  return "social";
}

function parseSpikeFromStatus(statusLine){
  if (!statusLine) return null;
  const sl = String(statusLine);

  // e.g., "2361 Social mentions ... ↑ 76%"
  const countMatch = sl.match(/([\d.,]+)\s*(K|M|B)?\s*(?:Social\s*)?mentions/i);
  const pctMatch   = sl.match(/↑\s*([0-9]+)%/);
  if (!countMatch && !pctMatch) return null;

  let count = null;
  if (countMatch){
    let n = parseFloat(countMatch[1].replace(/,/g,""));
    const unit = (countMatch[2]||"").toUpperCase();
    if (unit==="K") n*=1e3;
    if (unit==="M") n*=1e6;
    if (unit==="B") n*=1e9;
    count = Math.round(n);
  }
  const pct = pctMatch ? parseInt(pctMatch[1],10) : null;

  return { mention_count: count, spike_percentage: pct };
}

export default async function handler(req, res){
  try{
    const host  = req.headers["x-forwarded-host"] || req.headers.host;
    const proto = req.headers["x-forwarded-proto"] || "https";
    const url   = `${proto}://${host}/api/get_mentions?limit=1000&nocache=1&_=${Date.now()}`;

    const r = await fetch(url, { cache: "no-store", headers: { "accept": "application/json" } });
    if (!r.ok) {
      return res.status(200).json({ ok:true, window:"today", spikes:[], note:`get_mentions ${r.status}` });
    }

    let list = await r.json();
    if (!Array.isArray(list) && list && Array.isArray(list.items)) list = list.items;
    if (!Array.isArray(list)) list = [];

    const start = startOfTodayET();

    const spikes = [];
    for (const m of list){
      if (toTs(m) < start) continue;
      if (!isMW(m)) continue;

      const statusLine = m?.provider_raw?.statusLine || m?.provider_meta?.statusLine || m?.statusLine || "";
      const parsed = parseSpikeFromStatus(statusLine);
      if (!parsed) continue;

      const platform = detectPlatform(m, statusLine);
      spikes.push({
        title: m.title || "(untitled)",
        platform,
        spike_percentage: parsed.spike_percentage,
        mention_count: parsed.mention_count,
        detected_at: new Date((toTs(m)||Math.floor(Date.now()/1000))*1000).toISOString(),
        link: m.link || null
      });
    }

    // sort newest first and de-dupe by title+platform
    spikes.sort((a,b)=> new Date(b.detected_at) - new Date(a.detected_at));
    const seen = new Set();
    const dedup = [];
    for (const s of spikes){
      const key = `${s.title}::${s.platform}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push(s);
    }

    return res.status(200).json({ ok:true, window:"today", spikes: dedup });
  }catch(e){
    return res.status(200).json({ ok:true, window:"today", spikes:[], error_message: e?.message || String(e) });
  }
}
