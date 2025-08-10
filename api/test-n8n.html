export default function handler(req, res) {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.status(200).send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>POST to n8n Webhook (Production URL)</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body{font-family:system-ui,arial,sans-serif;max-width:820px;margin:40px auto;padding:0 16px}
    textarea,input{width:100%} textarea{height:240px}
    label{display:block;margin-top:12px}
    pre{white-space:pre-wrap;background:#f6f6f6;padding:12px}
  </style>
</head>
<body>
  <h1>POST to n8n Webhook (Production URL)</h1>

  <label>n8n Webhook Production URL</label>
  <input id="url" placeholder="https://YOUR-N8N-DOMAIN/webhook/meltwater" />

  <label>JSON Payload</label>
  <textarea id="payload">{
  "results":[
    {
      "Title":"Browser → n8n test",
      "URL":"https://example.com/news/unique-101",
      "Source Name":"Example News",
      "Document ID":"mw_demo_101",
      "Input Name":"Coinbase Alerts",
      "Permalink":"https://app.meltwater.com/..."
    }
  ]
}</textarea>

  <button id="send" style="margin-top:12px;">Send to n8n</button>
  <pre id="out" style="margin-top:16px;"></pre>

  <script>
  document.getElementById('send').onclick = async () => {
    const url = document.getElementById('url').value.trim();
    const payloadText = document.getElementById('payload').value;
    const out = document.getElementById('out');
    if (!url) { out.textContent = 'Enter your n8n Webhook Production URL.'; return; }
    let obj;
    try { obj = JSON.parse(payloadText); }
    catch { out.textContent = 'Payload is not valid JSON. Fix it and try again.'; return; }
    out.textContent = 'Sending to n8n...';
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {'content-type': 'application/json','accept':'application/json'},
        body: JSON.stringify(obj)
      });
      const text = await res.text();
      out.textContent = 'Status: ' + res.status + '\\n\\n' + text;
    } catch (e) {
      out.textContent = String(e);
    }
  };
  </script>
</body>
</html>`);
}
