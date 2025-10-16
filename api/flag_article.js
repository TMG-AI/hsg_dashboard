// Flag/unflag articles for intern summaries
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.STORAGE_KV_REST_API_URL,
  token: process.env.STORAGE_KV_REST_API_TOKEN,
});

const FLAGGED_SET = "articles:flagged:ids"; // Set of article IDs only
const FLAGGED_HASH = "articles:flagged:data"; // Hash of article data by ID
const ZSET = "mentions:z"; // Main articles sorted set

export default async function handler(req, res) {
  try {
    if (req.method === "POST") {
      // Flag an article - get full article data from main ZSET
      const { article_id, title, link, source } = req.body;

      if (!article_id) {
        return res.status(400).json({ error: "article_id is required" });
      }

      console.log(`POST: Flagging article_id: "${article_id}" (type: ${typeof article_id})`);
      console.log(`POST: Received metadata - title: "${title}", link: "${link}", source: "${source}"`);

      // Fetch the full article from main mentions ZSET
      const allArticles = await redis.zrange(ZSET, 0, 10000, { rev: true });
      console.log(`POST: Fetched ${allArticles.length} articles from ZSET`);

      let fullArticle = null;

      for (const item of allArticles) {
        try {
          const parsed = typeof item === 'string' ? JSON.parse(item) : item;
          if (parsed && parsed.id === article_id) {
            fullArticle = parsed;
            console.log(`POST: Found full article in ZSET:`, JSON.stringify(fullArticle).substring(0, 200));
            break;
          }
        } catch (e) {
          console.error('Error parsing article:', e);
        }
      }

      if (!fullArticle) {
        console.log(`POST: Article ${article_id} NOT found in ZSET, using provided metadata`);
      }

      // If we found the full article, use it; otherwise use provided metadata
      const flaggedArticle = fullArticle ? {
        ...fullArticle,
        flagged_at: new Date().toISOString()
      } : {
        id: article_id,
        title: title || "Unknown",
        link: link || "#",
        source: source || "Unknown",
        published: new Date().toISOString(),
        flagged_at: new Date().toISOString()
      };

      console.log(`POST: Storing flagged article (first 300 chars):`, JSON.stringify(flaggedArticle).substring(0, 300));

      // Store article ID in Set and full data in Hash
      const saddResult = await redis.sadd(FLAGGED_SET, article_id);
      await redis.hset(FLAGGED_HASH, { [article_id]: JSON.stringify(flaggedArticle) });

      console.log(`POST: SADD result: ${saddResult} (1 = new member, 0 = already existed)`);

      // Verify it was added
      const verifyCount = await redis.scard(FLAGGED_SET);
      console.log(`POST: Total flagged articles in Redis after add: ${verifyCount}`);

      return res.status(200).json({
        ok: true,
        message: "Article flagged for intern summary",
        article_id
      });

    } else if (req.method === "DELETE") {
      // Unflag an article
      const { article_id } = req.body;

      if (!article_id) {
        return res.status(400).json({ error: "article_id is required" });
      }

      console.log(`DELETE: Unflagging article_id: "${article_id}" (type: ${typeof article_id})`);

      // Remove from both Set and Hash
      const sremResult = await redis.srem(FLAGGED_SET, article_id);
      const hdelResult = await redis.hdel(FLAGGED_HASH, article_id);

      console.log(`DELETE: SREM result: ${sremResult}, HDEL result: ${hdelResult}`);

      return res.status(200).json({
        ok: true,
        message: sremResult > 0 ? "Article unflagged" : "Article was not flagged (no action needed)",
        article_id,
        removed: sremResult > 0
      });

    } else if (req.method === "GET") {
      // Get all flagged articles (v2 - fixed hmget handling)
      console.log(`GET v2: Fetching flagged articles from Redis`);
      console.log(`GET: Using FLAGGED_SET="${FLAGGED_SET}" and FLAGGED_HASH="${FLAGGED_HASH}"`);

      // Get all article IDs from Set
      const articleIds = await redis.smembers(FLAGGED_SET) || [];
      console.log(`GET: Retrieved ${articleIds.length} flagged article IDs from Set`);
      console.log(`GET: Article IDs:`, JSON.stringify(articleIds));

      if (!articleIds || articleIds.length === 0) {
        return res.status(200).json({
          ok: true,
          flagged_count: 0,
          articles: []
        });
      }

      // Get article data from Hash
      // Try hgetall first to see all data, then filter by articleIds
      const allHashData = await redis.hgetall(FLAGGED_HASH);
      console.log(`GET: hgetall returned:`, typeof allHashData, JSON.stringify(allHashData)?.substring(0, 300));

      // Extract values for the requested article IDs
      const dataArray = articleIds.map(id => allHashData?.[id]).filter(Boolean);
      console.log(`GET: Extracted ${dataArray.length} articles from hash`);

      // Parse JSON strings and filter out nulls
      const articles = dataArray
        .map((dataStr, index) => {
          if (!dataStr) {
            console.warn(`GET: No data found in Hash for article ID: ${articleIds[index]}`);
            return null;
          }
          try {
            const parsed = JSON.parse(dataStr);
            console.log(`GET: Loaded article ID: ${parsed.id}, title: ${parsed.title?.substring(0, 50)}`);
            return parsed;
          } catch (e) {
            console.error(`GET: Failed to parse article data for ID ${articleIds[index]}:`, e);
            return null;
          }
        })
        .filter(Boolean);

      console.log(`GET: Successfully processed ${articles.length} articles`);

      // Sort by flagged_at (newest first)
      articles.sort((a, b) => new Date(b.flagged_at) - new Date(a.flagged_at));

      return res.status(200).json({
        ok: true,
        flagged_count: articles.length,
        articles
      });

    } else {
      return res.status(405).json({ error: "Method not allowed" });
    }

  } catch (e) {
    console.error('Flag article error:', e);
    res.status(500).json({
      ok: false,
      error: e?.message || String(e)
    });
  }
}
