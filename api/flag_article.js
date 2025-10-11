// Flag/unflag articles for intern summaries
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.STORAGE_KV_REST_API_URL,
  token: process.env.STORAGE_KV_REST_API_TOKEN,
});

const FLAGGED_SET = "articles:flagged";

export default async function handler(req, res) {
  try {
    if (req.method === "POST") {
      // Flag an article
      const { article_id, title, link, source } = req.body;

      if (!article_id) {
        return res.status(400).json({ error: "article_id is required" });
      }

      const flaggedArticle = {
        id: article_id,
        title: title || "Unknown",
        link: link || "#",
        source: source || "Unknown",
        flagged_at: new Date().toISOString()
      };

      await redis.sadd(FLAGGED_SET, JSON.stringify(flaggedArticle));

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

      // Get all flagged articles
      const flagged = await redis.smembers(FLAGGED_SET);

      // Find and remove the matching one
      for (const item of flagged) {
        try {
          const parsed = JSON.parse(item);
          if (parsed.id === article_id) {
            await redis.srem(FLAGGED_SET, item);
            return res.status(200).json({
              ok: true,
              message: "Article unflagged",
              article_id
            });
          }
        } catch {}
      }

      return res.status(404).json({
        ok: false,
        message: "Article not found in flagged list"
      });

    } else if (req.method === "GET") {
      // Get all flagged articles
      const flagged = await redis.smembers(FLAGGED_SET);

      const articles = flagged.map(item => {
        try {
          return JSON.parse(item);
        } catch {
          return null;
        }
      }).filter(Boolean);

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
