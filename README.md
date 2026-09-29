# Gravity Wars

Turn-based artillery across curved space. Bend shots around planets and black
holes, wrap them off the edge of the map, and knock out your rival's homeworld.

**Modes:** solo vs CPU (Cadet / Captain / Admiral) · hot seat (2 players, 1 screen) · online duel (share a 5-letter room code).

## Architecture

- **Static frontend**: Vite + React, canvas renderer, deployed to Cloudflare Pages
- **Multiplayer backend**: Cloudflare Workers + Durable Objects (one DO per room, WebSocket Hibernation API)
- **Physics**: Deterministic and shared. The same `simulateShot()` animates shots on clients, powers the CPU's search, and referees online shots on the server.

See `ARCHITECTURE.md` for the full design doc.

## Project Structure

```
src/
  App.jsx              # Game screen (local / cpu / online modes), HUD, victory panel
  Lobby.jsx            # Main menu (attract-mode demo plays behind it)
  MultiplayerApp.jsx   # Online wrapper: connection, waiting room, rematch votes
  styles.css           # Design tokens + all UI styles
  prefs.js             # localStorage prefs + CPU win/loss record
  game/
    constants.js       # Shared constants
    physics.js         # Deterministic sim: full path, closest approach, wraps
    levelgen.js        # Seeded level generation (mulberry32), black holes from level 3
    rules.js           # Match rules (first-to-N), shared with the server
    ai.js              # CPU opponent
    view.js            # Canvas engine: playback, particles, transitions
    art.js             # Procedural planets, black holes, nebula backgrounds
    audio.js           # Synthesized Web Audio sound effects
    names.js           # Procedural sector names per level
  net/
    client.js          # WebSocket client + HTTP room helpers
  ui/
    AttractBackground.jsx, icons.jsx
worker/
  index.js             # CF Worker entry — room codes, routes /api/* to the DO
  game-room.js         # GameRoom Durable Object (referee)
```

## Features

- Solo vs CPU with three ranks; wins/losses per rank are remembered, and beating one offers a promotion
- First-to-3/5/7 matches with an end-of-match stats card and rematch
- Per-player aim memory, so you can refine your last shot instead of starting over
- Near-miss markers ("missed by 12px") and slow-motion on finishing blows and close calls
- Long wandering shots auto-accelerate; hold Space (or press on the field) to fast-forward
- Black holes from level 3, procedural planet types, per-level nebula palettes and sector names
- Drag-to-aim (mouse or touch), keyboard controls, optional aim assist in offline modes
- Responsive, HiDPI canvas; works on phones (best in landscape)
- Online: short room codes, share sheet on mobile, presence, reconnect-and-resync, rematch

## Controls

| Action | Keys | Mouse / touch |
| --- | --- | --- |
| Aim | ← → or A D (Shift = 1°) | Drag on the field: direction = angle, distance = power |
| Power | ↑ ↓ or W S (Shift = 1%) | Drag distance, or the slider |
| Fire | Space / Enter | FIRE button |
| Fast-forward | Hold Space or F | Press and hold on the field |
| Mute | M | Speaker icon |

## Online Protocol (summary)

1. `POST /api/rooms` `{ targetScore }` → `{ roomId: "K7QX2", playerId: 1, seed }`
2. `POST /api/rooms/:code/join` → `{ playerId: 2 }` and the server broadcasts `room_state`
3. Active player sends `fire { angle, power }`
4. The server simulates the shot, applies the rules, and broadcasts
   `shot_fired { id, player, angle, power, hit, hitWhat, next }`
5. Both clients animate the shot locally, then adopt `next` (scores, level, turn, status)

## Local Development

Both servers must run simultaneously:

```bash
npm install

# Terminal 1: Frontend dev server
npm run dev

# Terminal 2: Worker dev server (with local Durable Objects)
npm run worker:dev
```

Then open `http://localhost:5173`. Solo and hot-seat modes work without the worker.

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed deployment instructions.

The worker imports the shared game modules from `src/game/`, so a change to
physics, level generation or rules must be deployed to **both** the worker and
the frontend (the worker workflow watches those files).

### Quick Start

1. **Deploy Backend (Cloudflare Workers)**
   ```bash
   wrangler login
   npm run worker:deploy
   ```
   Save the output URL (e.g., `https://gravity-wars-worker.YOUR_SUBDOMAIN.workers.dev`)

2. **Configure Frontend**
   - Add worker URL as GitHub secret: `VITE_API_URL`

3. **Deploy Frontend**
   - Push to `main`; Cloudflare Pages (or the GitHub Pages workflow) builds and deploys
