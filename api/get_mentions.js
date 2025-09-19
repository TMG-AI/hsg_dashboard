// ============================================
// FILE 1: /api/get_mentions.js
// ============================================
// Direct Meltwater API integration - pulls last 24 hours of data

export default async function handler(req, res) {
  try {
    const MELTWATER_API_KEY = process.env.MELTWATER_API_KEY;
    const SEARCH_ID = '27558498'; // Your Meltwater search ID
    
    if (!MELTWATER_API_KEY) {
      return res.status(500).json({ error: 'Meltwater API key not configured' });
    }

    // Calculate last 24 hours
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    // Format dates for Meltwater API (ISO string format)
    const startDate = yesterday.toISOString().split('.')[0]; // Remove milliseconds
    const endDate = now.toISOString().split('.')[0];

    // Call Meltwater API
    const meltwaterResponse = await fetch(`https://api.meltwater.com/v3/search/${SEARCH_ID}`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'apikey': MELTWATER_API_KEY
      },
      body: JSON.stringify({
        start: startDate,
        end: endDate,
        tz: "America/New_York",
        sort_by: "date",
        sort_order: "desc",
        template: {
          name: "api.json"
        }
      })
    });

    if (!meltwaterResponse.ok) {
      console.error('Meltwater API error:', meltwaterResponse.status, await meltwaterResponse.text());
      return res.status(meltwaterResponse.status).json({ 
        error: `Meltwater API error: ${meltwaterResponse.status}` 
      });
    }

    const meltwaterData = await meltwaterResponse.json();
    
    // Transform Meltwater data to dashboard format
    const transformedArticles = transformMeltwaterData(meltwaterData);
    
    // Apply filters if provided
    let filtered = transformedArticles;
    const url = new URL(req.url, "http://localhost");
    
    // Filter by search query
    const q = (url.searchParams.get("q") || "").toLowerCase().trim();
    if (q) {
      filtered = filtered.filter(m => 
        (m.title || "").toLowerCase().includes(q) || 
        (m.source || "").toLowerCase().includes(q) ||
        (m.matched || []).some(tag => tag.toLowerCase().includes(q))
      );
    }
    
    // Filter by section
    const section = (url.searchParams.get("section") || "").trim();
    if (section) {
      filtered = filtered.filter(m => m.section === section);
    }
    
    // Apply limit
    const limit = Math.max(1, Math.min(1000, parseInt(url.searchParams.get("limit") || "300", 10)));
    filtered = filtered.slice(0, limit);
    
    res.json(filtered);
  } catch (error) {
    console.error('Error fetching Meltwater data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

function transformMeltwaterData(meltwaterData) {
  // Handle different possible response structures from Meltwater
  let articles = [];
  
  if (meltwaterData.results) {
    articles = meltwaterData.results;
  } else if (meltwaterData.documents) {
    articles = meltwaterData.documents;
  } else if (Array.isArray(meltwaterData)) {
    articles = meltwaterData;
  } else if (meltwaterData.data && Array.isArray(meltwaterData.data)) {
    articles = meltwaterData.data;
  }

  return articles.map(article => ({
    id: article.id || article.document_id || `mw_${Date.now()}_${Math.random()}`,
    title: article.title || article.headline || 'Untitled',
    link: article.url || article.link || article.permalink || '#',
    source: article.source_name || article.source || article.media_name || 'Unknown Source',
    section: 'Meltwater',
    origin: 'meltwater',
    published: article.published_date || article.date || article.published_at || new Date().toISOString(),
    published_ts: article.published_timestamp || 
                  (article.published_date ? Math.floor(Date.parse(article.published_date) / 1000) : Math.floor(Date.now() / 1000)),
    matched: extractKeywords(article),
    
    // Meltwater-specific fields
    reach: article.reach || article.circulation || article.audience || 0,
    sentiment: normalizeSentiment(article),
    sentiment_label: article.sentiment || article.sentiment_label || null,
    country: article.country || article.country_code || null,
    language: article.language || article.language_code || null,
    
    // Store additional metadata
    provider_meta: {
      document_id: article.id || article.document_id,
      search_id: article.search_id,
      influencer_score: article.influencer_score,
      source_type: article.source_type || article.media_type
    }
  }));
}

function normalizeSentiment(article) {
  // Convert sentiment to numeric value
  if (typeof article.sentiment_score === 'number') {
    return article.sentiment_score;
  }
  
  const sentiment = (article.sentiment || '').toLowerCase();
  if (sentiment === 'positive') return 1;
  if (sentiment === 'negative') return -1;
  if (sentiment === 'neutral') return 0;
  
  return undefined;
}

function extractKeywords(article) {
  const keywords = [];
  
  // Add source type
  if (article.source_type) {
    keywords.push(article.source_type);
  }
  
  // Add sentiment if available
  if (article.sentiment) {
    keywords.push(`sentiment-${article.sentiment.toLowerCase()}`);
  }
  
  // Add country if available
  if (article.country) {
    keywords.push(article.country);
  }
  
  // Add language if available and not English
  if (article.language && article.language.toLowerCase() !== 'en') {
    keywords.push(article.language.toUpperCase());
  }
  
  // Add any tags or entities from the article
  if (article.tags && Array.isArray(article.tags)) {
    keywords.push(...article.tags);
  }
  
  if (article.entities && Array.isArray(article.entities)) {
    keywords.push(...article.entities.map(e => e.name || e.value).filter(Boolean));
  }
  
  // Look for Coinbase-related keywords in title
  const title = (article.title || '').toLowerCase();
  const coinbaseKeywords = ['bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'cryptocurrency', 'coinbase', 'blockchain', 'defi'];
  coinbaseKeywords.forEach(keyword => {
    if (title.includes(keyword)) {
      keywords.push(keyword);
    }
  });
  
  return [...new Set(keywords)]; // Remove duplicates
}
