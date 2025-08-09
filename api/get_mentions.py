from http.server import BaseHTTPRequestHandler
import json
# --- FIX: Changed 'kv' to 'KV' ---
from vercel_kv import KV

# --- FIX: Create an instance of the KV class ---
kv = KV( )

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            # Fetch the IDs of the latest 50 mentions from our sorted set, most recent first
            mention_ids = kv.zrange('mentions', 0, 49, desc=True)
            
            mentions = []
            if mention_ids:
                # mget fetches multiple keys at once, which is efficient
                mentions = kv.mget(*mention_ids)
            
            # Filter out any potential null results if an item was deleted or expired
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
