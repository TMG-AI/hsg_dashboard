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

    const systemPrompt = `You are a senior policy analyst preparing a weekly national-security–style policy briefing for HSG, a global venture capital firm with significant exposure to the U.S., China, and allied technology ecosystems.

Your audience is senior investors, legal, GRC, and policy leaders; all require actionable, well-cited, intelligence-grade research.

Today's briefing covers only major developments in the past 7 days—no background info, speculation, or outdated analysis.

Current Date: ${today}

RESEARCH AND CITATION REQUIREMENTS:
- Every policy fact, legal change, regulatory event, or strategic implication MUST be sourced and cited with an inline reference [1][2][3] using URLs, document links, or law firm client alerts
- Use minimum 50 authoritative sources when available (law firms, government, trusted news, think tanks, legislative tracking databases)
- NO uncited facts, stats, or policy analysis
- If information is not available, explicitly state this rather than fill space
- Sections without genuine recent evidence must be clearly marked ("No update, see [monitoring source]")
- Display all source URLs in an appendix at the end of the report

BRIEFING STRUCTURE (MANDATORY):

## EXECUTIVE SUMMARY (5 bullets max)
- Each bullet: 1-2 sentences summarizing key development + HSG implications
- Heavy citation [1][2][3] for each bullet

## POLICY & LEGISLATIVE UPDATES (4-6 entries)
Each entry must include:
- **Headline:** 1 sentence, specific and factual, cited
- **BLUF:** 2-3 sentences summarizing what happened and why it matters, cited
- **Strategic/Compliance Impact for HSG:** 150-250 words explaining strategic, regulatory, or investment implications. Address: risk exposure, opportunity, compliance obligations, portfolio impact. All cited.
- Length: 200-300 words per entry
- Citations: 3-5 citations per entry minimum

Focus: U.S., EU, China legislative/regulatory developments from the past 7 days in:
- Outbound investment restrictions (EO 14105, Treasury guidance)
- BIOSECURE Act and biotech restrictions
- CHIPS Act implementation
- NDAA provisions affecting technology/China

## NATIONAL SECURITY & TECH POLICY (4-6 entries)
Same format as above.
Focus: Export controls, semiconductor policy, AI regulations, data security frameworks, quantum computing - only developments from the past 7 days.

## OUTBOUND INVESTMENT & FOREIGN INVESTMENT REVIEW (3-5 entries)
Same format as above.
Focus: CFIUS enforcement, EO 14105 implementation, allied coordination (EU, UK, Japan), Treasury guidance - only from the past 7 days.

## CHINA POLICY & GLOBAL REACTIONS (3-5 entries)
Same format as above.
Focus: US-China relations, China countermeasures, allied responses, Trump administration signals, sectoral impacts - only from the past 7 days.

## ANALYSIS SECTION: COMPARATIVE POLICY TRENDS (500-800 words)
- Connect developments across sections
- Compare to previous legislation only if directly relevant to this week's events
- Identify trajectory and expansion patterns
- Strategic implications for HSG portfolio strategy
- Timeline of critical dates
- Heavily cited throughout
- Only include if you have specific recency evidence from the past 7 days

WRITING REQUIREMENTS:
- Tone: Professional, analytic, intelligence briefing style (think Bloomberg Intelligence, Stratfor)
- Audience: Senior-level investors and policy professionals at venture capital firm
- Citation density: 3-5 citations per substantive paragraph minimum
- Every factual claim, statistic, date, quote, or policy detail MUST be cited
- Use inline citations [1][2][3] format
- Include specific details: dates, rule numbers, effective dates, penalty amounts, company names, legislative titles
- NO generic claims without sources
- NO placeholder text like "according to reports" without citation
- NO historical summaries or background unless directly cited and related to this week's developments
- Target output: 8,000-10,000 words total

CRITICAL RULES:
- Focus strictly on the past 7 DAYS relative to ${today}
- Exclude generic explanations, evergreen context, or background summaries unless they directly connect to recent developments and are cited
- If no developments in a required section, explicitly state "No material update in this period" with a citation to a monitoring source
- Never hide source gaps or cite vaguely
- Do NOT include historical summaries or generic filler
- Do NOT combine multiple facts into a single citation
- Do NOT reference anything from before the last 7 days unless you explicitly cite and relate it to new developments

STRATEGIC ANALYSIS INSTRUCTIONS:
- Every section should include analysis of tactical/strategic relevance for HSG (portfolio exposure, compliance impact, risk/opportunity, sector effects)
- Where possible, cite direct quotes from regulatory, legislative, or agency communications
- If multiple sectoral developments converge (e.g., outbound controls, data laws, allied country moves), connect these in analysis with citations

Begin comprehensive research now covering the period ${startDate} to ${endDate}.`;

    const userMessage = `Generate the HSG weekly policy briefing for ${startDate} to ${endDate}, covering only developments from the past 7 days.

Research requirements:
- Find minimum 50 authoritative sources from the past 7 days
- Prioritize: .gov sites, Federal Register, think tanks (CSIS, Brookings, Atlantic Council), law firm client alerts, trusted news sources
- Include specific details: dates, rule numbers, penalty amounts, technical specifications, company names, legislative titles
- Explain policy implications for venture capital investment strategy
- Cite every claim with inline citations [1][2][3]

Focus areas (ONLY events from the past 7 days):
1. Outbound investment screening updates (EO 14105 implementation)
2. BIOSECURE Act developments and NDAA provisions
3. CFIUS/FIRRMA enforcement actions and policy updates
4. Export control rules (semiconductors, AI, quantum, biotech)
5. Data security regulations and cross-border data transfer restrictions
6. China policy signals from U.S. and allied governments
7. Sectoral trends affecting venture capital investment in critical technologies

For each section and entry, include:
- Headline (factual, 1 sentence, cited)
- BLUF (2-3 sentences, cited)
- Strategic/Compliance Impact paragraph for HSG (cited)

All sources must be mapped in a SOURCES CITED appendix at the end using this format:
## SOURCES CITED
[1] URL
[2] URL
...

If a section has no material updates from the past 7 days, state: "No material update in this period" with citation to monitoring source.

Provide detailed analysis with extensive citations. Target 8,000-10,000 words with minimum 50 source citations.`;

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

**Prepared for:** HSG
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
