# This is a Python serverless function for Vercel.
# It will check RSS feeds and Twitter for mentions of Coinbase and send alerts to Slack.

import os
import feedparser
import requests
import json
from http.server import BaseHTTPRequestHandler

# --- CONFIGURATION ---
# --- You will need to set these as Environment Variables in Vercel ---
SLACK_WEBHOOK_URL = os.environ.get('SLACK_WEBHOOK_URL' )
TWITTER_BEARER_TOKEN = os.environ.get('TWITTER_BEARER_TOKEN')
KEYWORDS_TO_TRACK = "Coinbase OR Base OR USDC" # Using Twitter's OR operator

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

# --- List of Twitter/X Usernames to Monitor ---
# (We will search their recent tweets for our keywords )
TWITTER_USERS_TO_MONITOR = [
    "laurashin",
    "nic__carter",
    "jchervinsky",
    "a16zcrypto",
    "BanklessHQ",
    "VitalikButerin"
    # Add more handles here
]

# --- Helper function to send a message to Slack ---
def send_slack_notification(message):
    if not SLACK_WEBHOOK_URL:
        print("Slack Webhook URL not set. Cannot send notification.")
        print(f"Message: {message}")
        return
    try:
        payload = {'text': message}
        requests.post(SLACK_WEBHOOK_URL, json=payload)
        print(f"Successfully sent to Slack: {message}")
    except Exception as e:
        print(f"Error sending to Slack: {e}")

# --- Main handler function that Vercel will run ---
class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        print("--- Starting Scan ---")

        # 1. Check RSS Feeds
        print("Checking RSS Feeds...")
        for name, url in RSS_FEEDS.items():
            feed = feedparser.parse(url)
            for entry in feed.entries:
                # Simple check if any keyword is in the title or summary
                if any(keyword.lower() in entry.title.lower() for keyword in KEYWORDS_TO_TRACK.split(" OR ")):
                     # In a real application, you'd track sent links in a database to avoid duplicates.
                     # For this simple starter, we just send everything new from the last check.
                    message = f"📰 *New Article Mention from {name}*\n>{entry.title}\n{entry.link}"
                    send_slack_notification(message)

        # 2. Check Twitter/X Mentions
        print("Checking Twitter/X...")
        if not TWITTER_BEARER_TOKEN:
            print("Twitter Bearer Token not set. Skipping Twitter check.")
        else:
            headers = {"Authorization": f"Bearer {TWITTER_BEARER_TOKEN}"}
            # Construct the query to search tweets from our list of users containing our keywords
            user_query = " OR ".join([f"from:{user}" for user in TWITTER_USERS_TO_MONITOR])
            search_url = f"https://api.twitter.com/2/tweets/search/recent?query=({user_query} ) ({KEYWORDS_TO_TRACK}) -is:retweet"

            response = requests.get(search_url, headers=headers)
            if response.status_code == 200:
                tweet_data = response.json()
                if 'data' in tweet_data:
                    for tweet in tweet_data['data']:
                        # Again, a database would be needed to prevent duplicate alerts.
                        author_id = tweet['author_id'] # You can map this back to a username if needed
                        message = f"🐦 *New Tweet Mention*\n>{tweet['text']}\nhttps://twitter.com/anyuser/status/{tweet['id']}"
                        send_slack_notification(message )
                else:
                    print("No new tweets found.")
            else:
                print(f"Error fetching tweets: {response.status_code} {response.text}")


        # Send response back to Vercel
        self.send_response(200)
        self.send_header('Content-type','text/plain')
        self.end_headers()
        self.wfile.write("Scan complete.".encode('utf-8'))
        return
