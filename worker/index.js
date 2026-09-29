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

// Short, speakable room codes (no 0/O or 1/I confusion).
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 5;

function newRoomCode() {
  const buf = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

// Rooms are addressed by code (idFromName). Links from before codes existed
// used raw 64-hex Durable Object ids, which still resolve.
function roomStub(env, encoded) {
  let raw;
  try {
    raw = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    try {
      return env.GAME_ROOMS.get(env.GAME_ROOMS.idFromString(raw.toLowerCase()));
    } catch {
      return null;
    }
  }
  if (/^[A-Z0-9]{4,8}$/i.test(raw)) {
    return env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(raw.toUpperCase()));
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const notFound = () =>
      new Response("Not found", { status: 404, headers: { ...corsHeaders(origin, env), ...SECURITY_HEADERS } });

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: { ...corsHeaders(origin, env), ...SECURITY_HEADERS },
      });
    }

    // POST /api/rooms — create new room under a fresh code
    if (request.method === "POST" && url.pathname === "/api/rooms") {
      const body = (await request.text()).slice(0, 1024);
      for (let attempt = 0; attempt < 6; attempt++) {
        const code = newRoomCode();
        const stub = env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(code));
        const response = await stub.fetch(
          new Request(`${url.origin}/create?code=${code}`, { method: "POST", body, headers: { "Content-Type": "application/json" } })
        );
        if (response.status !== 409) return addResponseHeaders(response, origin, env);
      }
      return addResponseHeaders(new Response("Could not allocate a room code", { status: 503 }), origin, env);
    }

    // POST /api/rooms/:id/join
    const joinMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/join$/);
    if (request.method === "POST" && joinMatch) {
      const stub = roomStub(env, joinMatch[1]);
      if (!stub) return notFound();
      const response = await stub.fetch(new Request(url.origin + "/join", { method: "POST" }));
      return addResponseHeaders(response, origin, env);
    }

    // GET /api/rooms/:id/ws — WebSocket upgrade
    const wsMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/ws$/);
    if (wsMatch) {
      // Browsers send Origin on WebSocket upgrades; block other sites from
      // opening sockets into rooms when an allowed origin is configured.
      if (env?.ALLOWED_ORIGIN && origin && origin !== env.ALLOWED_ORIGIN) {
        return new Response("Forbidden", { status: 403, headers: SECURITY_HEADERS });
      }
      const stub = roomStub(env, wsMatch[1]);
      if (!stub) return notFound();
      return stub.fetch(request);
    }

    return notFound();
  },
};
