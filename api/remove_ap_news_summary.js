// Remove AP News Summary articles from Redis
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.STORAGE_KV_REST_API_URL,
  token: process.env.STORAGE_KV_REST_API_TOKEN,
});

const ZSET = "mentions:z";

function toObj(x) {
  if (!x) return null;
  if (typeof x === "object" && x.id) return x;
  try {
    return JSON.parse(x);
  } catch { return null; }
}

export default async function handler(req, res) {
  try {
    const dryRun = req.query.dry_run === 'true';

    console.log(`Removing AP News Summary articles (dry_run: ${dryRun})`);

    // Get all articles from Redis
    const raw = await redis.zrange(ZSET, 0, -1);
    const allArticles = raw.map(toObj).filter(Boolean);

    console.log(`Total articles in Redis: ${allArticles.length}`);

    // Find articles with "AP News Summary" in title
    const apNewsSummaryArticles = allArticles.filter(article => {
      const title = (article.title || '').toLowerCase();
      return title.includes('ap news summary');
    });

    console.log(`Found ${apNewsSummaryArticles.length} AP News Summary articles`);

    if (dryRun) {
      return res.status(200).json({
        ok: true,
        dry_run: true,
        total_articles: allArticles.length,
        ap_news_summary_found: apNewsSummaryArticles.length,
        would_remove: apNewsSummaryArticles.length,
        would_remain: allArticles.length - apNewsSummaryArticles.length,
        sample_articles: apNewsSummaryArticles.slice(0, 10).map(a => ({
          id: a.id,
          title: a.title,
          source: a.source,
          origin: a.origin
        }))
      });
    }

    // Actually remove the articles
    let removed = 0;
    for (const article of apNewsSummaryArticles) {
      const articleStr = JSON.stringify(article);
      const result = await redis.zrem(ZSET, articleStr);
      if (result > 0) removed++;
    }

    console.log(`Removed ${removed} AP News Summary articles`);

    return res.status(200).json({
      ok: true,
      total_articles: allArticles.length,
      ap_news_summary_found: apNewsSummaryArticles.length,
      removed: removed,
      remaining: allArticles.length - removed,
      sample_removed: apNewsSummaryArticles.slice(0, 10).map(a => ({
        id: a.id,
        title: a.title,
        source: a.source
      }))
    });

  } catch (e) {
    console.error("Remove AP News Summary error:", e);
    res.status(500).json({
      ok: false,
      error: e?.message || String(e)
    });
  }
}
