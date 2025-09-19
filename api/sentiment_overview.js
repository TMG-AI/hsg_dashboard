// ============================================
// FILE 3: /api/sentiment_overview.js
// ============================================
// Direct Meltwater API integration for sentiment analysis

export default async function handler3(req, res) {
  try {
    const MELTWATER_API_KEY = process.env.MELTWATER_API_KEY;
    const SEARCH_ID = '27558498'; // Your Meltwater search ID
    
    if (!MELTWATER_API_KEY) {
      return res.status(500).json({ error: 'Meltwater API key not configured' });
    }

    // Parse window parameter
    const win = (req.query?.window || "24h").toString().toLowerCase();
    const hours = parseInt(req.query?.hours || "24", 10);
    
    // Calculate time range
    const now = new Date();
    let startDate, endDate;
    let windowLabel = win;
    
    if (win === "today") {
      // Start of today ET
      const todayET = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
      todayET.setHours(0, 0, 0, 0);
      startDate = todayET.toISOString().split('.')[0];
      endDate = now.toISOString().split('.')[0];
      windowLabel = "today";
    } else {
      // Default to hours-based window
      startDate = new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString().split('.')[0];
      endDate = now.toISOString().split('.')[0];
      windowLabel = `${hours}h`;
    }

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
        },
        page_size: 100
      })
    });

    if (!meltwaterResponse.ok) {
      console.error('Meltwater API error:', meltwaterResponse.status);
      return res.status(meltwaterResponse.status).json({ 
        error: `Meltwater API error: ${meltwaterResponse.status}` 
      });
    }

    const meltwaterData = await meltwaterResponse.json();
    
    // Extract articles
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
    
    // Find the latest article with sentiment
    let latest = null;
    for (const article of articles) {
      if (article.sentiment || article.sentiment_score !== undefined) {
        latest = {
          ts: Math.floor(Date.parse(article.published_date || article.published_at || new Date()) / 1000),
          title: article.title || article.headline,
          source: article.source_name || article.source,
          sentiment: {
            label: article.sentiment || 'neutral',
            score: article.sentiment_score || 0
          }
        };
        break;
      }
    }
    
    // Prepare response
    const response = {
      ok: true,
      window: windowLabel,
      latest: latest,
      items: [], // Empty for now since dashboard doesn't use it
      generated_at: new Date().toISOString()
    };
    
    // Add cache headers
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    
    res.status(200).json(response);
  } catch (error) {
    console.error('Error fetching sentiment:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Internal server error' 
    });
  }
}
