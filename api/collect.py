# api/collect.py
import os, time, json
from datetime import datetime
from typing import List, Dict
import feedparser
from dateutil import parser as dtp
from upstash_redis import Redis
from resend import Emails

# ---- Config ----
REDIS = Redis(url=os.getenv("KV_REST_API_URL"), token=os.getenv("KV_REST_API_TOKEN"))
RSS_FEEDS: List[str] = [u.strip() for u in (os.getenv("RSS_FEEDS") or "").split(",") if u.strip()]
KEYWORDS: List[str]  = [k.strip().lower() for k in (os.getenv("KEYWORDS") or "").split(",") if k.strip()]
URGENT: List[str]    = [k.strip().lower() for k in (os.getenv("ALERT_KEYWORDS_URGENT") or "").split(",") if k.strip()]

ZSET_MENTIONS = "mentions:z"       # score = published_ts
SET_SEEN      = "mentions:seen"    # SADD de-dupe set
MAX_MENTIONS  = 5000

RESEND_API_KEY     = os.getenv("RESEND_API_KEY")
ALERT_EMAIL_FROM   = os.getenv("ALERT_EMAIL_FROM")
ALERT_EMAIL_TO     = [e.strip() for e in (os.getenv("ALERT_EMAIL_TO") or "").split(",") if e.strip()]

def _now() -> int:
    return int(time.time())

def _pub_ts(entry) -> int:
    for field in ("published", "updated", "pubDate"):
        v = getattr(entry, field, None) or entry.get(field)
        if v:
            try: return int(dtp.parse(v).timestamp())
            except Exception: pass
    return _now()

def _match(text: str) -> List[str]:
    t = (text or "").lower()
    return [k for k in KEYWORDS if k in t]

def _urgent(matched: List[str]) -> bool:
    if not URGENT: return False
    s = set(matched)
    return any(u in s for u in URGENT)

def _mention_id(link: str, title: str) -> str:
    # link preferred; fall back to title+ts to avoid accidental collisions
    from hashlib import sha256
    payload = (link or "").encode("utf-8") if link else f"{title}|{_now()}".encode("utf-8")
    return sha256(payload).hexdigest()

def _store(mention: Dict):
    # store JSON in ZSET; trim window
    REDIS.zadd(ZSET_MENTIONS, {json.dumps(mention, separators=(",",":")): mention["published_ts"]})
    REDIS.zremrangebyrank(ZSET_MENTIONS, 0, -MAX_MENTIONS-1)

def _send_email(mention: Dict):
    if not (RESEND_API_KEY and ALERT_EMAIL_FROM and ALERT_EMAIL_TO): return
    Emails.api_key = RESEND_API_KEY
    subject = f"[URGENT] {mention['title']}"
    body = (
        f"<p><b>{mention['title']}</b></p>"
        f"<p>Source: {mention['source']} &middot; Published: {mention['published']}</p>"
        f"<p>Keywords: {', '.join(mention['matched'])}</p>"
        f"<p><a href='{mention['link']}'>Open article</a></p>"
    )
    Emails.send({
        "from": ALERT_EMAIL_FROM,
        "to": ALERT_EMAIL_TO,
        "subject": subject,
        "html": body
    })

def handler(request):
    if not (RSS_FEEDS and KEYWORDS):
        return ({"ok": False, "error": "Missing RSS_FEEDS or KEYWORDS"}, 400)

    found = 0
    stored = 0
    emailed = 0

    for url in RSS_FEEDS:
        feed = feedparser.parse(url)
        source = (feed.feed.get("title") or url) if getattr(feed, "feed", None) else url

        for e in getattr(feed, "entries", []):
            title = e.get("title", "").strip()
            link  = e.get("link", "").strip()
            text  = f"{title}\n{e.get('summary','')}\n{link}"
            matched = _match(text)
            if not matched:
                continue

            mid = _mention_id(link, title)

            # ATOMIC DE-DUPE: SADD returns 1 if new, 0 if exists
            added = REDIS.sadd(SET_SEEN, mid)
            if added != 1:
                # already seen, skip
                continue

            published_ts = _pub_ts(e)
            mention = {
                "id": mid,
                "title": title or "(untitled)",
                "link": link,
                "source": source,
                "matched": matched,
                "published_ts": published_ts,
                "published": datetime.utcfromtimestamp(published_ts).isoformat() + "Z"
            }
            _store(mention)
            stored += 1
            if _urgent(matched):
                _send_email(mention)
                emailed += 1

            found += 1

    return ({"ok": True, "feeds": len(RSS_FEEDS), "found": found, "stored": stored, "emailed": emailed}, 200)
