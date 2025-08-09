import os
import feedparser
import requests
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError
from http.server import BaseHTTPRequestHandler

# --- CONFIGURATION ---
# --- You will set these as Environment Variables in Vercel ---
# Use the "Bot User OAuth Token" that starts with "xoxb-"
SLACK_BOT_TOKEN = os.environ.get("SLACK_BOT_TOKEN" )
# The name of the channel, e.g., "coinbase-intel" (no #)
SLACK_CHANNEL_NAME = "coinbase-intel"
TWITTER_BEARER_TOKEN = os.environ.get('TWITTER_BEARER_TOKEN')
KEYWORDS_TO_TRACK = "Coinbase OR Base OR USDC"

# --- List of RSS Feeds to Monitor ---
RSS_FEEDS = {
    "CoinDesk": "https://www.coindesk.com/arc/outboundfeeds/rss/",
    "The Block": "https://www.theblock.co/rss.xml",
    "Cointelegraph": "https://cointelegraph.com/rss",
}

# Initialize the Slack client
slack_client = WebClient(token=SLACK_BOT_TOKEN )

# --- Helper function to send a message to Slack ---
def send_slack_notification(message):
    if not SLACK_BOT_TOKEN:
        print("Slack Bot Token not set. Cannot send notification.")
        print(f"Message: {message}")
        return
    try:
        # The modern way to post a message
        result = slack_client.chat_postMessage(
            channel=coinbase-pr,
            text=message
        )
        print(f"Successfully sent to Slack: {result['ts']}")
    except SlackApiError as e:
        print(f"Error sending to Slack: {e.response['error']}")

# --- Main handler function that Vercel will run ---
class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        print("--- Starting Scan ---")

        # 1. Check RSS Feeds
        print("Checking RSS Feeds...")
        for name, url in RSS_FEEDS.items():
            try:
                feed = feedparser.parse(url)
                for entry in feed.entries:
                    if any(keyword.lower() in entry.title.lower() for keyword in KEYWORDS_TO_TRACK.split(" OR ")):
                        message = f"📰 *New Article Mention from {name}*\n>{entry.title}\n{entry.link}"
                        send_slack_notification(message)
            except Exception as e:
                print(f"Error parsing RSS feed {name}: {e}")

        # 2. Check Twitter/X (code is unchanged, add it back if you need it)
        print("Skipping Twitter check for now.")


        # Send response back to Vercel
        self.send_response(200)
        self.send_header('Content-type','text/plain')
        self.end_headers()
        self.wfile.write("Scan complete.".encode('utf-8'))
        return
