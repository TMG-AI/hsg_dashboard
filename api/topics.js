// Topic Clustering API - Group articles by topic using AI
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.STORAGE_KV_REST_API_URL,
  token: process.env.STORAGE_KV_REST_API_TOKEN,
});

const ZSET = "mentions:z";
const TOPICS_CACHE = "topics:categorized:cache";
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

    console.log(`Topic categorization: Analyzing ${articles.length} articles from last ${days} days`);

    if (articles.length === 0) {
      return res.status(200).json({
        ok: true,
        topics: [],
        total_articles: 0,
        message: "No articles found in time range"
      });
    }

    // Limit to 450 most recent articles to avoid token limits and timeouts
    const articlesToAnalyze = articles.slice(0, 450);

    // Prepare article data for clustering (titles only for efficiency)
    const articleData = articlesToAnalyze.map((a, idx) => ({
      idx: idx,
      id: a.id,
      title: a.title,
      source: a.source,
      published: a.published
    }));

    console.log(`Analyzing ${articleData.length} articles (limited from ${articles.length} total)`);

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
            content: `You are a deterministic policy intelligence classifier for TMG's HSG Dashboard.

Categorize articles into these 10 policy categories:
1. Trade & Investment - tariffs, de minimis, outbound investment, CFIUS
2. Technology & AI - AI export/compute controls, GAIN AI Act, Nvidia/Anthropic policies
3. Security & Sanctions - Entity List, OFAC/SDN, DoD designations, SAFE Research-like
4. Financial Markets & Capital Controls - delisting/index bans, SEC/Treasury disclosures (TICKER/SAFE/Protecting American Capital)
5. Education & Research Oversight - foreign gifts/contracts in higher ed, SAFE Research/DETERRENT, visas
6. Infrastructure & Property - ports/cranes/maritime, farmland/leases, state restrictions
7. Health & Biotech - BIOSECURE, clinical/genomic data, experimental treatments EO
8. Social Media & Content Regulation - TikTok/ByteDance, KOSA, COPPA 2.0, TAKE IT DOWN, KOSMA
9. Human Rights & Ethics - Uyghur forced labor, organ harvesting, Falun Gong
10. Legislative Monitoring & Political Messaging - committee statements, hearings, legislative calendar, high-level rhetoric

Return ONLY valid JSON in this exact format:
{
  "topics": [
    {
      "name": "Trade & Investment",
      "article_indices": [0, 5, 12],
      "summary": "Articles covering tariffs, de minimis rules, outbound investment screening, and CFIUS reviews.",
      "article_count": 3
    }
  ]
}

Guidelines:
- Use EXACTLY the 10 category names listed above
- Each article belongs to exactly ONE category (no duplicates)
- If an article doesn't clearly fit any category, assign to the closest match
- Order topics by article count (largest first)
- Summaries should be 1-2 sentences describing what's covered in this category`
          },
          {
            role: 'user',
            content: `Categorize these ${articles.length} articles into the 10 policy categories:\n\n${JSON.stringify(articleData, null, 2)}`
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

    // Better error handling for OpenAI response
    if (!data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
      console.error('Invalid OpenAI response structure:', JSON.stringify(data));
      return res.status(500).json({
        error: 'OpenAI returned invalid response structure',
        details: 'No content in response'
      });
    }

    const contentStr = data.choices[0].message.content.trim();
    if (!contentStr) {
      return res.status(500).json({
        error: 'OpenAI returned empty content'
      });
    }

    let clusteringResult;
    try {
      clusteringResult = JSON.parse(contentStr);
    } catch (parseError) {
      console.error('Failed to parse OpenAI response:', contentStr.substring(0, 500));
      return res.status(500).json({
        error: 'Failed to parse OpenAI JSON response',
        details: parseError.message
      });
    }

    if (!clusteringResult.topics || !Array.isArray(clusteringResult.topics)) {
      return res.status(500).json({
        error: 'OpenAI response missing topics array'
      });
    }

    // Build topic objects with full article data
    const topics = clusteringResult.topics.map(topic => {
      const topicArticles = topic.article_indices.map(idx => articlesToAnalyze[idx]).filter(Boolean);

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
    console.error('Topic categorization error:', e);
    res.status(500).json({
      ok: false,
      error: e?.message || String(e)
    });
  }
}
