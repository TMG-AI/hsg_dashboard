// Deduplicate articles by title similarity (cross-source deduplication)
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

// Normalize title for comparison (remove HTML entities, special chars, lowercase)
function normalizeTitle(title) {
  if (!title) return '';

  // Decode HTML entities
  let normalized = title
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<b>/g, '')
    .replace(/<\/b>/g, '')
    .replace(/<[^>]+>/g, ''); // Remove any remaining HTML tags

  // Remove special characters, normalize whitespace, lowercase
  normalized = normalized
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Replace special chars with space
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .trim();

  return normalized;
}

// Fast fingerprint for exact matching (first 100 chars of normalized title)
function fingerprint(title) {
  const normalized = normalizeTitle(title);
  // Take first 100 chars and create a simple hash
  return normalized.substring(0, 100);
}

export default async function handler(req, res) {
  try {
    const threshold = parseFloat(req.query.threshold || '0.85'); // 85% similarity by default
    const dryRun = req.query.dry_run === 'true';

    console.log(`Starting title deduplication (threshold: ${threshold}, dry_run: ${dryRun})`);

    // Get all articles
    const raw = await redis.zrange(ZSET, 0, -1);
    const allArticles = raw.map(toObj).filter(Boolean);

    console.log(`Total articles: ${allArticles.length}`);

    // Group articles by fingerprint (fast exact matching on first 100 chars)
    const titleGroups = new Map();
    const duplicates = [];

    for (const article of allArticles) {
      const fp = fingerprint(article.title);

      if (!fp) continue;

      if (titleGroups.has(fp)) {
        // Duplicate found - add to existing group
        titleGroups.get(fp).push(article);
      } else {
        // New unique fingerprint - create new group
        titleGroups.set(fp, [article]);
      }
    }

    console.log(`Found ${titleGroups.size} unique title fingerprints`);

    // Find duplicates (groups with more than 1 article)
    const duplicateGroups = [];
    let totalDuplicates = 0;

    for (const [normalizedTitle, articles] of titleGroups.entries()) {
      if (articles.length > 1) {
        // Sort by published date (keep oldest)
        articles.sort((a, b) => {
          const dateA = new Date(a.published || 0);
          const dateB = new Date(b.published || 0);
          return dateA - dateB;
        });

        const keep = articles[0];
        const remove = articles.slice(1);

        duplicateGroups.push({
          fingerprint: normalizedTitle.substring(0, 80) + '...',
          original_title: keep.title,
          keep: {
            id: keep.id,
            source: keep.source,
            published: keep.published
          },
          remove: remove.map(a => ({
            id: a.id,
            title: a.title,
            source: a.source,
            published: a.published
          }))
        });

        totalDuplicates += remove.length;
        duplicates.push(...remove);
      }
    }

    console.log(`Found ${duplicateGroups.length} duplicate groups with ${totalDuplicates} total duplicates`);

    if (dryRun) {
      return res.status(200).json({
        ok: true,
        dry_run: true,
        total_articles: allArticles.length,
        unique_groups: titleGroups.size,
        duplicate_groups: duplicateGroups.length,
        duplicates_to_remove: totalDuplicates,
        would_remain: allArticles.length - totalDuplicates,
        sample_duplicates: duplicateGroups.slice(0, 10)
      });
    }

    // Actually remove duplicates
    let removed = 0;
    for (const article of duplicates) {
      const articleStr = JSON.stringify(article);
      const result = await redis.zrem(ZSET, articleStr);
      if (result > 0) removed++;
    }

    console.log(`Removed ${removed} duplicate articles`);

    return res.status(200).json({
      ok: true,
      total_articles: allArticles.length,
      unique_groups: titleGroups.size,
      duplicate_groups: duplicateGroups.length,
      removed: removed,
      remaining: allArticles.length - removed,
      sample_duplicates: duplicateGroups.slice(0, 10)
    });

  } catch (e) {
    console.error("Deduplication error:", e);
    res.status(500).json({
      ok: false,
      error: e?.message || String(e)
    });
  }
}
