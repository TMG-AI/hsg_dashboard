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

      console.log(`POST: Flagging article_id: "${article_id}" (type: ${typeof article_id})`);

      const flaggedArticle = {
        id: article_id,
        title: title || "Unknown",
        link: link || "#",
        source: source || "Unknown",
        flagged_at: new Date().toISOString()
      };

      console.log(`POST: Storing flagged article:`, JSON.stringify(flaggedArticle));

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

      console.log(`DELETE: Looking for article_id: "${article_id}" (type: ${typeof article_id})`);
      console.log(`DELETE: Found ${flagged.length} flagged articles in Redis`);

      // Find and remove the matching one
      let removed = false;
      for (const item of flagged) {
        try {
          const parsed = JSON.parse(item);
          console.log(`DELETE: Comparing with parsed.id: "${parsed.id}" (type: ${typeof parsed.id}), match: ${parsed.id === article_id}`);

          if (parsed.id === article_id) {
            const result = await redis.srem(FLAGGED_SET, item);
            removed = true;
            console.log(`Unflagged article ${article_id}, srem result:`, result);
            return res.status(200).json({
              ok: true,
              message: "Article unflagged",
              article_id
            });
          }
        } catch (e) {
          console.error('Error parsing flagged item:', e);
        }
      }

      // If we didn't find it, still return success since the desired state (unflagged) is achieved
      console.log(`Article ${article_id} not found in flagged set (already unflagged or never flagged)`);

      return res.status(200).json({
        ok: true,
        message: "Article was not flagged (no action needed)",
        article_id,
        already_unflagged: true
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
