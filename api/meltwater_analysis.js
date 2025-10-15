// /api/meltwater_analysis.js
// Analyze Meltwater's unique value vs Google Alerts and Newsletters
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
  } catch {
    return null;
  }
}

function detectOrigin(m) {
  if (m && typeof m.origin === "string" && m.origin && m.origin !== "") {
    return m.origin;
  }

  if (
    m?.section === "Newsletter" ||
    (Array.isArray(m?.matched) && m.matched.includes("newsletter")) ||
    (m?.id && m.id.startsWith("newsletter_"))
  ) {
    return "newsletter";
  }

  const prov = (m?.provider || "").toLowerCase();
  if (
    prov.includes("meltwater") ||
    m?.section === "Meltwater" ||
    (Array.isArray(m?.matched) && m.matched.includes("meltwater-alert")) ||
    (m?.id && m.id.startsWith("mw_stream_"))
  ) {
    return "meltwater";
  }

  if (m?.section === "Congress" || (m?.id && m.id.startsWith("congress_"))) {
    return "congress";
  }

  return "google_alerts";
}

// Normalize text for comparison (remove whitespace, punctuation, lowercase)
function normalizeText(text) {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Extract key entities and topics from text (companies, people, places, topics)
function extractKeyEntities(text) {
  if (!text) return new Set();

  const normalized = normalizeText(text);
  const entities = new Set();

  // Common stopwords to ignore
  const stopwords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
    'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this',
    'that', 'these', 'those', 'it', 'its', 'he', 'she', 'they', 'we',
    'you', 'i', 'me', 'my', 'your', 'his', 'her', 'their', 'our'
  ]);

  // Extract capitalized words (likely proper nouns - companies, people, places)
  const words = text.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    // Check if word starts with capital letter (not at sentence start)
    if (/^[A-Z][a-z]+/.test(word)) {
      const normalized = word.toLowerCase();
      if (!stopwords.has(normalized) && normalized.length > 2) {
        entities.add(normalized);

        // Check for multi-word entities (e.g., "Hong Kong", "United States")
        if (i < words.length - 1 && /^[A-Z][a-z]+/.test(words[i + 1])) {
          const phrase = `${word} ${words[i + 1]}`.toLowerCase();
          entities.add(phrase);
        }
      }
    }
  }

  // Extract significant keywords (words that appear to be important based on context)
  // Look for domain-specific terms related to China, Hong Kong, policy, business
  const importantKeywords = [
    'china', 'chinese', 'beijing', 'shanghai', 'hong kong', 'hongshan',
    'hongshan capital', 'taiwan', 'macau', 'asia', 'asian',
    'semiconductor', 'chip', 'technology', 'ai', 'artificial intelligence',
    'trade', 'tariff', 'export', 'import', 'sanctions', 'regulation',
    'investment', 'venture', 'capital', 'funding', 'ipo', 'acquisition',
    'cybersecurity', 'data', 'privacy', 'security', 'surveillance',
    'military', 'defense', 'national security', 'foreign policy',
    'manufacturing', 'supply chain', 'factory', 'production',
    'cryptocurrency', 'blockchain', 'digital currency', 'fintech'
  ];

  const lowerText = normalized.toLowerCase();
  for (const keyword of importantKeywords) {
    if (lowerText.includes(keyword)) {
      entities.add(keyword);
    }
  }

  return entities;
}

// Calculate content similarity based on key entities and topics
function calculateContentSimilarity(article1, article2) {
  // Combine title and summary for both articles
  // Clean HTML entities and tags first
  const cleanText = (text) => {
    if (!text) return '';
    // Decode HTML entities
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      // Remove HTML tags
      .replace(/<[^>]+>/g, ' ')
      // Clean up extra spaces
      .replace(/\s+/g, ' ')
      .trim();
  };

  const text1 = cleanText(`${article1.title || ''} ${article1.summary || ''}`);
  const text2 = cleanText(`${article2.title || ''} ${article2.summary || ''}`);

  // Extract entities from both
  const entities1 = extractKeyEntities(text1);
  const entities2 = extractKeyEntities(text2);

  // Calculate word-level similarity as fallback
  const words1 = new Set(normalizeText(text1).split(" ").filter(w => w.length > 3));
  const words2 = new Set(normalizeText(text2).split(" ").filter(w => w.length > 3));

  const wordIntersection = new Set([...words1].filter(w => words2.has(w)));
  const wordUnion = new Set([...words1, ...words2]);

  const wordSimilarity = wordUnion.size > 0 ? wordIntersection.size / wordUnion.size : 0;

  // If both articles have sparse/no entities (short summaries), rely primarily on word similarity
  if (entities1.size <= 2 || entities2.size <= 2) {
    // For sparse entity extraction, use word similarity more heavily
    // This handles Google Alerts with short summaries
    return wordSimilarity;
  }

  // Calculate Jaccard similarity on entities
  const intersection = new Set([...entities1].filter(e => entities2.has(e)));
  const union = new Set([...entities1, ...entities2]);

  const entitySimilarity = union.size > 0 ? intersection.size / union.size : 0;

  // Weight entity similarity higher (70%) than word similarity (30%)
  // Because entities capture the key subjects/topics being discussed
  return (entitySimilarity * 0.7) + (wordSimilarity * 0.3);
}

// Legacy function for backward compatibility
function calculateSimilarity(text1, text2) {
  const words1 = new Set(normalizeText(text1).split(" "));
  const words2 = new Set(normalizeText(text2).split(" "));

  const intersection = new Set([...words1].filter((w) => words2.has(w)));
  const union = new Set([...words1, ...words2]);

  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

// Check if URL domains match (same source)
function isSameSource(url1, url2) {
  try {
    const domain1 = new URL(url1).hostname.replace("www.", "");
    const domain2 = new URL(url2).hostname.replace("www.", "");
    return domain1 === domain2;
  } catch {
    return false;
  }
}

// Analyze content uniqueness
function analyzeUniqueness(meltwaterArticles, otherArticles) {
  const analysis = {
    total_meltwater: meltwaterArticles.length,
    total_other: otherArticles.length,
    unique_sources: 0,
    duplicate_content: 0,
    similar_content: 0, // 30-70% similarity
    unique_content: 0, // <30% similarity
    unique_meltwater_articles: [],
    duplicate_examples: [],
    meltwater_only_domains: new Set(),
    shared_domains: new Set(),
    debug_sample_comparisons: [], // For debugging
  };

  // Track all domains
  const otherDomains = new Set();
  otherArticles.forEach((article) => {
    if (article.link) {
      try {
        const domain = new URL(article.link).hostname.replace("www.", "");
        otherDomains.add(domain);
      } catch {}
    }
  });

  // Analyze each Meltwater article
  meltwaterArticles.forEach((mw, mwIndex) => {
    let bestMatch = null;
    let bestSimilarity = 0;
    let isSameSourceMatch = false;

    // Compare with all other articles
    otherArticles.forEach((other) => {
      // Check if same source
      if (mw.link && other.link && isSameSource(mw.link, other.link)) {
        isSameSourceMatch = true;
        bestMatch = other;
        bestSimilarity = 1.0;
        return;
      }

      // Use enhanced content similarity that compares topics and entities
      // This tells us if Google Alerts/Newsletters covered the SAME STORY/TOPIC
      // even if from different sources
      const contentSimilarity = calculateContentSimilarity(mw, other);

      if (contentSimilarity > bestSimilarity) {
        bestSimilarity = contentSimilarity;
        bestMatch = other;
      }
    });

    // Log first 5 comparisons for debugging
    if (mwIndex < 5) {
      analysis.debug_sample_comparisons.push({
        meltwater_title: mw.title?.substring(0, 100),
        best_match_title: bestMatch?.title?.substring(0, 100),
        similarity_score: Math.round(bestSimilarity * 100),
        mw_summary_length: (mw.summary || '').length,
        match_summary_length: bestMatch ? (bestMatch.summary || '').length : 0
      });
    }

    // Track Meltwater domain
    if (mw.link) {
      try {
        const domain = new URL(mw.link).hostname.replace("www.", "");
        if (otherDomains.has(domain)) {
          analysis.shared_domains.add(domain);
        } else {
          analysis.meltwater_only_domains.add(domain);
        }
      } catch {}
    }

    // Categorize based on similarity
    if (bestSimilarity >= 0.7) {
      // High similarity - likely duplicate
      analysis.duplicate_content++;
      if (analysis.duplicate_examples.length < 5) {
        analysis.duplicate_examples.push({
          meltwater: {
            title: mw.title,
            link: mw.link,
            date: mw.published_at,
          },
          matched_with: {
            title: bestMatch?.title,
            link: bestMatch?.link,
            origin: detectOrigin(bestMatch),
          },
          similarity: Math.round(bestSimilarity * 100),
        });
      }
    } else if (bestSimilarity >= 0.3) {
      // Medium similarity - related but different angle
      analysis.similar_content++;
    } else {
      // Low similarity - unique content
      analysis.unique_content++;
      if (analysis.unique_meltwater_articles.length < 10) {
        analysis.unique_meltwater_articles.push({
          title: mw.title,
          link: mw.link,
          summary: mw.summary?.substring(0, 200) + "...",
          date: mw.published_at,
          publisher: mw.publisher,
        });
      }
    }
  });

  // Calculate source uniqueness
  analysis.unique_sources = analysis.meltwater_only_domains.size;
  analysis.meltwater_only_domains = Array.from(
    analysis.meltwater_only_domains
  );
  analysis.shared_domains = Array.from(analysis.shared_domains);

  // Calculate percentages
  if (analysis.total_meltwater > 0) {
    analysis.uniqueness_percentage = Math.round(
      (analysis.unique_content / analysis.total_meltwater) * 100
    );
    analysis.duplicate_percentage = Math.round(
      (analysis.duplicate_content / analysis.total_meltwater) * 100
    );
    analysis.similar_percentage = Math.round(
      (analysis.similar_content / analysis.total_meltwater) * 100
    );
  }

  return analysis;
}

// NEW: Topic-level analysis - What topics/themes does each source cover?
function analyzeTopicCoverage(meltwaterArticles, googleAlertsArticles, newsletterArticles) {
  // Extract all entities/topics from each source
  const extractAllTopics = (articles) => {
    const topicCounts = {};
    articles.forEach(article => {
      const text = `${article.title || ''} ${article.summary || ''}`;
      const entities = extractKeyEntities(text);
      entities.forEach(entity => {
        topicCounts[entity] = (topicCounts[entity] || 0) + 1;
      });
    });
    return topicCounts;
  };

  const meltwaterTopics = extractAllTopics(meltwaterArticles);
  const googleTopics = extractAllTopics(googleAlertsArticles);
  const newsletterTopics = extractAllTopics(newsletterArticles);
  const combinedFreeTopics = {};

  // Combine Google + Newsletter topics
  Object.keys(googleTopics).forEach(topic => {
    combinedFreeTopics[topic] = googleTopics[topic];
  });
  Object.keys(newsletterTopics).forEach(topic => {
    combinedFreeTopics[topic] = (combinedFreeTopics[topic] || 0) + newsletterTopics[topic];
  });

  // Find top topics in each source
  const getTopTopics = (topicCounts, n = 20) => {
    return Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([topic, count]) => ({ topic, count }));
  };

  const topMeltwaterTopics = getTopTopics(meltwaterTopics, 30);
  const topFreeTopics = getTopTopics(combinedFreeTopics, 30);

  // Find topics ONLY in Meltwater
  const uniqueMeltwaterTopics = Object.keys(meltwaterTopics).filter(
    topic => !combinedFreeTopics[topic] && meltwaterTopics[topic] >= 3
  );

  // Find topics ONLY in Google/Newsletter
  const uniqueFreeTopics = Object.keys(combinedFreeTopics).filter(
    topic => !meltwaterTopics[topic] && combinedFreeTopics[topic] >= 3
  );

  // Find overlapping topics (covered by BOTH)
  const overlappingTopics = Object.keys(meltwaterTopics).filter(
    topic => combinedFreeTopics[topic]
  );

  // Calculate coverage percentages
  const totalMeltwaterTopics = Object.keys(meltwaterTopics).length;
  const totalFreeTopics = Object.keys(combinedFreeTopics).length;
  const overlapCount = overlappingTopics.length;

  const meltwaterUniquePercent = totalMeltwaterTopics > 0
    ? Math.round((uniqueMeltwaterTopics.length / totalMeltwaterTopics) * 100)
    : 0;

  // Calculate how much Meltwater is adding to the conversation
  const topicsNotInFree = Object.keys(meltwaterTopics).filter(
    topic => !combinedFreeTopics[topic]
  );

  return {
    summary: {
      total_meltwater_topics: totalMeltwaterTopics,
      total_free_topics: totalFreeTopics,
      overlapping_topics: overlapCount,
      meltwater_unique_topics: uniqueMeltwaterTopics.length,
      free_unique_topics: uniqueFreeTopics.length,
      meltwater_topic_uniqueness: meltwaterUniquePercent
    },
    top_meltwater_topics: topMeltwaterTopics,
    top_free_topics: topFreeTopics,
    meltwater_only_topics: uniqueMeltwaterTopics.slice(0, 30),
    free_only_topics: uniqueFreeTopics.slice(0, 30),
    interpretation: generateTopicInterpretation(
      meltwaterUniquePercent,
      uniqueMeltwaterTopics.length,
      topMeltwaterTopics,
      topFreeTopics
    )
  };
}

function generateTopicInterpretation(uniquePercent, uniqueCount, meltwaterTopics, freeTopics) {
  const meltwaterTop5 = meltwaterTopics.slice(0, 5).map(t => t.topic);
  const freeTop5 = freeTopics.slice(0, 5).map(t => t.topic);

  // Check if topics are substantially different
  const topicOverlap = meltwaterTop5.filter(t => freeTop5.includes(t)).length;

  if (topicOverlap >= 4) {
    return {
      verdict: "OVERLAPPING COVERAGE",
      explanation: "Both sources are covering the same major topics (trade, policy, tariffs, etc.). Meltwater is not adding significantly different themes.",
      value: "LOW"
    };
  } else if (topicOverlap >= 2) {
    return {
      verdict: "PARTIAL OVERLAP",
      explanation: "Some shared topics, but Meltwater covers additional themes not found in free sources.",
      value: "MODERATE"
    };
  } else {
    return {
      verdict: "DISTINCT COVERAGE",
      explanation: "Meltwater covers substantially different topics than Google Alerts/Newsletters. Provides unique thematic coverage.",
      value: "HIGH"
    };
  }
}

export default async function handler(req, res) {
  try {
    // Get time window (default: last 7 days)
    const days = parseInt(req.query?.days || "7");
    const now = Math.floor(Date.now() / 1000);
    const startTime = now - days * 24 * 60 * 60;

    // Fetch all articles from Redis
    const raw = await redis.zrange(ZSET, 0, 10000, { rev: true });
    const items = raw.map(toObj).filter(Boolean);

    console.log(`Total items in Redis: ${items.length}`);

    // Filter to time window
    const recentItems = items.filter((m) => {
      const ts = Number(m?.published_ts ?? NaN);
      return Number.isFinite(ts) && ts >= startTime && ts <= now;
    });

    console.log(`Items in last ${days} days: ${recentItems.length}`);

    // Separate by origin
    const meltwaterArticles = [];
    const googleAlertsArticles = [];
    const newsletterArticles = [];
    const otherArticles = [];

    recentItems.forEach((item) => {
      const origin = detectOrigin(item);
      if (origin === "meltwater") {
        meltwaterArticles.push(item);
      } else if (origin === "google_alerts") {
        googleAlertsArticles.push(item);
      } else if (origin === "newsletter") {
        newsletterArticles.push(item);
      } else {
        otherArticles.push(item);
      }
    });

    console.log(`Meltwater: ${meltwaterArticles.length}`);
    console.log(`Google Alerts: ${googleAlertsArticles.length}`);
    console.log(`Newsletters: ${newsletterArticles.length}`);

    // Combine non-Meltwater sources for comparison
    const combinedOtherSources = [
      ...googleAlertsArticles,
      ...newsletterArticles,
      ...otherArticles,
    ];

    // Perform OLD article-by-article analysis
    const analysis = analyzeUniqueness(
      meltwaterArticles,
      combinedOtherSources
    );

    // Add breakdown by comparison source
    const vsGoogleAlerts = analyzeUniqueness(
      meltwaterArticles,
      googleAlertsArticles
    );
    const vsNewsletters = analyzeUniqueness(
      meltwaterArticles,
      newsletterArticles
    );

    // NEW: Perform topic-level analysis
    const topicAnalysis = analyzeTopicCoverage(
      meltwaterArticles,
      googleAlertsArticles,
      newsletterArticles
    );

    res.status(200).json({
      ok: true,
      time_period: {
        days: days,
        start: new Date(startTime * 1000).toISOString(),
        end: new Date(now * 1000).toISOString(),
      },
      article_counts: {
        meltwater: meltwaterArticles.length,
        google_alerts: googleAlertsArticles.length,
        newsletters: newsletterArticles.length,
        other: otherArticles.length,
      },
      overall_analysis: analysis,
      topic_analysis: topicAnalysis,
      comparison_breakdowns: {
        vs_google_alerts: {
          unique_percentage: vsGoogleAlerts.uniqueness_percentage,
          duplicate_percentage: vsGoogleAlerts.duplicate_percentage,
          unique_sources: vsGoogleAlerts.unique_sources,
        },
        vs_newsletters: {
          unique_percentage: vsNewsletters.uniqueness_percentage,
          duplicate_percentage: vsNewsletters.duplicate_percentage,
          unique_sources: vsNewsletters.unique_sources,
        },
      },
      recommendation: generateRecommendation(analysis),
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("Meltwater analysis error:", e);
    res.status(500).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
}

function generateRecommendation(analysis) {
  const uniquePercent = analysis.uniqueness_percentage || 0;
  const duplicatePercent = analysis.duplicate_percentage || 0;
  const uniqueSources = analysis.unique_sources || 0;

  if (uniquePercent >= 50 || uniqueSources >= 10) {
    return {
      verdict: "HIGH VALUE",
      reason: `Meltwater provides ${uniquePercent}% unique content and ${uniqueSources} exclusive sources not found elsewhere. This represents significant value.`,
      confidence: "high",
    };
  } else if (uniquePercent >= 30 || uniqueSources >= 5) {
    return {
      verdict: "MODERATE VALUE",
      reason: `Meltwater provides ${uniquePercent}% unique content and ${uniqueSources} exclusive sources. There is some overlap with other sources, but meaningful unique coverage.`,
      confidence: "medium",
    };
  } else if (duplicatePercent >= 70) {
    return {
      verdict: "LOW VALUE",
      reason: `${duplicatePercent}% of Meltwater content is duplicate or very similar to content from free sources. Only ${uniquePercent}% is unique.`,
      confidence: "high",
    };
  } else {
    return {
      verdict: "UNCERTAIN",
      reason: `Mixed results: ${uniquePercent}% unique, ${duplicatePercent}% duplicate. May need longer analysis period or keyword refinement.`,
      confidence: "low",
    };
  }
}
