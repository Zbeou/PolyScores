// Vercel Serverless Function — proxies requests to Polymarket Gamma API
// Bypasses CORS. Caches responses for 30s.
// Usage: /api/proxy?path=/events&tag_slug=nba&active=true&closed=false

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  if (req.method === "OPTIONS") return res.status(200).end();

  const { path, ...params } = req.query;

  if (!path) {
    return res.status(400).json({ error: "Missing 'path' query parameter" });
  }

  // Only allow /events, /markets, /sports, /tags, /series paths
  const allowed = ["/events", "/markets", "/sports", "/tags", "/series", "/search"];
  if (!allowed.some((a) => path.startsWith(a))) {
    return res.status(403).json({ error: "Path not allowed" });
  }

  const query = new URLSearchParams(params).toString();
  const url = `https://gamma-api.polymarket.com${path}${query ? `?${query}` : ""}`;

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    const data = await response.json();

    // Cache 30s, stale-while-revalidate 60s
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    return res.status(response.status).json(data);
  } catch (err) {
    return res
      .status(502)
      .json({ error: "Failed to reach Polymarket API", detail: err.message });
  }
}
