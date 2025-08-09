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
URGENT_KEYWORDS = [k.strip().lower() for k in os.getenv("URGENT_KEYWORDS", "").split(",") if k.strip()]

def get_mention_id(link: str) -> str:
    return hashlib.sha256(link.encode("utf-8")).hexdigest()

def store_mention_data(mention_id: str, data: dict):
    score = data.get("published_ts", int(time.time()))
    redis_client.set(mention_id, json.dumps(data))
    redis_client.zadd('mentions_sorted_set', {mention_id: score})
    print(f"  ✅ Successfully stored mention ID: {mention_id}")

def send_email_alert(data: dict):
    if not resend.api_key or not DESTINATION_EMAIL:
        print("  - Email alert skipped: Resend API Key or Destination Email not set.")
        return
    try:
        subject = f"**URGENT** Coinbase Mention: {data.get('source')}"
        html_body = f"""<h3><a href='{data.get("link")}'>{data.get("title")}</a></h3><p><strong>Source:</strong> {data.get('source')}</p><p><strong>Published:</strong> {data.get('published')}</p>"""
        params = {"from": "PR Alerter <onboarding@resend.dev>", "to": [DESTINATION_EMAIL], "subject": subject, "html": html_body}
        resend.Emails.send(params)
        print(f"  ✅ URGENT email alert sent for: {data.get('title')}")
    except Exception as e:
        print(f"  ❌ Email alert failed: {e}")
# --- END: Code from _shared.py ---

# --- Configuration from Environment Variables ---
RSS_FEEDS = [u.strip() for u in os.getenv("RSS_FEEDS", "").split(",") if u.strip()]
KEYWORDS = [k.strip().lower() for k in os.getenv("KEYWORDS", "").split(",") if k.strip()]

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        print("\n--- COLLECTOR SCRIPT STARTED ---")
        
        # --- DIAGNOSTIC LOGGING ---
        print(f"Found {len(RSS_FEEDS)} RSS Feeds.")
        print(f"Found {len(KEYWORDS)} Keywords to track.")
        print(f"Found {len(URGENT_KEYWORDS)} Urgent Keywords.")
        if not all([os.environ.get('KV_REST_API_URL'), os.environ.get('KV_REST_API_TOKEN')]):
            print("❌ FATAL: Missing Database Credentials. Exiting.")
            self.send_response(500); self.end_headers(); self.wfile.write(b"Server Error: Missing Database Credentials."); return
        print("✅ Database credentials found.")
        
        total_found_this_run = 0
        for url in RSS_FEEDS:
            print(f"\nProcessing feed: {url}")
            try:
                feed = feedparser.parse(url)
                source_title = feed.feed.get("title", "Unknown Source")
                print(f"  - Found {len(feed.entries)} entries in feed.")
                
                for entry in feed.entries:
                    text_to_search = f"{entry.get('title', '')} {entry.get('summary', '')}".lower()
                    
                    if any(keyword in text_to_search for keyword in KEYWORDS):
                        mention_id = get_mention_id(entry.link)
                        
                        if not redis_client.exists(mention_id):
                            total_found_this_run += 1
                            print(f"  - NEW MENTION FOUND: {entry.title}")
                            
                            published_ts = int(time.time())
                            try: published_ts = int(dtp.parse(entry.published).timestamp())
                            except: pass
                            
                            mention_data = {
                                "id": mention_id, "title": entry.title, "link": entry.link,
                                "source": source_title, "published": entry.get("published", datetime.utcnow().isoformat()),
                                "published_ts": published_ts
                            }
                            store_mention_data(mention_id, mention_data)

                            urgent_text_to_search = f"{entry.title} {source_title}".lower()
                            if any(urgent_keyword in urgent_text_to_search for urgent_keyword in URGENT_KEYWORDS):
                                print("  - Mention matches URGENT keywords. Sending alert.")
                                send_email_alert(mention_data)
            except Exception as e:
                print(f"❌ ERROR processing feed {url}: {e}")

        print(f"\n--- COLLECTOR SCRIPT FINISHED ---")
        print(f"Total new mentions found in this run: {total_found_this_run}")
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"Collection complete. Check logs for details.")
        return
