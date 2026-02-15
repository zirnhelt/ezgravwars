// Worker entry point
// Routes /api/* requests to the GameRoom Durable Object.
// Static assets are served by Cloudflare Pages.

export { GameRoom } from "./game-room.js";

// CORS headers helper
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// Add CORS headers to response
function addCorsHeaders(response, origin) {
  const newHeaders = new Headers(response.headers);
  const cors = corsHeaders(origin);
  Object.entries(cors).forEach(([key, value]) => {
    newHeaders.set(key, value);
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
        headers: corsHeaders(origin),
      });
    }

    // POST /api/rooms — create new room
    if (request.method === "POST" && url.pathname === "/api/rooms") {
      const id = env.GAME_ROOMS.newUniqueId();
      const stub = env.GAME_ROOMS.get(id);
      // Forward with /create path
      const response = await stub.fetch(new Request(url.origin + "/create", { method: "POST" }));
      return addCorsHeaders(response, origin);
    }

    // POST /api/rooms/:id/join
    const joinMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/join$/);
    if (request.method === "POST" && joinMatch) {
      const id = env.GAME_ROOMS.idFromString(joinMatch[1]);
      const stub = env.GAME_ROOMS.get(id);
      const response = await stub.fetch(new Request(url.origin + "/join", { method: "POST" }));
      return addCorsHeaders(response, origin);
    }

    // GET /api/rooms/:id/ws — WebSocket upgrade
    const wsMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/ws$/);
    if (wsMatch) {
      const id = env.GAME_ROOMS.idFromString(wsMatch[1]);
      const stub = env.GAME_ROOMS.get(id);
      // Forward the full URL (with query params for player id)
      // Note: WebSocket upgrades don't need CORS headers
      return stub.fetch(request);
    }

    return new Response("Not found", {
      status: 404,
      headers: corsHeaders(origin),
    });
  },
};
