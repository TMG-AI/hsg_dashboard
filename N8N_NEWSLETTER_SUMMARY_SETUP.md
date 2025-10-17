# n8n Newsletter Summary Webhook Setup

This guide shows how to send newsletter summaries from n8n to the HSG Dashboard.

## Webhook Endpoint

**URL:** `https://hsg-dashboard.vercel.app/api/newsletter_summary_webhook`

**Method:** POST

**Authentication:** Optional Bearer token (set `NEWSLETTER_SUMMARY_WEBHOOK_SECRET` in Vercel)

## Expected JSON Format

```json
{
  "date": "October 17, 2025",
  "total_newsletters": 2,
  "total_articles": 2,
  "newsletters": [
    {
      "name": "CNN Meanwhile in China",
      "articles": [
        {
          "title": "Back at the edge with trade tensions",
          "summary": "• The article intended to discuss the escalating trade tensions...",
          "link": "https://example.com/article" // Optional
        }
      ]
    },
    {
      "name": "CNBC The China Connection",
      "articles": [
        {
          "title": "Xi's long game begins",
          "summary": "• Chinese President Xi Jinping and the Central Committee...",
          "link": null
        }
      ]
    }
  ]
}
```

## n8n Workflow Setup

### Step 1: Add HTTP Request Node

After your email parsing and AI summarization, add an **HTTP Request** node with these settings:

- **Method:** POST
- **URL:** `https://hsg-dashboard.vercel.app/api/newsletter_summary_webhook`
- **Authentication:** None (or Bearer Token if you set the secret)
- **Body Content Type:** JSON
- **Send Body:** Yes

### Step 2: Format the JSON Body

In the HTTP Request node, set the **Body** to JSON mode and structure it like this:

```json
{
  "date": "{{ $now.format('MMMM D, YYYY') }}",
  "total_newsletters": {{ $('Aggregate_Newsletters').item.json.count }},
  "total_articles": {{ $('Aggregate_Articles').item.json.count }},
  "newsletters": {{ $json.newsletters }}
}
```

### Step 3: Structure Your Data

Before the HTTP Request, use a **Code** node to structure the data:

```javascript
// Group articles by newsletter
const newsletters = [];
const newsletterMap = new Map();

for (const item of $input.all()) {
  const newsletterName = item.json.newsletter_name;

  if (!newsletterMap.has(newsletterName)) {
    newsletterMap.set(newsletterName, {
      name: newsletterName,
      articles: []
    });
  }

  newsletterMap.get(newsletterName).articles.push({
    title: item.json.article_title,
    summary: item.json.article_summary,
    link: item.json.article_link || null
  });
}

return [{
  json: {
    newsletters: Array.from(newsletterMap.values())
  }
}];
```

### Step 4: Optional - Add Authentication

If you want to secure the webhook:

1. In Vercel, add environment variable:
   - **Name:** `NEWSLETTER_SUMMARY_WEBHOOK_SECRET`
   - **Value:** `your-secret-token-here`

2. In n8n HTTP Request node:
   - **Authentication:** Generic Credential Type → Header Auth
   - **Name:** `Authorization`
   - **Value:** `Bearer your-secret-token-here`

## Testing

### Test with curl:

```bash
curl -X POST https://hsg-dashboard.vercel.app/api/newsletter_summary_webhook \
  -H "Content-Type: application/json" \
  -d '{
    "date": "October 17, 2025",
    "total_newsletters": 1,
    "total_articles": 1,
    "newsletters": [{
      "name": "Test Newsletter",
      "articles": [{
        "title": "Test Article",
        "summary": "This is a test summary",
        "link": null
      }]
    }]
  }'
```

Expected response:
```json
{
  "ok": true,
  "message": "Stored 1 newsletter summary articles",
  "stored": 1,
  "date": "October 17, 2025",
  "newsletters_processed": 1,
  "total_articles": 1,
  "timestamp": "2025-10-17T..."
}
```

## How It Appears in Dashboard

Articles will show up as:
- **Title:** `{Newsletter Name}: {Article Title}`
- **Source:** Newsletter name (e.g., "CNN Meanwhile in China")
- **Origin:** "newsletter"
- **Section:** "Newsletter"
- **Summary:** The AI-generated summary with bullet points

They'll be mixed with other newsletter articles in the dashboard's Newsletter section.

## Troubleshooting

### Check Vercel Logs

If articles aren't appearing, check the logs:
```bash
vercel logs https://hsg-dashboard.vercel.app
```

### Common Issues

1. **401 Unauthorized:** Check that the Bearer token matches in both n8n and Vercel
2. **400 Bad Request:** Verify the JSON format matches the expected structure
3. **Duplicates not storing:** Articles with the same newsletter name + title + date are deduplicated

### Debug Mode

Add `?debug=true` to see what's being processed without storing:
```
POST https://hsg-dashboard.vercel.app/api/newsletter_summary_webhook?debug=true
```
