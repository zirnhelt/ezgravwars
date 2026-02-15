// Worker entry point
// Routes /api/* requests to the GameRoom Durable Object.
// Static assets are served by Cloudflare Pages.

export { GameRoom } from "./game-room.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // POST /api/rooms — create new room
    if (request.method === "POST" && url.pathname === "/api/rooms") {
      const id = env.GAME_ROOMS.newUniqueId();
      const stub = env.GAME_ROOMS.get(id);
      // Forward with /create path
      return stub.fetch(new Request(url.origin + "/create", { method: "POST" }));
    }

    // POST /api/rooms/:id/join
    const joinMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/join$/);
    if (request.method === "POST" && joinMatch) {
      const id = env.GAME_ROOMS.idFromString(joinMatch[1]);
      const stub = env.GAME_ROOMS.get(id);
      return stub.fetch(new Request(url.origin + "/join", { method: "POST" }));
    }

    // GET /api/rooms/:id/ws — WebSocket upgrade
    const wsMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/ws$/);
    if (wsMatch) {
      const id = env.GAME_ROOMS.idFromString(wsMatch[1]);
      const stub = env.GAME_ROOMS.get(id);
      // Forward the full URL (with query params for player id)
      return stub.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
};
