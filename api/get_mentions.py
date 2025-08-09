import os, json, hashlib, time
from http.server import BaseHTTPRequestHandler
from upstash_redis import Redis

# --- START: Code from _shared.py is now inside this file ---
redis_client = Redis(
    url=os.environ.get('KV_REST_API_URL' ), 
    token=os.environ.get('KV_REST_API_TOKEN')
)

def get_latest_mentions(limit: int = 50) -> list:
    # --- FINAL FIX STARTS HERE ---
    # Fetch the results in ascending order (the default, which works)
    # The 'desc' parameter was incorrect and has been removed.
    mention_ids = redis_client.zrange('mentions_sorted_set', 0, limit - 1)
    
    # Now, reverse the list in Python to get the most recent first.
    mention_ids.reverse()
    # --- FINAL FIX ENDS HERE ---

    if not mention_ids:
        return []
    
    results = redis_client.mget(*mention_ids)
    
    mentions = []
    for item in results:
        if item and isinstance(item, bytes):
            try:
                mentions.append(json.loads(item.decode('utf-8')))
            except Exception as e:
                print(f"Error decoding a mention from database: {e}")
        
    return mentions
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
            print(f"FATAL ERROR in get_mentions handler: {e}")
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "An internal server error occurred.", "details": str(e)}).encode('utf-8'))
        return
