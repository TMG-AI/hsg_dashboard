// /api/congress_update_summaries.js
// One-time endpoint to update existing Congress bills with detailed summaries
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
  } catch { return null; }
}

// Fetch detailed bill summary from Congress.gov API
async function fetchBillSummary(congress, type, number, apiKey) {
  try {
    const url = `https://api.congress.gov/v3/bill/${congress}/${type}/${number}/summaries?api_key=${apiKey}&format=json`;

    const response = await fetch(url, {
      headers: {
        'X-Api-Key': apiKey,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      console.log(`Could not fetch summary for ${type}${number}: ${response.status}`);
      return null;
    }

    const data = await response.json();

    // Get the most recent summary (usually the first one)
    if (data.summaries && data.summaries.length > 0) {
      const latestSummary = data.summaries[0];
      return latestSummary.text || null;
    }

    return null;
  } catch (error) {
    console.log(`Error fetching summary for ${type}${number}:`, error.message);
    return null;
  }
}

export default async function handler(req, res) {
  const apiKey = process.env.CONGRESS_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      ok: false,
      error: "CONGRESS_API_KEY not configured"
    });
  }

  try {
    // Get all items from Redis
    const raw = await redis.zrange(ZSET, 0, 5000, { rev: true });
    const items = raw.map(toObj).filter(Boolean);

    // Filter for Congress bills only
    const congressBills = items.filter(m =>
      m.origin === 'congress' ||
      (m.id && m.id.startsWith('congress_')) ||
      m.section === 'Federal Legislation'
    );

    console.log(`Found ${congressBills.length} Congress bills to update`);

    let updated = 0;
    let skipped = 0;
    const errors = [];

    for (const bill of congressBills) {
      try {
        // Extract bill type and number from the bill_number field or title
        const billNumber = bill.bill_number || bill.title?.split(':')[0]?.trim();

        if (!billNumber) {
          console.log(`Skipping bill ${bill.id} - no bill number found`);
          skipped++;
          continue;
        }

        // Parse bill type and number (e.g., "SRES444" -> type: "sres", number: "444")
        const match = billNumber.match(/^([A-Z]+)(\d+)$/i);
        if (!match) {
          console.log(`Skipping bill ${bill.id} - could not parse bill number: ${billNumber}`);
          skipped++;
          continue;
        }

        const type = match[1].toLowerCase();
        const number = match[2];
        const congress = bill.congress_number || "119";

        // Fetch detailed summary
        const detailedSummary = await fetchBillSummary(congress, type, number, apiKey);

        if (detailedSummary && detailedSummary !== bill.summary) {
          // Update the bill with the new summary
          const updatedBill = {
            ...bill,
            summary: detailedSummary
          };

          // Remove old version and add updated version to Redis
          await redis.zrem(ZSET, JSON.stringify(bill));
          await redis.zadd(ZSET, {
            score: bill.published_ts,
            member: JSON.stringify(updatedBill)
          });

          console.log(`Updated summary for ${billNumber}`);
          updated++;
        } else if (detailedSummary) {
          console.log(`Summary unchanged for ${billNumber}`);
          skipped++;
        } else {
          console.log(`No detailed summary available for ${billNumber}`);
          skipped++;
        }
      } catch (err) {
        console.error(`Error updating bill ${bill.id}:`, err);
        errors.push({
          bill_id: bill.id,
          error: err?.message || String(err)
        });
      }
    }

    res.status(200).json({
      ok: true,
      total_congress_bills: congressBills.length,
      updated,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
      message: `Updated ${updated} Congress bills with detailed summaries`
    });
  } catch (e) {
    console.error("Update summaries error:", e);
    res.status(500).json({
      ok: false,
      error: e?.message || String(e)
    });
  }
}
