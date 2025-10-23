// Webhook to receive newsletter summaries from n8n
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.STORAGE_KV_REST_API_URL,
  token: process.env.STORAGE_KV_REST_API_TOKEN,
});

const ZSET = "mentions:z";
const SEEN_ID = "mentions:seen";
const SEEN_LINK = "mentions:seen:canon";
const RETENTION_DAYS = 14;

function idFromString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return `newsletter_summary_${h.toString(16)}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  try {
    const webhookSecret = process.env.NEWSLETTER_SUMMARY_WEBHOOK_SECRET;

    // Optional: Verify webhook secret if configured
    if (webhookSecret) {
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${webhookSecret}`) {
        console.error("Unauthorized webhook attempt");
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    const body = req.body;
    console.log("Newsletter summary webhook received:", JSON.stringify(body).substring(0, 500));

    // Expected format from n8n:
    // {
    //   "date": "October 17, 2025",
    //   "total_newsletters": 2,
    //   "total_articles": 2,
    //   "newsletters": [
    //     {
    //       "name": "CNN Meanwhile in China",
    //       "articles": [
    //         {
    //           "title": "Back at the edge with trade tensions",
    //           "summary": "• The article intended to discuss..."
    //         }
    //       ]
    //     }
    //   ]
    // }

    if (!body.newsletters || !Array.isArray(body.newsletters)) {
      return res.status(400).json({
        error: "Invalid format. Expected 'newsletters' array"
      });
    }

    let stored = 0;
    const now = Math.floor(Date.now() / 1000);
    const errors = [];

    // Process each newsletter
    for (const newsletter of body.newsletters) {
      const newsletterName = newsletter.name || "Unknown Newsletter";
      const articles = newsletter.articles || [];

      console.log(`Processing ${articles.length} articles from ${newsletterName}`);

      // Process each article from this newsletter
      for (const article of articles) {
        try {
          // Log the article structure to debug missing titles
          console.log(`Article fields from n8n:`, Object.keys(article));
          console.log(`Article data sample:`, JSON.stringify(article).substring(0, 300));

          // Use headline, title, or name field (from n8n)
          const title = article.headline || article.title || article.name || "Newsletter Article";
          const summary = article.summary || "";
          const link = article.link || article.url || null;

          console.log(`Parsed title: "${title}" from newsletter: ${newsletterName}`);

          // Create unique ID from newsletter name + title + date
          const uniqueStr = `${newsletterName}_${title}_${body.date || new Date().toISOString()}`;
          const articleId = idFromString(uniqueStr);

          // Check if already stored
          const addId = await redis.sadd(SEEN_ID, articleId);
          if (addId !== 1) {
            console.log(`Skipping duplicate: ${title}`);
            continue;
          }

          // If there's a link, also check canonical URL deduplication
          if (link && link.startsWith('http')) {
            const addLink = await redis.sadd(SEEN_LINK, link);
            if (addLink !== 1) {
              console.log(`Skipping duplicate link: ${link}`);
              continue;
            }
          }

          // Clean title: remove emojis and whitespace
          const cleanTitle = title.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').trim();

          // Build article object
          const m = {
            id: articleId,
            title: cleanTitle, // Just the title, without source name prefix
            link: link && link.startsWith('http') ? link : null, // Only include valid URLs
            source: newsletterName,
            provider: newsletterName,
            summary: summary,
            origin: "newsletter",
            section: "Newsletter",
            published_ts: now,
            published: new Date(now * 1000).toISOString(),
            reach: 0,
            newsletter_summary: true, // Flag to indicate this came from summary webhook
            no_link: !link || !link.startsWith('http') // Flag for articles without links
          };

          // Store in Redis
          await redis.zadd(ZSET, { score: now, member: JSON.stringify(m) });
          stored++;

          console.log(`Stored: ${m.title}`);
        } catch (err) {
          console.error(`Error processing article "${article.title}":`, err);
          errors.push({
            newsletter: newsletterName,
            article: article.title,
            error: err?.message || String(err)
          });
        }
      }
    }

    // Cleanup old articles
    const cutoffTimestamp = now - (RETENTION_DAYS * 24 * 60 * 60);
    await redis.zremrangebyscore(ZSET, '-inf', cutoffTimestamp);

    console.log(`Newsletter summary webhook complete: ${stored} articles stored`);

    return res.status(200).json({
      ok: true,
      message: `Stored ${stored} newsletter summary articles`,
      stored,
      date: body.date,
      newsletters_processed: body.newsletters.length,
      total_articles: body.total_articles,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString()
    });

  } catch (e) {
    console.error("Newsletter summary webhook error:", e);
    res.status(500).json({
      ok: false,
      error: e?.message || String(e)
    });
  }
}
