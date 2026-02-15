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

## Features

- [x] Game component with deterministic physics
- [x] Seeded PRNG (mulberry32) for deterministic level generation
- [x] Physics engine with both sync and async simulation modes
- [x] Local 2-player hot-seat mode
- [x] Online multiplayer with turn-based gameplay
- [x] WebSocket client with automatic reconnection
- [x] Lobby UI for creating and joining games
- [x] Shareable room links with copy-to-clipboard
- [x] Durable Objects for persistent game state
- [x] Turn validation and room cleanup
- [x] GitHub Pages deployment support

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

Both servers must run simultaneously:

```bash
# Install dependencies
npm install

# Terminal 1: Frontend dev server
npm run dev

# Terminal 2: Worker dev server (with local Durable Objects)
npm run worker:dev
```

Then open `http://localhost:5173`

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed deployment instructions.

### Quick Start

1. **Deploy Backend (Cloudflare Workers)**
   ```bash
   wrangler login
   npm run worker:deploy
   ```
   Save the output URL (e.g., `https://gravity-wars-api.YOUR_SUBDOMAIN.workers.dev`)

2. **Configure Frontend**
   - Add worker URL as GitHub secret: `VITE_API_URL`
   - Update `src/config.js` with your worker URL

3. **Deploy Frontend (GitHub Pages)**
   - Enable GitHub Pages in repository settings (Source: GitHub Actions)
   - Push to main branch
   - Access at `https://YOUR_USERNAME.github.io/ezgravwars/`
