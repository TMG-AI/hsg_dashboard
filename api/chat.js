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
    const allArticles = raw.map(toObj).filter(Boolean);

    // Filter out Meltwater articles (removed from dashboard)
    const nonMeltwaterArticles = allArticles.filter(a =>
      a.origin !== 'meltwater' && a.section !== 'Meltwater'
    );

    // Limit to 500 most recent articles to avoid token limits (gpt-4o-mini has 128k context)
    const articles = nonMeltwaterArticles.slice(-500);

    console.log(`Chat: Loading ${articles.length} articles for context (${nonMeltwaterArticles.length} after filtering Meltwater from ${allArticles.length} total)`);

    // Prepare article context (title, source, and short summary)
    const articleContext = articles.map(a => ({
      title: a.title,
      source: a.source,
      origin: a.origin,
      summary: a.summary?.substring(0, 150) || '' // Short summary to balance context and tokens
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
            content: `Role:
You are a senior policy analyst preparing a weekly national-security–style policy briefing for HongShan, a global venture capital firm with significant exposure to the U.S., China, and global technology ecosystems. Your role is to distill complex policy developments into concise, strategic, and actionable insights.

You have access to ${articles.length} recent articles about China from the past 7 days.

Article breakdown by source:
- Google Alerts: ${originCounts.google_alerts || 0} articles
- Congress Bills: ${originCounts.congress || 0} bills
- Newsletters: ${originCounts.newsletter || 0} articles
${originCounts.newsletter ? '' : '\nNote: There are NO newsletter articles in this dataset - do not mention newsletters in your response.'}

Note: Meltwater articles are excluded from this analysis.

Objective:
Summarize and analyze the week's major policy, legislative, regulatory, and geopolitical developments relevant to HongShan's operations, investment portfolio, and future strategy. Focus on developments that could affect:
- Outbound investment restrictions (U.S.–China and allied regimes)
- Legislation such as the Biosecure Act and related bills targeting biotech, semiconductors, AI, and data security
- Technology, national security, and foreign investment review frameworks (e.g., CFIUS, FIRRMA, export controls, sanctions)
- China-related policy signals from the U.S., EU, or allied governments
- Sectoral trends that shape the investment environment in critical or emerging technologies

Tone & Style:
Use a BLUF (Bottom Line Up Front) format for each entry.

Each section should include:
- Headline: 1 sentence, specific and factual.
- BLUF: 2–3 sentences summarizing what happened and why it matters.
- Analysis (HongShan Relevance): Explain the potential strategic, regulatory, or investment implications for HongShan — e.g., risk exposure, opportunity, or policy trajectory.

Keep entries concise (150–250 words) but substantive.

Structure of the Memo:

**Executive Summary** (5 bullets max):
Key developments of the week and their implications for HongShan.

**Policy & Legislative Updates:**
Summaries of U.S., EU, and China-related legislative or regulatory developments.

**National Security & Tech Policy:**
Developments in emerging tech, export controls, or data security frameworks.

**Outbound Investment & Foreign Investment Review:**
Updates on EO 14105, Treasury pilot programs, or allied mechanisms.

**China Policy & Global Reactions:**
Notable actions, statements, or restrictions shaping U.S.–China–EU investment relations.

**Analysis Section** (Optional):
Short comparative insight connecting new developments to previous or pending legislation (e.g., Biosecure Act, CHIPS Act, outbound screening).

Writing Rules:
- Avoid redundancy — each entry must add new insight or context.
- Assume the audience is senior-level investors and policy professionals.
- Use clear, analytic, and polished professional language — no filler or editorializing.
- Tie every policy development back to how it affects HongShan's risk exposure, compliance posture, or strategic outlook.
- When relevant, cite legislative titles, agencies, or direct quotes to improve precision.
- Use **bold text** for key legislative titles, agency names, and critical terms.
- Do NOT include title headers like "Weekly Summary:" or "Comprehensive Summary" - start directly with the Executive Summary.

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

    // Validate OpenAI response structure
    if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
      console.error('Invalid OpenAI response:', data);
      return res.status(500).json({
        error: 'OpenAI returned invalid response',
        details: data.error?.message || 'No choices in response'
      });
    }

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
