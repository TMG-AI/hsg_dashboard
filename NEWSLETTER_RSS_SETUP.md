# Newsletter RSS Feed Setup

## Overview
This sets up automated collection of newsletter RSS feeds filtered for China/Chinese keywords.

## Environment Variable Setup

### In Vercel Dashboard:

1. Go to your Vercel project: https://vercel.com/
2. Click on **Settings** → **Environment Variables**
3. Add this variable:

**Variable Name:** `NEWSLETTER_RSS_FEEDS`

**Value:** (Paste your 10 RSS feed URLs, separated by commas or semicolons)

Example format:
```
https://example.com/newsletter1/feed.xml,https://example.com/newsletter2/rss,https://politico.com/feed.xml
```

Or with semicolons:
```
https://example.com/newsletter1/feed.xml;https://example.com/newsletter2/rss;https://politico.com/feed.xml
```

## How It Works

### Automatic Collection
- **Runs every 4 hours** via Vercel cron job
- Endpoint: `/api/newsletter_rss_collect`
- Filters for articles containing "China" or "Chinese"
- Stores in Redis alongside other mentions

### Filtering Keywords
The collector automatically filters for these keywords (case-insensitive):
- china
- chinese

Articles must contain at least one of these keywords in:
- Article title
- Article content/summary
- Newsletter name

### Article Storage
Articles are stored with:
- **Section:** "Newsletter"
- **Origin:** "newsletter_rss"
- **Matched:** ["newsletter", "china"] or ["newsletter", "chinese"]
- **Provider:** The newsletter name from RSS feed

### Handling Articles Without Links
Some newsletters provide content summaries without individual article URLs. The collector handles this by:
- Generating a unique internal identifier
- Creating an internal URL: `https://newsletter.internal/{newsletter-name}/{id}`
- Setting `newsletter_article: true` flag

## Testing

### Manual Test (Before Deployment):
You can test the collector locally with:
```bash
curl https://hsg-dashboard.vercel.app/api/newsletter_rss_collect
```

Expected response if feeds not configured:
```json
{
  "ok": true,
  "message": "Newsletter RSS collection disabled - no feeds configured",
  "disabled": true
}
```

Expected response after configuration:
```json
{
  "ok": true,
  "feeds": 10,
  "found": 25,
  "stored": 23,
  "skipped": 2,
  "generated_at": "2025-10-12T..."
}
```

## Common Newsletter RSS Feed URLs

Here are examples of popular newsletter RSS feeds you might want to add:

### News & Analysis
- **POLITICO China Watcher:** (you'll need to find their RSS URL)
- **Axios China:** (check their RSS feed page)
- **Bloomberg:** https://feeds.bloomberg.com/markets/news.rss
- **The Economist:** https://www.economist.com/china/rss.xml
- **Foreign Policy:** https://foreignpolicy.com/feed/

### Tech & Business
- **TechCrunch:** https://techcrunch.com/feed/
- **The Information:** (may require subscription)
- **Protocol:** https://www.protocol.com/feeds/feed.rss

### China-Specific
- **SupChina:** https://supchina.com/feed/
- **Sinocism:** (usually email-only, may not have RSS)
- **ChinaTalk:** (check if they have RSS)

## Finding RSS Feeds for Newsletters

Many newsletters don't have RSS feeds, but here's how to find them if they exist:

1. **Check the website footer** - Look for an RSS icon or "RSS Feed" link
2. **Try common URLs:**
   - `https://example.com/feed`
   - `https://example.com/rss`
   - `https://example.com/feed.xml`
   - `https://example.com/rss.xml`
3. **Use RSS discovery tools:**
   - View page source and search for "rss" or "feed"
   - Use browser extensions like "RSS Feed Finder"

## Monitoring

### View Collected Articles
Articles will appear on your dashboard at:
- https://hsg-dashboard.vercel.app/

They'll be in the **Newsletter** section with the "newsletter_rss" origin.

### Check Collection Status
View logs in Vercel:
1. Go to Vercel Dashboard
2. Click on your project
3. Go to **Deployments**
4. Click on latest deployment
5. View **Function Logs**
6. Search for "Newsletter RSS collection"

You should see logs like:
```
Newsletter RSS collection starting: 10 feeds, filtering for China/Chinese
[Newsletter RSS] Stored: "China's new AI regulations..." from POLITICO (matched: china)
Newsletter RSS collection complete: 25 China-related articles found, 23 stored, 2 skipped
```

## Troubleshooting

### No articles being collected?
1. Check that `NEWSLETTER_RSS_FEEDS` is set in Vercel
2. Verify the RSS feed URLs are valid (test in browser)
3. Make sure articles contain "China" or "Chinese" keywords
4. Check Vercel function logs for errors

### Duplicate articles?
Articles are deduplicated by canonical URL. If a newsletter article appears in both RSS and your n8n workflow, the first one collected wins.

### Want to add more keywords?
Edit `/api/newsletter_rss_collect.js` and modify the `CHINA_KEYWORDS` array:
```javascript
const CHINA_KEYWORDS = ["china", "chinese", "beijing", "taiwan"];
```

## Next Steps

1. **Add your 10 RSS feed URLs** to Vercel environment variables
2. **Deploy** (Vercel will automatically redeploy when you save env variables)
3. **Wait 4 hours** for the first cron run, or manually trigger via:
   ```bash
   curl https://hsg-dashboard.vercel.app/api/newsletter_rss_collect
   ```
4. **Check your dashboard** to see the new Newsletter articles

## Integration with Existing System

This newsletter RSS collector works alongside:
- ✅ **Main RSS collector** (`/api/collect`) - General crypto/PR feeds
- ✅ **Congress collector** (`/api/congress_collect`) - Federal legislation
- ✅ **Meltwater webhook** (`/api/meltwater_webhook`) - Real-time alerts
- ✅ **Google Alerts webhook** (`/api/ga_webhook`) - Google Alert emails
- ✅ **Newsletter webhook** (`/api/newsletter_webhook`) - n8n workflow articles
- ✅ **Newsletter RSS collector** (`/api/newsletter_rss_collect`) - NEW!

All articles are stored in the same Redis database and appear together on the dashboard.
