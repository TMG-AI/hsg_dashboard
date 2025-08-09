# --- api/index.py (Updated Function) ---

import os
import feedparser
import requests
import json
from http.server import BaseHTTPRequestHandler

# ... (all the other configuration at the top of the file remains the same ) ...
SLACK_WEBHOOK_URL = os.environ.get('https://hooks.slack.com/services/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')
# ... (rest of the config) ...


# --- UPDATED Helper function to send a message to Slack ---
def send_slack_notification(message):
    if not SLACK_WEBHOOK_URL:
        print("Slack Webhook URL not set. Cannot send notification.")
        print(f"Message: {message}")
        return
    try:
        # This is the key change: we specify the channel here.
        # The webhook will post to '#coinbase-intel' regardless of its default setting.
        payload = {
            'text': message,
            'channel': '#coinbase-intel' # This overrides the default channel
        }
        response = requests.post(SLACK_WEBHOOK_URL, json=payload)
        # Optional: Check if Slack reported an error
        if response.text != 'ok':
            print(f"Slack returned an error: {response.text}")
        else:
            print(f"Successfully sent to Slack channel #coinbase-intel: {message}")
    except Exception as e:
        print(f"Error sending to Slack: {e}")

# ... (the rest of the file, including the handler class, remains exactly the same) ...

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # ... (all the logic inside here is unchanged) ...
        print("--- Starting Scan ---")

        # 1. Check RSS Feeds
        print("Checking RSS Feeds...")
        for name, url in RSS_FEEDS.items():
            feed = feedparser.parse(url)
            for entry in feed.entries:
                if any(keyword.lower() in entry.title.lower() for keyword in KEYWORDS_TO_TRACK.split(" OR ")):
                    message = f"📰 *New Article Mention from {name}*\n>{entry.title}\n{entry.link}"
                    send_slack_notification(message) # This will now post to #coinbase-intel

        # ... (Twitter check also remains the same) ...
        # ...

        self.send_response(200)
        self.send_header('Content-type','text/plain')
        self.end_headers()
        self.wfile.write("Scan complete.".encode('utf-8'))
        return
