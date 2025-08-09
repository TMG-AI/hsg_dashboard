import os, feedparser, time, hashlib, json
from http.server import BaseHTTPRequestHandler
from datetime import datetime
from dateutil import parser as dtp
from upstash_redis import Redis
import resend

# --- START: Code from _shared.py is now inside this file ---
redis_client = Redis(
    url=os.environ.get('KV_REST_API_URL' ), 
    token=os.environ.get('KV_REST_API_TOKEN')
)
resend.api_key = os.environ.get("RESEND_API_KEY")
DESTINATION_EMAIL = os.environ.get("DESTINATION_EMAIL")

def get_mention_id(link: str) -> str:
    return hashlib.sha256(link.encode("utf-8")).hexdigest()

def store_mention_data(mention_id: str, data: dict):
    score = data.get("published_ts", int(time.time()))
    redis_client.set(mention_id, json.dumps(data))
    redis_client.zadd('mentions_sorted_set', {mention_id: score})

def send_email_alert(data: dict):
    if not resend.api_key or not DESTINATION_EMAIL:
        print("Resend API Key or Destination Email not set.")
        return
    try:
        subject = f"New Coinbase Mention: {data.get('source')}"
        html_body = f"""<h3><a href='{data.get("link")}'>{data.get("title")}</a></h3><p><strong>Source:</strong> {data.get('source')}</p><p><strong>Published:</strong> {data.get('published')}</p>"""
        params = {"from": "PR Alerter <onboarding@resend.dev>", "to": [DESTINATION_EMAIL], "subject": subject, "html": html_body}
        resend.Emails.send(params)
        print(f"Email alert sent for: {data.get('title')}")
    except Exception as e:
        print(f"Email alert failed: {e}")
# --- END: Code from _shared.py ---

# --- Configuration from Environment Variables ---
RSS_FEEDS = [u.strip() for u in os.getenv("RSS_FEEDS", "").split(",") if u.strip()]
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
                            send_email_alert(mention_data)
                            # --- FINAL FIX: Add a small delay to respect the rate limit ---
                            time.sleep(0.6) # Sleep for 600ms, allowing less than 2 requests/sec
            except Exception as e:
                print(f"Failed to process feed {url}: {e}")

        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"Collection complete.")
        return
