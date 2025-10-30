// Analyze all sources in Redis to identify quality and trustworthiness
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

function normalizeSource(source) {
  if (!source) return 'unknown';
  return source.toLowerCase()
    .replace(/^www\./, '')
    .replace(/^amp\./, '')
    .trim();
}

export default async function handler(req, res) {
  try {
    // Get all articles
    const raw = await redis.zrange(ZSET, 0, -1);
    const articles = raw.map(toObj).filter(Boolean);

    console.log(`Analyzing ${articles.length} total articles`);

    // Analysis by source domain
    const bySource = {};
    const byOrigin = {};
    const byProvider = {};
    const sourceOriginMatrix = {};

    articles.forEach(a => {
      const source = normalizeSource(a.source || a.provider || 'unknown');
      const origin = a.origin || 'unknown';
      const provider = a.provider || 'unknown';

      // Count by source
      if (!bySource[source]) {
        bySource[source] = { count: 0, origins: {}, sample_titles: [] };
      }
      bySource[source].count++;
      bySource[source].origins[origin] = (bySource[source].origins[origin] || 0) + 1;
      if (bySource[source].sample_titles.length < 3) {
        bySource[source].sample_titles.push(a.title);
      }

      // Count by origin
      if (!byOrigin[origin]) byOrigin[origin] = 0;
      byOrigin[origin]++;

      // Count by provider
      if (!byProvider[provider]) byProvider[provider] = 0;
      byProvider[provider]++;

      // Source-Origin matrix
      const key = `${source}|${origin}`;
      sourceOriginMatrix[key] = (sourceOriginMatrix[key] || 0) + 1;
    });

    // Sort sources by count
    const sortedSources = Object.entries(bySource)
      .map(([source, data]) => ({
        source,
        count: data.count,
        origins: data.origins,
        sample_titles: data.sample_titles,
        percentage: ((data.count / articles.length) * 100).toFixed(2)
      }))
      .sort((a, b) => b.count - a.count);

    // Identify potential low-quality sources
    const youtubeArticles = sortedSources.filter(s =>
      s.source.includes('youtube.com') || s.source.includes('youtu.be')
    );

    const socialMediaSources = sortedSources.filter(s =>
      s.source.includes('twitter.com') ||
      s.source.includes('x.com') ||
      s.source.includes('facebook.com') ||
      s.source.includes('reddit.com') ||
      s.source.includes('tiktok.com')
    );

    const unknownSources = sortedSources.filter(s =>
      s.source === 'unknown' || s.source === ''
    );

    // Blogs and less established sources (heuristic based on common patterns)
    const potentialBlogs = sortedSources.filter(s =>
      s.source.includes('blog') ||
      s.source.includes('wordpress') ||
      s.source.includes('medium.com') ||
      s.source.includes('substack.com') ||
      s.source.includes('blogspot')
    );

    // Group all low-quality candidates
    const lowQualityCandidates = [
      ...youtubeArticles,
      ...socialMediaSources,
      ...unknownSources,
      ...potentialBlogs
    ];

    // Remove duplicates
    const uniqueLowQuality = Array.from(
      new Map(lowQualityCandidates.map(item => [item.source, item])).values()
    );

    // Sort by count (highest first)
    uniqueLowQuality.sort((a, b) => b.count - a.count);

    return res.status(200).json({
      ok: true,
      summary: {
        total_articles: articles.length,
        unique_sources: sortedSources.length,
        unique_origins: Object.keys(byOrigin).length,
        low_quality_source_count: uniqueLowQuality.length,
        low_quality_article_count: uniqueLowQuality.reduce((sum, s) => sum + s.count, 0)
      },
      by_origin: Object.entries(byOrigin)
        .map(([origin, count]) => ({
          origin,
          count,
          percentage: ((count / articles.length) * 100).toFixed(2)
        }))
        .sort((a, b) => b.count - a.count),
      top_20_sources: sortedSources.slice(0, 20),
      low_quality_candidates: {
        youtube: youtubeArticles,
        social_media: socialMediaSources,
        unknown: unknownSources,
        blogs: potentialBlogs,
        all_unique: uniqueLowQuality
      },
      all_sources: sortedSources
    });

  } catch (e) {
    console.error('Source analysis error:', e);
    res.status(500).json({
      ok: false,
      error: e?.message || String(e)
    });
  }
}
