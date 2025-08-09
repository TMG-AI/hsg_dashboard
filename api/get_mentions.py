import os, json, hashlib, time
from http.server import BaseHTTPRequestHandler
from upstash_redis import Redis

# --- START: Code from _shared.py is now inside this file ---
redis_client = Redis(
    url=os.environ.get('KV_REST_API_URL' ), 
    token=os.environ.get('KV_REST_API_TOKEN')
)

def get_latest_mentions(limit: int = 50) -> list:
    # This function fetches the IDs of the latest mentions from our sorted set
    mention_ids = redis_client.zrange('mentions_sorted_set', 0, limit - 1, desc=True)
    
    if not mention_ids:
        print("get_latest_mentions: No mention IDs found in sorted set.")
        return []
    
    print(f"get_latest_mentions: Found {len(mention_ids)} IDs to fetch.")
    
    # Fetch all the mention data from Redis using the IDs
    # The mget command is efficient for fetching multiple keys at once
    results = redis_client.mget(*mention_ids)
    
    mentions = []
    for i, item in enumerate(results):
        # --- ROBUST FIX STARTS HERE ---
        # We must check if the item is not None and is a bytes object before decoding
        if item and isinstance(item, bytes):
            try:
                # Decode the bytes to a string, then parse the JSON
                mentions.append(json.loads(item.decode('utf-8')))
            except json.JSONDecodeError:
                print(f"Error decoding JSON for item index {i}")
            except Exception as e:
                print(f"An unexpected error occurred processing item index {i}: {e}")
        # --- ROBUST FIX ENDS HERE ---
        
    print(f"get_latest_mentions: Successfully processed and returning {len(mentions)} mentions.")
    return mentions
# --- END: Code from _shared.py ---

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            # This now calls the more robust function defined above
            mentions = get_latest_mentions()
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(mentions).encode('utf-8'))
        except Exception as e:
            # This will catch any other unexpected errors
            print(f"FATAL ERROR in get_mentions handler: {e}")
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "An internal server error occurred.", "details": str(e)}).encode('utf-8'))
        return
