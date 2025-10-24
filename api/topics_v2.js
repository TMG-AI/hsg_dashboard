// Topic Categorization API v2 - Policy Intelligence Classifier
// Uses deterministic categorization with chunking to process all articles
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.STORAGE_KV_REST_API_URL,
  token: process.env.STORAGE_KV_REST_API_TOKEN,
});

const ZSET = "mentions:z";
const TOPICS_V2_CACHE = "topics:v2:cache";
const CACHE_TTL = 3600; // 1 hour cache

function toObj(x) {
  if (!x) return null;
  if (typeof x === "object" && x.id) return x;
  try {
    return JSON.parse(x);
  } catch { return null; }
}

// Chunk articles to avoid token limits
function chunkArray(array, chunkSize) {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

// Parse NDJSON response from OpenAI
function parseNDJSON(ndjsonString) {
  const lines = ndjsonString.trim().split('\n').filter(line => line.trim());
  const results = [];

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      results.push(obj);
    } catch (e) {
      console.error('Failed to parse NDJSON line:', line, e);
    }
  }

  return results;
}

// Build categorization prompt for a chunk
function buildCategorizationPrompt(articles) {
  return `You are a deterministic policy intelligence classifier for TMG's HSG Dashboard.
Classify each input item and output ONLY NDJSON where each line matches:
{
  "id": string,
  "title": string,
  "primary_category": "Trade & Investment" | "Technology & AI" | "Security & Sanctions" | "Financial Markets & Capital Controls" | "Education & Research Oversight" | "Infrastructure & Property" | "Health & Biotech" | "Social Media & Content Regulation" | "Human Rights & Ethics" | "Legislative Monitoring & Political Messaging",
  "secondary_category": string|null,
  "relevance": "High" | "Medium" | "Low",
  "policy_stage": "Proposal" | "Pending" | "Passed/Effective" | "Enforcement/Implementation" | "N/A",
  "key_entities": string[],
  "related_instruments": string[],
  "signals": string[],
  "confidence": number
}

Decision rules and cues:
- Trade & Investment: tariffs, de minimis, outbound investment, CFIUS.
- Technology & AI: AI export/compute controls, GAIN AI Act, Nvidia/Anthropic policies.
- Security & Sanctions: Entity List, OFAC/SDN, DoD designations, SAFE Research-like.
- Financial Markets & Capital Controls: delisting/index bans, SEC/Treasury disclosures (TICKER/SAFE/Protecting American Capital).
- Education & Research Oversight: foreign gifts/contracts in higher ed, SAFE Research/DETERRENT, visas.
- Infrastructure & Property: ports/cranes/maritime, farmland/leases, state restrictions.
- Health & Biotech: BIOSECURE, clinical/genomic data, experimental treatments EO.
- Social Media & Content Regulation: TikTok/ByteDance, KOSA, COPPA 2.0, TAKE IT DOWN, KOSMA.
- Human Rights & Ethics: Uyghur forced labor, organ harvesting, Falun Gong.
- Legislative Monitoring & Political Messaging: committee statements, hearings, legislative calendar, high-level rhetoric.

Policy Stage: infer from verbs like introduced/advanced/passed/signed/final rule/effective/enforcement; else "N/A".
Relevance: High (direct exposure), Medium (indirect or early + credible), Low (opinion/speculative).
Never invent instrument names; only record exact strings if explicitly present.
Temperature=0. Output only valid NDJSON lines, no prose.

Classify these articles:
${JSON.stringify(articles, null, 2)}`;
}

// Categorize a chunk of articles using OpenAI
async function categorizeChunk(articles, apiKey) {
  const prompt = buildCategorizationPrompt(articles);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a deterministic policy intelligence classifier. Output ONLY valid NDJSON, no additional text.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0,
      max_tokens: 16000
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }

  const data = await response.json();

  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('Invalid OpenAI response structure');
  }

  const content = data.choices[0].message.content.trim();
  return parseNDJSON(content);
}

// Transform categorized articles into UI-friendly topic format
function transformToTopics(categorizedArticles, allArticles) {
  // Create a map of article ID to categorization
  const categorizationMap = new Map();
  categorizedArticles.forEach(cat => {
    categorizationMap.set(cat.id, cat);
  });

  // Group articles by primary_category
  const categoryGroups = {};

  categorizedArticles.forEach(cat => {
    const category = cat.primary_category;
    if (!categoryGroups[category]) {
      categoryGroups[category] = {
        articles: [],
        relevance_counts: { High: 0, Medium: 0, Low: 0 },
        policy_stages: {}
      };
    }

    // Find the full article data
    const fullArticle = allArticles.find(a => a.id === cat.id);
    if (fullArticle) {
      categoryGroups[category].articles.push({
        ...fullArticle,
        categorization: cat
      });

      // Track metadata
      categoryGroups[category].relevance_counts[cat.relevance]++;
      const stage = cat.policy_stage || 'N/A';
      categoryGroups[category].policy_stages[stage] = (categoryGroups[category].policy_stages[stage] || 0) + 1;
    }
  });

  // Build topics array for UI
  const topics = Object.entries(categoryGroups).map(([name, data]) => {
    // Generate summary based on category
    const summary = generateCategorySummary(name, data);

    return {
      name: name,
      summary: summary,
      article_count: data.articles.length,
      articles: data.articles.map(a => ({
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
        no_link: a.no_link || false,
        // Add categorization metadata
        relevance: a.categorization.relevance,
        policy_stage: a.categorization.policy_stage,
        key_entities: a.categorization.key_entities,
        related_instruments: a.categorization.related_instruments,
        signals: a.categorization.signals,
        confidence: a.categorization.confidence
      })),
      metadata: {
        high_relevance: data.relevance_counts.High,
        medium_relevance: data.relevance_counts.Medium,
        low_relevance: data.relevance_counts.Low,
        policy_stages: data.policy_stages
      }
    };
  });

  // Sort by article count (largest first)
  topics.sort((a, b) => b.article_count - a.article_count);

  return topics;
}

// Generate summary for a category
function generateCategorySummary(categoryName, data) {
  const count = data.articles.length;
  const highRelevance = data.relevance_counts.High;

  const summaries = {
    "Trade & Investment": `${count} articles covering tariffs, de minimis rules, outbound investment screening, and CFIUS reviews. ${highRelevance} high-relevance items.`,
    "Technology & AI": `${count} articles on AI export controls, compute restrictions, GAIN AI Act developments, and technology policies. ${highRelevance} high-relevance items.`,
    "Security & Sanctions": `${count} articles covering Entity List additions, OFAC/SDN designations, DoD contractor restrictions, and national security measures. ${highRelevance} high-relevance items.`,
    "Financial Markets & Capital Controls": `${count} articles on delisting threats, index bans, SEC disclosure requirements, and capital market restrictions. ${highRelevance} high-relevance items.`,
    "Education & Research Oversight": `${count} articles covering foreign gifts reporting, research security (SAFE Research/DETERRENT), and visa restrictions. ${highRelevance} high-relevance items.`,
    "Infrastructure & Property": `${count} articles on port security, crane restrictions, maritime supply chains, farmland ownership, and critical infrastructure. ${highRelevance} high-relevance items.`,
    "Health & Biotech": `${count} articles covering BIOSECURE Act, genomic data restrictions, clinical trial oversight, and biotech policies. ${highRelevance} high-relevance items.`,
    "Social Media & Content Regulation": `${count} articles on TikTok/ByteDance restrictions, Kids Online Safety Act (KOSA), COPPA 2.0, and content moderation. ${highRelevance} high-relevance items.`,
    "Human Rights & Ethics": `${count} articles covering Uyghur forced labor prevention, organ harvesting concerns, Falun Gong protection, and human rights legislation. ${highRelevance} high-relevance items.`,
    "Legislative Monitoring & Political Messaging": `${count} articles on committee hearings, legislative calendar updates, congressional statements, and political rhetoric. ${highRelevance} high-relevance items.`
  };

  return summaries[categoryName] || `${count} articles in this category. ${highRelevance} high-relevance items.`;
}

export default async function handler(req, res) {
  try {
    const days = parseInt(req.query.days || '7', 10);
    const forceRefresh = req.query.refresh === 'true';

    // Check cache first
    if (!forceRefresh) {
      const cached = await redis.get(TOPICS_V2_CACHE);
      if (cached) {
        console.log('Returning cached topics v2');
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

    console.log(`Topic categorization v2: Processing ${articles.length} articles from last ${days} days`);

    if (articles.length === 0) {
      return res.status(200).json({
        ok: true,
        topics: [],
        total_articles: 0,
        message: "No articles found in time range"
      });
    }

    // Prepare article data for categorization (id, title, summary)
    const articleData = articles.map(a => ({
      id: a.id,
      title: a.title,
      summary: a.summary || ""
    }));

    // Chunk articles to avoid token limits (250 articles per chunk)
    const chunks = chunkArray(articleData, 250);
    console.log(`Processing ${chunks.length} chunks (${articleData.length} total articles)`);

    // Process each chunk
    const allCategorizations = [];
    for (let i = 0; i < chunks.length; i++) {
      console.log(`Processing chunk ${i + 1}/${chunks.length} (${chunks[i].length} articles)...`);

      try {
        const chunkResults = await categorizeChunk(chunks[i], process.env.OPENAI_API_KEY);
        allCategorizations.push(...chunkResults);
        console.log(`Chunk ${i + 1} complete: ${chunkResults.length} categorizations`);
      } catch (error) {
        console.error(`Error processing chunk ${i + 1}:`, error);
        // Continue with other chunks even if one fails
      }
    }

    console.log(`Total categorizations: ${allCategorizations.length}`);

    // Transform to topic format
    const topics = transformToTopics(allCategorizations, articles);

    const result = {
      ok: true,
      topics: topics,
      total_articles: articles.length,
      categorized_articles: allCategorizations.length,
      total_topics: topics.length,
      days: days,
      timestamp: new Date().toISOString()
    };

    // Cache the result
    await redis.setex(TOPICS_V2_CACHE, CACHE_TTL, JSON.stringify(result));

    res.status(200).json(result);

  } catch (e) {
    console.error('Topic categorization v2 error:', e);
    res.status(500).json({
      ok: false,
      error: e?.message || String(e)
    });
  }
}
