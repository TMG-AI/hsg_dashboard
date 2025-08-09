import os, hashlib, time, json
from upstash_redis import Redis
from slack_sdk import WebClient

# --- Configuration ---
# This code explicitly reads the KV_... variables provided by the Vercel integration.
# This is the most robust way to connect.
redis_client = Redis(
    url=os.environ.get('KV_REST_API_URL'), 
    token=os.environ.get('KV_REST_API_TOKEN')
)
slack_client = WebClient(token=os.environ.get("SLACK_BOT_TOKEN"))

# --- Helper Functions ---
def get_mention_id(link: str) -> str:
    return hashlib.sha256(link.encode("utf-8")).hexdigest()

def store_mention_data(mention_id: str, data: dict):
    score = data.get("published_ts", int(time.time()))
    # Store the data as a JSON string
    redis_client.set(mention_id, json.dumps(data))
    # Add the ID to a sorted set for easy retrieval
    redis_client.zadd('mentions_sorted_set', {mention_id: score})
    # Optional: Trim the sorted set to keep it from growing indefinitely
    # redis_client.zremrangebyrank('mentions_sorted_set', 0, -5001) 

def get_latest_mentions(limit: int = 50) -> list:
    mention_ids = redis_client.zrange('mentions_sorted_set', 0, limit - 1, desc=True)
    if not mention_ids:
        return []
    
    # Fetch all mention data at once and filter out any Nones
    results = redis_client.mget(*mention_ids)
    return [json.loads(m.decode('utf-8')) for m in results if m]

def send_slack_alert(data: dict):
    if not slack_client.token:
        return
    try:
        channel_id = os.environ.get("SLACK_CHANNEL_ID") # Using Channel ID is more reliable
        if not channel_id:
            print("SLACK_CHANNEL_ID not set.")
            return
        
        title = data.get("title", "New Mention")
        link = data.get("link", "")
        source = data.get("source", "Unknown")
        
        message = f"📰 *{title}*\n*Source:* {source}\n<{link}|Read More>"
        slack_client.chat_postMessage(channel=channel_id, text=message)
    except Exception as e:
        print(f"Slack alert failed: {e}")
