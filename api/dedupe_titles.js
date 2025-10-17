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

// Calculate similarity between two strings (Levenshtein distance ratio)
function similarity(s1, s2) {
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;

  if (longer.length === 0) return 1.0;

  const editDistance = levenshtein(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

// Levenshtein distance algorithm
function levenshtein(s1, s2) {
  const costs = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return costs[s2.length];
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

    // Group articles by normalized title
    const titleGroups = new Map();
    const duplicates = [];

    for (const article of allArticles) {
      const normalizedTitle = normalizeTitle(article.title);

      if (!normalizedTitle) continue;

      // Check if this title is similar to any existing group
      let foundGroup = false;

      for (const [groupTitle, articles] of titleGroups.entries()) {
        const sim = similarity(normalizedTitle, groupTitle);

        if (sim >= threshold) {
          // Similar title found - add to this group
          articles.push(article);
          foundGroup = true;
          break;
        }
      }

      if (!foundGroup) {
        // New unique title - create new group
        titleGroups.set(normalizedTitle, [article]);
      }
    }

    console.log(`Found ${titleGroups.size} unique title groups`);

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
          normalized_title: normalizedTitle,
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
