// Perplexity API - Generate weekly HSG policy briefing with multi-stage research
// Max execution time for Vercel serverless function
export const config = {
  maxDuration: 300, // 5 minutes
};

// Specific research topics to investigate deeply
const RESEARCH_QUERIES = [
  "Treasury Department outbound investment final rule EO 14105 October November 2024 implementation guidance",
  "BIOSECURE Act Senate NDAA FY2026 amendment biotech supply chain October November 2024",
  "CFIUS penalty increase enforcement authority subpoena November 2024 $5 million final rule",
  "Commerce Department BIS semiconductor export controls TSMC China Entity List November 2024",
  "EU European Union outbound investment screening framework member states October November 2024",
  "UK National Security Investment Act China policy October November 2024",
  "Japan semiconductor investment $65 billion TSMC Rapidus November 2024",
  "DOJ Department Justice data security bulk transfer China countries of concern October November 2024",
  "Trump administration China policy personnel Marco Rubio Mike Waltz November 2024 tariffs",
  "China Ministry Commerce export control countermeasures rare earth November 2024",
  "CHIPS Act implementation Intel TSMC funding November 2024",
  "venture capital limited partner China exposure Texas pension October November 2024"
];

async function conductResearch(query, apiKey) {
  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'sonar-pro',
      temperature: 0.1,
      max_tokens: 4000,
      return_citations: true,
      search_recency_filter: 'month',
      // Removed search_domain_filter - was blocking law firms (.com) and other important sources
      messages: [{
        role: 'user',
        content: `Conduct comprehensive research on: ${query}

Research requirements:
- Find 5-10 authoritative sources minimum
- Prioritize: .gov sites, major law firms (Cooley, Morrison Foerster, DLA Piper, Skadden, White & Case), think tanks (CSIS, Brookings, Atlantic Council), Federal Register
- Include specific details: dates, rule numbers, penalty amounts, technical specifications, company names
- Explain policy implications for venture capital investment strategy
- Cite every claim with inline citations [1][2][3]

Provide detailed analysis with extensive citations.`
      }]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Research failed for "${query}":`, response.status, errorText);
    return { query, content: '', citations: [] };
  }

  const data = await response.json();

  // LOG: Full API response structure
  console.log(`\n📥 RAW RESPONSE for "${query.substring(0, 40)}..."`);
  console.log(`Response keys:`, Object.keys(data));
  console.log(`Full citations field:`, JSON.stringify(data.citations));
  console.log(`Choices:`, data.choices?.length || 0);

  const content = data.choices?.[0]?.message?.content || '';

  // Perplexity returns citations as top-level array of URLs
  let citations = [];

  if (Array.isArray(data.citations)) {
    citations = data.citations;
    console.log(`✅ Found ${citations.length} citations in data.citations array`);
  } else if (data.citations) {
    console.warn(`⚠️ data.citations exists but is not an array:`, typeof data.citations, data.citations);
  } else {
    console.warn(`⚠️ No data.citations field in response`);
  }

  // Fallback: Extract URLs from content if inline citations exist
  const urlMatches = content.match(/https?:\/\/[^\s\)]+/g) || [];
  if (urlMatches.length > 0) {
    console.log(`📎 Found ${urlMatches.length} URLs embedded in content`);
  }

  const allCitations = [...new Set([...citations, ...urlMatches])]; // Deduplicate

  // LOG: Citation extraction results
  console.log(`\n📊 CITATION EXTRACTION SUMMARY:`);
  console.log(`  API citations (data.citations): ${citations.length}`);
  console.log(`  URL matches in content: ${urlMatches.length}`);
  console.log(`  Total unique citations: ${allCitations.length}`);
  console.log(`  Content length: ${content.length} chars`);
  if (allCitations.length > 0) {
    console.log(`  ✅ Sample citations:`, allCitations.slice(0, 3));
  } else {
    console.error(`  ❌ ZERO citations extracted! This will cause "0 sources" issue`);
  }

  return {
    query,
    content,
    citations: allCitations
  };
}

async function synthesizeBriefing(combinedResearch, allCitationsWithUrls, totalSources, dateRange, apiKey) {

  const systemPrompt = `You are a senior policy analyst preparing a weekly national-security–style policy briefing for HSG, a global venture capital firm with significant exposure to the U.S., China, and global technology ecosystems.

Your role is to distill complex policy developments into concise, strategic, and actionable insights.

Current Date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

BRIEFING STRUCTURE (MANDATORY):

## EXECUTIVE SUMMARY (5 bullets max)
- Each bullet: 1-2 sentences summarizing key development + HSG implications
- Heavy citation [1][2][3] for each bullet

## POLICY & LEGISLATIVE UPDATES (4-6 entries)
Each entry must include:
- **Headline:** 1 sentence, specific and factual
- **BLUF:** 2-3 sentences summarizing what happened and why it matters
- **Analysis (HSG Relevance):** 150-250 words explaining strategic, regulatory, or investment implications. Address: risk exposure, opportunity, compliance obligations, portfolio impact
- Length: 200-300 words per entry
- Citations: 3-5 citations per entry minimum

Focus: U.S., EU, China legislative/regulatory developments in:
- Outbound investment restrictions (EO 14105, Treasury guidance)
- BIOSECURE Act and biotech restrictions
- CHIPS Act implementation
- NDAA provisions affecting technology/China

## NATIONAL SECURITY & TECH POLICY (4-6 entries)
Same format as above.
Focus: Export controls, semiconductor policy, AI regulations, data security frameworks, quantum computing

## OUTBOUND INVESTMENT & FOREIGN INVESTMENT REVIEW (3-5 entries)
Same format as above.
Focus: CFIUS enforcement, EO 14105 implementation, allied coordination (EU, UK, Japan), Treasury guidance

## CHINA POLICY & GLOBAL REACTIONS (3-5 entries)
Same format as above.
Focus: US-China relations, China countermeasures, allied responses, Trump administration signals, sectoral impacts

## ANALYSIS SECTION: COMPARATIVE POLICY TRENDS (500-800 words)
- Connect developments across sections
- Compare to previous legislation (CHIPS Act, earlier export controls)
- Identify trajectory and expansion patterns
- Strategic implications for HSG portfolio strategy
- Timeline of critical dates
- Heavily cited throughout

WRITING REQUIREMENTS:
- Tone: Professional, analytic, intelligence briefing style (think Bloomberg Intelligence, Stratfor)
- Audience: Senior-level investors and policy professionals at venture capital firm
- Citation density: 3-5 citations per substantive paragraph minimum
- Every factual claim, statistic, date, quote, or policy detail MUST be cited
- Use inline citations [1][2][3] format
- Include specific details: dates, rule numbers, effective dates, penalty amounts, company names, legislative titles
- NO generic claims without sources
- NO placeholder text like "according to reports" without citation
- Target output: 8,000-10,000 words total

CRITICAL: You have extensive research provided below. Use it comprehensively. Every policy development discussed must reference the research sources. Maintain high citation density throughout.`;

  const userMessage = `Using the research conducted below, create a comprehensive weekly HSG national security policy briefing for ${dateRange.startDate} to ${dateRange.endDate}.

IMPORTANT CITATION INSTRUCTIONS:
- You have ${totalSources} sources available (numbered [1] through [${totalSources}])
- EVERY factual claim, policy detail, date, or statistic MUST include citations
- Use citations like this: "Treasury finalized the rule[1][2]" or "effective January 2, 2025[3]"
- Aim for 3-5 citations per paragraph
- The more citations, the better

MASTER SOURCE LIST (${totalSources} total):
${allCitationsWithUrls.map(c => `[${c.number}] ${c.url}`).join('\n')}

---

RESEARCH CONDUCTED (12 topics):

${combinedResearch}

---

SYNTHESIS INSTRUCTIONS:

1. Organize findings into the required structure (Executive Summary → Policy Updates → National Security → Outbound Investment → China Policy → Analysis)

2. For each policy development:
   - State what happened specifically (dates, amounts, entities)
   - Explain immediate implications
   - Analyze strategic impact for HSG (portfolio exposure, compliance requirements, risk factors, opportunities)

3. Citation requirements:
   - Cite sources from research above using [1][2][3] format
   - Maintain 3-5 citations per paragraph
   - Never make claims about specific policies, dates, or amounts without citations
   - If research is insufficient on a topic, state "limited reporting available" rather than speculating

4. HSG-specific analysis must address:
   - Portfolio company exposure (which sectors/companies affected)
   - US LP relationship implications (fundraising, compliance)
   - Geographic expansion strategy considerations (Japan, Europe offices)
   - Compliance infrastructure requirements
   - Timeline for action/decisions

5. Connect dots across developments:
   - How do semiconductor export controls relate to outbound investment rules?
   - How does BIOSECURE Act fit broader decoupling pattern?
   - What do Trump administration signals mean for trajectory?
   - How do allied policies (EU, UK, Japan) create opportunities or risks?

Synthesize this into the required briefing format with:
- Executive Summary (5 bullets, heavily cited)
- Policy & Legislative Updates (4-6 entries)
- National Security & Tech Policy (4-6 entries)
- Outbound Investment & Foreign Investment Review (3-5 entries)
- China Policy & Global Reactions (3-5 entries)
- Analysis Section (500-800 words)

Each entry: Headline, BLUF, Analysis (HSG Relevance) with 3-5 citations per paragraph.
Target: 8,000-10,000 words total with EXTENSIVE citations throughout.`;

  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'sonar-pro',
      temperature: 0.2,
      max_tokens: 16000,
      top_p: 0.9,
      presence_penalty: 0,
      frequency_penalty: 1,
      return_citations: false,  // We already have them from research stage
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Synthesis failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  let briefingText = data.choices[0].message.content;

  // LOG: Analyze which citations were actually used
  console.log(`\n🔍 CITATION ANALYSIS:`);
  const citationMatches = briefingText.match(/\[(\d+)\]/g) || [];
  const uniqueCitationNumbers = [...new Set(citationMatches.map(m => parseInt(m.match(/\d+/)[0])))];
  console.log(`  Total citation instances: ${citationMatches.length}`);
  console.log(`  Unique citation numbers used: ${uniqueCitationNumbers.length}`);
  console.log(`  Citation numbers: [${uniqueCitationNumbers.sort((a, b) => a - b).join(', ')}]`);
  console.log(`  Sources collected: ${totalSources}`);
  console.log(`  Sources actually cited: ${uniqueCitationNumbers.length}`);
  console.log(`  Unused sources: ${totalSources - uniqueCitationNumbers.length}`);

  // Separate cited vs unused sources
  const citedSources = allCitationsWithUrls.filter(c => uniqueCitationNumbers.includes(c.number));
  const unusedSources = allCitationsWithUrls.filter(c => !uniqueCitationNumbers.includes(c.number));

  // Build sources appendix with ONLY cited sources
  let sourcesAppendix = `

---

## SOURCES CITED

${citedSources.map(c => `[${c.number}] ${c.url}`).join('\n')}
`;

  // Add unused sources if any exist
  if (unusedSources.length > 0) {
    sourcesAppendix += `

## ADDITIONAL SOURCES CONSULTED

${unusedSources.map(c => `[${c.number}] ${c.url}`).join('\n')}
`;
  }

  briefingText = briefingText + sourcesAppendix;

  return {
    briefing: briefingText,
    allCitations: citedSources.map(c => c.url),  // Array of CITED URLs only
    citedSourceCount: citedSources.length,
    collectedSourceCount: totalSources,
    citationInstanceCount: citationMatches.length,
    researchCount: 12
  };
}

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

    console.log('=== Starting Multi-Stage Briefing Generation ===');
    console.log(`Date Range: ${startDate} to ${endDate}`);

    // Stage 1: Parallel research on all topics
    console.log(`Stage 1: Researching ${RESEARCH_QUERIES.length} topics in parallel...`);
    const startTime = Date.now();

    const researchPromises = RESEARCH_QUERIES.map(query =>
      conductResearch(query, apiKey)
    );

    const researchResults = await Promise.all(researchPromises);

    const researchTime = ((Date.now() - startTime) / 1000).toFixed(1);

    // Build a master citation list with URLs
    let citationIndex = 1;
    const masterCitationMap = new Map();
    const allCitationsWithUrls = [];

    console.log('=== Research Stage Complete ===');
    researchResults.forEach((result, i) => {
      const citationCount = result.citations?.length || 0;
      console.log(`Query ${i + 1}: "${result.query.substring(0, 60)}..." - ${citationCount} sources`);

      if (citationCount === 0) {
        console.warn(`  ⚠️ Query ${i + 1} returned ZERO citations!`);
      }

      if (result.citations && result.citations.length > 0) {
        result.citations.forEach((citation) => {
          if (!masterCitationMap.has(citation)) {
            masterCitationMap.set(citation, citationIndex);
            allCitationsWithUrls.push({ number: citationIndex, url: citation });
            citationIndex++;
          }
        });
      }
    });

    const totalSources = allCitationsWithUrls.length;
    console.log(`\n📚 MASTER CITATION LIST BUILT:`);
    console.log(`  Total unique sources collected: ${totalSources}`);
    console.log(`  Stage 1 Complete: ${totalSources} sources found in ${researchTime}s`);

    if (totalSources === 0) {
      console.error(`\n❌❌❌ CRITICAL: ZERO sources collected from all ${RESEARCH_QUERIES.length} queries!`);
      console.error(`This will result in "0 sources cited" even if briefing has citation numbers.`);
      console.error(`Check the individual query logs above to see why citations are not being extracted.`);
    } else if (totalSources < 20) {
      console.warn(`\n⚠️ Warning: Only ${totalSources} sources collected (expected 40-100+)`);
    } else {
      console.log(`\n✅ Successfully collected ${totalSources} sources for synthesis`);
    }

    // Format research with proper citation mapping
    const combinedResearch = researchResults
      .filter(r => r.content && r.content.length > 100)
      .map((r, i) => {
        const sourcesText = r.citations && r.citations.length > 0
          ? r.citations.map(c => `[${masterCitationMap.get(c)}] ${c}`).join('\n')
          : 'No sources found';

        return `### Research Area ${i + 1}: ${r.query}\n\n${r.content}\n\n**Sources:**\n${sourcesText}`;
      }).join('\n\n---\n\n');

    console.log(`Preparing synthesis with ${totalSources} sources`);

    // Stage 2: Synthesize comprehensive briefing
    console.log('=== Starting Synthesis Stage ===');
    console.log(`Master citation list has ${totalSources} sources`);
    const synthesisStart = Date.now();

    const synthesis = await synthesizeBriefing(
      combinedResearch,
      allCitationsWithUrls,
      totalSources,
      { startDate, endDate },
      apiKey
    );

    const synthesisTime = ((Date.now() - synthesisStart) / 1000).toFixed(1);

    // Validate output quality
    const wordCount = synthesis.briefing.split(/\s+/).length;
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('=== Briefing Generation Complete ===');
    console.log(`Final briefing: ${wordCount} words`);
    console.log(`Citation instances: ${synthesis.citationInstanceCount}`);
    console.log(`Sources cited: ${synthesis.citedSourceCount}`);
    console.log(`Sources collected: ${synthesis.collectedSourceCount}`);
    console.log(`Total time: ${totalTime}s`);
    console.log(`Research queries: ${synthesis.researchCount}`);

    // Quality warnings
    if (wordCount < 5000) {
      console.warn('⚠️  Warning: Briefing shorter than expected');
    }
    if (synthesis.citationInstanceCount < 50) {
      console.warn('⚠️  Warning: Low citation density');
    }
    if (synthesis.citedSourceCount < 20) {
      console.warn('⚠️  Warning: Insufficient cited source diversity');
    }
    if (synthesis.collectedSourceCount < 30) {
      console.warn('⚠️  Warning: Insufficient research source diversity');
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
**Sources Cited:** ${synthesis.citedSourceCount} | **Sources Researched:** ${synthesis.collectedSourceCount}
**Research Depth:** ${synthesis.researchCount} comprehensive queries

---

${synthesis.briefing}`;

    return res.status(200).json({
      ok: true,
      briefing: briefingWithMetadata,
      citations: synthesis.allCitations,  // Array of cited URLs only
      startDate: startDate,
      endDate: endDate,
      generatedAt: new Date().toISOString(),
      metadata: {
        wordCount,
        citationInstanceCount: synthesis.citationInstanceCount,
        citedSourceCount: synthesis.citedSourceCount,
        collectedSourceCount: synthesis.collectedSourceCount,
        researchQueriesUsed: synthesis.researchCount,
        generationTimeSeconds: parseFloat(totalTime),
        qualityChecks: {
          sufficientLength: wordCount >= 5000,
          adequateCitations: synthesis.citationInstanceCount >= 50,
          diverseCitedSources: synthesis.citedSourceCount >= 20,
          diverseCollectedSources: synthesis.collectedSourceCount >= 30
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
