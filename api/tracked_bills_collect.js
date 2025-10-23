// /api/tracked_bills_collect.js
// Tracks specific bills and alerts when they're updated
import { Redis } from "@upstash/redis";
import { Resend } from "resend";

const redis = new Redis({
  url: process.env.STORAGE_KV_REST_API_URL,
  token: process.env.STORAGE_KV_REST_API_TOKEN,
});

const ZSET = "mentions:z";
const SEEN_ID = "mentions:seen";
const SEEN_LINK = "mentions:seen:canon";
const TRACKED_BILLS_PREFIX = "tracked_bills:";
const RETENTION_DAYS = 14;

// Initialize Resend for email alerts (optional)
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// TRACKED BILLS LIST - Add bill numbers here in format: "hr1234", "s5678", etc.
const TRACKED_BILLS = [
  // House Bills
  "hr82", "hr139", "hr515", "hr1157", "hr1398", "hr1836", "hr2000", "hr2864",
  "hr3334", "hr4004", "hr4173", "hr4219", "hr4227", "hr5515", "hr6323",
  "hr7176", "hr7217", "hr7249", "hr7624", "hr7909", "hr8233", "hr8270",
  "hr8360", "hr8446", "hr8790", "hr8800", "hr8867", "hr9456",

  // Senate Bills
  "s257", "s426", "s1130", "s1631", "s1687", "s1890", "s2074", "s2228",
  "s2292", "s2426", "s3283", "s3312", "s3589", "s3654", "s4031", "s4089",
  "s4111", "s4159", "s4239", "s4532", "s4591", "s4909", "s5015", "s5384",
  "s5385", "s5524",

  // Resolutions
  "hres109", "hres1398", "sres906"
];

// Helper functions
function normalizeUrl(u) {
  try {
    const url = new URL(u);
    url.hash = "";
    if (url.search) url.search = "";
    let s = url.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return (u || "").trim();
  }
}

function idFromCanonical(c) {
  let h = 0;
  for (let i = 0; i < c.length; i++) h = (h * 31 + c.charCodeAt(i)) >>> 0;
  return `tracked_bill_${h.toString(16)}`;
}

function toEpoch(d) {
  const t = Date.parse(d);
  return Number.isFinite(t) ? Math.floor(t / 1000) : Math.floor(Date.now() / 1000);
}

// Parse bill number into congress, type, and number
function parseBillNumber(billStr) {
  // Examples: "hr1234" -> {type: "hr", number: "1234"}
  //           "s5678" -> {type: "s", number: "5678"}
  const match = billStr.toLowerCase().match(/^([a-z]+)(\d+)$/);
  if (!match) return null;

  return {
    type: match[1],
    number: match[2]
  };
}

// Fetch specific bill from Congress.gov API
async function fetchBill(congress, type, number, apiKey) {
  try {
    const url = `https://api.congress.gov/v3/bill/${congress}/${type}/${number}?api_key=${apiKey}&format=json`;

    const response = await fetch(url, {
      headers: {
        'X-Api-Key': apiKey,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      console.log(`Could not fetch bill ${type}${number}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data.bill || null;
  } catch (error) {
    console.log(`Error fetching bill ${type}${number}:`, error.message);
    return null;
  }
}

// Fetch detailed bill summary
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
      return null;
    }

    const data = await response.json();

    if (data.summaries && data.summaries.length > 0) {
      return data.summaries[0].text || null;
    }

    return null;
  } catch (error) {
    return null;
  }
}

// Send email alert for updated bill
async function sendBillAlert(bill, isNew) {
  if (!resend || !process.env.RESEND_FROM_EMAIL || !process.env.RESEND_TO_EMAIL) {
    console.log("Email alerts not configured - skipping alert");
    return;
  }

  try {
    const subject = isNew
      ? `New Tracked Bill: ${bill.bill_number}`
      : `Bill Update: ${bill.bill_number}`;

    const html = `
      <h2>${subject}</h2>
      <p><strong>Bill:</strong> ${bill.title}</p>
      <p><strong>Latest Action (${bill.latest_action_date}):</strong><br/>${bill.summary}</p>
      <p><a href="${bill.link}">View on Congress.gov</a></p>
    `;

    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to: process.env.RESEND_TO_EMAIL,
      subject,
      html
    });

    console.log(`Alert sent for ${bill.bill_number}`);
  } catch (error) {
    console.error(`Failed to send alert for ${bill.bill_number}:`, error.message);
  }
}

export default async function handler(req, res) {
  try {
    const congress = process.env.CONGRESS_NUMBER || "119";
    const apiKey = process.env.CONGRESS_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error: "CONGRESS_API_KEY not configured"
      });
    }

    let fetched = 0, stored = 0, updated = 0, skipped = 0;
    const errors = [];
    const newBills = [];
    const updatedBills = [];

    console.log(`Tracking ${TRACKED_BILLS.length} bills`);

    // Calculate 7 days ago timestamp for filtering
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);

    for (const billStr of TRACKED_BILLS) {
      try {
        const parsed = parseBillNumber(billStr);
        if (!parsed) {
          console.log(`Invalid bill number format: ${billStr}`);
          errors.push({ bill: billStr, error: "Invalid format" });
          continue;
        }

        const { type, number } = parsed;
        const billId = `${type}${number}`;

        // Fetch bill data
        const bill = await fetchBill(congress, type, number, apiKey);
        if (!bill) {
          console.log(`Could not fetch ${billId}`);
          errors.push({ bill: billId, error: "Not found" });
          continue;
        }

        fetched++;

        // Get latest action date
        const latestActionDate = bill.latestAction?.actionDate;
        const latestActionText = bill.latestAction?.text || "";

        if (!latestActionDate) {
          console.log(`No latest action date for ${billId} - skipping`);
          skipped++;
          continue;
        }

        const actionTimestamp = toEpoch(latestActionDate);

        // Only process bills updated in the past 7 days
        if (actionTimestamp < sevenDaysAgo) {
          console.log(`${billId} not updated in past 7 days (last: ${latestActionDate}) - skipping`);
          skipped++;
          continue;
        }

        // Check Redis for last known action date
        const redisKey = `${TRACKED_BILLS_PREFIX}${billId}:last_action`;
        const storedActionDate = await redis.get(redisKey);

        const isNew = !storedActionDate;
        const hasUpdate = storedActionDate && storedActionDate !== latestActionDate;

        if (isNew) {
          console.log(`New tracked bill: ${billId} (action: ${latestActionDate})`);
        } else if (hasUpdate) {
          console.log(`Update detected for ${billId}: ${storedActionDate} -> ${latestActionDate}`);
        } else {
          // No change since last check
          skipped++;
          continue;
        }

        // Build bill URL
        const typeMap = {
          's': 'senate-bill',
          'hr': 'house-bill',
          'sres': 'senate-resolution',
          'hres': 'house-resolution',
          'sjres': 'senate-joint-resolution',
          'hjres': 'house-joint-resolution',
          'sconres': 'senate-concurrent-resolution',
          'hconres': 'house-concurrent-resolution'
        };
        const urlType = typeMap[type.toLowerCase()] || `${type.toLowerCase()}-bill`;
        const billUrl = `https://www.congress.gov/bill/${congress}th-congress/${urlType}/${number}`;
        const canon = normalizeUrl(billUrl);

        // Fetch detailed summary
        let summary = latestActionText;
        const detailedSummary = await fetchBillSummary(congress, type, number, apiKey);
        if (detailedSummary) {
          summary = detailedSummary;
        }

        // Build mention object
        const m = {
          id: idFromCanonical(canon),
          canon,
          section: "Congress - Tracked Bills",
          title: `${billId.toUpperCase()}: ${bill.title}`,
          link: billUrl,
          source: "Congress.gov",
          matched: ["tracked"],
          summary: summary,
          origin: "congress_tracked",
          published_ts: actionTimestamp,
          published: new Date(actionTimestamp * 1000).toISOString(),
          bill_number: billId.toUpperCase(),
          congress_number: congress,
          bill_type: type,
          introduced_date: bill.introducedDate || null,
          latest_action_date: latestActionDate,
          is_tracked: true,
          update_type: isNew ? "new" : "update"
        };

        // Always store/update in Redis ZSET (overwrites old entry if exists)
        // First remove any existing entry for this bill
        const existingRaw = await redis.zrange(ZSET, '-inf', '+inf', { byScore: true });
        const existing = existingRaw.find(item => {
          try {
            const parsed = typeof item === 'string' ? JSON.parse(item) : item;
            return parsed.canon === canon;
          } catch {
            return false;
          }
        });

        if (existing) {
          await redis.zrem(ZSET, existing);
        }

        // Add new/updated entry
        await redis.zadd(ZSET, { score: actionTimestamp, member: JSON.stringify(m) });

        // Update last action date in Redis
        await redis.set(redisKey, latestActionDate);

        // Add to deduplication sets
        await redis.sadd(SEEN_ID, m.id);
        await redis.sadd(SEEN_LINK, canon);

        stored++;

        if (isNew) {
          newBills.push(billId);
          await sendBillAlert(m, true);
        } else if (hasUpdate) {
          updated++;
          updatedBills.push(billId);
          await sendBillAlert(m, false);
        }

      } catch (err) {
        console.error(`Error processing ${billStr}:`, err);
        errors.push({ bill: billStr, error: err?.message || String(err) });
      }
    }

    // Cleanup old articles
    const cutoffTimestamp = Math.floor(Date.now() / 1000) - (RETENTION_DAYS * 24 * 60 * 60);
    await redis.zremrangebyscore(ZSET, '-inf', cutoffTimestamp);

    console.log(`Tracked bills collection complete: ${stored} stored, ${updated} updated, ${skipped} skipped`);

    res.status(200).json({
      ok: true,
      source: "Congress.gov Tracked Bills",
      congress,
      total_tracked: TRACKED_BILLS.length,
      fetched,
      stored,
      updated,
      skipped,
      new_bills: newBills,
      updated_bills: updatedBills,
      errors: errors.length > 0 ? errors : undefined,
      generated_at: new Date().toISOString()
    });

  } catch (e) {
    console.error("Tracked bills collection error:", e);
    res.status(500).json({
      ok: false,
      error: `Tracked bills collection failed: ${e?.message || e}`
    });
  }
}
