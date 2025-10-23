// Cleanup existing newsletter titles - remove emojis and source prefix
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

function cleanTitle(title, source) {
  let cleaned = title;

  // Remove source prefix FIRST (e.g., "Semafor Flagship: 🟡 Title" -> "🟡 Title")
  if (source && cleaned.startsWith(source + ':')) {
    cleaned = cleaned.substring(source.length + 1).trim();
  }

  // Then remove emojis (e.g., "🟡 Title" -> "Title")
  cleaned = cleaned.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').trim();

  return cleaned;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed. Use POST." });
    }

    console.log('Starting newsletter title cleanup...');

    // Get last 7 days of articles
    const now = Math.floor(Date.now() / 1000);
    const sevenDaysAgo = now - (7 * 24 * 60 * 60);

    const raw = await redis.zrange(ZSET, sevenDaysAgo, now, { byScore: true });
    const allArticles = raw.map(toObj).filter(Boolean);

    console.log(`Found ${allArticles.length} total articles`);

    // Filter for newsletter summary articles only
    const newsletterArticles = allArticles.filter(a =>
      a.newsletter_summary === true ||
      a.origin === 'newsletter' && a.no_link === true
    );

    console.log(`Found ${newsletterArticles.length} newsletter summary articles to clean`);

    let cleaned = 0;
    let skipped = 0;

    for (const article of newsletterArticles) {
      const originalTitle = article.title;
      const cleanedTitle = cleanTitle(article.title, article.source);

      // Only update if title actually changed
      if (cleanedTitle !== originalTitle) {
        // Update the article
        article.title = cleanedTitle;

        // Remove old entry
        const oldEntry = raw.find(r => {
          const parsed = toObj(r);
          return parsed && parsed.id === article.id;
        });

        if (oldEntry) {
          await redis.zrem(ZSET, oldEntry);
          // Add updated entry with same timestamp
          await redis.zadd(ZSET, {
            score: article.published_ts,
            member: JSON.stringify(article)
          });

          cleaned++;
          console.log(`Cleaned: "${originalTitle}" -> "${cleanedTitle}"`);
        }
      } else {
        skipped++;
      }
    }

    console.log(`Cleanup complete: ${cleaned} updated, ${skipped} skipped`);

    return res.status(200).json({
      ok: true,
      message: "Newsletter titles cleaned successfully",
      total_newsletters: newsletterArticles.length,
      cleaned,
      skipped
    });

  } catch (e) {
    console.error('Cleanup error:', e);
    res.status(500).json({
      ok: false,
      error: e?.message || String(e)
    });
  }
}
