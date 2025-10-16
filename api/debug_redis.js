// Debug endpoint to check Redis state
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.STORAGE_KV_REST_API_URL,
  token: process.env.STORAGE_KV_REST_API_TOKEN,
});

const FLAGGED_SET = "articles:flagged:ids";
const FLAGGED_HASH = "articles:flagged:data";

export default async function handler(req, res) {
  try {
    // Get all members from the Set
    const setMembers = await redis.smembers(FLAGGED_SET);

    // Get all fields from the Hash
    const hashKeys = await redis.hkeys(FLAGGED_HASH) || [];
    const hashValues = hashKeys.length > 0 ? await redis.hmget(FLAGGED_HASH, ...hashKeys) : [];

    // Get Set cardinality
    const setCard = await redis.scard(FLAGGED_SET);

    // Get Hash length
    const hashLen = await redis.hlen(FLAGGED_HASH);

    return res.status(200).json({
      ok: true,
      set_key: FLAGGED_SET,
      hash_key: FLAGGED_HASH,
      set_cardinality: setCard,
      set_members: setMembers,
      hash_length: hashLen,
      hash_keys: hashKeys,
      hash_sample: Array.isArray(hashValues) ? hashValues.slice(0, 2) : [hashValues],
      diagnosis: {
        set_has_members: setMembers && setMembers.length > 0,
        hash_has_data: hashKeys && hashKeys.length > 0,
        keys_match: JSON.stringify((setMembers || []).sort()) === JSON.stringify((hashKeys || []).sort()),
        hashValues_type: typeof hashValues,
        hashValues_isArray: Array.isArray(hashValues)
      }
    });

  } catch (e) {
    console.error('Debug Redis error:', e);
    res.status(500).json({
      ok: false,
      error: e?.message || String(e)
    });
  }
}
