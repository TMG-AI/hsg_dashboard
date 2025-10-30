// Remove all scmp.com articles from Redis
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.STORAGE_KV_REST_API_URL,
  token: process.env.STORAGE_KV_REST_API_TOKEN,
});

const ZSET = "mentions:z";
const SEEN_ID = "mentions:seen";
const SEEN_LINK = "mentions:seen:canon";

function toObj(x) {
  if (!x) return null;
  if (typeof x === "object" && x.id) return x;
  try {
    return JSON.parse(x);
  } catch { return null; }
}

export default async function handler(req, res) {
  try {
    // Safety check - only allow POST with confirmation
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Use POST to confirm deletion' });
    }

    const { confirm } = req.body;
    if (confirm !== 'DELETE_SCMP') {
      return res.status(400).json({
        error: 'Send POST with body: { "confirm": "DELETE_SCMP" } to proceed'
      });
    }

    // Get all articles
    const raw = await redis.zrange(ZSET, 0, -1);
    const articles = raw.map((item, idx) => ({ raw: item, parsed: toObj(item), idx }));

    // Find all scmp.com articles
    const scmpArticles = articles.filter(({ parsed: a }) =>
      a && (
        (a.source && a.source.toLowerCase().includes('scmp')) ||
        (a.link && a.link.toLowerCase().includes('scmp.com')) ||
        (a.provider && a.provider.toLowerCase().includes('scmp'))
      )
    );

    console.log(`Found ${scmpArticles.length} SCMP articles to remove`);

    // Remove from sorted set
    let removed = 0;
    for (const { raw, parsed } of scmpArticles) {
      try {
        await redis.zrem(ZSET, raw);

        // Also remove from deduplication sets
        if (parsed.id) {
          await redis.srem(SEEN_ID, parsed.id);
        }
        if (parsed.canon) {
          await redis.srem(SEEN_LINK, parsed.canon);
        }

        removed++;
        console.log(`Removed: "${parsed.title}" from ${parsed.source}`);
      } catch (e) {
        console.error(`Failed to remove article ${parsed.id}:`, e);
      }
    }

    return res.status(200).json({
      ok: true,
      message: `Removed ${removed} SCMP articles`,
      removed_count: removed,
      total_scmp_found: scmpArticles.length
    });

  } catch (e) {
    console.error('Remove SCMP error:', e);
    res.status(500).json({
      ok: false,
      error: e?.message || String(e)
    });
  }
}
