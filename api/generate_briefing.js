// Perplexity API - Generate weekly HSG policy briefing
// Following Perplexity's comprehensive instruction set
export const config = {
  maxDuration: 300, // 5 minutes
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  try {
    const { startDate, endDate } = req.body;
    const apiKey = process.env.PERPLEXITY_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "Perplexity API key not configured" });
    }

    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    console.log('=== Starting Perplexity Briefing Generation ===');
    console.log(`Date Range: ${startDate} to ${endDate}`);
    console.log(`Current Date: ${today}`);

    const systemPrompt = `You are an expert senior policy analyst creating a weekly national-security–style policy and risk intelligence briefing for HongShan, a top global VC firm.

**MANDATORY INSTRUCTIONS:**
- Research and summarize ONLY developments from the past 7 days. Do NOT include background, speculation, or events older than that.
- For EVERY policy fact, regulation, development, legislative action, or quote, you MUST cite the live source at the end of the sentence or bullet (using [1], [2], etc.).
- Use ONLY credible and fresh sources (.gov, law firms, major policy news, Congressional trackers, global news alerts). NO Wikipedia or filler.
- List ALL sources with clickable URLs in a section at the end ("## SOURCES").
- If a required section has no recent development, say so, and cite a real monitoring feed, tracker, or daily news wrap proving it.
- Final output must be markdown with these exact sections and style:

---

# Executive Summary
- 5 bullets, one per key new event, each with citation.

# Policy & Legislative Updates
For US, China, EU, UK, Japan - any law, rule, or enforcement change in past week. Headline + BLUF + 150 word analysis, all cited.

# National Security & Tech Policy
All new tech controls, sanctions, export/review framework changes this week, with explicit citations per fact.

# Outbound & Foreign Investment Review
New screening, CFIUS/FIRRMA, pilot programs, LP/disclosure, or significant market reactions—ONLY if in the last 7 days, all cited.

# China Policy & Global Reactions
Official statements, countermeasures, or market impacts from govt sources in last 7 days, each cited.

# Analysis
Short synthesis or risk insight—only if it directly references a cited development from above.

## SOURCES
[List all used URLs as [1] [2] ... [n], DO NOT duplicate, sorted in order of appearance.]

---

**Every claim, especially dates, numbers, names, policy shifts, enforcement notices, and analysis, must have a [1]/[2]/[n] citation matching the source in the appendix.
If no source exists this week for a requirement, write "No material update confirmed via [source/date]."
Focus on actionable, cited, recent, and sector/legal-focused developments, not generic background.**

Begin ONLY after you have confirmed sufficient cited sources for every section.`;

    const userMessage = `Generate HongShan weekly policy briefing for ${startDate} to ${endDate}, using the instructions above.`;

    const startTime = Date.now();

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar-pro',
        temperature: 0.2,
        max_tokens: 12000,
        return_citations: true,
        search_recency_filter: 'week',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Perplexity API error:', response.status, errorText);
      return res.status(500).json({
        error: `Perplexity API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error('Invalid Perplexity response structure:', JSON.stringify(data));
      return res.status(500).json({
        error: 'Perplexity returned invalid response structure'
      });
    }

    let briefingText = data.choices[0].message.content;
    const citations = data.citations || [];

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('=== Briefing Generation Complete ===');
    console.log(`Total time: ${totalTime}s`);
    console.log(`Citations collected: ${citations.length}`);
    console.log(`Briefing length: ${briefingText.length} chars`);

    // Analyze citation usage
    const citationMatches = briefingText.match(/\[(\d+)\]/g) || [];
    const uniqueCitationNumbers = [...new Set(citationMatches.map(m => parseInt(m.match(/\d+/)[0])))];

    console.log(`Citation instances in text: ${citationMatches.length}`);
    console.log(`Unique citation numbers used: ${uniqueCitationNumbers.length}`);

    if (citations.length === 0) {
      console.warn('⚠️  Warning: No citations returned by Perplexity API');
    } else if (uniqueCitationNumbers.length < 20) {
      console.warn(`⚠️  Warning: Low citation diversity (${uniqueCitationNumbers.length} unique sources)`);
    }

    // Count words
    const wordCount = briefingText.split(/\s+/).length;
    console.log(`Word count: ${wordCount}`);

    if (wordCount < 5000) {
      console.warn('⚠️  Warning: Briefing shorter than expected (< 5000 words)');
    }

    // Add metadata header to briefing
    const briefingWithMetadata = `# WEEKLY POLICY BRIEFING: NATIONAL SECURITY & INVESTMENT DEVELOPMENTS

**Prepared for:** HongShan
**Period Covered:** ${startDate} – ${endDate}
**Generated:** ${new Date().toLocaleString('en-US', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  timeZoneName: 'short'
})}
**Classification:** Strategic Intelligence – Senior Leadership
**Sources Cited:** ${citations.length} | **Coverage:** Past 7 Days

---

${briefingText}`;

    return res.status(200).json({
      ok: true,
      briefing: briefingWithMetadata,
      citations: citations,
      startDate: startDate,
      endDate: endDate,
      generatedAt: new Date().toISOString(),
      metadata: {
        wordCount,
        citationInstanceCount: citationMatches.length,
        citedSourceCount: citations.length,
        generationTimeSeconds: parseFloat(totalTime),
        qualityChecks: {
          sufficientLength: wordCount >= 5000,
          adequateCitations: citationMatches.length >= 50,
          diverseSources: citations.length >= 20
        }
      }
    });

  } catch (e) {
    console.error('=== Briefing Generation Error ===');
    console.error('Error:', e);
    console.error('Stack:', e.stack);

    return res.status(500).json({
      ok: false,
      error: e?.message || String(e),
      timestamp: new Date().toISOString()
    });
  }
}
