# api/get_mentions.py
import os, json, ast, traceback
from upstash_redis import Redis

# Initialize once (fail-safe)
REDIS_URL  = os.getenv("KV_REST_API_URL")
REDIS_TOKEN= os.getenv("KV_REST_API_TOKEN")
ZSET       = "mentions:z"

def _safe_parse(item: str):
    """Parse JSON first; if that fails, try legacy str(dict) via ast.literal_eval."""
    if item is None:
        return None
    if isinstance(item, (bytes, bytearray)):
        item = item.decode("utf-8", errors="ignore")
    # JSON path
    try:
        return json.loads(item)
    except Exception:
        pass
    # Legacy str(dict)
    try:
        v = ast.literal_eval(item)
        return v if isinstance(v, dict) else None
    except Exception:
        return None

def handler(request):
    # Basic env checks with explicit 500 explanation instead of stack trace
    if not REDIS_URL or not REDIS_TOKEN:
        return ({"ok": False, "error": "Missing KV_REST_API_URL or KV_REST_API_TOKEN"}, 500)

    try:
        r = Redis(url=REDIS_URL, token=REDIS_TOKEN)
    except Exception as e:
        return ({"ok": False, "error": f"Redis init failed: {type(e).__name__}: {e}"}, 500)

    # limit handling
    limit = 200
    try:
        qs = request.args or {}
        if "limit" in qs:
            limit = max(1, min(500, int(qs.get("limit"))))
    except Exception:
        pass

    try:
        raw = r.zrevrange(ZSET, 0, limit - 1) or []
        out = []
        for s in raw:
            parsed = _safe_parse(s)
            if parsed and isinstance(parsed, dict):
                out.append(parsed)
        # Return a bare array (your frontend expects this)
        return (out, 200)
    except Exception as e:
        # Never 500 silently—surface a compact diagnostic payload
        return (
            {
                "ok": False,
                "error": f"Unhandled in get_mentions: {type(e).__name__}: {e}",
                "hint": "If you recently changed storage format, some legacy records may be malformed.",
            },
            500,
        )
