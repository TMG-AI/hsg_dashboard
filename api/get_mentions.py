import os, json, hashlib, time
from http.server import BaseHTTPRequestHandler
from upstash_redis import Redis

# --- START: Code from _shared.py is now inside this file ---
redis_client = Redis(
    url=os.environ.get('KV_REST_API_URL' ), 
    token=os.environ.get('KV_REST_API_TOKEN')
)

def get_latest_mentions(limit: int = 50) -> list:
    mention_ids = redis_client.zrange('mentions_sorted_set', 0, limit - 1, desc=True)
    if not mention_ids:
        return []
    
    results = redis_client.mget(*mention_ids)
    return [json.loads(m.decode('utf-8')) for m in results if m]
# --- END: Code from _shared.py ---

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            mentions = get_latest_mentions()
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(mentions).encode('utf-8'))
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
        return
