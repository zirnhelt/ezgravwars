# Gravity Wars — Architecture

## Overview

Two-player turn-based game. Static site on Cloudflare Pages, game rooms managed
by a Durable Object, players connected via WebSocket through a Worker. Solo
(vs CPU) and hot-seat modes run entirely in the browser.

```
┌──────────────┐        ┌──────────────┐
│  Player 1    │        │  Player 2    │
│  (browser)   │        │  (browser)   │
└──────┬───────┘        └──────┬───────┘
       │ WebSocket              │ WebSocket
       └──────────┐  ┌─────────┘
                  ▼  ▼
          ┌───────────────┐
          │   CF Worker    │  (routes /api/*, allocates room codes)
          │   (stateless)  │
          └───────┬───────┘
                  │ idFromName(code)
                  ▼
          ┌───────────────┐
          │ Durable Object │  (one per room)
          │  "GameRoom"    │
          │                │
          │ • game state   │
          │ • referee: runs│
          │   simulateShot │
          │ • match rules  │
          └───────────────┘
```

## Key Design Decision: One Deterministic Simulation, Three Consumers

`simulateShot(planets, angle, power, shooter)` in `src/game/physics.js` is pure
and deterministic. It returns the whole flight up front (path, outcome, closest
approach to the target, edge wraps). Everything else builds on it:

| Consumer | Uses it to |
| --- | --- |
| `GameView` (client) | Replay the path as an animation. Because the ending is known in advance, it can slow time for a finishing blow or near miss and fast-forward long orbits. |
| `ai.js` (client) | Search ~1,000 candidate shots in ~30 ms and pick one that fits the CPU's personality. |
| `GameRoom` (server) | Referee online shots. |

Requirements for determinism:
- Level generation uses a **seeded PRNG** (room seed + level), never `Math.random()`
- Physics uses shared constants and a fixed step count
- Only `{ angle, power }` crosses the network

Visual-only randomness (planet surface styles, nebulae, particles) lives in
`art.js`/`view.js` and never feeds back into physics.

### Why the server referees

Earlier versions had the shooter's client report hit/miss back to the server.
That had two failure modes: a stale React closure made the wrong client report
(the game stalled after player 2's first shot), and any client could claim a
hit. Now the server computes the outcome itself and bundles the resulting state
with the shot, so there is no report step to lose or forge.

---

## Room Lifecycle

### 1. Create Room
```
Player 1 → POST /api/rooms { targetScore: 5 }
         ← { roomId: "K7QX2", playerId: 1, seed, targetScore, token }
```
`token` is the seat's secret (128-bit, hex). The client keeps it in
`localStorage` (`gw:games`, see `src/games.js`) and presents it on every
socket and status/resign call. Rooms created before tokens existed have none
and stay open.
The Worker generates a 5-character code (no 0/O/1/I), addresses the DO with
`idFromName(code)`, and retries on the rare collision. Legacy 64-hex room ids
still resolve via `idFromString`.

### 2. Join Room
```
Player 2 → POST /api/rooms/K7QX2/join
         ← { roomId: "K7QX2", playerId: 2, seed, token }
DO: status "waiting" → "playing", broadcasts room_state, pushes "Your rival
    has joined" to player 1 if they aren't looking
```

### 3. Share
Player 1 sees the code plus a link: `https://…/room/K7QX2`. Opening it joins
and redirects to `/online/K7QX2/2`. If this browser already holds a seat in
that room (the invite again, or a nudge), it goes straight to the seat.

### 4. Connect WebSocket
```
Both → GET /api/rooms/K7QX2/ws?player=N&token=T  (upgrade)
     ← room_state snapshot
```

### Play by mail
- **Lifetime:** every state change pushes the cleanup alarm to
  `lastActivity + 30 days` (7 days while waiting for a rival). The alarm only
  deletes a room nobody is connected to.
- **Missed shots:** the DO stores `lastShot` (with the state *before* it). A
  client whose `seen` id (in `gw:games`) is older starts from that state and
  replays the shot, then adopts the current state.
- **Status for the menu:** `GET /api/rooms/:code/status?player&token` returns a
  summary (status, scores, turn, level, lastActivity) for **Your games**.
- **Resign:** `POST /api/rooms/:code/resign?player&token` or the `resign`
  message. Resigning an unjoined invite cancels (deletes) the room.
- **Other devices:** `/online/:code/:seat#t=TOKEN` imports the seat. The token
  sits in the URL fragment, which browsers never send to servers, and is
  removed from the address bar once stored.

### 5. Match end and rematch
First to `targetScore` wins (`src/game/rules.js`, shared by client and server).
Both players vote `rematch`; when both have, the DO starts a new match with a
fresh seed, and the loser shoots first.

---

## Message Protocol

All messages are JSON over WebSocket: `{ type, data }`.

### Server → Client

```jsonc
// Snapshot: on connect, when P2 joins, and when a rematch starts
{ "type": "room_state", "data": {
    "roomId": "K7QX2", "playerId": 1,
    "seed": 98765, "level": 1, "scores": [0, 0], "turn": 1,
    "status": "playing",          // waiting | playing | finished
    "winner": null, "targetScore": 5,
    "shotCount": 0,               // shots already reflected in this snapshot
    "lastShot": null,             // { id, player, angle, power, hit, hitWhat, before: {...} }
    "resignedBy": null,
    "rematch": { "1": false, "2": false },
    "online": { "1": true, "2": true },
    "notify": { "1": false, "2": true },   // seats with push subscriptions
    "pushAvailable": true                  // server has VAPID keys
}}

// Live aim from the player on turn, relayed to the other seat only
{ "type": "aim", "data": { "player": 1, "angle": 40, "power": 62, "seed": 98765, "level": 1 } }

{ "type": "notify_status", "data": { "notify": { "1": true, "2": false } } }

// A shot, refereed. Sent to both players, including the shooter.
{ "type": "shot_fired", "data": {
    "id": 7,                      // monotonic; clients ignore ids <= shotCount
    "player": 1, "angle": 42, "power": 65,
    "hit": true, "hitWhat": "HIT!",   // HIT! | planet | self | lost
    "next": { "seed": 98765, "level": 2, "scores": [1, 0], "turn": 2,
              "status": "playing", "winner": null, "targetScore": 5 }
}}

{ "type": "presence", "data": { "online": { "1": true, "2": false } } }
{ "type": "rematch_vote", "data": { "votes": { "1": true, "2": false } } }
{ "type": "error", "data": { "message": "Not your turn", "fatal": false } }
```

### Client → Server

```jsonc
{ "type": "fire", "data": { "angle": 42, "power": 65 } }  // only on your turn
{ "type": "aim", "data": { "angle": 40, "power": 62 } }   // while aiming, ≤ ~11/s
{ "type": "rematch", "data": {} }                          // only when finished
{ "type": "resign", "data": {} }
{ "type": "visibility", "data": { "visible": false } }     // tab hidden/shown
{ "type": "push_subscribe", "data": { "subscription": { "endpoint": "…", "keys": { "p256dh": "…", "auth": "…" } } } }
{ "type": "push_unsubscribe", "data": { "endpoint": "…" } }
```

Aim messages carry the level they belong to (the server stamps `seed` and
`level`), so a late one can't move a turret on the next map.

### Client handling

- Incoming shots are queued and played in order; a shot never interrupts another.
- `next` is applied only after the local animation (and any level transition)
  finishes, so the scoreboard never jumps ahead of what players have seen.
- A `room_state` that arrives mid-animation (e.g. after a reconnect) is held
  and applied when the client is idle.

---

## Durable Object: GameRoom

Uses the **WebSocket Hibernation API** (`state.acceptWebSocket`). The object
may be evicted from memory between messages while sockets stay open, so it
keeps nothing important in memory:

- Game state lives in `state.storage` under `"game"`
- Connected players are found with `state.getWebSockets(String(playerId))`
  (sockets are tagged with their seat), never an in-memory Map
- Whether a socket's tab is visible is a socket attachment
  (`serializeAttachment`), which survives hibernation
- An alarm deletes the room 30 days after the last move (7 if never joined)

Validation: `fire` requires integer angle/power in range, `status === "playing"`,
and the sender's seat to match `turn`. Sockets with a wrong token, unclaimed
seats, or deleted rooms get a `fatal` error so clients stop reconnecting.

### Turn notifications (Web Push)

`worker/push.js` implements Web Push with WebCrypto only: RFC 8291 payload
encryption (aes128gcm) and RFC 8292 VAPID (ES256 JWT). It reproduces the RFC
8291 Appendix A test vector byte-for-byte. Subscriptions are stored per seat
(max 3 devices) in the game record.

The DO pushes to a seat only when **none of that seat's sockets is visible**:
after a shot (your move / you've been hit / defeat), when the rival joins,
on a rematch vote, and on resign. Pushes carry a `Topic` so an undelivered
older notice for the same match is replaced, and the service worker uses a
per-match `tag` so the tray shows one notice per match. Dead subscriptions
(404/410) are pruned. Endpoints must be on a known push service host
(FCM, Mozilla, Apple, Windows), so a stored subscription can't make the room
fetch arbitrary URLs.

---

## Seeded PRNG

mulberry32 (`createRng` in `levelgen.js`). Level layout uses
`createRng(seed + level * 9973)`; black holes use a separate stream so adding
them didn't reshuffle existing layouts.

---

## Cloudflare Configuration

```toml
name = "gravity-wars-worker"
main = "worker/index.js"

[durable_objects]
bindings = [{ name = "GAME_ROOMS", class_name = "GameRoom" }]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["GameRoom"]
```

Set `ALLOWED_ORIGIN` (wrangler secret) in production: it restricts CORS for the
HTTP endpoints and rejects WebSocket upgrades from other origins.

---

## Cost

Cloudflare Workers free tier:
- 100,000 requests/day
- Durable Objects: 1M requests/month free, ~$0.15/million after
- WebSocket messages count as requests; hibernation means idle rooms cost nothing
- For a hobby game, this is effectively free

---

## Future Enhancements
- Daily challenge (date-seeded solo puzzle, shots-to-hit, shareable result)
- Spectator mode (additional WS connections tagged as observers)
- Player names/avatars per seat (notifications currently say "Rival")
- Game replay (store all shots, replay from seed)
