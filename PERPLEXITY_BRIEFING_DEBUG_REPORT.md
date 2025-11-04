# COMPREHENSIVE DEBUGGING REPORT: PERPLEXITY BRIEFING FEATURE
## Generated: 2025-11-04
## Files Analyzed: /api/generate_briefing.js, perplexity-briefing.html

---

## EXECUTIVE SUMMARY

**CRITICAL FINDING**: I have identified **8 bugs** in the Perplexity briefing generation feature, including issues with:
1. Citation extraction from Perplexity API responses
2. Master citation list construction
3. Research content formatting
4. Frontend metadata display
5. Citation number mapping inconsistencies

**Impact**: Sources are not being properly tracked or displayed, leading to incorrect citation counts and missing source lists.

---

## DETAILED BUG ANALYSIS

### 🔴 CRITICAL BUG #1: Citation Extraction Logic is Flawed
**File**: `/api/generate_briefing.js`
**Lines**: 62-70
**Severity**: CRITICAL

**Problem**:
```javascript
// Lines 62-66
const citations = data.citations ||
                 data.choices?.[0]?.citations ||
                 data.choices?.[0]?.message?.citations ||
                 [];

// Lines 69-70
const urlMatches = content.match(/https?:\/\/[^\s\)]+/g) || [];
const allCitations = [...new Set([...citations, ...urlMatches])];
```

**Why This is Broken**:

1. **Perplexity API Response Structure Unknown**: The code checks THREE possible locations for citations (`data.citations`, `data.choices[0].citations`, `data.choices[0].message.citations`) but doesn't validate if ANY of these are correct according to Perplexity's actual API documentation.

2. **Regex URL Extraction is Unreliable**: Line 69 extracts URLs from the content text using regex, but:
   - This will match URLs that appear in the response TEXT, not actual citation objects
   - URLs in markdown like `[text](url)` won't match the pattern
   - URLs followed by punctuation will include the punctuation
   - Example: `"source: https://example.com."` will capture `https://example.com.` (with period)

3. **Mixed Data Types**: `citations` could be an array of objects with metadata (title, url, etc.), but `urlMatches` is just strings. Mixing these creates inconsistent data.

4. **return_citations: true** (Line 34): This parameter may not be supported by Perplexity's `sonar-pro` model or may require a specific format.

**Expected Behavior**:
Perplexity's `sonar-pro` model with `return_citations: true` should return citations in a specific format. According to Perplexity API docs, citations are returned in the `citations` array at the root level of the response OR embedded in the message.

**Actual Behavior**:
The code doesn't know which format Perplexity actually uses, so it guesses multiple locations and falls back to regex extraction, which is error-prone.

**Fix Required**:
```javascript
// After API call, validate the actual response structure
console.log('Full Perplexity Response:', JSON.stringify(data, null, 2));

// Perplexity typically returns citations as an array of URLs at root level
const citations = Array.isArray(data.citations) ? data.citations : [];

// Don't use regex extraction - use actual citation data from API
// If citations is empty, that means Perplexity didn't find sources
if (citations.length === 0) {
  console.warn(`No citations returned for query: ${query.substring(0, 50)}`);
}

return {
  query,
  content,
  citations: citations // Array of URL strings
};
```

---

### 🔴 CRITICAL BUG #2: Master Citation Map Construction is Incomplete
**File**: `/api/generate_briefing.js`
**Lines**: 280-297
**Severity**: CRITICAL

**Problem**:
```javascript
// Lines 286-297
researchResults.forEach((result, i) => {
  console.log(`Query ${i + 1}: "${result.query.substring(0, 60)}..." - ${result.citations?.length || 0} sources`);
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
```

**Why This is Broken**:

1. **No Validation of Citation Format**: The code assumes `citation` is a string (URL), but doesn't validate this. If Perplexity returns citation objects like `{url: "...", title: "..."}`, this will fail silently.

2. **Optional Chaining Hides Failures**: Line 287 uses `result.citations?.length` which will return 0 if citations is undefined, null, or not an array. This hides the problem that citations aren't being collected properly.

3. **No Logging of Failed Citations**: If `result.citations` is empty or undefined for ANY research query, there's no clear error message explaining why.

4. **Silent Deduplication**: The `if (!masterCitationMap.has(citation))` check prevents duplicates, but doesn't log how many duplicates were found. This makes it impossible to know if deduplication is working correctly.

**Fix Required**:
```javascript
researchResults.forEach((result, i) => {
  console.log(`Query ${i + 1}: "${result.query.substring(0, 60)}..."`);

  // Validate citation structure
  if (!result.citations) {
    console.error(`  ❌ No citations property in result ${i + 1}`);
    return;
  }

  if (!Array.isArray(result.citations)) {
    console.error(`  ❌ Citations is not an array for result ${i + 1}:`, typeof result.citations);
    return;
  }

  console.log(`  📚 ${result.citations.length} citations found`);

  let newCitations = 0;
  let duplicates = 0;

  result.citations.forEach((citation) => {
    // Validate citation is a string URL
    if (typeof citation !== 'string') {
      console.warn(`  ⚠️  Citation is not a string:`, citation);
      return;
    }

    if (!masterCitationMap.has(citation)) {
      masterCitationMap.set(citation, citationIndex);
      allCitationsWithUrls.push({ number: citationIndex, url: citation });
      citationIndex++;
      newCitations++;
    } else {
      duplicates++;
    }
  });

  console.log(`  ✅ Added ${newCitations} new citations, ${duplicates} duplicates`);
});

console.log(`\n📊 Master Citation List Summary:`);
console.log(`  Total Unique Sources: ${allCitationsWithUrls.length}`);
console.log(`  Total Queries: ${researchResults.length}`);
console.log(`  Average Sources per Query: ${(allCitationsWithUrls.length / researchResults.length).toFixed(1)}`);
```

---

### 🟠 HIGH BUG #3: Research Formatting May Create Invalid Citation References
**File**: `/api/generate_briefing.js`
**Lines**: 304-312
**Severity**: HIGH

**Problem**:
```javascript
const combinedResearch = researchResults
  .filter(r => r.content && r.content.length > 100)
  .map((r, i) => {
    const sourcesText = r.citations && r.citations.length > 0
      ? r.citations.map(c => `[${masterCitationMap.get(c)}] ${c}`).join('\n')
      : 'No sources found';

    return `### Research Area ${i + 1}: ${r.query}\n\n${r.content}\n\n**Sources:**\n${sourcesText}`;
  }).join('\n\n---\n\n');
```

**Why This is Broken**:

1. **masterCitationMap.get(c) Can Return undefined**: If a citation `c` wasn't added to the map (due to earlier bugs), `masterCitationMap.get(c)` returns `undefined`, creating invalid references like `[undefined] https://example.com`.

2. **Filter Changes Index**: Line 305 filters results, but line 306 uses `(r, i)` for numbering. This means "Research Area 1" might actually be the 3rd query if the first two were filtered out. This is confusing.

3. **No Validation of masterCitationMap**: The code assumes every citation in `r.citations` exists in `masterCitationMap`, but doesn't validate this assumption.

4. **Content Length Check is Arbitrary**: Filtering `r.content.length > 100` could exclude legitimate research results that have few sources but are important. This threshold should be 0 or have a clear reason.

**Fix Required**:
```javascript
const combinedResearch = researchResults
  .map((r, originalIndex) => {
    // Keep original query index for debugging
    const queryNum = originalIndex + 1;

    // Skip if no meaningful content
    if (!r.content || r.content.trim().length === 0) {
      console.warn(`⚠️  Query ${queryNum} has no content, skipping`);
      return null;
    }

    // Validate citations exist in master map
    const sourcesText = r.citations && r.citations.length > 0
      ? r.citations.map(c => {
          const citationNum = masterCitationMap.get(c);
          if (citationNum === undefined) {
            console.error(`❌ Citation not in master map: ${c}`);
            return `[ERROR] ${c}`;
          }
          return `[${citationNum}] ${c}`;
        }).join('\n')
      : 'No sources found';

    return `### Research Area ${queryNum}: ${r.query}\n\n${r.content}\n\n**Sources:**\n${sourcesText}`;
  })
  .filter(Boolean) // Remove null entries
  .join('\n\n---\n\n');

console.log(`📝 Combined research: ${combinedResearch.length} chars from ${researchResults.length} queries`);
```

---

### 🟠 HIGH BUG #4: Synthesis Stage Doesn't Use Master Citation List Correctly
**File**: `/api/generate_briefing.js`
**Lines**: 145-155
**Severity**: HIGH

**Problem**:
```javascript
const userMessage = `Using the research conducted below, create a comprehensive weekly HSG national security policy briefing for ${dateRange.startDate} to ${dateRange.endDate}.

IMPORTANT CITATION INSTRUCTIONS:
- You have ${totalSources} sources available (numbered [1] through [${totalSources}])
- EVERY factual claim, policy detail, date, or statistic MUST include citations
- Use citations like this: "Treasury finalized the rule[1][2]" or "effective January 2, 2025[3]"
- Aim for 3-5 citations per paragraph
- The more citations, the better

MASTER SOURCE LIST (${totalSources} total):
${allCitationsWithUrls.map(c => `[${c.number}] ${c.url}`).join('\n')}
```

**Why This is a Problem**:

1. **AI Model May Not Follow Citation Numbers**: Perplexity's synthesis stage uses `sonar-pro` model with `return_citations: false` (line 217). The model is being asked to use specific numbered citations [1][2][3], but:
   - The model hasn't seen these numbered citations during research
   - The model is synthesizing from the research TEXT, not the citation list
   - The model may create its own citations or ignore the numbered list entirely

2. **No Validation of Citation Usage**: After synthesis, the code counts citation instances (line 333) but doesn't verify:
   - Are the citation numbers valid (within [1] to [totalSources])?
   - Do all citation numbers correspond to actual sources?
   - Are there citations like [99] when only 50 sources exist?

3. **Research Content Already Has Different Citation Numbers**: In the `combinedResearch` string passed to synthesis, each research area has its own citation numbers from the master list. But the AI model might create NEW citation numbers or reuse them incorrectly.

**Why This Causes User's Issue**:
The synthesis stage may generate citations that don't correspond to real sources, or it may not use the master citation list at all. This explains why the user sees incorrect citation counts vs source counts.

**Fix Required**:
```javascript
// After synthesis completes
const briefingText = data.choices[0].message.content;

// VALIDATE all citations in briefing are valid
const citationMatches = briefingText.match(/\[(\d+)\]/g) || [];
const citationNumbers = citationMatches.map(m => parseInt(m.match(/\d+/)[0]));
const uniqueCitations = [...new Set(citationNumbers)];

console.log(`📊 Citation Analysis:`);
console.log(`  Total citation instances: ${citationMatches.length}`);
console.log(`  Unique citation numbers used: ${uniqueCitations.length}`);
console.log(`  Available sources: ${totalSources}`);

// Find invalid citations
const invalidCitations = uniqueCitations.filter(num => num < 1 || num > totalSources);
if (invalidCitations.length > 0) {
  console.error(`❌ Invalid citation numbers found: ${invalidCitations.join(', ')}`);
  console.error(`   These citations reference sources that don't exist!`);
}

// Find unused sources
const usedCitations = new Set(uniqueCitations);
const unusedSources = allCitationsWithUrls
  .filter(c => !usedCitations.has(c.number))
  .map(c => c.number);

if (unusedSources.length > 0) {
  console.warn(`⚠️  ${unusedSources.length} sources were collected but not cited in briefing`);
  console.warn(`   Unused source numbers: ${unusedSources.slice(0, 10).join(', ')}${unusedSources.length > 10 ? '...' : ''}`);
}
```

---

### 🟠 HIGH BUG #5: Sources Appendix May Not Match Citations Used
**File**: `/api/generate_briefing.js`
**Lines**: 234-243
**Severity**: HIGH

**Problem**:
```javascript
const sourcesAppendix = `

---

## SOURCES CITED

${allCitationsWithUrls.map(c => `[${c.number}] ${c.url}`).join('\n')}
`;

briefingText = briefingText + sourcesAppendix;
```

**Why This is a Problem**:

1. **Lists ALL Sources Collected, Not Sources Actually Used**: The appendix shows `allCitationsWithUrls` (every source from research stage), but the briefing text may only use a subset of these sources.

2. **No Correspondence Check**: There's no validation that:
   - Every citation [1] to [N] used in the briefing appears in the sources list
   - Every source in the list is actually cited in the briefing

3. **Creates Misleading Source Count**: If the briefing uses citations [1][2][5][10] but the source list shows [1] through [50], the user sees 50 sources but only 4 are actually referenced.

**This is Likely the Root Cause of User's Issue**: User reports "citation count vs source count" discrepancies. This is because:
- `sourceCount` = total sources collected from research (50+)
- `citationCount` = citation instances in text [1][2][3]
- But many collected sources are never cited in the final briefing

**Fix Required**:
```javascript
// Before appending sources
const citationMatches = briefingText.match(/\[(\d+)\]/g) || [];
const citationNumbers = [...new Set(
  citationMatches.map(m => parseInt(m.match(/\d+/)[0]))
)].sort((a, b) => a - b);

// Only include sources that are actually cited
const citedSources = allCitationsWithUrls.filter(c =>
  citationNumbers.includes(c.number)
);

console.log(`📚 Source Appendix:`);
console.log(`  Total sources collected: ${allCitationsWithUrls.length}`);
console.log(`  Sources actually cited: ${citedSources.length}`);
console.log(`  Utilization rate: ${((citedSources.length / allCitationsWithUrls.length) * 100).toFixed(1)}%`);

const sourcesAppendix = `

---

## SOURCES CITED

${citedSources.length > 0
  ? citedSources.map(c => `[${c.number}] ${c.url}`).join('\n')
  : 'No sources cited (this is an error - briefing should have citations)'
}

---

## ADDITIONAL SOURCES CONSULTED (NOT CITED)

${allCitationsWithUrls.filter(c => !citationNumbers.includes(c.number))
  .map(c => `${c.url}`).join('\n')}
`;

briefingText = briefingText + sourcesAppendix;
```

---

### 🟡 MEDIUM BUG #6: Frontend Metadata Display Shows Wrong Information
**File**: `perplexity-briefing.html`
**Lines**: 196-200
**Severity**: MEDIUM

**Problem**:
```javascript
document.getElementById('briefing-meta').innerHTML = `
  <div>Coverage: ${data.startDate} – ${data.endDate}</div>
  <div>Generated: ${new Date(data.generatedAt).toLocaleString('en-US')}</div>
  ${meta.wordCount ? `<div style="margin-top:8px">📊 ${meta.wordCount.toLocaleString()} words | ${meta.citationCount} citations | ${meta.sourceCount} sources | ${meta.generationTimeSeconds}s</div>` : ''}
`;
```

**Why This is Misleading**:

1. **Citations vs Sources Confusion**: Shows `${meta.citationCount} citations | ${meta.sourceCount} sources` but doesn't explain what the difference is:
   - `citationCount` = total [1][2][3] instances in text (can be hundreds)
   - `sourceCount` = unique sources collected (50+)
   - But user expects `sourceCount` = number of unique citations USED, not collected

2. **No Validation**: If `meta.citationCount` is 0 or `meta.sourceCount` is 0, it still displays without warning the user that something went wrong.

3. **Misleading "Sources" Label**: "sources" suggests "unique sources cited" but actually means "sources collected during research phase".

**Fix Required**:
```javascript
// Better metadata display
const citationStats = meta.citationCount && meta.sourceCount
  ? `📊 ${meta.wordCount.toLocaleString()} words | ${meta.citationCount} citation instances | ${meta.sourceCount} unique sources researched | ${meta.generationTimeSeconds}s`
  : '⚠️ Metadata incomplete';

document.getElementById('briefing-meta').innerHTML = `
  <div>Coverage: ${data.startDate} – ${data.endDate}</div>
  <div>Generated: ${new Date(data.generatedAt).toLocaleString('en-US')}</div>
  ${meta.wordCount ? `<div style="margin-top:8px">${citationStats}</div>` : ''}
  ${meta.citationCount === 0 ? '<div style="color:red">⚠️ Warning: No citations found in briefing</div>' : ''}
`;
```

---

### 🟡 MEDIUM BUG #7: Return Value `citations` Array is Wrong
**File**: `/api/generate_briefing.js`
**Lines**: 374-378
**Severity**: MEDIUM

**Problem**:
```javascript
return res.status(200).json({
  ok: true,
  briefing: briefingWithMetadata,
  citations: synthesis.allCitations,  // ← This is ALL sources collected
  startDate: startDate,
  endDate: endDate,
```

**Why This is Wrong**:

1. **`synthesis.allCitations`** (line 247) is defined as `allCitationsWithUrls.map(c => c.url)` - this is the full list of ALL sources from research, not the sources actually cited in the briefing.

2. **Frontend Doesn't Use This Data**: The frontend (perplexity-briefing.html) receives `data.citations` but never displays it. This suggests the frontend was expecting citation data but the implementation is incomplete.

3. **Inconsistent with metadata.sourceCount**: Line 384 correctly uses `allCitationsWithUrls.length` for sourceCount, but then returns ALL citations in the citations array without filtering to used citations.

**Fix Required**:
```javascript
// After synthesis, extract ACTUALLY USED citations
const citationMatches = synthesis.briefing.match(/\[(\d+)\]/g) || [];
const usedCitationNumbers = [...new Set(
  citationMatches.map(m => parseInt(m.match(/\d+/)[0]))
)];

const usedCitations = allCitationsWithUrls
  .filter(c => usedCitationNumbers.includes(c.number))
  .map(c => c.url);

console.log(`📤 Returning response:`);
console.log(`  Briefing length: ${briefingWithMetadata.length} chars`);
console.log(`  Citations used: ${usedCitations.length}`);
console.log(`  Sources collected: ${allCitationsWithUrls.length}`);

return res.status(200).json({
  ok: true,
  briefing: briefingWithMetadata,
  citations: usedCitations,  // Only citations actually used
  allSourcesCollected: allCitationsWithUrls.map(c => c.url),  // For reference
  startDate: startDate,
  endDate: endDate,
  generatedAt: new Date().toISOString(),
  metadata: {
    wordCount,
    citationCount,
    citationsUsed: usedCitations.length,  // New field
    sourcesCollected: allCitationsWithUrls.length,  // Renamed for clarity
    researchQueriesUsed: synthesis.researchCount,
    generationTimeSeconds: parseFloat(totalTime),
    qualityChecks: {
      sufficientLength: wordCount >= 5000,
      adequateCitations: citationCount >= 50,
      diverseSources: allCitationsWithUrls.length >= 30,
      goodCitationUtilization: usedCitations.length >= (allCitationsWithUrls.length * 0.5)  // New check
    }
  }
});
```

---

### 🟡 MEDIUM BUG #8: No Logging of Perplexity API Response Structure
**File**: `/api/generate_briefing.js`
**Lines**: 53-81
**Severity**: MEDIUM

**Problem**: The `conductResearch` function doesn't log the actual Perplexity API response structure. This makes debugging impossible.

**Why This is Critical for Debugging**:

1. **We Don't Know What Perplexity Returns**: The code guesses where citations are in the response (lines 62-66) but never logs what Perplexity ACTUALLY returns.

2. **Can't Verify return_citations Works**: Line 34 sets `return_citations: true` but we have no way to verify this parameter is respected by Perplexity.

3. **Can't Debug Citation Extraction**: If citations aren't being extracted, we can't tell if it's because:
   - Perplexity isn't returning them
   - They're in a different location than expected
   - The data structure is different than assumed

**Fix Required**:
```javascript
const data = await response.json();

// LOG THE FULL RESPONSE for debugging (only in development/first run)
console.log(`\n${'='.repeat(80)}`);
console.log(`PERPLEXITY API RESPONSE for "${query.substring(0, 40)}..."`);
console.log(`${'='.repeat(80)}`);
console.log(JSON.stringify(data, null, 2));
console.log(`${'='.repeat(80)}\n`);

const content = data.choices?.[0]?.message?.content || '';

// Check ALL possible citation locations with logging
const citationsAtRoot = data.citations;
const citationsInChoice = data.choices?.[0]?.citations;
const citationsInMessage = data.choices?.[0]?.message?.citations;

console.log(`Citation locations check:`);
console.log(`  data.citations: ${citationsAtRoot ? `${citationsAtRoot.length} items` : 'not present'}`);
console.log(`  data.choices[0].citations: ${citationsInChoice ? `${citationsInChoice.length} items` : 'not present'}`);
console.log(`  data.choices[0].message.citations: ${citationsInMessage ? `${citationsInMessage.length} items` : 'not present'}`);

const citations = citationsAtRoot || citationsInChoice || citationsInMessage || [];

if (Array.isArray(citations) && citations.length > 0) {
  console.log(`  ✅ Found ${citations.length} citations`);
  console.log(`  Sample citation structure:`, citations[0]);
} else {
  console.warn(`  ⚠️  No citations found in any location`);
}
```

---

## ROOT CAUSE ANALYSIS

After analyzing all bugs, here's what's actually happening:

### The Citation Tracking Problem

1. **Research Stage** (conductResearch):
   - ❌ Citations may not be extracted correctly from Perplexity API (Bug #1)
   - ❌ No validation of citation format (Bug #2, #8)
   - Result: May have 0 sources when we should have 50+

2. **Master Citation List Construction**:
   - ❌ No validation that citations are strings (Bug #2)
   - ❌ Silent failures when citations are missing (Bug #2)
   - Result: Master list may be incomplete or empty

3. **Synthesis Stage**:
   - ❌ AI model may not use numbered citations correctly (Bug #4)
   - ❌ No validation of citation usage (Bug #4)
   - Result: Briefing may have invalid citations or none at all

4. **Response Assembly**:
   - ❌ Sources appendix shows ALL collected sources, not used sources (Bug #5)
   - ❌ Return value shows ALL sources, not used sources (Bug #7)
   - ❌ Frontend displays misleading metrics (Bug #6)
   - Result: User sees mismatch between citation count and source count

### Why User Hasn't Seen This Before

The bugs are systematic and affect EVERY run, but they're hidden by:
- No detailed logging of API responses
- No validation of intermediate steps
- Misleading success indicators (high word count, presence of citations)
- Frontend showing "sources" when it means "sources collected not used"

---

## RECOMMENDED FIXES (Priority Order)

### 1. IMMEDIATE FIX: Add Comprehensive Logging
Add detailed logging throughout the pipeline to see what's actually happening:
- Log full Perplexity API responses
- Log master citation list construction
- Log citation validation
- Log sources used vs collected

### 2. HIGH PRIORITY: Fix Citation Extraction
- Remove regex URL extraction
- Validate Perplexity API response structure
- Confirm `return_citations: true` works with sonar-pro
- Add error handling for missing citations

### 3. HIGH PRIORITY: Validate Citation Usage
- After synthesis, verify all citation numbers are valid
- Track which sources are actually used
- Update source appendix to show only used sources
- Add quality check for citation utilization rate

### 4. MEDIUM PRIORITY: Fix Frontend Display
- Change "sources" label to "sources researched"
- Show "citations used" vs "sources collected"
- Add warning if no citations found
- Display citation utilization rate

### 5. LONG TERM: Consider Alternative Approach
The current approach of asking Perplexity to use numbered citations from a master list may be fundamentally flawed. Consider:
- Using Perplexity's native citation format
- Post-processing to map Perplexity's citations to a numbered list
- Using a different AI model for synthesis that better handles structured citations

---

## ADDITIONAL CONCERNS

### Perplexity API Documentation
I notice the code doesn't reference Perplexity's official API documentation. Key questions:
1. Does `sonar-pro` model support `return_citations: true`?
2. What format do citations come in (strings, objects, both)?
3. Is `search_domain_filter` working as expected?
4. Are there rate limits that could affect parallel research?

### Vercel Function Timeout
- `maxDuration: 300` (5 minutes) is set
- But 12 parallel API calls + synthesis could take longer
- No handling of timeout errors
- Consider breaking into multiple functions or using queue

### Error Recovery
- If one research query fails, the entire briefing continues
- But that query's sources are lost
- No way to retry failed queries
- No indication to user that some research failed

### Cost Concerns
- 12 research queries @ 4000 tokens each = ~48,000 tokens input
- 1 synthesis query @ 16,000 tokens max output
- No cost tracking or budgeting
- Could be expensive at scale

---

## TESTING RECOMMENDATIONS

### 1. API Response Validation Test
```javascript
// Add this as a test endpoint
export default async function handler(req, res) {
  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'sonar-pro',
      temperature: 0.1,
      max_tokens: 1000,
      return_citations: true,
      search_recency_filter: 'month',
      search_domain_filter: ['gov'],
      messages: [{
        role: 'user',
        content: 'What is the Treasury outbound investment rule EO 14105? Provide 5 sources.'
      }]
    })
  });

  const data = await response.json();

  return res.status(200).json({
    fullResponse: data,
    citationsAtRoot: data.citations,
    citationsInChoices: data.choices?.[0]?.citations,
    citationsInMessage: data.choices?.[0]?.message?.citations,
    analysis: {
      hasCitations: !!data.citations,
      citationCount: data.citations?.length || 0,
      citationType: typeof data.citations?.[0]
    }
  });
}
```

### 2. Citation Usage Validation Test
After generating a briefing:
1. Extract all citation numbers [N] from text
2. Verify each N is between 1 and sourceCount
3. Check for unused sources
4. Calculate utilization rate

### 3. End-to-End Test
Run briefing generation with extensive logging and:
1. Save all API responses to file
2. Save intermediate data structures
3. Track citation numbers through entire pipeline
4. Generate detailed report of sources collected vs used

---

## CONCLUSION

The Perplexity briefing feature has **8 significant bugs** that compound to create the citation tracking issue. The problems are:

1. **Citation Extraction** - May not be working at all
2. **Master List Construction** - Lacks validation
3. **Research Formatting** - Could create invalid references
4. **Synthesis** - AI may not follow citation instructions
5. **Sources Appendix** - Shows all sources, not used sources
6. **Frontend Display** - Misleading labels
7. **Return Value** - Wrong citation array
8. **Logging** - Insufficient for debugging

**Most Critical**: Bug #1 (citation extraction) is likely the root cause. If citations aren't being extracted from Perplexity API responses, everything downstream fails silently.

**Recommended Next Steps**:
1. Add comprehensive logging immediately
2. Run a test query and examine the FULL Perplexity API response
3. Verify the API actually returns citations in the expected format
4. Fix citation extraction based on actual API behavior
5. Add validation at every step

The good news: These are all fixable issues. The bad news: They require careful debugging to understand what Perplexity is actually returning.

