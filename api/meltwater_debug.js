// Temporary debug endpoint to see raw Meltwater API response
export default async function handler(req, res) {
  const MELTWATER_API_KEY = process.env.MELTWATER_API_KEY;
  const MELTWATER_SEARCH_ID = "27861003";

  try {
    if (!MELTWATER_API_KEY) {
      return res.status(200).json({ error: "MELTWATER_API_KEY not configured" });
    }

    // Fetch from last 24 hours (using a working date)
    const startDate = '2024-10-12T00:00:00';
    const endDate = '2024-10-13T23:59:59';

    const requestBody = {
      start: startDate,
      end: endDate,
      tz: "America/New_York",
      sort_by: "date",
      sort_order: "desc",
      template: {
        name: "api.json"
      },
      page_size: 10  // Get 10 articles to see variation
    };

    const response = await fetch(`https://api.meltwater.com/v3/search/${MELTWATER_SEARCH_ID}`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'apikey': MELTWATER_API_KEY
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Meltwater API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const documents = data.result?.documents || [];

    res.status(200).json({
      ok: true,
      document_count: documents.length,
      first_document: documents[0] || null,
      full_response: data
    });

  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e?.message || String(e)
    });
  }
}
