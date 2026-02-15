# Gravity Wars — Multiplayer

Two-player turn-based artillery game with orbital mechanics and toroidal wrapping.

## Architecture

- **Static frontend**: Vite + React, deployed to Cloudflare Pages
- **Multiplayer backend**: Cloudflare Workers + Durable Objects (one DO per game room)
- **Physics**: Deterministic — both clients simulate from the same seed + inputs, no physics on the server

See `ARCHITECTURE.md` for the full design doc.

## Project Structure

```
src/
  App.jsx              # Main game component (supports local + online modes)
  game/
    constants.js       # All shared constants
    physics.js         # Deterministic physics engine + animated sim
    levelgen.js        # Seeded level generation (mulberry32 PRNG)
    index.js           # Re-exports
  net/
    client.js          # WebSocket client wrapper + HTTP room helpers
worker/
  index.js             # CF Worker entry — routes /api/* to Durable Object
  game-room.js         # GameRoom Durable Object (skeleton, needs completion)
wrangler.toml          # Cloudflare Workers config
ARCHITECTURE.md        # Full architecture/protocol doc
```

## What's Done

- [x] Game component extracted into shared modules
- [x] Seeded PRNG (mulberry32) for deterministic level gen
- [x] Physics engine separated, with both sync (`simulateShot`) and async (`animateShot`) modes
- [x] Component supports `mode="local"` (hot-seat) and `mode="online"` props
- [x] Online mode: controls disabled when not your turn, labels show YOU/OPP
- [x] WebSocket client wrapper with reconnection
- [x] Durable Object skeleton with room create/join/WS handling
- [x] Worker routing for /api/rooms endpoints
- [x] Default aim uses seeded RNG (same offset on both clients)

## What Needs Building

### 1. Lobby/Router UI
- Landing page with "Create Game" and "Join Game" options
- Route: `/room/:roomId` auto-joins and connects
- Waiting screen: "Share this link..." with copy button
- Connection status indicator
- Use React Router or simple hash-based routing

### 2. App Wrapper / Multiplayer Glue
- Parent component that manages room lifecycle:
  - Creates room → gets roomId + seed
  - Connects WebSocket via `GameClient`
  - Passes `incomingShot` prop to game when opponent fires
  - Passes `onFire` callback that sends to server
- Handle `room_state`, `shot_fired`, `player_joined`, `player_disconnected` messages

### 3. Durable Object Completion
- `game-room.js` has the skeleton. Needs:
  - Turn validation (check WS tags to confirm correct player)
  - Room expiry via DO alarm (clean up after 1hr idle)
  - Handle reconnection (send full state on reconnect)
  - Error handling for edge cases

### 4. Vite Setup
- `npm create vite@latest . -- --template react` (in this directory)
- Add `base: '/gravity-wars/'` to vite.config.js for GitHub Pages
- Or configure for Cloudflare Pages deployment

### 5. Deployment
- Option A: Pages + separate Worker (`wrangler deploy`)
- Option B: Pages Functions (move worker code into `functions/api/`)
- Set up custom domain if desired

## Key Design Notes

### Determinism
Both clients MUST produce identical simulations. This means:
- Level gen uses `createRng(seed + levelNum * 9973)` — never Math.random()
- Default aim offset uses `createRng(seed + level * 31 + turn * 7)`
- Physics constants are shared via constants.js
- The `simulateShot()` function is pure and deterministic

### Shot Flow (Online)
1. Active player adjusts angle/power and hits Fire
2. Client calls `onFire(angle, power)` → sends to server
3. Client ALSO runs `executeShot()` locally (no waiting for server)
4. Server broadcasts `shot_fired` to both players
5. Opponent's client receives `shot_fired` → runs `executeShot()` with same params
6. Active player sends `report_result` to server
7. Server updates authoritative state, broadcasts `shot_result`
8. Both clients transition to next turn

### Props for Online Mode
```jsx
<GravityWars
  mode="online"
  myPlayerId={2}          // am I P1 or P2?
  roomSeed={98765}        // from room creation
  onFire={(angle, power) => client.fire(angle, power)}
  incomingShot={lastShot} // set when server sends shot_fired for opponent
/>
```

## Local Development
```bash
npm install
npm run dev          # Vite dev server (local 2P mode)
wrangler dev         # Worker + DO dev server (multiplayer)
```
