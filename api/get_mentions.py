import os, json
from urllib.parse import urlparse, parse_qs
from http.server import BaseHTTPRequestHandler
from upstash_redis import Redis

REDIS = Redis(url=os.getenv("KV_REST_API_URL"), token=os.getenv("KV_REST_API_TOKEN"))
ZSET  = "mentions:z"

def _json(self, obj, status=200):
    data = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    self.send_response(status)
    self.send_header("Content-Type", "application/json; charset=utf-8")
    self.send_header("Content-Length", str(len(data)))
    self.end_headers()
    self.wfile.write(data)

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            qs = parse_qs(urlparse(self.path).query)
            try:
                limit = int(qs.get("limit", ["200"])[0]); limit = max(1, min(500, limit))
            except Exception:
                limit = 200

            raw = REDIS.zrevrange(ZSET, 0, limit - 1) or []
            out = []
            for s in raw:
                if isinstance(s, (bytes, bytearray)):
                    s = s.decode("utf-8", errors="ignore")
                try:
                    out.append(json.loads(s))
                except Exception:
                    continue
            _json(self, out, 200)
        except Exception as e:
            _json(self, {"ok": False, "error": f"get_mentions failed: {type(e).__name__}: {e}"}, 500)
