import os, hashlib, time, json
from upstash_redis import Redis
import resend # Import the new library

# --- Configuration ---
redis_client = Redis(
    url=os.environ.get('KV_REST_API_URL'), 
    token=os.environ.get('KV_REST_API_TOKEN')
)
# --- NEW: Configure Resend ---
resend.api_key = os.environ.get("RESEND_API_KEY")
DESTINATION_EMAIL = os.environ.get("DESTINATION_EMAIL")

# --- Helper Functions ---
def get_mention_id(link: str) -> str:
    return hashlib.sha256(link.encode("utf-8")).hexdigest()

def store_mention_data(mention_id: str, data: dict):
    score = data.get("published_ts", int(time.time()))
    redis_client.set(mention_id, json.dumps(data))
    redis_client.zadd('mentions_sorted_set', {mention_id: score})

def get_latest_mentions(limit: int = 50) -> list:
    mention_ids = redis_client.zrange('mentions_sorted_set', 0, limit - 1, desc=True)
    if not mention_ids: return []
    results = redis_client.mget(*mention_ids)
    return [json.loads(m.decode('utf-8')) for m in results if m]

# --- REPLACED: send_slack_alert is now send_email_alert ---
def send_email_alert(data: dict):
    if not resend.api_key or not DESTINATION_EMAIL:
        print("Resend API Key or Destination Email not set.")
        return
    try:
        subject = f"New Coinbase Mention: {data.get('source')}"
        html_body = f"""
        <h3><a href='{data.get("link")}'>{data.get("title")}</a></h3>
        <p><strong>Source:</strong> {data.get('source')}</p>
        <p><strong>Published:</strong> {data.get('published')}</p>
        """
        params = {
            "from": "PR Alerter <onboarding@resend.dev>", # Resend requires this 'from' address for free accounts
            "to": [DESTINATION_EMAIL],
            "subject": subject,
            "html": html_body,
        }
        resend.Emails.send(params)
        print(f"Email alert sent for: {data.get('title')}")
    except Exception as e:
        print(f"Email alert failed: {e}")
