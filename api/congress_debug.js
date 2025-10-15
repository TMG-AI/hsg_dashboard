// /api/congress_debug.js
// Debug endpoint to see exactly what Congress.gov API returns for a specific bill

export default async function handler(req, res) {
  const apiKey = process.env.CONGRESS_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: "CONGRESS_API_KEY not configured" });
  }

  const congress = "119";
  const type = "sres";
  const number = "444";

  try {
    // 1. Get basic bill info
    const billUrl = `https://api.congress.gov/v3/bill/${congress}/${type}/${number}?api_key=${apiKey}&format=json`;
    const billResponse = await fetch(billUrl, {
      headers: {
        'X-Api-Key': apiKey,
        'Accept': 'application/json'
      }
    });

    const billData = await billResponse.json();

    // 2. Get bill summaries
    const summariesUrl = `https://api.congress.gov/v3/bill/${congress}/${type}/${number}/summaries?api_key=${apiKey}&format=json`;
    const summariesResponse = await fetch(summariesUrl, {
      headers: {
        'X-Api-Key': apiKey,
        'Accept': 'application/json'
      }
    });

    const summariesData = await summariesResponse.json();

    // 3. Get bill text
    const textUrl = `https://api.congress.gov/v3/bill/${congress}/${type}/${number}/text?api_key=${apiKey}&format=json`;
    const textResponse = await fetch(textUrl, {
      headers: {
        'X-Api-Key': apiKey,
        'Accept': 'application/json'
      }
    });

    const textData = await textResponse.json();

    // 4. Get bill actions
    const actionsUrl = `https://api.congress.gov/v3/bill/${congress}/${type}/${number}/actions?api_key=${apiKey}&format=json`;
    const actionsResponse = await fetch(actionsUrl, {
      headers: {
        'X-Api-Key': apiKey,
        'Accept': 'application/json'
      }
    });

    const actionsData = await actionsResponse.json();

    res.status(200).json({
      ok: true,
      bill_info: {
        title: billData.bill?.title,
        type: billData.bill?.type,
        number: billData.bill?.number,
        introducedDate: billData.bill?.introducedDate,
        updateDate: billData.bill?.updateDate,
        latestAction: billData.bill?.latestAction,
        sponsors: billData.bill?.sponsors,
        policyArea: billData.bill?.policyArea,
        subjects: billData.bill?.subjects
      },
      summaries: {
        count: summariesData.summaries?.length || 0,
        summaries: summariesData.summaries || []
      },
      text_versions: {
        count: textData.textVersions?.length || 0,
        versions: textData.textVersions || []
      },
      actions: {
        count: actionsData.actions?.length || 0,
        recent_actions: actionsData.actions?.slice(0, 5) || []
      }
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error?.message || String(error)
    });
  }
}
