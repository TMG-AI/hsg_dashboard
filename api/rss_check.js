import Parser from "rss-parser";
const parser = new Parser();

export default async function handler(req, res) {
  try {
    const feeds = (process.env.RSS_FEEDS || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    const out = [];
    for (const url of feeds) {
      try {
        const feed = await parser.parseURL(url);
        const title = feed?.title || null;
        const items = (feed?.items || []).slice(0, 3).map(it => ({
          title: it.title,
          link: typeof it.link === "string" ? it.link : (it.link?.href || it.links?.[0]?.href || null),
          hasLinksArray: Array.isArray(it.links),
          linkObj: typeof it.link === "object" && it.link ? true : false
        }));
        out.push({ url, ok: true, title, itemsCount: feed?.items?.length || 0, sample: items });
      } catch (e) {
        out.push({ url, ok: false, error: e?.message || String(e) });
      }
    }

    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}
