// Perplexity API - Generate weekly HSG policy briefing
// 5-query focused approach
export const config = {
  maxDuration: 300, // 5 minutes
};

function generateQueries(startDate, endDate) {
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return [
    `US Treasury outbound investment restrictions EO 14105 China developments between ${startDate} and ${endDate} ${today}`,
    `BIOSECURE Act WuXi BGI biotech Senate NDAA news between ${startDate} and ${endDate} ${today}`,
    `Commerce Department BIS semiconductor export controls TSMC China Entity List news between ${startDate} and ${endDate} ${today}`,
    `Trump administration China policy tariffs developments between ${startDate} and ${endDate} ${today}`,
    `EU UK Japan China investment screening semiconductor policy news between ${startDate} and ${endDate} ${today}`
  ];
}

const SECTION_TITLES = [
  'Outbound Investment & Treasury Guidance',
  'Biotech & Biosecurity Policy',
  'Semiconductor Export Controls & CFIUS',
  'US-China Policy & Political Developments',
  'Allied Government Coordination'
];

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

    console.log('=== Starting Perplexity Briefing Generation ===');
    console.log(`Date Range: ${startDate} to ${endDate}`);
    console.log('Using 5-query focused approach');

    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const FOCUSED_QUERIES = generateQueries(startDate, endDate);

    const startTime = Date.now();
    const results = [];

    // Run queries SEQUENTIALLY
    for (let i = 0; i < FOCUSED_QUERIES.length; i++) {
      const query = FOCUSED_QUERIES[i];
      console.log(`Query ${i+1}/5: ${query.substring(0, 50)}...`);

      try {
        const response = await fetch('https://api.perplexity.ai/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'sonar-pro',
            temperature: 0.2,
            max_tokens: 2500,
            return_citations: true,
            search_recency_filter: 'week',
            messages: [{
              role: 'user',
              content: `TODAY'S DATE: ${today}

Research this topic for developments in the PAST 7 DAYS ONLY (${startDate} to ${endDate}): ${query}

CRITICAL REQUIREMENTS:
- ONLY report on events, announcements, or developments from the past 7 days
- Include the specific date for each development (e.g., "On November 1, 2025...")
- If NO developments occurred in the past 7 days, explicitly state "No material updates in the past week"
- Find 5-10 authoritative sources from .gov sites, law firms, think tanks, major news
- Include specific details: dates, dollar amounts, company names, rule numbers
- Explain strategic implications for venture capital firms
- Cite every fact with [1][2][3]

If there are no developments in the past 7 days for this topic, say so clearly with a source confirming no news.`
            }]
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Query ${i+1} failed: ${response.status}`, errorText);
          results.push({
            content: `No updates found for this topic (API error: ${response.status})`,
            citations: []
          });
        } else {
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content || 'No content returned';
          const citations = data.citations || [];

          console.log(`Found ${citations.length} sources`);

          // Log warning if content mentions wrong year
          if (content.includes('2024') && !content.includes('2025')) {
            console.warn(`⚠️  Warning: Query ${i+1} may have returned outdated results from 2024`);
          }

          results.push({
            content,
            citations
          });
        }

        // Add 2-second delay between queries to avoid rate limits
        if (i < FOCUSED_QUERIES.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

      } catch (error) {
        console.error(`Query ${i+1} error:`, error);
        results.push({
          content: `No updates found for this topic (error: ${error.message})`,
          citations: []
        });
      }
    }

    // Deduplicate citations
    const allCitations = [...new Set(
      results.flatMap(r => r.citations || [])
    )];

    // Build executive summary from first finding of each query
    const executiveSummary = results
      .map((result, i) => {
        const firstParagraph = result.content.split('\n\n')[0] || 'No updates available';
        return `- **${SECTION_TITLES[i]}:** ${firstParagraph.substring(0, 200)}...`;
      })
      .join('\n');

    // Format full briefing
    const timestamp = new Date().toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      timeZoneName: 'short'
    });

    let briefingMarkdown = `---
**WEEKLY POLICY BRIEFING: NATIONAL SECURITY & INVESTMENT DEVELOPMENTS**
**Prepared for:** HSG
**Period Covered:** ${startDate} – ${endDate}
**Generated:** ${timestamp}
**Classification:** Strategic Intelligence – Senior Leadership
**Sources Analyzed:** ${allCitations.length}
**Research Queries:** 5 focused policy areas
---

# Executive Summary

${executiveSummary}

---

# Policy & Legislative Developments

`;

    // Add first 3 sections
    for (let i = 0; i < 3; i++) {
      briefingMarkdown += `## ${SECTION_TITLES[i]}

${results[i].content}

**Sources:**
${results[i].citations.map((url, idx) => `[${idx + 1}] ${url}`).join('\n')}

---

`;
    }

    briefingMarkdown += `# China Policy & Global Context

`;

    // Add last 2 sections
    for (let i = 3; i < 5; i++) {
      briefingMarkdown += `## ${SECTION_TITLES[i]}

${results[i].content}

**Sources:**
${results[i].citations.map((url, idx) => `[${idx + 1}] ${url}`).join('\n')}

---

`;
    }

    // Add master source list
    briefingMarkdown += `# MASTER SOURCE LIST

${allCitations.map((url, idx) => `[${idx + 1}] ${url}`).join('\n')}
`;

    // Count words and citations
    const wordCount = briefingMarkdown.split(/\s+/).length;
    const citationMatches = briefingMarkdown.match(/\[(\d+)\]/g) || [];
    const generationTimeSeconds = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('=== Briefing Generation Complete ===');
    console.log(`Total time: ${generationTimeSeconds}s`);
    console.log(`Unique sources: ${allCitations.length}`);
    console.log(`Word count: ${wordCount}`);
    console.log(`Citation instances: ${citationMatches.length}`);

    return res.status(200).json({
      ok: true,
      briefing: briefingMarkdown,
      citations: allCitations,
      startDate: startDate,
      endDate: endDate,
      generatedAt: new Date().toISOString(),
      metadata: {
        wordCount,
        citationInstanceCount: citationMatches.length,
        citedSourceCount: allCitations.length,
        queriesUsed: 5,
        generationTimeSeconds: parseFloat(generationTimeSeconds)
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
