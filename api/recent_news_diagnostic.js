// Diagnostic endpoint to see what news was collected in past 7 days
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.STORAGE_KV_REST_API_URL,
  token: process.env.STORAGE_KV_REST_API_TOKEN,
});

const ZSET = "mentions:z";

function toObj(x) {
  if (!x) return null;
  if (typeof x === "object" && x.id) return x;
  try { return JSON.parse(String(x)); } catch { return null; }
}

export default async function handler(req, res) {
  try {
    // Get past 7 days
    const now = Math.floor(Date.now() / 1000);
    const sevenDaysAgo = now - (7 * 24 * 60 * 60);

    console.log('=== Recent News Diagnostic ===');
    console.log(`Checking from ${new Date(sevenDaysAgo * 1000).toISOString()} to ${new Date(now * 1000).toISOString()}`);

    // Fetch from Redis
    const raw = await redis.zrange(ZSET, sevenDaysAgo, now, { byScore: true });
    const items = raw.map(toObj).filter(Boolean);

    console.log(`Found ${items.length} items in past 7 days`);

    // Group by source/origin
    const bySource = {};
    const articles = items.map(m => {
      const source = m.source || m.publisher || m.provider || 'unknown';
      bySource[source] = (bySource[source] || 0) + 1;

      return {
        title: m.title || m.headline || 'No title',
        source: source,
        url: m.url || m.link,
        published: m.published_ts ? new Date(m.published_ts * 1000).toISOString() : 'unknown',
        origin: m.origin || 'unknown',
        excerpt: (m.description || m.summary || '').substring(0, 150)
      };
    });

    // Sort by published date (most recent first)
    articles.sort((a, b) => {
      if (a.published === 'unknown') return 1;
      if (b.published === 'unknown') return -1;
      return new Date(b.published) - new Date(a.published);
    });

    return res.status(200).json({
      ok: true,
      timeRange: {
        start: new Date(sevenDaysAgo * 1000).toISOString(),
        end: new Date(now * 1000).toISOString()
      },
      summary: {
        totalArticles: items.length,
        bySource: bySource,
        uniqueSources: Object.keys(bySource).length
      },
      articles: articles,
      sampleHeadlines: articles.slice(0, 20).map(a => `${a.published}: ${a.title} (${a.source})`)
    });

  } catch (e) {
    console.error('Diagnostic error:', e);
    return res.status(500).json({
      ok: false,
      error: e?.message || String(e)
    });
  }
}
