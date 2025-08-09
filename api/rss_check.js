import Parser from "rss-parser";
const parser = new Parser({
  customFields: { item: [
    ['media:group', 'media', { keepArray: false }],
    ['media:description', 'mediaDescription'],
    ['media:content', 'mediaContent', { keepArray: false }],
    ['media:thumbnail', 'mediaThumb', { keepArray: false }],
  ]}
});

export default async function handler(req, res) {
  try {
    const feeds = (process.env.RSS_FEEDS || "").split(",").map(s=>s.trim()).filter(Boolean);
    const out = [];
    for (const url of feeds) {
      if (!/youtube\.com\/feeds\/videos\.xml/.test(url)) continue;
      try {
        const feed = await parser.parseURL(url);
        const items = (feed.items || []).slice(0, 3).map(it => ({
          title: it.title,
          link: typeof it.link === "string" ? it.link : (it.link?.href || it.links?.[0]?.href || null),
          mediaDescription: it.mediaDescription || it?.media?.description || "",
        }));
        out.push({ url, ok: true, title: feed.title || null, itemsCount: feed.items?.length || 0, sample: items });
      } catch (e) {
        out.push({ url, ok: false, error: e?.message || String(e) });
      }
    }
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}
