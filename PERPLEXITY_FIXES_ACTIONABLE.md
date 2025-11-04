# ACTIONABLE FIXES FOR PERPLEXITY BRIEFING FEATURE
## Immediate Steps to Resolve Citation Tracking Issues

---

## PRIORITY 1: ADD COMPREHENSIVE LOGGING (15 minutes)

This will reveal exactly where citations are lost. Do this FIRST before any other fixes.

### Step 1.1: Add Research Stage Logging

**File**: `/api/generate_briefing.js`
**Lines**: 59-81
**Action**: Replace the `conductResearch` function's return section with:

```javascript
const data = await response.json();

// ⭐ NEW: Log full API response (for debugging)
console.log(`\n${'═'.repeat(80)}`);
console.log(`📡 PERPLEXITY RESPONSE: "${query.substring(0, 50)}..."`);
console.log(`${'═'.repeat(80)}`);
console.log('Full response structure:', JSON.stringify(data, null, 2));

const content = data.choices?.[0]?.message?.content || '';

// ⭐ NEW: Check ALL possible citation locations with detailed logging
const citationsAtRoot = data.citations;
const citationsInChoice = data.choices?.[0]?.citations;
const citationsInMessage = data.choices?.[0]?.message?.citations;

console.log('\n🔍 Citation Location Analysis:');
console.log(`  • data.citations: ${citationsAtRoot ? `✓ ${citationsAtRoot.length} items` : '✗ not present'}`);
console.log(`  • data.choices[0].citations: ${citationsInChoice ? `✓ ${citationsInChoice.length} items` : '✗ not present'}`);
console.log(`  • data.choices[0].message.citations: ${citationsInMessage ? `✓ ${citationsInMessage.length} items` : '✗ not present'}`);

// Use the first available citation array
const citations = citationsAtRoot || citationsInChoice || citationsInMessage || [];

if (Array.isArray(citations) && citations.length > 0) {
  console.log(`\n✅ Found ${citations.length} citations`);
  console.log('  Sample citation type:', typeof citations[0]);
  console.log('  Sample citation:', JSON.stringify(citations[0], null, 2));
} else {
  console.warn(`\n⚠️  WARNING: No citations found for query!`);
}

// ⭐ REMOVED: Don't use regex extraction - only use API citations
// const urlMatches = content.match(/https?:\/\/[^\s\)]+/g) || [];
// const allCitations = [...new Set([...citations, ...urlMatches])];

console.log(`\n📊 Research Complete:`);
console.log(`  • Content: ${content.length} chars`);
console.log(`  • Citations: ${citations.length} sources`);
console.log(`${'═'.repeat(80)}\n`);

return {
  query,
  content,
  citations: citations  // Array of URLs from API only
};
```

### Step 1.2: Add Master List Construction Logging

**File**: `/api/generate_briefing.js`
**Lines**: 286-297
**Action**: Replace with:

```javascript
console.log('\n' + '═'.repeat(80));
console.log('📚 BUILDING MASTER CITATION LIST');
console.log('═'.repeat(80));

researchResults.forEach((result, i) => {
  const queryNum = i + 1;
  console.log(`\nQuery ${queryNum}: "${result.query.substring(0, 60)}..."`);

  // ⭐ NEW: Validate citation structure
  if (!result.citations) {
    console.error(`  ❌ No citations property`);
    return;
  }

  if (!Array.isArray(result.citations)) {
    console.error(`  ❌ Citations is not an array: ${typeof result.citations}`);
    return;
  }

  console.log(`  📖 ${result.citations.length} citations found`);

  let newCitations = 0;
  let duplicates = 0;
  let invalidCitations = 0;

  result.citations.forEach((citation) => {
    // ⭐ NEW: Validate citation is a string URL
    if (typeof citation !== 'string') {
      console.warn(`  ⚠️  Invalid citation type (${typeof citation}):`, citation);
      invalidCitations++;
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

  console.log(`  ✅ Added: ${newCitations} new | Duplicates: ${duplicates} | Invalid: ${invalidCitations}`);
});

const totalSources = allCitationsWithUrls.length;
console.log(`\n${'═'.repeat(80)}`);
console.log('📊 MASTER CITATION LIST SUMMARY');
console.log(`${'═'.repeat(80)}`);
console.log(`  Total Unique Sources: ${totalSources}`);
console.log(`  Total Queries: ${researchResults.length}`);
console.log(`  Average per Query: ${(totalSources / researchResults.length).toFixed(1)}`);
console.log(`  Sample Sources:`);
allCitationsWithUrls.slice(0, 5).forEach(c => {
  console.log(`    [${c.number}] ${c.url}`);
});
console.log(`${'═'.repeat(80)}\n`);
```

### Step 1.3: Add Synthesis Validation Logging

**File**: `/api/generate_briefing.js`
**Lines**: 230-249
**Action**: Insert BEFORE `return` statement:

```javascript
const data = await response.json();
let briefingText = data.choices[0].message.content;

// ⭐ NEW: Validate citation usage in synthesized briefing
console.log('\n' + '═'.repeat(80));
console.log('🔍 CITATION VALIDATION IN SYNTHESIZED BRIEFING');
console.log('═'.repeat(80));

const citationMatches = briefingText.match(/\[(\d+)\]/g) || [];
const citationNumbers = citationMatches.map(m => parseInt(m.match(/\d+/)[0]));
const uniqueCitations = [...new Set(citationNumbers)].sort((a, b) => a - b);

console.log(`\n📊 Citation Usage Statistics:`);
console.log(`  Total Citation Instances: ${citationMatches.length}`);
console.log(`  Unique Citations Used: ${uniqueCitations.length}`);
console.log(`  Available Sources: ${totalSources}`);
console.log(`  Utilization Rate: ${((uniqueCitations.length / totalSources) * 100).toFixed(1)}%`);

// ⭐ NEW: Find invalid citations (out of range)
const invalidCitations = uniqueCitations.filter(num => num < 1 || num > totalSources);
if (invalidCitations.length > 0) {
  console.error(`\n❌ INVALID CITATION NUMBERS FOUND:`);
  console.error(`  ${invalidCitations.join(', ')}`);
  console.error(`  These citations reference sources that don't exist!`);
  console.error(`  Valid range: [1..${totalSources}]`);
}

// ⭐ NEW: Find unused sources
const usedCitationSet = new Set(uniqueCitations);
const unusedSources = allCitationsWithUrls
  .filter(c => !usedCitationSet.has(c.number))
  .map(c => c.number);

if (unusedSources.length > 0) {
  console.warn(`\n⚠️  ${unusedSources.length} sources collected but NOT cited in briefing`);
  console.warn(`  Unused: [${unusedSources.slice(0, 20).join(', ')}]${unusedSources.length > 20 ? '...' : ''}`);
}

console.log(`\n✅ Citation Usage by Number:`);
const citationCounts = {};
citationNumbers.forEach(n => citationCounts[n] = (citationCounts[n] || 0) + 1);
const topCitations = Object.entries(citationCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10);
console.log(`  Top 10 most cited sources:`);
topCitations.forEach(([num, count]) => {
  const url = allCitationsWithUrls.find(c => c.number === parseInt(num))?.url || 'unknown';
  console.log(`    [${num}] cited ${count}x - ${url.substring(0, 60)}...`);
});
console.log(`${'═'.repeat(80)}\n`);

// Continue with existing code...
```

---

## PRIORITY 2: FIX SOURCES APPENDIX (10 minutes)

Only show sources that are ACTUALLY CITED in the briefing.

### Step 2.1: Update Sources Appendix Generation

**File**: `/api/generate_briefing.js`
**Lines**: 234-243
**Action**: Replace with:

```javascript
// ⭐ NEW: Build sources appendix with only USED sources
const citationMatches = briefingText.match(/\[(\d+)\]/g) || [];
const usedCitationNumbers = [...new Set(
  citationMatches.map(m => parseInt(m.match(/\d+/)[0]))
)].sort((a, b) => a - b);

const usedSources = allCitationsWithUrls.filter(c =>
  usedCitationNumbers.includes(c.number)
);

const unusedSources = allCitationsWithUrls.filter(c =>
  !usedCitationNumbers.includes(c.number)
);

console.log(`\n📚 Building Sources Appendix:`);
console.log(`  Sources Cited: ${usedSources.length}`);
console.log(`  Sources Unused: ${unusedSources.length}`);

const sourcesAppendix = `

---

## SOURCES CITED

${usedSources.length > 0
  ? usedSources.map(c => `[${c.number}] ${c.url}`).join('\n')
  : '⚠️ ERROR: No sources cited in briefing'
}

${unusedSources.length > 0 ? `
---

## ADDITIONAL SOURCES CONSULTED

The following sources were researched but not directly cited in this briefing:

${unusedSources.map(c => `• ${c.url}`).join('\n')}
` : ''}
`;

briefingText = briefingText + sourcesAppendix;
```

---

## PRIORITY 3: FIX METADATA (5 minutes)

Show accurate metrics: used vs collected sources.

### Step 3.1: Update Metadata Calculation

**File**: `/api/generate_briefing.js`
**Lines**: 374-393
**Action**: Replace with:

```javascript
// ⭐ NEW: Calculate accurate citation metrics
const citationMatches = briefingWithMetadata.match(/\[(\d+)\]/g) || [];
const citationNumbers = citationMatches.map(m => parseInt(m.match(/\d+/)[0]));
const uniqueCitationsUsed = [...new Set(citationNumbers)].length;

return res.status(200).json({
  ok: true,
  briefing: briefingWithMetadata,
  citations: allCitationsWithUrls
    .filter(c => citationNumbers.includes(c.number))
    .map(c => c.url),  // ⭐ Only return USED citations
  allSourcesCollected: allCitationsWithUrls.map(c => c.url),  // For reference
  startDate: startDate,
  endDate: endDate,
  generatedAt: new Date().toISOString(),
  metadata: {
    wordCount,
    citationInstances: citationMatches.length,      // ⭐ Renamed for clarity
    uniqueSourcesCited: uniqueCitationsUsed,        // ⭐ NEW: Actual sources used
    sourcesCollected: allCitationsWithUrls.length,  // ⭐ Renamed from sourceCount
    researchQueriesUsed: synthesis.researchCount,
    generationTimeSeconds: parseFloat(totalTime),
    qualityChecks: {
      sufficientLength: wordCount >= 5000,
      adequateCitations: citationMatches.length >= 50,
      diverseSources: uniqueCitationsUsed >= 20,     // ⭐ Check used, not collected
      goodUtilization: uniqueCitationsUsed >= (allCitationsWithUrls.length * 0.4)  // ⭐ NEW
    }
  }
});
```

---

## PRIORITY 4: FIX FRONTEND DISPLAY (5 minutes)

Show clear, accurate metrics to user.

### Step 4.1: Update Frontend Metadata Display

**File**: `perplexity-briefing.html`
**Lines**: 196-200
**Action**: Replace with:

```javascript
// ⭐ NEW: Display accurate and clear metrics
const meta = data.metadata || {};

let metadataHTML = '';
if (meta.wordCount) {
  const citationStats = [
    `${meta.wordCount.toLocaleString()} words`,
    `${meta.citationInstances || meta.citationCount || 0} citation instances`,
    `${meta.uniqueSourcesCited || 0} unique sources cited`,
    `${meta.sourcesCollected || meta.sourceCount || 0} sources researched`,
    `${meta.generationTimeSeconds}s generation time`
  ].join(' | ');

  metadataHTML = `<div style="margin-top:8px">📊 ${citationStats}</div>`;

  // ⭐ NEW: Show warnings for quality issues
  if (meta.citationInstances === 0 || meta.uniqueSourcesCited === 0) {
    metadataHTML += '<div style="color:#d32f2f;margin-top:8px">⚠️ Warning: No citations found in briefing</div>';
  } else if (meta.uniqueSourcesCited < 20) {
    metadataHTML += '<div style="color:#f57c00;margin-top:8px">⚠️ Warning: Low source diversity</div>';
  }

  // ⭐ NEW: Show utilization rate
  if (meta.uniqueSourcesCited && meta.sourcesCollected) {
    const utilizationRate = ((meta.uniqueSourcesCited / meta.sourcesCollected) * 100).toFixed(0);
    metadataHTML += `<div style="color:#666;margin-top:8px;font-size:12px">Source utilization: ${utilizationRate}% (${meta.uniqueSourcesCited}/${meta.sourcesCollected} sources used)</div>`;
  }
}

document.getElementById('briefing-meta').innerHTML = `
  <div>Coverage: ${data.startDate} – ${data.endDate}</div>
  <div>Generated: ${new Date(data.generatedAt).toLocaleString('en-US')}</div>
  ${metadataHTML}
`;
```

---

## PRIORITY 5: CREATE DIAGNOSTIC TEST ENDPOINT (10 minutes)

Create a test endpoint to verify Perplexity API behavior.

### Step 5.1: Create Test File

**File**: `/api/test_perplexity_citations.js` (NEW FILE)
**Action**: Create this file:

```javascript
// Test endpoint to verify Perplexity API citation behavior
export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  const apiKey = process.env.PERPLEXITY_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'PERPLEXITY_API_KEY not configured' });
  }

  console.log('🧪 Testing Perplexity API Citation Behavior...');

  try {
    // Test 1: With return_citations: true
    console.log('\n📡 Test 1: return_citations: true');
    const response1 = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar-pro',
        temperature: 0.1,
        max_tokens: 1000,
        return_citations: true,
        search_recency_filter: 'month',
        search_domain_filter: ['gov', 'edu'],
        messages: [{
          role: 'user',
          content: 'What is the Treasury Department outbound investment rule EO 14105? Provide 5 authoritative sources with specific details.'
        }]
      })
    });

    const data1 = await response1.json();

    console.log('Response 1 structure:', {
      hasCitations: !!data1.citations,
      citationsLocation: {
        atRoot: !!data1.citations,
        inChoices: !!data1.choices?.[0]?.citations,
        inMessage: !!data1.choices?.[0]?.message?.citations
      }
    });

    // Test 2: Without return_citations
    console.log('\n📡 Test 2: return_citations: false');
    const response2 = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar-pro',
        temperature: 0.1,
        max_tokens: 1000,
        return_citations: false,
        messages: [{
          role: 'user',
          content: 'What is the Treasury Department outbound investment rule EO 14105? Provide 5 authoritative sources with specific details.'
        }]
      })
    });

    const data2 = await response2.json();

    console.log('Response 2 structure:', {
      hasCitations: !!data2.citations
    });

    // Build comprehensive analysis
    const analysis = {
      test1_with_return_citations: {
        requestParams: {
          model: 'sonar-pro',
          return_citations: true,
          search_recency_filter: 'month',
          search_domain_filter: ['gov', 'edu']
        },
        responseStructure: {
          hasCitationsAtRoot: !!data1.citations,
          hasCitationsInChoices: !!data1.choices?.[0]?.citations,
          hasCitationsInMessage: !!data1.choices?.[0]?.message?.citations,
          citationCountAtRoot: (data1.citations || []).length,
          citationTypeAtRoot: typeof (data1.citations || [])[0],
          sampleCitationAtRoot: (data1.citations || [])[0]
        },
        fullResponse: data1
      },
      test2_without_return_citations: {
        requestParams: {
          model: 'sonar-pro',
          return_citations: false
        },
        responseStructure: {
          hasCitations: !!data2.citations
        },
        fullResponse: data2
      },
      conclusion: {
        doesReturnCitationsWork: !!(data1.citations && data1.citations.length > 0),
        citationLocation: data1.citations ? 'root' :
                         data1.choices?.[0]?.citations ? 'choices[0]' :
                         data1.choices?.[0]?.message?.citations ? 'message' : 'none',
        recommendedExtractionMethod: data1.citations ? 'data.citations' :
                                     data1.choices?.[0]?.citations ? 'data.choices[0].citations' :
                                     data1.choices?.[0]?.message?.citations ? 'data.choices[0].message.citations' :
                                     'NONE_FOUND'
      }
    };

    return res.status(200).json(analysis);

  } catch (error) {
    console.error('Test failed:', error);
    return res.status(500).json({
      error: error.message,
      stack: error.stack
    });
  }
}
```

### Step 5.2: Run the Test

```bash
# Deploy to Vercel or run locally
vercel dev

# Then visit:
# http://localhost:3000/api/test_perplexity_citations
```

This will show you EXACTLY how Perplexity returns citations.

---

## TESTING PROCEDURE

### Step 1: Deploy All Fixes
```bash
git add .
git commit -m "Add comprehensive logging and fix citation tracking"
git push
# Or: vercel --prod
```

### Step 2: Run Diagnostic Test
1. Visit `/api/test_perplexity_citations`
2. Examine the full response structure
3. Confirm where citations are located
4. Verify `return_citations: true` works

### Step 3: Generate Test Briefing
1. Visit `/perplexity-briefing.html`
2. Click "Generate Weekly Briefing"
3. Wait for completion (2-5 minutes)
4. Check browser console for new logging output
5. Check Vercel logs for detailed citation tracking

### Step 4: Analyze Logs
Look for these in Vercel function logs:

```
📡 PERPLEXITY RESPONSE: "Treasury Department outbound investment..."
═══════════════════════════════════════════════════════════════════════
Full response structure: { ... }

🔍 Citation Location Analysis:
  • data.citations: ✓ 8 items
  • data.choices[0].citations: ✗ not present
  • data.choices[0].message.citations: ✗ not present

📚 BUILDING MASTER CITATION LIST
═══════════════════════════════════════════════════════════════════════
Query 1: "Treasury Department outbound investment..."
  📖 8 citations found
  ✅ Added: 8 new | Duplicates: 0 | Invalid: 0

📊 MASTER CITATION LIST SUMMARY
  Total Unique Sources: 47
  Total Queries: 12
  Average per Query: 3.9

🔍 CITATION VALIDATION IN SYNTHESIZED BRIEFING
  Total Citation Instances: 234
  Unique Citations Used: 23
  Available Sources: 47
  Utilization Rate: 48.9%
```

### Step 5: Verify Frontend Display
Check that frontend shows:
```
8,500 words | 234 citation instances | 23 unique sources cited | 47 sources researched
Source utilization: 49% (23/47 sources used)
```

---

## EXPECTED OUTCOMES

### After These Fixes:

1. ✅ **Clear Logging**: You'll see exactly where citations come from
2. ✅ **Accurate Metrics**: Frontend shows "23 unique sources cited" not "47 sources"
3. ✅ **Better Sources List**: Only cited sources in main list, unused in separate section
4. ✅ **Quality Warnings**: If citations aren't working, you'll know immediately
5. ✅ **Validation**: Invalid citation numbers will be detected and logged

### What You'll Learn:

1. Does `return_citations: true` work with sonar-pro?
2. Where are citations located in API response?
3. How many sources are typically collected vs used?
4. Are there invalid citation numbers being generated?
5. What's a typical utilization rate?

---

## IF CITATIONS STILL DON'T WORK

If after these fixes, you see in logs:
```
⚠️  WARNING: No citations found for query!
```

Then the problem is **Perplexity API not returning citations**. Next steps:

### Option A: Different Model
Try `sonar` instead of `sonar-pro`:
```javascript
model: 'sonar',  // Instead of 'sonar-pro'
```

### Option B: Remove return_citations Parameter
It might not be supported:
```javascript
// Remove this line:
// return_citations: true,
```

### Option C: Use Different Citation Strategy
Instead of relying on Perplexity's citations, extract URLs from content:
```javascript
// Extract all URLs from content
const urlPattern = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&\/=]*)/g;
const citations = [...new Set((content.match(urlPattern) || []))];
```

### Option D: Contact Perplexity Support
Ask specifically:
- Does `sonar-pro` support `return_citations: true`?
- What's the correct format for retrieving citations?
- Are there rate limits affecting citation extraction?

---

## ROLLBACK PLAN

If these changes break something:

```bash
# Revert all changes
git reset --hard HEAD~1
git push --force

# Or revert specific file
git checkout HEAD~1 -- api/generate_briefing.js
```

---

## TIME ESTIMATE

- Priority 1 (Logging): 15 minutes
- Priority 2 (Sources): 10 minutes
- Priority 3 (Metadata): 5 minutes
- Priority 4 (Frontend): 5 minutes
- Priority 5 (Test): 10 minutes
- Testing: 10 minutes
- **Total: ~55 minutes**

---

## SUMMARY

These fixes will:

1. ✅ Show you exactly what Perplexity returns
2. ✅ Track citations through entire pipeline
3. ✅ Display accurate metrics to users
4. ✅ Validate citation numbers are correct
5. ✅ Separate "sources used" from "sources collected"

After implementing these fixes, you'll either:
- **See the problem clearly** in the logs and can fix it
- **Confirm citations are working** and metrics are now accurate

No more guessing - you'll have full visibility into the citation tracking pipeline.

