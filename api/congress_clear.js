// /api/congress_clear.js
// Clear Congress bills from Redis so they can be re-collected
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.STORAGE_KV_REST_API_URL,
  token: process.env.STORAGE_KV_REST_API_TOKEN,
});

const ZSET = "mentions:z";
const SEEN_ID = "mentions:seen";
const SEEN_LINK = "mentions:seen:canon";

function toObj(x) {
  if (!x) return null;
  if (typeof x === "object" && x.id) return x;
  try {
    return JSON.parse(x);
  } catch { return null; }
}

export default async function handler(req, res) {
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

    console.log(`Found ${congressBills.length} Congress bills to remove`);

    let removed = 0;

    for (const bill of congressBills) {
      // Remove from main sorted set
      await redis.zrem(ZSET, JSON.stringify(bill));

      // Remove from deduplication sets
      if (bill.id) {
        await redis.srem(SEEN_ID, bill.id);
      }
      if (bill.canon) {
        await redis.srem(SEEN_LINK, bill.canon);
      }

      removed++;
      console.log(`Removed: ${bill.title}`);
    }

    res.status(200).json({
      ok: true,
      removed,
      message: `Removed ${removed} Congress bills from Redis. Run /api/congress_collect to re-import with updated summaries.`
    });
  } catch (e) {
    console.error("Clear Congress bills error:", e);
    res.status(500).json({
      ok: false,
      error: e?.message || String(e)
    });
  }
}
