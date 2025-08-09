import os, time, json
from datetime import datetime
from typing import List, Dict
from http.server import BaseHTTPRequestHandler
import feedparser
from dateutil import parser as dtp
from upstash_redis import Redis
from resend import Emails

REDIS = Redis(url=os.getenv("KV_REST_API_URL"), token=os.getenv("KV_REST_API_TOKEN"))
RSS_FEEDS: List[str] = [u.strip() for u in (os.getenv("RSS_FEEDS") or "").split(",") if u.strip()]
KEYWORDS:  List[str] = [k.strip().lower() for k in (os.getenv("KEYWORDS") or "").split(",") if k.strip()]
URGENT:    List[str] = [k.strip().lower() for k in (os.getenv("ALERT_KEYWORDS_URGENT") or "").split(",") if k.strip()]

ZSET = "mentions:z"
SEEN = "mentions:seen"
MAX_MENTIONS = 5000

RESEND_API_KEY   = os.getenv("RESEND_API_KEY")
ALERT_EMAIL_FROM = os.getenv("ALERT_EMAIL_FROM")
ALERT_EMAIL_TO   = [e.strip() for e in (os.getenv("ALERT_EMAIL_TO") or "").split(",") if e.strip()]

def _json(self, obj, status=200):
    data = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    self.send_response(status)
    self.send_header("Content-Type", "application/json; charset=utf-8")
    self.send_header("Content-Length", str(len(data)))
    self.end_headers()
    self.wfile.write(data)

def _now() -> int: return int(time.time())

def _pub_ts(e) -> int:
    for field in ("published", "updated", "pubDate"):
        v = getattr(e, field, None) or e.get(field)
        if v:
            try: return int(dtp.parse(v).timestamp())
            except Exception: pass
    return _now()

def _match(t: str) -> List[str]:
    t = (t or "").lower()
    return [k for k in KEYWORDS if k in t]

def _urgent(matched: List[str]) -> bool:
    return bool(set(matched) & set(URGENT)) if URGENT else False

def _id(link: str, title: str) -> str:
    from hashlib import sha256
    return sha256((link or title or "").encode("utf-8")).hexdigest()

def _store(m: Dict):
    REDIS.zadd(ZSET, {json.dumps(m, separators=(",", ":")): m["published_ts"]})
    REDIS.zremrangebyrank(ZSET, 0, -MAX_MENTIONS-1)

def _email(m: Dict):
    if not (RESEND_API_KEY and ALERT_EMAIL_FROM and ALERT_EMAIL_TO): return
    Emails.api_key = RESEND_API_KEY
    Emails.send({
        "from": ALERT_EMAIL_FROM,
        "to": ALERT_EMAIL_TO,
        "subject": f"[URGENT] {m['title']}",
        "html": (
            f"<p><b>{m['title']}</b></p>"
            f"<p>Source: {m['source']} · {m['published']}</p>"
            f"<p>Keywords: {', '.join(m['matched'])}</p>"
            f"<p><a href='{m['link']}'>Open</a></p>"
        )
    })

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            if not (RSS_FEEDS and KEYWORDS):
                _json(self, {"ok": False, "error": "Missing RSS_FEEDS or KEYWORDS"}, 400); return

            found = stored = emailed = 0

            for url in RSS_FEEDS:
                feed = feedparser.parse(url)
                source = (getattr(feed, "feed", {}) or {}).get("title") or url

                for e in getattr(feed, "entries", []):
                    title = (e.get("title") or "").strip()
                    link  = (e.get("link")  or "").strip()
                    matched = _match(f"{title}\n{e.get('summary','')}\n{link}")
                    if not matched: continue

                    mid = _id(link, title)
                    if REDIS.sadd(SEEN, mid) != 1:  # 1=new, 0=seen
                        continue

                    ts = _pub_ts(e)
                    m = {
                        "id": mid,
                        "title": title or "(untitled)",
                        "link": link,
                        "source": source,
                        "matched": matched,
                        "published_ts": ts,
                        "published": datetime.utcfromtimestamp(ts).isoformat() + "Z"
                    }
                    _store(m)
                    stored += 1
                    if _urgent(matched): _email(m); emailed += 1
                    found += 1

            _json(self, {"ok": True, "feeds": len(RSS_FEEDS), "found": found, "stored": stored, "emailed": emailed}, 200)
        except Exception as e:
            _json(self, {"ok": False, "error": f"collect failed: {type(e).__name__}: {e}"}, 500)
