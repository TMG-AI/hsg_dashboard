// /api/meltwater_entity_test.js
// Test entity extraction on sample articles
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
  const prov = (m?.provider || "").toLowerCase();
  if (
    prov.includes("meltwater") ||
    m?.section === "Meltwater" ||
    (Array.isArray(m?.matched) && m.matched.includes("meltwater-alert")) ||
    (m?.id && m.id.startsWith("mw_stream_"))
  ) {
    return "meltwater";
  }
  if (
    m?.section === "Newsletter" ||
    (Array.isArray(m?.matched) && m.matched.includes("newsletter")) ||
    (m?.id && m.id.startsWith("newsletter_"))
  ) {
    return "newsletter";
  }
  if (m?.section === "Congress" || (m?.id && m.id.startsWith("congress_"))) {
    return "congress";
  }
  return "google_alerts";
}

function normalizeText(text) {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractKeyEntities(text) {
  if (!text) return new Set();

  const normalized = normalizeText(text);
  const entities = new Set();

  const stopwords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
    'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this',
    'that', 'these', 'those', 'it', 'its', 'he', 'she', 'they', 'we',
    'you', 'i', 'me', 'my', 'your', 'his', 'her', 'their', 'our'
  ]);

  const words = text.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (/^[A-Z][a-z]+/.test(word)) {
      const norm = word.toLowerCase();
      if (!stopwords.has(norm) && norm.length > 2) {
        entities.add(norm);
        if (i < words.length - 1 && /^[A-Z][a-z]+/.test(words[i + 1])) {
          const phrase = `${word} ${words[i + 1]}`.toLowerCase();
          entities.add(phrase);
        }
      }
    }
  }

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

  const lowerText = text.toLowerCase();
  for (const keyword of importantKeywords) {
    if (lowerText.includes(keyword)) {
      entities.add(keyword);
    }
  }

  return entities;
}

function calculateContentSimilarity(article1, article2) {
  const text1 = `${article1.title || ''} ${article1.summary || ''}`;
  const text2 = `${article2.title || ''} ${article2.summary || ''}`;

  const entities1 = extractKeyEntities(text1);
  const entities2 = extractKeyEntities(text2);

  if (entities1.size === 0 && entities2.size === 0) return 0;
  if (entities1.size === 0 || entities2.size === 0) return 0;

  const intersection = new Set([...entities1].filter(e => entities2.has(e)));
  const union = new Set([...entities1, ...entities2]);

  const entitySimilarity = intersection.size / union.size;

  const words1 = new Set(normalizeText(text1).split(" ").filter(w => w.length > 3));
  const words2 = new Set(normalizeText(text2).split(" ").filter(w => w.length > 3));

  const wordIntersection = new Set([...words1].filter(w => words2.has(w)));
  const wordUnion = new Set([...words1, ...words2]);

  const wordSimilarity = wordUnion.size > 0 ? wordIntersection.size / wordUnion.size : 0;

  return (entitySimilarity * 0.7) + (wordSimilarity * 0.3);
}

export default async function handler(req, res) {
  try {
    const days = 7;
    const now = Math.floor(Date.now() / 1000);
    const startTime = now - days * 24 * 60 * 60;

    const raw = await redis.zrange(ZSET, 0, 10000, { rev: true });
    const items = raw.map(toObj).filter(Boolean);

    const recentItems = items.filter((m) => {
      const ts = Number(m?.published_ts ?? NaN);
      return Number.isFinite(ts) && ts >= startTime && ts <= now;
    });

    const meltwaterArticles = [];
    const googleAlertsArticles = [];
    const newsletterArticles = [];

    recentItems.forEach((item) => {
      const origin = detectOrigin(item);
      if (origin === "meltwater") meltwaterArticles.push(item);
      else if (origin === "google_alerts") googleAlertsArticles.push(item);
      else if (origin === "newsletter") newsletterArticles.push(item);
    });

    // Test on first Meltwater article
    const testMW = meltwaterArticles[0];
    const testMWText = `${testMW.title || ''} ${testMW.summary || ''}`;
    const testMWEntities = extractKeyEntities(testMWText);

    // Find best match in Google Alerts
    let bestGAMatch = null;
    let bestGASimilarity = 0;
    
    googleAlertsArticles.forEach(ga => {
      const sim = calculateContentSimilarity(testMW, ga);
      if (sim > bestGASimilarity) {
        bestGASimilarity = sim;
        bestGAMatch = ga;
      }
    });

    let bestGAEntities = new Set();
    let bestGAText = '';
    if (bestGAMatch) {
      bestGAText = `${bestGAMatch.title || ''} ${bestGAMatch.summary || ''}`;
      bestGAEntities = extractKeyEntities(bestGAText);
    }

    res.status(200).json({
      ok: true,
      test_meltwater: {
        title: testMW.title,
        summary: testMW.summary,
        full_text_length: testMWText.length,
        entities_extracted: Array.from(testMWEntities),
        entity_count: testMWEntities.size
      },
      best_google_alert_match: bestGAMatch ? {
        title: bestGAMatch.title,
        summary: bestGAMatch.summary,
        full_text_length: bestGAText.length,
        entities_extracted: Array.from(bestGAEntities),
        entity_count: bestGAEntities.size,
        similarity_score: bestGASimilarity,
        common_entities: Array.from(new Set([...testMWEntities].filter(e => bestGAEntities.has(e))))
      } : null,
      analysis: {
        problem: testMWEntities.size === 0 ? "NO ENTITIES EXTRACTED FROM MELTWATER" : 
                 bestGAEntities.size === 0 ? "NO ENTITIES EXTRACTED FROM GOOGLE ALERTS" :
                 bestGASimilarity < 0.3 ? "Low similarity - might be legitimately unique" :
                 "Should be detecting duplicates"
      }
    });
  } catch (e) {
    console.error("Entity test error:", e);
    res.status(500).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
}
