export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { path, ...params } = req.query;
  if (!path) return res.status(400).json({ error: "Missing path" });

  const ok = ["/events", "/markets", "/sports", "/tags", "/series", "/search"];
  if (!ok.some((p) => path.startsWith(p)))
    return res.status(403).json({ error: "Path not allowed" });

  const qs = new URLSearchParams(params).toString();
  const url = `https://gamma-api.polymarket.com${path}${qs ? "?" + qs : ""}`;

  try {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    const data = await r.json();
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
