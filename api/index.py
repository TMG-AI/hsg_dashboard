import os
import feedparser
import requests
import hashlib
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError
from http.server import BaseHTTPRequestHandler
# --- FIX: Changed 'kv' to 'KV' ---
from vercel_kv import KV
import time

# --- FIX: Create an instance of the KV class ---
kv = KV( )

# --- CONFIGURATION ---
SLACK_BOT_TOKEN = os.environ.get("SLACK_BOT_TOKEN")
SLACK_CHANNEL_NAME = "coinbase-intel"
KEYWORDS_TO_TRACK = ["coinbase", "base", "usdc"] # Lowercase for easier matching

# --- List of RSS Feeds to Monitor ---
RSS_FEEDS = {
    "CoinDesk": "https://www.coindesk.com/arc/outboundfeeds/rss/",
    "The Block": "https://www.theblock.co/rss.xml",
    "Cointelegraph": "https://cointelegraph.com/rss",
    "Decrypt": "https://decrypt.co/feed",
    "Blockworks": "https://blockworks.co/feed",
    "TechCrunch Crypto": "https://techcrunch.com/category/cryptocurrency/feed/",
    "Forbes Crypto": "https://www.forbes.com/crypto-blockchain/feed/",
}

slack_client = WebClient(token=SLACK_BOT_TOKEN )

def send_slack_notification(message):
    if not SLACK_BOT_TOKEN:
        print("Slack Bot Token not set. Cannot send notification.")
        return
    try:
        slack_client.chat_postMessage(channel=SLACK_CHANNEL_NAME, text=message)
    except SlackApiError as e:
        print(f"Error sending to Slack: {e.response['error']}")

# --- Main handler function that Vercel will run ---
class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        print("--- Starting Scan ---")

        for name, url in RSS_FEEDS.items():
            try:
                feed = feedparser.parse(url)
                for entry in feed.entries:
                    if any(keyword in entry.title.lower() for keyword in KEYWORDS_TO_TRACK):
                        mention_id = hashlib.md5(entry.link.encode()).hexdigest()
                        
                        if kv.get(mention_id) is None:
                            print(f"New mention found: {entry.title}")
                            
                            publish_timestamp = time.time()
                            if hasattr(entry, 'published_parsed') and entry.published_parsed is not None:
                                publish_timestamp = time.mktime(entry.published_parsed)

                            mention_data = {
                                "id": mention_id,
                                "source": name,
                                "title": entry.title,
                                "link": entry.link,
                                "published": entry.get("published", time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(publish_timestamp))),
                                "type": "news"
                            }
                            
                            kv.set(mention_id, mention_data)
                            kv.zadd('mentions', {mention_id: publish_timestamp})

                            message = f"📰 *New Article Mention from {name}*\n>{entry.title}\n{entry.link}"
                            send_slack_notification(message)
                        else:
                            print(f"Duplicate mention skipped: {entry.title}")
            except Exception as e:
                print(f"Error processing feed {name}: {e}")

        self.send_response(200)
        self.send_header('Content-type','text/plain')
        self.end_headers()
        self.wfile.write("Scan complete.".encode('utf-8'))
        return
