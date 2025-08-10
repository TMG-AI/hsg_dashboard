export default async function handler(req, res) {
  try {
    if (req.method !== "POST") { res.status(405).send("Use POST"); return; }

    // Body may arrive as string or object
    const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    let parsed = null;
    try { parsed = typeof req.body === "string" ? JSON.parse(req.body) : req.body; } catch {}

    res.status(200).json({
      ok: true,
      note: "echo_n8n",
      method: req.method,
      got_secret: Boolean(req.headers["x-mw-secret"] || req.headers["X-MW-SECRET"]),
      content_type: req.headers["content-type"] || null,
      body_is_string: typeof req.body === "string",
      parsed_ok: parsed !== null,
      parsed_keys: parsed && typeof parsed === "object" ? Object.keys(parsed) : [],
      sample_title: parsed?.title || parsed?.results?.[0]?.title || parsed?.results?.[0]?.Title || null,
      received_at: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}
