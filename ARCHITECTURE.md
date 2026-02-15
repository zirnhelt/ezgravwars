# Gravity Wars Multiplayer — Architecture

## Overview

Two-player turn-based game. Static site on Cloudflare Pages, game rooms managed
by a Durable Object, players connected via WebSocket through a Worker.

```
┌──────────────┐        ┌──────────────┐
│  Player 1    │        │  Player 2    │
│  (browser)   │        │  (browser)   │
└──────┬───────┘        └──────┬───────┘
       │ WebSocket              │ WebSocket
       └──────────┐  ┌─────────┘
                  ▼  ▼
          ┌───────────────┐
          │   CF Worker    │  (routes /api/*)
          │   (stateless)  │
          └───────┬───────┘
                  │ stub.get()
                  ▼
          ┌───────────────┐
          │ Durable Object │  (one per game room)
          │  "GameRoom"    │
          │                │
          │ • game state   │
          │ • planet seed  │
          │ • turn logic   │
          │ • score        │
          └───────────────┘
```

## Project Structure

```
gravity-wars/
├── src/
│   ├── App.jsx              # React client (modified for multiplayer)
│   ├── game/
│   │   ├── physics.js       # Shared physics engine (used by both client & DO)
│   │   ├── levelgen.js      # Seeded level generation
│   │   └── constants.js     # Shared constants (G, speeds, sizes, etc.)
│   └── net/
│       └── client.js        # WebSocket client wrapper
├── worker/
│   ├── index.js             # CF Worker entry — routes requests
│   └── game-room.js         # Durable Object class
├── vite.config.js
├── wrangler.toml
└── package.json
```

## Key Design Decision: Deterministic Shared Simulation

Both clients run physics independently from the same inputs. No streaming
of trail points needed. This keeps bandwidth minimal and feels instant for
both players.

Requirements for determinism:
- Level generation uses a **seeded PRNG** (room seed), not Math.random()
- Physics sim uses the same constants and step count
- Active player sends only `{ angle, power }` — both clients simulate identically

The Durable Object is the authority for turn order, scores, and level
transitions. It does NOT run physics — it's a state coordinator.

---

## Room Lifecycle

### 1. Create Room
```
Player 1 → POST /api/rooms
         ← { roomId: "abc123", playerId: 1 }

DO creates room state:
{
  roomId: "abc123",
  seed: <random>,
  level: 1,
  scores: [0, 0],
  turn: 1,
  players: { 1: connected },
  status: "waiting"    // waiting | playing | finished
}
```

### 2. Join Room
```
Player 2 → POST /api/rooms/abc123/join
         ← { roomId: "abc123", playerId: 2 }

DO updates:
  players: { 1: connected, 2: connected }
  status: "playing"
  → broadcasts "game_start" to both
```

### 3. Share Room
Player 1 gets a URL like: `https://gravity-wars.pages.dev/room/abc123`
Player 2 opens that link → auto-joins.

### 4. Connect WebSocket
```
Both → GET /api/rooms/abc123/ws  (upgrade to WebSocket)
     ← connected to Durable Object
```

---

## Message Protocol

All messages are JSON over WebSocket.

### Server → Client

```jsonc
// Initial state on connect
{ "type": "room_state", "data": {
    "roomId": "abc123",
    "playerId": 1,          // your player number
    "seed": 98765,
    "level": 1,
    "scores": [0, 0],
    "turn": 1,
    "status": "waiting",
    "shotHistory": []
}}

// Opponent joined
{ "type": "player_joined", "data": { "status": "playing" }}

// Shot fired (sent to BOTH players including shooter)
{ "type": "shot_fired", "data": {
    "player": 1,
    "angle": 42,
    "power": 65
}}

// Shot result — authoritative state update
// (clients also compute this locally, but DO confirms)
{ "type": "shot_result", "data": {
    "hit": true,
    "hitWhat": "HIT!",
    "scores": [1, 0],
    "level": 2,              // if advanced
    "seed": 54321,           // new seed if new level
    "turn": 2,
    "shotHistory": [...]
}}

// Opponent disconnected
{ "type": "player_disconnected", "data": { "player": 2 }}

// Opponent reconnected
{ "type": "player_reconnected", "data": { "player": 2 }}
```

### Client → Server

```jsonc
// Fire (only accepted from current turn's player)
{ "type": "fire", "data": {
    "angle": 42,
    "power": 65
}}

// Report result (active player reports what happened)
{ "type": "report_result", "data": {
    "hit": true,
    "hitWhat": "HIT!"
}}
```

---

## Durable Object: GameRoom

```js
export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();  // playerId → WebSocket
    this.game = null;           // loaded from storage on first request
  }

  async fetch(request) {
    // Handle HTTP (create/join) or upgrade to WebSocket
  }

  // Core logic:
  // - Validates "fire" messages come from correct player
  // - Broadcasts shot to both players
  // - Accepts result report from active player
  // - Updates authoritative state (scores, level, turn)
  // - Broadcasts new state
  // - Persists to Durable Object storage for reconnection
}
```

### State Persistence

On every state change, persist to DO storage:
```js
await this.state.storage.put("game", this.game);
```

On reconnect, load from storage and send full `room_state` to the
reconnecting client.

---

## Seeded PRNG

Replace all `Math.random()` in level generation with a seeded generator.
Simple mulberry32 works fine:

```js
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Usage:
const rng = mulberry32(roomSeed + levelNum);
// Use rng() everywhere instead of Math.random()
```

Both clients generate identical levels from the same seed + level number.

---

## Client Changes Summary

### New: Lobby/Connection UI
- Landing page: "Create Game" button → gets room URL to share
- Room URL auto-joins: `/room/:roomId`
- Show waiting state: "Waiting for opponent..." with shareable link
- Show connection status indicator

### Modified: Game Component
- Receives `playerId` and `seed` from room
- Uses seeded PRNG for level generation
- Only enables controls when `turn === myPlayerId`
- On fire: sends message to server, then runs local sim
- On receiving opponent's shot: runs sim locally with their params
- Watches for `shot_fired` from server to trigger opponent's animation
- Shows opponent's shot playing out in real-time (local sim)

### New: Reconnection
- On WebSocket close, attempt reconnect with exponential backoff
- On reconnect, receive full state, rebuild current level from seed
- If a shot was in progress, skip to result

---

## Cloudflare Configuration

### wrangler.toml
```toml
name = "gravity-wars-worker"
main = "worker/index.js"
compatibility_date = "2024-01-01"

[durable_objects]
bindings = [
  { name = "GAME_ROOMS", class_name = "GameRoom" }
]

[[migrations]]
tag = "v1"
new_classes = ["GameRoom"]
```

### Pages + Worker routing
Option A: Pages for static, separate Worker for API
  - Pages serves the Vite build
  - Worker handles /api/* routes
  - Set up custom domain or use Pages Functions

Option B: Pages Functions (simpler)
  - Put DO logic in `functions/api/` directory
  - Pages handles both static + API
  - Less config, but slightly less flexible

**Recommendation: Option B (Pages Functions)** for simplicity.
With Pages Functions, the worker code goes in:
```
functions/
  api/
    rooms/
      index.js           # POST /api/rooms (create)
      [roomId]/
        join.js          # POST /api/rooms/:roomId/join
        ws.js            # GET  /api/rooms/:roomId/ws (WebSocket upgrade)
```

---

## Deployment Steps

1. Create repo, scaffold Vite + React
2. Extract physics/levelgen into shared modules
3. Implement seeded PRNG, verify both players generate identical levels
4. Build Durable Object (GameRoom class)
5. Build WebSocket client wrapper
6. Modify React component for multiplayer state
7. Add lobby UI (create/join/waiting)
8. Test locally with `wrangler dev`
9. Deploy: `wrangler deploy` (for worker) + Pages auto-deploy from git
10. Set up custom domain if desired

---

## Cost

Cloudflare Workers free tier:
- 100,000 requests/day
- Durable Objects: 1M requests/month free, ~$0.15/million after
- WebSocket messages count as requests
- For a hobby game, this is effectively free

---

## Future Enhancements (optional)
- Spectator mode (additional WS connections marked as observers)
- Rematch button (reuse room, reset state)
- Room expiry (auto-delete after 1hr idle via DO alarm)
- Game replay (store all shots, replay from seed)
- Sound effects (pew pew)
