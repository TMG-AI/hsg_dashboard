from http.server import BaseHTTPRequestHandler
import json
import os
from vercel_kv import KV

# --- MANUAL FIX: Explicitly load credentials from environment variables ---
kv = KV(
    url=os.environ.get('KV_URL' ),
    rest_api_url=os.environ.get('KV_REST_API_URL'),
    rest_api_token=os.environ.get('KV_REST_API_TOKEN'),
    rest_api_read_only_token=os.environ.get('KV_REST_API_READ_ONLY_TOKEN')
)

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            mention_ids = kv.zrange('mentions', 0, 49, desc=True)
            
            mentions = []
            if mention_ids:
                mentions = kv.mget(*mention_ids)
            
            mentions = [m for m in mentions if m is not None]

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
