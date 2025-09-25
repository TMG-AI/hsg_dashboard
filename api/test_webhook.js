// Test endpoint to see Meltwater webhook payload structure
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('=== WEBHOOK TEST DEBUG ===');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body type:', typeof req.body);
    console.log('Raw body:', JSON.stringify(req.body, null, 2));

    if (req.body && req.body.documents) {
      console.log('Documents count:', req.body.documents.length);
      req.body.documents.forEach((doc, i) => {
        console.log(`Document ${i + 1}:`, JSON.stringify(doc, null, 2));
      });
    }
    console.log('=== END TEST DEBUG ===');

    res.status(200).json({
      ok: true,
      message: 'Test webhook received - check logs for structure',
      received: {
        method: req.method,
        headers: req.headers,
        body: req.body,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Test webhook error:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}