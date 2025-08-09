from http.server import BaseHTTPRequestHandler
import json
import os
from upstash_redis import Redis

# --- FINAL, CORRECTED FIX: Use the Upstash library with the existing KV_... environment variables ---
redis = Redis(
    url=os.environ.get('KV_REST_API_URL' ), 
    token=os.environ.get('KV_REST_API_TOKEN')
)

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            mention_ids = redis.zrange('mentions', 0, 49, desc=True)
            
            mentions = []
            if mention_ids:
                results = redis.mget(*mention_ids)
                # The results from the database need to be decoded from bytes
                mentions = [json.loads(m.decode('utf-8')) for m in results if m is not None]
            
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
