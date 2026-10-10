// Optional Cloudflare Worker: holds a HenrikDev API key as a secret so the
// public site never ships it. Deploy:
//   1. Get a key: https://api.henrikdev.xyz/dashboard/ (sign in with Discord) → API Keys → Generate.
//   2. npx wrangler deploy proxy/henrik-worker.js --name sh-valo-proxy
//   3. npx wrangler secret put HENRIK_KEY --name sh-valo-proxy   (paste the key)
//   4. Put the worker URL in js/config.js → HENRIK_PROXY.
const ALLOWED_ORIGINS = ["https://shivesh900.github.io", "http://localhost:8080"];
const ALLOWED = /^\/valorant\/v[234]\/(account|mmr|matches)\//;
export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Accept",
      "Vary": "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    if (request.method !== "GET" || !ALLOWED.test(url.pathname)) return new Response(JSON.stringify({ errors: [{ message: "Not allowed" }] }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: "GET" });
    let res = await cache.match(cacheKey);
    if (!res) {
      const upstream = await fetch("https://api.henrikdev.xyz" + url.pathname + url.search, { headers: { Authorization: env.HENRIK_KEY, Accept: "application/json" } });
      res = new Response(upstream.body, upstream);
      res.headers.set("Cache-Control", upstream.ok ? "public, max-age=120" : "no-store");
      if (upstream.ok) ctx.waitUntil(cache.put(cacheKey, res.clone()));
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};
