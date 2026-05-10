// Vercel Serverless Function — proxies requests to Polymarket Gamma API
// This avoids CORS issues when calling from the browser.
// Usage: /api/proxy?path=/events&active=true&closed=false&limit=50

export default async function handler(req, res) {
  const { path, ...params } = req.query;

  if (!path) {
    return res.status(400).json({ error: "Missing 'path' parameter" });
  }

  // Build target URL
  const query = new URLSearchParams(params).toString();
  const url = `https://gamma-api.polymarket.com${path}${query ? `?${query}` : ""}`;

  try {
    const response = await fetch(url, {
      headers: { "Accept": "application/json" },
    });

    const data = await response.json();

    // Cache for 30 seconds to reduce API load
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: "Proxy error", message: err.message });
  }
}
