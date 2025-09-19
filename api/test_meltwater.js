// /api/test_meltwater.js
// FIXED VERSION - Uses correct dates (looking back, not forward)

export default async function handler(req, res) {
  const MELTWATER_API_KEY = process.env.MELTWATER_API_KEY;
  const SEARCH_ID = '27558498';
  
  if (!MELTWATER_API_KEY) {
    return res.status(200).json({
      error: 'MELTWATER_API_KEY not found in environment variables',
      hasKey: false
    });
  }

  try {
    // FIXED: Search LAST 24 hours, not future dates
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    // Format properly for Meltwater
    const startDate = yesterday.toISOString().replace(/\.\d{3}Z$/, '');
    const endDate = now.toISOString().replace(/\.\d{3}Z$/, '');

    console.log(`Searching from ${startDate} to ${endDate}`);
    
    const response = await fetch(`https://api.meltwater.com/v3/search/${SEARCH_ID}`, {
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

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(200).json({
        error: 'Meltwater API error',
        status: response.status,
        message: errorText,
        hasKey: true,
        searchId: SEARCH_ID,
        dates: { start: startDate, end: endDate }
      });
    }

    const data = await response.json();
    
    // Try different ways to find articles in response
    let articles = [];
    let articleCount = 0;
    
    // Check all possible response structures
    if (data.results && Array.isArray(data.results)) {
      articles = data.results;
      articleCount = articles.length;
    } else if (data.documents && Array.isArray(data.documents)) {
      articles = data.documents;
      articleCount = articles.length;
    } else if (data.data && Array.isArray(data.data)) {
      articles = data.data;
      articleCount = articles.length;
    } else if (Array.isArray(data)) {
      articles = data;
      articleCount = articles.length;
    }
    
    // If still no articles, check for nested structures
    if (articleCount === 0 && data.response) {
      if (data.response.results) {
        articles = data.response.results;
        articleCount = articles.length;
      } else if (data.response.documents) {
        articles = data.response.documents;
        articleCount = articles.length;
      }
    }
    
    // Show first article as sample if we have any
    let sampleArticle = null;
    if (articles.length > 0) {
      const first = articles[0];
      sampleArticle = {
        title: first.title || first.headline || 'No title',
        date: first.published_date || first.date || first.published_at || 'No date',
        source: first.source_name || first.source || 'No source'
      };
    }
    
    return res.status(200).json({
      success: true,
      hasKey: true,
      keyLength: MELTWATER_API_KEY.length,
      searchId: SEARCH_ID,
      articleCount: articleCount,
      timeRange: { 
        start: startDate, 
        end: endDate,
        note: 'Searching last 24 hours'
      },
      responseStructure: {
        hasResults: !!data.results,
        hasDocuments: !!data.documents,
        isArray: Array.isArray(data),
        hasData: !!data.data,
        hasResponse: !!data.response,
        allKeys: Object.keys(data).slice(0, 10) // Show first 10 keys
      },
      sampleArticle: sampleArticle,
      rawDataSample: JSON.stringify(data).substring(0, 500) // First 500 chars of response
    });
    
  } catch (error) {
    return res.status(200).json({
      error: 'Exception occurred',
      message: error.message,
      hasKey: true
    });
  }
}
