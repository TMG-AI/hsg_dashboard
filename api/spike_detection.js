// ============================================
// FILE 4: /api/spike_detection.js
// ============================================
// Direct Meltwater API integration for spike detection (simplified version)

export default async function handler4(req, res) {
  try {
    const MELTWATER_API_KEY = process.env.MELTWATER_API_KEY;
    const SEARCH_ID = '27558498'; // Your Meltwater search ID
    
    if (!MELTWATER_API_KEY) {
      return res.status(500).json({ error: 'Meltwater API key not configured' });
    }

    // For now, return empty spikes array since dashboard doesn't display them yet
    // This endpoint is ready for future use when you want to add spike detection
    
    const response = {
      ok: true,
      window: req.query?.window || "today",
      spikes: [], // Empty for now
      generated_at: new Date().toISOString()
    };
    
    // Add cache headers
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    
    res.status(200).json(response);
  } catch (error) {
    console.error('Error detecting spikes:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Internal server error' 
    });
  }
}
