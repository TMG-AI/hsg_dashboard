// OpenAI Chat API - Ask questions about articles
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  try {
    const { question } = req.body;

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: "Question is required" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OpenAI API key not configured" });
    }

    // Get all articles from last 7 days
    const now = Math.floor(Date.now() / 1000);
    const sevenDaysAgo = now - (7 * 24 * 60 * 60);

    const raw = await redis.zrange(ZSET, sevenDaysAgo, now, { byScore: true });
    const articles = raw.map(toObj).filter(Boolean);

    console.log(`Chat: Loading ${articles.length} articles for context`);

    // Prepare article context (limit to key info to save tokens)
    const articleContext = articles.map(a => ({
      title: a.title,
      source: a.source,
      published: a.published,
      origin: a.origin,
      summary: a.summary?.substring(0, 200) // Limit summary length
    }));

    // Count articles by origin
    const originCounts = articles.reduce((acc, a) => {
      const origin = a.origin || 'unknown';
      acc[origin] = (acc[origin] || 0) + 1;
      return acc;
    }, {});

    // Create OpenAI chat completion
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
            content: `You are an expert analyst helping with China media monitoring. You have access to ${articles.length} recent articles about China from the past 7 days.

Article breakdown by source:
- Google Alerts: ${originCounts.google_alerts || 0} articles
- Congress Bills: ${originCounts.congress || 0} bills
- Newsletters: ${originCounts.newsletter || 0} articles
${originCounts.newsletter ? '' : '\nNote: There are NO newsletter articles in this dataset - do not mention newsletters in your response.'}

Answer questions about trends, key topics, sentiment, or specific articles. ONLY discuss sources that have articles available (non-zero count).

FORMATTING REQUIREMENTS:
- Use **bold text** for all section headings and key terms
- Use bullet points (- ) for lists and key points
- Keep paragraphs short and scannable (2-3 sentences max)
- Use clear section breaks with bold headings
- Prioritize readability over academic formatting
- Start major sections with ## for markdown h2 headers

Available articles:
${JSON.stringify(articleContext, null, 2)}`
          },
          {
            role: 'user',
            content: question
          }
        ],
        temperature: 0.7,
        max_tokens: 2000
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
    const answer = data.choices[0]?.message?.content || "No response generated";

    res.status(200).json({
      ok: true,
      question,
      answer,
      articles_analyzed: articles.length,
      timestamp: new Date().toISOString()
    });

  } catch (e) {
    console.error('Chat error:', e);
    res.status(500).json({
      ok: false,
      error: e?.message || String(e)
    });
  }
}
