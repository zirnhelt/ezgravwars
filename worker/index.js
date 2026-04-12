// Worker entry point
// Routes /api/* requests to the GameRoom Durable Object.
// Static assets are served by Cloudflare Pages.

export { GameRoom } from "./game-room.js";

// CORS origin check — set ALLOWED_ORIGIN env var in production (wrangler secret).
// In dev (no env var set) any origin is allowed for local convenience.
function getAllowedOrigin(origin, env) {
  const configured = env?.ALLOWED_ORIGIN;
  if (!configured) return origin; // dev: reflect any origin
  return origin === configured ? origin : null;
}

function corsHeaders(origin, env) {
  const allowed = getAllowedOrigin(origin, env);
  return {
    'Access-Control-Allow-Origin': allowed ?? 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function addResponseHeaders(response, origin, env) {
  const newHeaders = new Headers(response.headers);
  Object.entries({ ...corsHeaders(origin, env), ...SECURITY_HEADERS }).forEach(([k, v]) => {
    newHeaders.set(k, v);
  });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: { ...corsHeaders(origin, env), ...SECURITY_HEADERS },
      });
    }

    // POST /api/rooms — create new room
    if (request.method === "POST" && url.pathname === "/api/rooms") {
      const id = env.GAME_ROOMS.newUniqueId();
      const stub = env.GAME_ROOMS.get(id);
      const response = await stub.fetch(new Request(url.origin + "/create", { method: "POST" }));
      return addResponseHeaders(response, origin, env);
    }

    // POST /api/rooms/:id/join
    const joinMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/join$/);
    if (request.method === "POST" && joinMatch) {
      const id = env.GAME_ROOMS.idFromString(joinMatch[1]);
      const stub = env.GAME_ROOMS.get(id);
      const response = await stub.fetch(new Request(url.origin + "/join", { method: "POST" }));
      return addResponseHeaders(response, origin, env);
    }

    // GET /api/rooms/:id/ws — WebSocket upgrade
    const wsMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/ws$/);
    if (wsMatch) {
      const id = env.GAME_ROOMS.idFromString(wsMatch[1]);
      const stub = env.GAME_ROOMS.get(id);
      // WebSocket upgrades don't use CORS but do get security headers via the upgrade response
      return stub.fetch(request);
    }

    return new Response("Not found", {
      status: 404,
      headers: { ...corsHeaders(origin, env), ...SECURITY_HEADERS },
    });
  },
};
