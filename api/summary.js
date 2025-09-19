// ============================================
// FILE 2: /api/summary.js
// ============================================
// Direct Meltwater API integration for summary statistics

export default async function handler2(req, res) {
  try {
    const MELTWATER_API_KEY = process.env.MELTWATER_API_KEY;
    const SEARCH_ID = '27558498'; // Your Meltwater search ID
    
    if (!MELTWATER_API_KEY) {
      return res.status(500).json({ error: 'Meltwater API key not configured' });
    }

    // Parse window parameter
    const win = (req.query?.window || req.query?.w || "24h").toString().toLowerCase();
    
    // Calculate time range based on window
    const now = new Date();
    let startDate, endDate;
    let windowLabel = win;
    
    switch(win) {
      case "today":
        // Start of today ET
        const todayET = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
        todayET.setHours(0, 0, 0, 0);
        startDate = todayET.toISOString().split('.')[0];
        endDate = now.toISOString().split('.')[0];
        windowLabel = "today";
        break;
      
      case "7d":
      case "week":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('.')[0];
        endDate = now.toISOString().split('.')[0];
        windowLabel = "7d";
        break;
      
      case "30d":
      case "month":
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('.')[0];
        endDate = now.toISOString().split('.')[0];
        windowLabel = "30d";
        break;
      
      case "24h":
      default:
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split('.')[0];
        endDate = now.toISOString().split('.')[0];
        windowLabel = "24h";
        break;
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
        page_size: 1000 // Get more results for summary
      })
    });

    if (!meltwaterResponse.ok) {
      console.error('Meltwater API error:', meltwaterResponse.status);
      return res.status(meltwaterResponse.status).json({ 
        error: `Meltwater API error: ${meltwaterResponse.status}` 
      });
    }

    const meltwaterData = await meltwaterResponse.json();
    
    // Process and aggregate data
    const summary = processDataForSummary(meltwaterData);
    
    // Prepare response in the format the dashboard expects
    const response = {
      ok: true,
      window: windowLabel,
      totals: {
        all: summary.totals.all,
        by_origin: summary.totals.by_origin
      },
      top_publishers: summary.topPublishers,
      generated_at: new Date().toISOString()
    };
    
    // Add cache headers for performance
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    
    res.status(200).json(response);
  } catch (error) {
    console.error('Error fetching summary:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Internal server error' 
    });
  }
}

function processDataForSummary(meltwaterData) {
  // Extract articles from response
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
  
  // Initialize counters
  const summary = {
    totals: {
      all: articles.length,
      by_origin: {
        meltwater: articles.length, // All from Meltwater API
        google_alerts: 0,
        rss: 0,
        reddit: 0,
        x: 0,
        other: 0
      }
    },
    topPublishers: {}
  };
  
  // Process each article
  articles.forEach(article => {
    // Count publishers
    const source = article.source_name || article.source || article.media_name || 'Unknown';
    summary.topPublishers[source] = (summary.topPublishers[source] || 0) + 1;
    
    // Check for social media sources in URL
    const url = article.url || article.link || '';
    if (url.includes('reddit.com')) {
      summary.totals.by_origin.reddit++;
      summary.totals.by_origin.meltwater--;
    } else if (url.includes('twitter.com') || url.includes('x.com')) {
      summary.totals.by_origin.x++;
      summary.totals.by_origin.meltwater--;
    }
  });
  
  // Convert top publishers to sorted array
  summary.topPublishers = Object.entries(summary.topPublishers)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));
  
  return summary;
}
