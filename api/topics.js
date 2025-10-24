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

    // Support both Anthropic and OpenAI
    const useAnthropic = process.env.ANTHROPIC_API_KEY ? true : false;

    if (!useAnthropic && !process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Neither Anthropic nor OpenAI API key configured" });
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

    console.log(`Analyzing ${articleData.length} articles (limited from ${articles.length} total) using ${useAnthropic ? 'Anthropic' : 'OpenAI'}`);

    const systemPrompt = `You are a deterministic policy intelligence classifier for TMG's HSG Dashboard.

CRITICAL: You MUST categorize EVERY SINGLE article provided. Do not skip any articles.

Categorize articles by their SUBSTANTIVE POLICY CONTENT into these 10 categories:

1. Trade & Investment - tariffs, de minimis, outbound investment, CFIUS, trade deals, export restrictions, import controls, trade negotiations, business deals
2. Technology & AI - AI export/compute controls, GAIN AI Act, semiconductors, chips, technology transfer, Nvidia/AMD policies, quantum computing, software restrictions
3. Security & Sanctions - Entity List, OFAC/SDN, DoD designations, SAFE Research, military-civil fusion, espionage, cybersecurity threats, national security
4. Financial Markets & Capital Controls - delisting/index bans, SEC/Treasury disclosures, TICKER/SAFE/Protecting American Capital, investment restrictions, capital markets
5. Education & Research Oversight - foreign gifts/contracts in higher ed, SAFE Research/DETERRENT, visas, student restrictions, academic espionage, Confucius Institutes
6. Infrastructure & Property - ports/cranes/maritime, farmland/leases, real estate, state restrictions, critical infrastructure, supply chains
7. Health & Biotech - BIOSECURE, clinical/genomic data, experimental treatments EO, pharmaceuticals, biotech restrictions, medical supply chains
8. Social Media & Content Regulation - TikTok/ByteDance, KOSA, COPPA 2.0, TAKE IT DOWN, KOSMA, social media bans, content moderation, data privacy
9. Human Rights & Ethics - Uyghur forced labor, organ harvesting, Falun Gong, religious persecution, detention camps, human rights violations
10. Legislative Monitoring & Political Messaging - ONLY for articles about the LEGISLATIVE PROCESS itself (committee hearings, markup sessions, floor votes, legislative calendars) or HIGH-LEVEL diplomatic statements with no specific policy content

IMPORTANT: Bills and legislation should be categorized by what they DO, not that they are legislation:
- "BIOSECURE Act passes committee" → Health & Biotech (it's about biotech restrictions)
- "KOSA advances in Senate" → Social Media & Content Regulation (it's about kids online safety)
- "Tariff bill introduced" → Trade & Investment (it's about tariffs)
- "Generic committee hearing on China" → Legislative Monitoring (procedural, no specific policy)
- "Senator speaks about China threat" without specific policy → Legislative Monitoring

Return ONLY valid JSON in this exact format:
{
  "topics": [
    {
      "name": "Trade & Investment",
      "article_indices": [0, 5, 12, 23, 45],
      "summary": "Articles covering tariffs, de minimis rules, outbound investment screening, and CFIUS reviews.",
      "article_count": 5
    }
  ]
}

MANDATORY REQUIREMENTS:
- Use EXACTLY the 10 category names listed above
- EVERY article index from 0 to ${articleData.length - 1} MUST appear in exactly ONE category
- Do not leave any articles uncategorized - if unsure, pick the closest match
- If an article is ambiguous, use your best judgment to assign it to the most relevant category
- Order topics by article count (largest first)
- Summaries should be 1-2 sentences

EXAMPLES OF CATEGORIZATION:
- "US May Cut Tariff on India" → Trade & Investment
- "Trump Administration weighs restricting US software exports" → Technology & AI
- "BIOSECURE Act passes committee" → Health & Biotech
- "TikTok ban bill advances" → Social Media & Content Regulation
- "Chinese minister to visit Brussels amid rare-earth row" → Trade & Investment
- "Congressional hearing on China policy" → Legislative Monitoring & Political Messaging
- "Uyghur forced labor prevention act" → Human Rights & Ethics
- "CFIUS blocks Chinese investment" → Trade & Investment
- "Entity List additions announced" → Security & Sanctions

Even generic China news articles, YouTube videos, or brief mentions should be categorized based on their primary subject matter.`;

    const userPrompt = `Categorize ALL ${articleData.length} articles below into the 10 policy categories. Every single article from index 0 to ${articleData.length - 1} must be assigned to exactly one category.

Articles to categorize:
${JSON.stringify(articleData, null, 2)}

REMINDER: Your response must include ALL ${articleData.length} article indices distributed across the 10 categories. Do not skip any articles.`;

    let aiResponse;

    if (useAnthropic) {
      // Use Anthropic Claude
      aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 8000,
          temperature: 0,
          messages: [
            {
              role: 'user',
              content: `${systemPrompt}\n\n${userPrompt}`
            }
          ]
        })
      });
    } else {
      // Use OpenAI
      aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
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
              content: systemPrompt
            },
            {
              role: 'user',
              content: userPrompt
            }
          ],
          temperature: 0,
          max_tokens: 8000,
          response_format: { type: "json_object" }
        })
      });
    }

    const openaiResponse = aiResponse;

    if (!openaiResponse.ok) {
      const error = await openaiResponse.text();
      console.error('AI API error:', openaiResponse.status, error);
      return res.status(500).json({
        error: `AI API error: ${openaiResponse.status}`,
        details: error
      });
    }

    const data = await openaiResponse.json();

    // Parse response based on which API we used
    let contentStr;

    if (useAnthropic) {
      // Anthropic response format
      if (!data.content || !data.content[0] || !data.content[0].text) {
        console.error('Invalid Anthropic response structure:', JSON.stringify(data));
        return res.status(500).json({
          error: 'Anthropic returned invalid response structure',
          details: 'No content in response'
        });
      }
      contentStr = data.content[0].text.trim();
    } else {
      // OpenAI response format
      if (!data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
        console.error('Invalid OpenAI response structure:', JSON.stringify(data));
        return res.status(500).json({
          error: 'OpenAI returned invalid response structure',
          details: 'No content in response'
        });
      }
      contentStr = data.choices[0].message.content.trim();
    }

    if (!contentStr) {
      return res.status(500).json({
        error: 'AI returned empty content'
      });
    }

    let clusteringResult;
    try {
      // Extract JSON from markdown code blocks if present (Claude sometimes does this)
      let jsonStr = contentStr;
      if (contentStr.includes('```json')) {
        const match = contentStr.match(/```json\s*([\s\S]*?)\s*```/);
        if (match) {
          jsonStr = match[1];
        }
      } else if (contentStr.includes('```')) {
        const match = contentStr.match(/```\s*([\s\S]*?)\s*```/);
        if (match) {
          jsonStr = match[1];
        }
      }

      clusteringResult = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('Failed to parse AI response:', contentStr.substring(0, 500));
      return res.status(500).json({
        error: 'Failed to parse AI JSON response',
        details: parseError.message
      });
    }

    if (!clusteringResult.topics || !Array.isArray(clusteringResult.topics)) {
      return res.status(500).json({
        error: 'AI response missing topics array'
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
