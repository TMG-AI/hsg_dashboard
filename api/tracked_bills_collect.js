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

// TRACKED BILLS LIST - Bills from user's China policy tracking list
const TRACKED_BILLS = [
  // Senate Bills (26 total)
  "s2047",  // No Capital Gains Allowance for American Adversaries Act
  "s2048",  // PRC Military and Human Rights Capital Markets Sanctions Act
  "s2046",  // No China in Index Funds Act
  "s2045",  // Protecting Endowments from Our Adversaries Act
  "s1748",  // Kids Online Safety Act
  "s836",   // Children and Teens' Online Privacy Protection Act
  "s1296",  // DETERRENT Act
  "s1185",  // FIGHTING for America Act
  "s1053",  // FIGHT China Act
  "s278",   // Kids Off Social Media Act (KOSMA)
  "s1356",  // TICKER Act
  "s1360",  // Protecting American Capital Act of 2025
  "s1357",  // SAFE Act
  "s1358",  // TASK Act
  "s1359",  // STOP CCP Act
  "s244",   // ROUTERS Act
  "s97",    // Securing Semiconductor Supply Chains Act
  "s257",   // Promoting Resilient Supply Chains Act of 2025
  "s817",   // Falun Gong Protection Act
  "s2224",  // Taiwan International Solidarity Act
  "s1705",  // Chip Security Act
  "s1711",  // STOP China Act
  "s1625",  // SHIELD Against CCP Act
  "s1934",  // Securing Our Energy Supply Chains Act
  "s2268",  // Agricultural Risk Review Act of 2025
  "s744",   // Maintaining American Superiority by Improving Export Control Transparency Act

  // House Bills (24 total)
  "hr1549", // China Financial Threat Mitigation Act of 2025
  "hr2914", // NO LIMITS Act
  "hr2683", // Remote Access Security Act
  "hr1048", // DETERRENT Act
  "hr2246", // FIGHT China Act
  "hr906",  // Foreign Adversary Communications Transparency Act
  "hr866",  // ROUTERS Act
  "hr2480", // Securing Semiconductor Supply Chains Act
  "hr2444", // Promoting Resilient Supply Chains Act of 2025
  "hr1540", // Falun Gong Protection Act
  "hr1724", // The No Dollars to Uyghur Forced Labor Act
  "hr1503", // Stop Forced Organ Harvesting Act of 2025
  "hr2416", // Taiwan International Solidarity Act
  "hr3447", // Chip Security Act
  "hr4361", // STOP China Act
  "hr708",  // SHIELD Against CCP Act
  "hr2390", // Maritime Supply Chain Security Act
  "hr252",  // Secure Our Ports act of 2025
  "hr2035", // American Cargo for American Ships Act
  "hr1713", // Agricultural Risk Review Act of 2025
  "hr4505", // Export Controls Enforcement Act
  "hr1316", // Maintaining American Superiority by Improving Export Control Transparency Act
  "hr4978", // Secure Trade Act
  "hr747",  // Stop Chinese Fentanyl Act
  "hr5022"  // No Advanced Chips for the CCP Act of 2025
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
