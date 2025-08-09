from http.server import BaseHTTPRequestHandler
import json
import os
from upstash_redis import Redis

# --- FINAL FIX: Use the official Upstash library and configure it manually ---
redis = Redis(
    url=os.environ.get('UPSTASH_REDIS_REST_URL' ), 
    token=os.environ.get('UPSTASH_REDIS_REST_TOKEN')
)

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            # Fetch the IDs of the latest 50 mentions, most recent first
            # Note: Upstash uses 'zrange' differently, but this works.
            mention_ids = redis.zrange('mentions', 0, 49, desc=True)
            
            mentions = []
            if mention_ids:
                # mget fetches multiple keys at once
                # We need to decode the results from bytes to strings
                results = redis.mget(*mention_ids)
                mentions = [json.loads(m) for m in results if m is not None]
            
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
