// Topic Clustering API - Group articles by topic using AI
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.STORAGE_KV_REST_API_URL,
  token: process.env.STORAGE_KV_REST_API_TOKEN,
});

const ZSET = "mentions:z";
const TOPICS_CACHE = "topics:cache";
const CACHE_TTL = 3600; // 1 hour cache

function toObj(x) {
  if (!x) return null;
  if (typeof x === "object" && x.id) return x;
  try {
    return JSON.parse(x);
  } catch { return null; }
}

export default async function handler(req, res) {
  try {
    const days = parseInt(req.query.days || '7', 10);
    const forceRefresh = req.query.refresh === 'true';

    // Check cache first
    if (!forceRefresh) {
      const cached = await redis.get(TOPICS_CACHE);
      if (cached) {
        console.log('Returning cached topics');
        return res.status(200).json({
          ...cached,
          cached: true
        });
      }
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OpenAI API key not configured" });
    }

    // Get articles from specified time range
    const now = Math.floor(Date.now() / 1000);
    const startTime = now - (days * 24 * 60 * 60);

    const raw = await redis.zrange(ZSET, startTime, now, { byScore: true });
    const articles = raw.map(toObj).filter(Boolean);

    console.log(`Topic clustering: Analyzing ${articles.length} articles from last ${days} days`);

    if (articles.length === 0) {
      return res.status(200).json({
        ok: true,
        topics: [],
        total_articles: 0,
        message: "No articles found in time range"
      });
    }

    // Prepare article data for clustering (titles only for efficiency)
    const articleData = articles.map((a, idx) => ({
      idx: idx,
      id: a.id,
      title: a.title,
      source: a.source,
      published: a.published
    }));

    // Ask OpenAI to cluster articles into topics
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are an expert at analyzing news articles about China and identifying major topics/themes.

Given a list of article titles, identify 5-10 major topic clusters that group similar articles together.

For each topic:
1. Create a clear, descriptive topic name (e.g., "Trade Wars & Tariffs", "Technology & Semiconductors")
2. List the article indices (idx values) that belong to this topic
3. Write a 2-3 sentence summary of what this topic cluster is about

Return ONLY valid JSON in this exact format:
{
  "topics": [
    {
      "name": "Topic Name",
      "article_indices": [0, 5, 12, 23],
      "summary": "Brief summary of this topic cluster and why these articles are grouped together.",
      "article_count": 4
    }
  ]
}

Guidelines:
- Create 5-10 topics maximum (don't create too many small clusters)
- Each article should belong to exactly ONE topic (no duplicates)
- If articles don't fit any major topic, create an "Other/Miscellaneous" topic
- Topic names should be clear and specific
- Order topics by article count (largest clusters first)`
          },
          {
            role: 'user',
            content: `Analyze these ${articles.length} articles and cluster them into topics:\n\n${JSON.stringify(articleData, null, 2)}`
          }
        ],
        temperature: 0.3,
        max_tokens: 4000,
        response_format: { type: "json_object" }
      })
    });

    if (!openaiResponse.ok) {
      const error = await openaiResponse.text();
      console.error('OpenAI API error:', openaiResponse.status, error);
      return res.status(500).json({
        error: `OpenAI API error: ${openaiResponse.status}`,
        details: error
      });
    }

    const data = await openaiResponse.json();
    const clusteringResult = JSON.parse(data.choices[0]?.message?.content || '{"topics":[]}');

    // Build topic objects with full article data
    const topics = clusteringResult.topics.map(topic => {
      const topicArticles = topic.article_indices.map(idx => articles[idx]).filter(Boolean);

      return {
        name: topic.name,
        summary: topic.summary,
        article_count: topicArticles.length,
        articles: topicArticles.map(a => ({
          id: a.id,
          title: a.title,
          link: a.link,
          source: a.source,
          provider: a.provider,
          summary: a.summary,
          published: a.published,
          published_ts: a.published_ts,
          origin: a.origin,
          reach: a.reach || 0,
          no_link: a.no_link || false
        }))
      };
    });

    // Sort topics by article count (largest first)
    topics.sort((a, b) => b.article_count - a.article_count);

    const result = {
      ok: true,
      topics: topics,
      total_articles: articles.length,
      total_topics: topics.length,
      days: days,
      timestamp: new Date().toISOString()
    };

    // Cache the result
    await redis.setex(TOPICS_CACHE, CACHE_TTL, JSON.stringify(result));

    res.status(200).json(result);

  } catch (e) {
    console.error('Topic clustering error:', e);
    res.status(500).json({
      ok: false,
      error: e?.message || String(e)
    });
  }
}
