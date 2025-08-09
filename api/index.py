import os
import feedparser
import requests
import hashlib
import json
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError
from http.server import BaseHTTPRequestHandler
from upstash_redis import Redis
import time

# --- FINAL, CORRECTED FIX: Use the Upstash library with the existing KV_... environment variables ---
redis = Redis(
    url=os.environ.get('KV_REST_API_URL' ), 
    token=os.environ.get('KV_REST_API_TOKEN')
)

# --- CONFIGURATION ---
SLACK_BOT_TOKEN = os.environ.get("SLACK_BOT_TOKEN")
SLACK_CHANNEL_NAME = "coinbase-intel"
KEYWORDS_TO_TRACK = ["coinbase", "base", "usdc"]

RSS_FEEDS = {
    "CoinDesk": "https://www.coindesk.com/arc/outboundfeeds/rss/",
    "The Block": "https://www.theblock.co/rss.xml",
    "Cointelegraph": "https://cointelegraph.com/rss",
}

slack_client = WebClient(token=SLACK_BOT_TOKEN )

def send_slack_notification(message):
    if not SLACK_BOT_TOKEN: return
    try:
        slack_client.chat_postMessage(channel=SLACK_CHANNEL_NAME, text=message)
    except SlackApiError as e:
        print(f"Error sending to Slack: {e.response['error']}")

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        print("--- Starting Scan ---")
        for name, url in RSS_FEEDS.items():
            try:
                feed = feedparser.parse(url)
                for entry in feed.entries:
                    if any(keyword in entry.title.lower() for keyword in KEYWORDS_TO_TRACK):
                        mention_id = hashlib.md5(entry.link.encode()).hexdigest()
                        
                        if not redis.exists(mention_id):
                            print(f"New mention found: {entry.title}")
                            
                            publish_timestamp = time.time()
                            if hasattr(entry, 'published_parsed') and entry.published_parsed is not None:
                                publish_timestamp = time.mktime(entry.published_parsed)

                            mention_data = {
                                "id": mention_id, "source": name, "title": entry.title,
                                "link": entry.link, "published": entry.get("published"), "type": "news"
                            }
                            
                            redis.set(mention_id, json.dumps(mention_data))
                            redis.zadd('mentions', {mention_id: publish_timestamp})

                            message = f"📰 *New Article Mention from {name}*\n>{entry.title}\n{entry.link}"
                            send_slack_notification(message)
            except Exception as e:
                print(f"Error processing feed {name}: {e}")

        self.send_response(200)
        self.send_header('Content-type','text/plain')
        self.end_headers()
        self.wfile.write("Scan complete.".encode('utf-8'))
        return
