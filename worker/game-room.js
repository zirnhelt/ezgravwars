// GameRoom Durable Object — one per match.
//
// The server is the referee: when a player fires, it runs the same
// deterministic simulateShot() the clients use, applies the shared match
// rules, and broadcasts the shot together with the resulting state. Clients
// animate the shot locally and adopt that state when the animation ends, so
// there is no client "report" step to get stuck on (or to cheat with).
//
// Uses the WebSocket Hibernation API. The object can be evicted from memory
// between messages while sockets stay open, so nothing lives only in memory:
// the game is in storage and connected players are found with
// state.getWebSockets(tag).

import { simulateShot } from "../src/game/physics.js";
import { generateLevel } from "../src/game/levelgen.js";
import { applyShot, newMatchState } from "../src/game/rules.js";
import { MIN_POWER, MAX_POWER } from "../src/game/constants.js";

const IDLE_TTL_MS = 60 * 60 * 1000; // delete a room an hour after everyone leaves

function randomSeed() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] % 2147483646) + 1;
}

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.game = null;
  }

  async load() {
    if (!this.game) this.game = (await this.state.storage.get("game")) ?? null;
    return this.game;
  }

  async save() {
    await this.state.storage.put("game", this.game);
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname.endsWith("/create")) return this.handleCreate(request, url);
    if (request.method === "POST" && url.pathname.endsWith("/join")) return this.handleJoin();
    if (url.pathname.endsWith("/ws")) return this.handleWebSocket(request, url);
    return new Response("Not found", { status: 404 });
  }

  // --- HTTP ---

  async handleCreate(request, url) {
    await this.load();
    if (this.game) return new Response("Room code in use", { status: 409 });
    const body = await request.json().catch(() => ({}));
    const seed = randomSeed();
    this.game = {
      ...newMatchState(seed, body?.targetScore),
      roomId: url.searchParams.get("code") || this.state.id.toString(),
      status: "waiting",
      players: { 1: true },
      shotCount: 0,
      rematch: { 1: false, 2: false },
    };
    await this.save();
    await this.state.storage.setAlarm(Date.now() + IDLE_TTL_MS);
    return Response.json({ roomId: this.game.roomId, playerId: 1, seed, targetScore: this.game.targetScore });
  }

  async handleJoin() {
    await this.load();
    if (!this.game) return new Response("Room not found", { status: 404 });
    if (this.game.players[2]) return new Response("Room full", { status: 409 });

    this.game.players[2] = true;
    this.game.status = "playing";
    await this.save();
    this.broadcastState();
    return Response.json({ roomId: this.game.roomId, playerId: 2, seed: this.game.seed, targetScore: this.game.targetScore });
  }

  async handleWebSocket(request, url) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    await this.load();
    const playerId = parseInt(url.searchParams.get("player"), 10);
    if (playerId !== 1 && playerId !== 2) return new Response("Invalid player", { status: 400 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Refuse politely over the socket so the client stops reconnecting.
    const refusal = !this.game
      ? "This room doesn't exist or has expired."
      : !this.game.players[playerId]
      ? "That seat hasn't been claimed. Join with the room link instead."
      : null;
    if (refusal) {
      server.accept();
      server.send(JSON.stringify({ type: "error", data: { message: refusal, fatal: true } }));
      server.close(1008, "refused");
      return new Response(null, { status: 101, webSocket: client });
    }

    const wasOnline = this.state.getWebSockets(String(playerId)).length > 0;
    this.state.acceptWebSocket(server, [String(playerId)]);
    await this.state.storage.deleteAlarm();

    server.send(JSON.stringify({ type: "room_state", data: this.snapshot(playerId) }));
    if (!wasOnline) this.broadcast({ type: "presence", data: { online: this.presence() } }, server);

    return new Response(null, { status: 101, webSocket: client });
  }

  // --- WebSocket events (hibernation API) ---

  async webSocketMessage(ws, message) {
    await this.load();
    if (!this.game) return;
    const playerId = this.playerOf(ws);

    let msg;
    try {
      msg = JSON.parse(message);
    } catch {
      return this.sendError(ws, "Invalid message format");
    }

    switch (msg?.type) {
      case "fire":
        return this.handleFire(ws, playerId, msg.data ?? {});
      case "rematch":
        return this.handleRematch(playerId);
      case "ping":
        ws.send(JSON.stringify({ type: "pong", data: {} }));
        return;
      default:
        return this.sendError(ws, "Unknown message type");
    }
  }

  async handleFire(ws, playerId, { angle, power }) {
    if (
      !Number.isInteger(angle) || angle < -360 || angle > 360 ||
      !Number.isInteger(power) || power < MIN_POWER || power > MAX_POWER
    ) {
      return this.sendError(ws, "Invalid shot parameters");
    }
    if (this.game.status !== "playing") return this.sendError(ws, "Match is not in progress");
    if (playerId !== this.game.turn) return this.sendError(ws, "Not your turn");

    const planets = generateLevel(this.game.seed, this.game.level);
    const sim = simulateShot(planets, angle, power, playerId, { record: false });
    this.game = { ...applyShot(this.game, playerId, sim.hit), shotCount: this.game.shotCount + 1 };
    await this.save();

    const g = this.game;
    this.broadcast({
      type: "shot_fired",
      data: {
        id: g.shotCount,
        player: playerId,
        angle,
        power,
        hit: sim.hit,
        hitWhat: sim.hitWhat,
        next: { seed: g.seed, level: g.level, scores: g.scores, turn: g.turn, status: g.status, winner: g.winner, targetScore: g.targetScore },
      },
    });
  }

  async handleRematch(playerId) {
    if (this.game.status !== "finished") return;
    this.game.rematch = { ...this.game.rematch, [playerId]: true };

    if (this.game.rematch[1] && this.game.rematch[2]) {
      const { roomId, players, shotCount, targetScore, winner } = this.game;
      this.game = {
        ...newMatchState(randomSeed(), targetScore),
        roomId, players, shotCount,
        turn: winner === 1 ? 2 : 1, // loser of the last match shoots first
        rematch: { 1: false, 2: false },
      };
      await this.save();
      this.broadcastState();
    } else {
      await this.save();
      this.broadcast({ type: "rematch_vote", data: { votes: this.game.rematch } });
    }
  }

  async webSocketClose(ws, code) {
    await this.onSocketGone(ws);
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, "closing"); } catch { /* already closed */ }
  }

  async webSocketError(ws) {
    await this.onSocketGone(ws);
  }

  async onSocketGone(ws) {
    const remaining = this.state.getWebSockets().filter((s) => s !== ws);
    // The departing socket may still be listed during this handler: leave it out.
    this.broadcast({ type: "presence", data: { online: this.presence(ws) } }, ws);
    if (remaining.length === 0) {
      await this.state.storage.setAlarm(Date.now() + IDLE_TTL_MS);
    }
  }

  async alarm() {
    if (this.state.getWebSockets().length === 0) {
      await this.state.storage.deleteAll();
      this.game = null;
    }
  }

  // --- Helpers ---

  playerOf(ws) {
    const tags = this.state.getTags(ws);
    return tags && tags.length ? parseInt(tags[0], 10) : null;
  }

  presence(except) {
    const on = (p) => this.state.getWebSockets(String(p)).some((s) => s !== except);
    return { 1: on(1), 2: on(2) };
  }

  snapshot(playerId) {
    const g = this.game;
    return {
      roomId: g.roomId,
      playerId,
      seed: g.seed,
      level: g.level,
      scores: g.scores,
      turn: g.turn,
      status: g.status,
      winner: g.winner,
      targetScore: g.targetScore,
      shotCount: g.shotCount,
      rematch: g.rematch,
      online: this.presence(),
    };
  }

  sendError(ws, message) {
    try { ws.send(JSON.stringify({ type: "error", data: { message } })); } catch { /* gone */ }
  }

  broadcast(msg, except) {
    const data = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(data); } catch { /* socket closing */ }
    }
  }

  broadcastState() {
    for (const ws of this.state.getWebSockets()) {
      try { ws.send(JSON.stringify({ type: "room_state", data: this.snapshot(this.playerOf(ws)) })); } catch { /* closing */ }
    }
  }
}
