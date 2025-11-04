// Perplexity API - Generate weekly HSG policy briefing
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  try {
    const { startDate, endDate } = req.body;

    if (!process.env.PERPLEXITY_API_KEY) {
      return res.status(500).json({ error: "Perplexity API key not configured" });
    }

    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const systemPrompt = `Role:
You are a senior policy analyst preparing a weekly national-security–style policy briefing for HSG, a global venture capital firm with significant exposure to the U.S., China, and global technology ecosystems. Your role is to distill complex policy developments into concise, strategic, and actionable insights.

Current Date: ${today}

Objective:
Summarize and analyze the week's major policy, legislative, regulatory, and geopolitical developments relevant to HSG's operations, investment portfolio, and future strategy. Focus on developments that could affect:
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
- Analysis (HSG Relevance): Explain the potential strategic, regulatory, or investment implications for HSG.
Keep entries concise (150–250 words) but substantive.

Structure of the Memo:
1. Executive Summary (5 bullets max): Key developments of the week and their implications for HSG.
2. Policy & Legislative Updates: Summaries of U.S., EU, and China-related legislative or regulatory developments.
3. National Security & Tech Policy: Developments in emerging tech, export controls, or data security frameworks.
4. Outbound Investment & Foreign Investment Review: Updates on EO 14105, Treasury pilot programs, or allied mechanisms.
5. China Policy & Global Reactions: Notable actions, statements, or restrictions shaping U.S.–China–EU investment relations.
6. Analysis Section (Optional): Short comparative insight connecting new developments to previous or pending legislation.

Writing Rules:
- Conduct extensive research: Minimum 50-80 sources for comprehensive weekly briefing
- Avoid redundancy — each entry must add new insight or context.
- Assume the audience is senior-level investors and policy professionals.
- Use clear, analytic, and polished professional language — no filler or editorializing.
- Tie every policy development back to how it affects HSG's risk exposure, compliance posture, or strategic outlook.
- When relevant, cite legislative titles, agencies, or direct quotes to improve precision.
- Use inline citations [1][2][3] throughout the report.
- Format using clear markdown with headers (## for main sections, ### for subsections), bold text for emphasis, and proper structure.

Focus your research on the past 7 days from the current date.`;

    const userMessage = `Generate the weekly HSG national security policy briefing covering ${startDate} to ${endDate}.

Conduct comprehensive research with minimum 50-80 sources across:
- U.S. government agencies (Treasury, Commerce, State Department, DOJ)
- Congressional legislation and committee reports
- Federal Register notices
- Think tank analysis (CSIS, Brookings, CFR, Atlantic Council)
- Legal firm client alerts on CFIUS, export controls, sanctions
- International policy developments (EU, UK, Japan, allied governments)

Focus areas:
1. Outbound investment screening updates (EO 14105 implementation)
2. BIOSECURE Act developments and NDAA provisions
3. CFIUS/FIRRMA enforcement actions and policy updates
4. Export control rules (semiconductors, AI, quantum, biotech)
5. Data security regulations and cross-border data transfer restrictions
6. China policy signals from U.S. and allied governments
7. Sectoral trends affecting venture capital investment in critical technologies

Provide detailed analysis with strategic implications for HSG's portfolio, compliance obligations, and risk exposure.`;

    console.log(`[Perplexity] Generating briefing for ${startDate} to ${endDate}...`);

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar-pro',
        temperature: 0.2,
        max_tokens: 8000,
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
        error: 'Perplexity returned invalid response structure',
        details: 'No choices in response'
      });
    }

    const briefingText = data.choices[0].message.content;
    const citations = data.citations || [];

    console.log(`[Perplexity] Successfully generated briefing (${briefingText.length} chars, ${citations.length} citations)`);

    return res.status(200).json({
      ok: true,
      briefing: briefingText,
      citations: citations,
      startDate: startDate,
      endDate: endDate,
      generatedAt: new Date().toISOString()
    });

  } catch (e) {
    console.error('Error generating Perplexity briefing:', e);
    return res.status(500).json({
      ok: false,
      error: e?.message || String(e)
    });
  }
}
