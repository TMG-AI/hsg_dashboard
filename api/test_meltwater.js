// /api/test_meltwater.js
// Test endpoint to debug Meltwater API

export default async function handler(req, res) {
  const MELTWATER_API_KEY = process.env.MELTWATER_API_KEY;
  const SEARCH_ID = '27558498';
  
  // Check if API key exists
  if (!MELTWATER_API_KEY) {
    return res.status(200).json({
      error: 'MELTWATER_API_KEY not found in environment variables',
      hasKey: false
    });
  }

  try {
    // Try to call Meltwater API
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    const startDate = yesterday.toISOString().split('.')[0];
    const endDate = now.toISOString().split('.')[0];

    console.log('Calling Meltwater API...');
    
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
        page_size: 10
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(200).json({
        error: 'Meltwater API error',
        status: response.status,
        message: errorText,
        hasKey: true,
        keyLength: MELTWATER_API_KEY.length,
        searchId: SEARCH_ID
      });
    }

    const data = await response.json();
    
    // Extract article count
    let articleCount = 0;
    if (data.results) articleCount = data.results.length;
    else if (data.documents) articleCount = data.documents.length;
    else if (Array.isArray(data)) articleCount = data.length;
    else if (data.data && Array.isArray(data.data)) articleCount = data.data.length;
    
    return res.status(200).json({
      success: true,
      hasKey: true,
      keyLength: MELTWATER_API_KEY.length,
      searchId: SEARCH_ID,
      articleCount: articleCount,
      timeRange: { start: startDate, end: endDate },
      responseStructure: {
        hasResults: !!data.results,
        hasDocuments: !!data.documents,
        isArray: Array.isArray(data),
        hasData: !!data.data
      }
    });
    
  } catch (error) {
    return res.status(200).json({
      error: 'Exception occurred',
      message: error.message,
      hasKey: true,
      keyLength: MELTWATER_API_KEY.length
    });
  }
}
