// Debug endpoint to verify Meltwater API key configuration
export default async function handler(req, res) {
  const MELTWATER_API_KEY = process.env.MELTWATER_API_KEY;

  if (!MELTWATER_API_KEY) {
    return res.status(200).json({
      error: 'MELTWATER_API_KEY environment variable not set',
      hasKey: false
    });
  }

  return res.status(200).json({
    hasKey: true,
    keyLength: MELTWATER_API_KEY.length,
    keyPrefix: MELTWATER_API_KEY.substring(0, 8) + '...',
    keySuffix: '...' + MELTWATER_API_KEY.substring(MELTWATER_API_KEY.length - 4),
    envVarName: 'MELTWATER_API_KEY'
  });
}
