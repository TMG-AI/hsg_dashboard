# api/get_mentions.py
import os, json
from upstash_redis import Redis

REDIS = Redis(url=os.getenv("KV_REST_API_URL"), token=os.getenv("KV_REST_API_TOKEN"))
ZSET_MENTIONS = "mentions:z"

def handler(request):
    limit = 200
    try:
        q = request.args
        if "limit" in q:
            limit = max(1, min(500, int(q.get("limit"))))
    except Exception:
        pass

    raw = REDIS.zrevrange(ZSET_MENTIONS, 0, limit - 1)
    out = []
    for s in raw or []:
        try:
            out.append(json.loads(s))
        except Exception:
            continue
    # Return a bare list (your index.html expects this)
    return (out, 200)
