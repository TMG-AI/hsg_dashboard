# PERPLEXITY BRIEFING DATA FLOW ANALYSIS
## Visual Breakdown of Citation Tracking Issues

---

## DATA FLOW DIAGRAM

```
┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 1: RESEARCH (12 Parallel Queries)                            │
└─────────────────────────────────────────────────────────────────────┘

Query 1: "Treasury outbound investment..."
   ↓
   📡 Perplexity API Call (sonar-pro, return_citations: true)
   ↓
   ⚠️  BUG #1: Citation extraction attempts 3 locations
   ↓
   ⚠️  BUG #8: No logging of actual response structure
   ↓
   { query: "...", content: "...", citations: ??? }

[Repeat for queries 2-12]

┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 2: MASTER CITATION LIST CONSTRUCTION                         │
└─────────────────────────────────────────────────────────────────────┘

researchResults = [
  { query: "...", content: "...", citations: ["url1", "url2"] },
  { query: "...", content: "...", citations: [] },  ← ⚠️ Empty!
  { query: "...", content: "...", citations: ["url3", "url1"] },
  ...
]
   ↓
   ⚠️  BUG #2: No validation of citation format
   ↓
   Loop through all citations from all queries
   ↓
   Deduplicate using Map
   ↓
masterCitationMap = Map {
  "url1" => 1,
  "url2" => 2,
  "url3" => 3,
  ...
}

allCitationsWithUrls = [
  { number: 1, url: "url1" },
  { number: 2, url: "url2" },
  { number: 3, url: "url3" },
  ...
]

totalSources = allCitationsWithUrls.length  // e.g., 47

┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 3: RESEARCH FORMATTING                                       │
└─────────────────────────────────────────────────────────────────────┘

For each research result:
   query.content → "The Treasury released guidance..."
   query.citations → ["url1", "url3"]
   ↓
   Map citations to numbers using masterCitationMap
   ↓
   ⚠️  BUG #3: masterCitationMap.get() may return undefined
   ↓
   Format as:
   ```
   ### Research Area 1: Treasury outbound investment...

   The Treasury released guidance...

   **Sources:**
   [1] url1
   [3] url3
   ```

combinedResearch = All research concatenated with sources

┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 4: SYNTHESIS                                                  │
└─────────────────────────────────────────────────────────────────────┘

systemPrompt = "You are a policy analyst..."

userPrompt = `
  IMPORTANT CITATION INSTRUCTIONS:
  - You have 47 sources available (numbered [1] through [47])
  - Use citations like [1][2][3]

  MASTER SOURCE LIST (47 total):
  [1] url1
  [2] url2
  [3] url3
  ...
  [47] url47

  ---

  RESEARCH CONDUCTED:
  ${combinedResearch}
`
   ↓
   📡 Perplexity API Call (sonar-pro, return_citations: false)
   ↓
   ⚠️  BUG #4: AI may not use numbered citations correctly
   ↓
   AI generates briefing text:
   ```
   ## EXECUTIVE SUMMARY
   - Treasury finalized outbound investment rules[1][2]
   - BIOSECURE Act advances in Senate[15]
   - Export controls expanded[8][9][10]
   ...
   ```
   ↓
briefingText = AI-generated content

┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 5: SOURCES APPENDIX                                          │
└─────────────────────────────────────────────────────────────────────┘

   ⚠️  BUG #5: Appends ALL sources collected, not just used
   ↓
sourcesAppendix = `
  ## SOURCES CITED
  [1] url1      ← Used in briefing ✓
  [2] url2      ← Used in briefing ✓
  [3] url3      ← NOT used in briefing ✗
  ...
  [47] url47    ← NOT used in briefing ✗
`
   ↓
briefingText = briefingText + sourcesAppendix

┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 6: METADATA CALCULATION                                      │
└─────────────────────────────────────────────────────────────────────┘

wordCount = briefingText.split(/\s+/).length  // e.g., 8500
citationCount = (briefingText.match(/\[\d+\]/g) || []).length  // e.g., 234

⚠️  Problem: This counts ALL [1][2][3] instances, not unique citations

sourceCount = allCitationsWithUrls.length  // e.g., 47

⚠️  Problem: This is sources COLLECTED, not sources USED

┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 7: RESPONSE ASSEMBLY                                         │
└─────────────────────────────────────────────────────────────────────┘

   ⚠️  BUG #7: Returns ALL citations, not used citations
   ↓
response = {
  ok: true,
  briefing: briefingText,
  citations: allCitationsWithUrls.map(c => c.url),  // All 47 URLs
  metadata: {
    wordCount: 8500,
    citationCount: 234,      ← Total [N] instances in text
    sourceCount: 47,         ← Total sources collected (not used!)
    researchQueriesUsed: 12
  }
}

┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 8: FRONTEND DISPLAY                                          │
└─────────────────────────────────────────────────────────────────────┘

   ⚠️  BUG #6: Misleading labels
   ↓
Display: "8,500 words | 234 citations | 47 sources"

User sees:
  - 234 citations (instances of [1][2][3])
  - 47 sources

User expects:
  - 234 citations (instances)
  - ~20-30 unique sources USED (not all 47 collected)

Result: USER IS CONFUSED!
```

---

## THE ACTUAL PROBLEM

### What's Happening:
1. **Research Stage**: Collects 47 sources from 12 queries
2. **Synthesis Stage**: AI uses maybe 15-20 of those sources
3. **Appendix**: Shows all 47 sources
4. **Metadata**: Shows 47 as "sourceCount"
5. **User Sees**: "234 citations | 47 sources" but many sources aren't cited

### What SHOULD Happen:
1. **Research Stage**: Collects 47 sources
2. **Synthesis Stage**: AI uses 20 sources
3. **Appendix**: Shows only the 20 used sources (+ optional "Additional Sources Consulted" section)
4. **Metadata**: Shows 20 as "citationsUsed" and 47 as "sourcesCollected"
5. **User Sees**: "234 citation instances | 20 unique sources cited | 47 sources researched"

---

## CITATION COUNT VS SOURCE COUNT EXPLAINED

### Example Briefing Text:
```
Treasury finalized the outbound investment rule[1][2] on October 28, 2024[1].
The rule implements EO 14105[3] and restricts investments in semiconductors[1][4].

BIOSECURE Act passed committee markup[5][6] in September[5].
```

### Counting:
- **Citation instances**: [1][2][1][3][1][4][5][6][5] = **9 instances**
- **Unique citations used**: [1][2][3][4][5][6] = **6 unique sources**
- **Sources collected**: Might be 47 total from research
- **Sources unused**: 47 - 6 = 41 sources collected but not cited

### Current Metadata Shows:
```json
{
  "citationCount": 9,      // ✓ Correct (citation instances)
  "sourceCount": 47        // ✗ WRONG (should be 6 unique sources USED)
}
```

### Correct Metadata Should Show:
```json
{
  "citationInstances": 9,           // Total [N] in text
  "uniqueSourcesCited": 6,          // Unique citation numbers used
  "sourcesCollected": 47,           // Sources from research phase
  "sourceUtilizationRate": 0.128    // 6/47 = 12.8%
}
```

---

## WHY SOURCES AREN'T BEING USED

Several possible reasons:

### 1. Perplexity Isn't Returning Citations
- `return_citations: true` may not work with sonar-pro
- Citations may be in different format than expected
- Bug #1 and #8 prevent us from knowing

### 2. Master Citation List is Incomplete
- If citations aren't extracted correctly, master list is empty or partial
- Synthesis stage gets incomplete source list
- AI has nothing to cite

### 3. AI Model Doesn't Follow Instructions
- Perplexity's synthesis doesn't use numbered citations well
- AI creates its own citations or uses wrong numbers
- AI ignores master source list

### 4. Research Content Has Wrong Citation Numbers
- Bug #3: If masterCitationMap.get() returns undefined
- Creates invalid references like [undefined]
- AI sees broken citations and ignores them

---

## VALIDATION GAPS

### Currently NO Validation For:

1. ✗ Perplexity API response structure
2. ✗ Citation extraction success
3. ✗ Master citation map completeness
4. ✗ Citation numbers in formatted research
5. ✗ Citation numbers used by AI in synthesis
6. ✗ Citation numbers are within valid range [1..N]
7. ✗ All citations have corresponding sources
8. ✗ Source utilization rate

### Should Have Validation For:

1. ✓ Every API response logged with full structure
2. ✓ Citation extraction logs count and format
3. ✓ Master map shows additions and duplicates
4. ✓ Research formatting validates citation numbers
5. ✓ Synthesis output checked for valid citations
6. ✓ Citation range validation [1..totalSources]
7. ✓ Every [N] has corresponding source in list
8. ✓ Calculate and log utilization rate (used/collected)

---

## DETECTION STRATEGY

### How to Find the Root Cause:

Add logging at each stage:

```javascript
// STAGE 1: After each research query
console.log('Research Response:', {
  querySummary: query.substring(0, 60),
  contentLength: content.length,
  citationsFound: citations.length,
  citationSample: citations.slice(0, 3),
  citationType: typeof citations[0]
});

// STAGE 2: After building master list
console.log('Master Citation Map:', {
  totalSources: allCitationsWithUrls.length,
  sampleSources: allCitationsWithUrls.slice(0, 5),
  queriesWith0Citations: researchResults.filter(r => !r.citations?.length).length
});

// STAGE 3: After formatting research
const citationNumbersInResearch = combinedResearch.match(/\[(\d+)\]/g) || [];
console.log('Research Formatting:', {
  totalCitationsInResearch: citationNumbersInResearch.length,
  uniqueCitationsInResearch: [...new Set(citationNumbersInResearch)].length,
  sampleCitations: citationNumbersInResearch.slice(0, 10)
});

// STAGE 4: After synthesis
const citationNumbersInBriefing = briefingText.match(/\[(\d+)\]/g) || [];
const citationNumbers = citationNumbersInBriefing.map(c => parseInt(c.match(/\d+/)[0]));
const uniqueCitations = [...new Set(citationNumbers)].sort((a,b) => a-b);

console.log('Synthesis Result:', {
  totalCitationInstances: citationNumbersInBriefing.length,
  uniqueCitationsUsed: uniqueCitations.length,
  citationRange: { min: Math.min(...uniqueCitations), max: Math.max(...uniqueCitations) },
  invalidCitations: uniqueCitations.filter(n => n < 1 || n > totalSources),
  utilizationRate: ((uniqueCitations.length / totalSources) * 100).toFixed(1) + '%'
});
```

This will show EXACTLY where citations are lost or corrupted.

---

## QUICK DIAGNOSTIC TEST

Add this test endpoint to verify Perplexity API behavior:

```javascript
// /api/test_perplexity_citations.js

export default async function handler(req, res) {
  const apiKey = process.env.PERPLEXITY_API_KEY;

  // Test 1: Simple query with return_citations: true
  const response1 = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'sonar-pro',
      temperature: 0.1,
      max_tokens: 500,
      return_citations: true,
      messages: [{
        role: 'user',
        content: 'What is Treasury EO 14105? Provide 3 sources.'
      }]
    })
  });

  const data1 = await response1.json();

  // Test 2: Same query with return_citations: false
  const response2 = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'sonar-pro',
      temperature: 0.1,
      max_tokens: 500,
      return_citations: false,
      messages: [{
        role: 'user',
        content: 'What is Treasury EO 14105? Provide 3 sources.'
      }]
    })
  });

  const data2 = await response2.json();

  return res.status(200).json({
    test1_with_citations: {
      hasCitations: !!data1.citations,
      citationsLocation: {
        atRoot: !!data1.citations,
        inChoices: !!data1.choices?.[0]?.citations,
        inMessage: !!data1.choices?.[0]?.message?.citations
      },
      citationCount: (data1.citations || []).length,
      citationSample: (data1.citations || [])[0],
      fullResponse: data1
    },
    test2_without_citations: {
      hasCitations: !!data2.citations,
      fullResponse: data2
    }
  });
}
```

Run this and you'll know EXACTLY how Perplexity returns citations.

---

## SUMMARY

The citation tracking issues stem from:

1. **Unknown API Behavior**: Don't know what Perplexity actually returns
2. **No Validation**: Citations flow through pipeline unchecked
3. **Wrong Metrics**: "sourceCount" means collected, not used
4. **Misleading Display**: Frontend shows wrong information

**Fix**: Add logging, validate each stage, track used vs collected sources separately.

