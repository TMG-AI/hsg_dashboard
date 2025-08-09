import os, feedparser, time
from http.server import BaseHTTPRequestHandler
from datetime import datetime
from dateutil import parser as dtp
# --- UPDATE: Import the new email function ---
from _shared import redis_client, get_mention_id, store_mention_data, send_email_alert

# --- Configuration from Environment Variables ---
RSS_FEEDS = [u.strip( ) for u in os.getenv("RSS_FEEDS", "").split(",") if u.strip()]
KEYWORDS = [k.strip().lower() for k in os.getenv("KEYWORDS", "").split(",") if k.strip()]

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if not all([os.environ.get('KV_REST_API_URL'), os.environ.get('KV_REST_API_TOKEN')]):
            self.send_response(500); self.end_headers(); self.wfile.write(b"Server Error: Missing Database Credentials."); return
        if not RSS_FEEDS or not KEYWORDS:
            self.send_response(400); self.end_headers(); self.wfile.write(b"Configuration Error: Missing RSS_FEEDS or KEYWORDS."); return

        for url in RSS_FEEDS:
            try:
                feed = feedparser.parse(url)
                source_title = feed.feed.get("title", url)
                for entry in feed.entries:
                    text_to_search = f"{entry.get('title', '')} {entry.get('summary', '')}".lower()
                    if any(keyword in text_to_search for keyword in KEYWORDS):
                        mention_id = get_mention_id(entry.link)
                        if not redis_client.exists(mention_id):
                            print(f"New mention found: {entry.title}")
                            published_ts = int(time.time())
                            try: published_ts = int(dtp.parse(entry.published).timestamp())
                            except: pass
                            
                            mention_data = {
                                "id": mention_id, "title": entry.title, "link": entry.link,
                                "source": source_title, "published": entry.get("published", datetime.utcnow().isoformat()),
                                "published_ts": published_ts
                            }
                            store_mention_data(mention_id, mention_data)
                            # --- UPDATE: Call the new email function ---
                            send_email_alert(mention_data)
            except Exception as e:
                print(f"Failed to process feed {url}: {e}")

        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"Collection complete.")
        return
