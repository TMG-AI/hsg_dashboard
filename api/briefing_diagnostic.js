// Diagnostic endpoint to test Perplexity API citation extraction
export const config = {
  maxDuration: 60, // 1 minute
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  try {
    const apiKey = process.env.PERPLEXITY_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "Perplexity API key not configured" });
    }

    console.log('=== Perplexity API Diagnostic Test ===');

    // Run a single test query
    const testQuery = "Treasury Department outbound investment final rule EO 14105 November 2024";

    console.log(`Testing query: "${testQuery}"`);

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar-pro',
        temperature: 0.1,
        max_tokens: 2000,
        return_citations: true,
        search_recency_filter: 'month',
        search_domain_filter: ['gov', 'edu', 'org'],
        messages: [{
          role: 'user',
          content: `Research: ${testQuery}\n\nProvide 3-5 key findings with inline citations [1][2][3].`
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(500).json({
        ok: false,
        error: `API request failed: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();

    // Analyze response structure
    const analysis = {
      responseKeys: Object.keys(data),
      hasTopLevelCitations: !!data.citations,
      topLevelCitationsCount: data.citations?.length || 0,
      topLevelCitationsType: Array.isArray(data.citations) ? 'array' : typeof data.citations,

      choicesCount: data.choices?.length || 0,

      hasChoiceLevelCitations: !!data.choices?.[0]?.citations,
      choiceLevelCitationsCount: data.choices?.[0]?.citations?.length || 0,
      choiceLevelCitationsType: Array.isArray(data.choices?.[0]?.citations) ? 'array' : typeof data.choices?.[0]?.citations,

      hasMessageLevelCitations: !!data.choices?.[0]?.message?.citations,
      messageLevelCitationsCount: data.choices?.[0]?.message?.citations?.length || 0,
      messageLevelCitationsType: Array.isArray(data.choices?.[0]?.message?.citations) ? 'array' : typeof data.choices?.[0]?.message?.citations,

      messageContent: data.choices?.[0]?.message?.content || '',
      contentLength: (data.choices?.[0]?.message?.content || '').length,
    };

    // Extract citations using current logic
    const citations = data.citations ||
                     data.choices?.[0]?.citations ||
                     data.choices?.[0]?.message?.citations ||
                     [];

    const content = data.choices?.[0]?.message?.content || '';
    const urlMatches = content.match(/https?:\/\/[^\s\)]+/g) || [];
    const allCitations = [...new Set([...citations, ...urlMatches])];

    // Extract citation numbers from content
    const citationMatches = content.match(/\[(\d+)\]/g) || [];
    const citationNumbers = [...new Set(citationMatches.map(m => parseInt(m.match(/\d+/)[0])))];

    return res.status(200).json({
      ok: true,
      query: testQuery,
      analysis,
      extraction: {
        apiCitations: citations,
        apiCitationsCount: citations.length,
        urlMatchesInContent: urlMatches,
        urlMatchesCount: urlMatches.length,
        combinedUniqueCitations: allCitations,
        combinedUniqueCitationsCount: allCitations.length,
        citationNumbersInContent: citationNumbers,
        citationNumbersCount: citationNumbers.length,
      },
      samples: {
        firstCitation: citations[0] || null,
        firstUrlMatch: urlMatches[0] || null,
        contentPreview: content.substring(0, 500),
      },
      rawResponse: {
        citations: data.citations,
        choices: data.choices?.map(c => ({
          citations: c.citations,
          message: {
            citations: c.message?.citations,
            contentLength: c.message?.content?.length,
          }
        }))
      }
    });

  } catch (e) {
    console.error('=== Diagnostic Error ===');
    console.error('Error:', e);
    console.error('Stack:', e.stack);

    return res.status(500).json({
      ok: false,
      error: e?.message || String(e),
      stack: e?.stack,
      timestamp: new Date().toISOString()
    });
  }
}
