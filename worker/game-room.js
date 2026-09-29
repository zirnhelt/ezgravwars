// GameRoom Durable Object — one per match.
//
// The server is the referee: when a player fires, it runs the same
// deterministic simulateShot() the clients use, applies the shared match
// rules, and broadcasts the shot together with the resulting state. Clients
// animate the shot locally and adopt that state when the animation ends.
//
// Matches are play-by-mail friendly: a room lives for weeks, each seat is
// guarded by a secret token, the last shot is kept so a returning player can
// watch what they missed, and players who aren't looking get a Web Push
// notification when it's their move.
//
// Uses the WebSocket Hibernation API. The object can be evicted from memory
// between messages while sockets stay open, so nothing lives only in memory:
// the game is in storage, connected players are found with
// state.getWebSockets(tag), and per-socket visibility is a socket attachment.

import { simulateShot } from "../src/game/physics.js";
import { generateLevel } from "../src/game/levelgen.js";
import { applyShot, newMatchState } from "../src/game/rules.js";
import { MIN_POWER, MAX_POWER } from "../src/game/constants.js";
import { sendPush, isAllowedEndpoint, pushConfigured } from "./push.js";

const DAY = 24 * 60 * 60 * 1000;
const ACTIVE_TTL_MS = 30 * DAY; // a match survives a month without moves
const WAITING_TTL_MS = 7 * DAY; // an unanswered invite lasts a week
const MAX_SUBSCRIPTIONS_PER_SEAT = 3;

function randomSeed() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] % 2147483646) + 1;
}

function randomToken() {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

const other = (p) => (p === 1 ? 2 : 1);
const validAim = (angle, power) =>
  Number.isInteger(angle) && angle >= -360 && angle <= 360 &&
  Number.isInteger(power) && power >= MIN_POWER && power <= MAX_POWER;

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

  // Record activity and push the cleanup alarm out accordingly.
  async touch() {
    this.game.lastActivity = Date.now();
    await this.save();
    const ttl = this.game.status === "waiting" ? WAITING_TTL_MS : ACTIVE_TTL_MS;
    await this.state.storage.setAlarm(this.game.lastActivity + ttl);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "POST" && path.endsWith("/create")) return this.handleCreate(request, url);
    if (request.method === "POST" && path.endsWith("/join")) return this.handleJoin();
    if (request.method === "GET" && path.endsWith("/status")) return this.handleStatus(url);
    if (request.method === "POST" && path.endsWith("/resign")) return this.handleResignHttp(url);
    if (path.endsWith("/ws")) return this.handleWebSocket(request, url);
    return new Response("Not found", { status: 404 });
  }

  // Returns an error string, or null when the seat/token pair is valid.
  // Rooms created before seat tokens existed have no tokens and stay open.
  seatError(playerId, token) {
    if (!this.game) return "This room doesn't exist or has expired.";
    if (playerId !== 1 && playerId !== 2) return "Invalid seat.";
    if (!this.game.players[playerId]) return "That seat hasn't been claimed. Join with the invite link instead.";
    if (this.game.tokens && this.game.tokens[playerId] !== token) return "That seat belongs to someone else on another device.";
    return null;
  }

  // --- HTTP ---

  async handleCreate(request, url) {
    await this.load();
    if (this.game) return new Response("Room code in use", { status: 409 });
    const body = await request.json().catch(() => ({}));
    const seed = randomSeed();
    const token = randomToken();
    this.game = {
      ...newMatchState(seed, body?.targetScore),
      roomId: url.searchParams.get("code") || this.state.id.toString(),
      status: "waiting",
      players: { 1: true },
      tokens: { 1: token },
      shotCount: 0,
      lastShot: null,
      rematch: { 1: false, 2: false },
      push: { 1: [], 2: [] },
      createdAt: Date.now(),
    };
    await this.touch();
    return Response.json({ roomId: this.game.roomId, playerId: 1, seed, targetScore: this.game.targetScore, token });
  }

  async handleJoin() {
    await this.load();
    if (!this.game) return new Response("Room not found", { status: 404 });
    if (this.game.players[2]) return new Response("Room full", { status: 409 });

    const token = randomToken();
    this.game.players[2] = true;
    this.game.tokens = { ...(this.game.tokens || {}), 2: token };
    this.game.status = "playing";
    await this.touch();
    this.broadcastState();
    await this.notify(1, {
      title: "Your rival has joined",
      body: `Your move — first to ${this.game.targetScore}.`,
    });
    return Response.json({ roomId: this.game.roomId, playerId: 2, seed: this.game.seed, targetScore: this.game.targetScore, token });
  }

  async handleStatus(url) {
    await this.load();
    const playerId = parseInt(url.searchParams.get("player"), 10);
    const err = this.seatError(playerId, url.searchParams.get("token"));
    if (err) return Response.json({ error: err }, { status: this.game ? 403 : 404 });
    const g = this.game;
    return Response.json({
      roomId: g.roomId,
      playerId,
      status: g.status,
      scores: g.scores,
      level: g.level,
      turn: g.turn,
      winner: g.winner,
      resignedBy: g.resignedBy ?? null,
      targetScore: g.targetScore,
      rivalJoined: !!g.players[2],
      online: this.presence(),
      rematch: g.rematch,
      lastActivity: g.lastActivity ?? null,
      lastShotId: g.lastShot?.id ?? 0,
    });
  }

  async handleResignHttp(url) {
    await this.load();
    const playerId = parseInt(url.searchParams.get("player"), 10);
    const err = this.seatError(playerId, url.searchParams.get("token"));
    if (err) return Response.json({ error: err }, { status: this.game ? 403 : 404 });
    await this.resign(playerId);
    return Response.json({ ok: true });
  }

  async handleWebSocket(request, url) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    await this.load();
    const playerId = parseInt(url.searchParams.get("player"), 10);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Refuse over the socket (not with an HTTP error) so the client can show
    // the reason and stop reconnecting.
    const refusal = this.seatError(playerId, url.searchParams.get("token"));
    if (refusal) {
      server.accept();
      server.send(JSON.stringify({ type: "error", data: { message: refusal, fatal: true } }));
      server.close(1008, "refused");
      return new Response(null, { status: 101, webSocket: client });
    }

    const wasOnline = this.state.getWebSockets(String(playerId)).length > 0;
    this.state.acceptWebSocket(server, [String(playerId)]);
    server.serializeAttachment({ visible: true });

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
    const data = msg?.data ?? {};

    switch (msg?.type) {
      case "fire":
        return this.handleFire(ws, playerId, data);
      case "aim":
        return this.handleAim(ws, playerId, data);
      case "rematch":
        return this.handleRematch(playerId);
      case "resign":
        return this.resign(playerId);
      case "visibility":
        ws.serializeAttachment({ ...(ws.deserializeAttachment() || {}), visible: data.visible !== false });
        return;
      case "push_subscribe":
        return this.handlePushSubscribe(ws, playerId, data.subscription);
      case "push_unsubscribe":
        return this.handlePushUnsubscribe(ws, playerId, data.endpoint);
      case "ping":
        ws.send(JSON.stringify({ type: "pong", data: {} }));
        return;
      default:
        return this.sendError(ws, "Unknown message type");
    }
  }

  async handleFire(ws, playerId, { angle, power }) {
    if (!validAim(angle, power)) return this.sendError(ws, "Invalid shot parameters");
    if (this.game.status !== "playing") return this.sendError(ws, "Match is not in progress");
    if (playerId !== this.game.turn) return this.sendError(ws, "Not your turn");

    const before = this.game;
    const planets = generateLevel(before.seed, before.level);
    const sim = simulateShot(planets, angle, power, playerId, { record: false });
    const g = { ...applyShot(before, playerId, sim.hit), shotCount: before.shotCount + 1 };
    g.lastShot = {
      id: g.shotCount,
      player: playerId,
      angle,
      power,
      hit: sim.hit,
      hitWhat: sim.hitWhat,
      before: { seed: before.seed, level: before.level, scores: before.scores, turn: before.turn, status: before.status, winner: before.winner, targetScore: before.targetScore },
    };
    this.game = g;
    await this.touch();

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

    // Tell the other player, if they aren't watching.
    const rival = other(playerId);
    const score = `${g.scores[rival - 1]}–${g.scores[playerId - 1]}`;
    let note;
    if (g.status === "finished") note = { title: "Defeat", body: `Your rival won ${g.scores[playerId - 1]}–${g.scores[rival - 1]}. Rematch?` };
    else if (sim.hit) note = { title: "You've been hit!", body: `Rival scores · you ${score} · your move on level ${g.level}` };
    else {
      const how = sim.hitWhat === "self" ? "hit their own world"
        : sim.hitWhat === "lost" ? "got lost in space"
        : sim.closest.dist < 60 ? `missed you by ${Math.round(sim.closest.dist)}px`
        : "missed";
      note = { title: "Your move", body: `Rival ${how} · you ${score} · level ${g.level}` };
    }
    await this.notify(rival, note);
  }

  // Live aim: relayed to the rival as-is, never stored.
  handleAim(ws, playerId, { angle, power }) {
    if (!validAim(angle, power) || this.game.status !== "playing" || playerId !== this.game.turn) return;
    const { seed, level } = this.game;
    const data = JSON.stringify({ type: "aim", data: { player: playerId, angle, power, seed, level } });
    for (const s of this.state.getWebSockets(String(other(playerId)))) {
      try { s.send(data); } catch { /* closing */ }
    }
  }

  async handleRematch(playerId) {
    if (this.game.status !== "finished") return;
    this.game.rematch = { ...this.game.rematch, [playerId]: true };

    if (this.game.rematch[1] && this.game.rematch[2]) {
      const { roomId, players, tokens, shotCount, targetScore, winner, push, createdAt } = this.game;
      this.game = {
        ...newMatchState(randomSeed(), targetScore),
        roomId, players, tokens, shotCount, push, createdAt,
        turn: winner === 1 ? 2 : 1, // loser of the last match shoots first
        lastShot: null,
        rematch: { 1: false, 2: false },
      };
      await this.touch();
      this.broadcastState();
      const first = this.game.turn;
      await this.notify(first, { title: "Rematch on", body: "New match — you shoot first." });
    } else {
      await this.touch();
      this.broadcast({ type: "rematch_vote", data: { votes: this.game.rematch } });
      await this.notify(other(playerId), { title: "Rematch?", body: "Your rival wants another round." });
    }
  }

  async resign(playerId) {
    const g = this.game;
    if (g.status === "waiting") {
      // Nobody joined yet: resigning just cancels the invite.
      this.broadcast({ type: "error", data: { message: "This room was cancelled.", fatal: true } });
      await this.state.storage.deleteAll();
      this.game = null;
      return;
    }
    if (g.status !== "playing") return;
    g.status = "finished";
    g.winner = other(playerId);
    g.resignedBy = playerId;
    await this.touch();
    this.broadcastState();
    await this.notify(other(playerId), { title: "Victory", body: "Your rival resigned." });
  }

  async handlePushSubscribe(ws, playerId, sub) {
    const valid =
      sub && isAllowedEndpoint(sub.endpoint, this.env) &&
      typeof sub.keys?.p256dh === "string" && sub.keys.p256dh.length >= 80 && sub.keys.p256dh.length <= 100 &&
      typeof sub.keys?.auth === "string" && sub.keys.auth.length >= 16 && sub.keys.auth.length <= 32;
    if (!pushConfigured(this.env) || !valid) {
      return this.sendError(ws, pushConfigured(this.env) ? "Unsupported push subscription" : "Notifications aren't set up on this server");
    }
    const clean = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
    const list = (this.game.push?.[playerId] || []).filter((s) => s.endpoint !== clean.endpoint);
    list.push(clean);
    this.game.push = { ...(this.game.push || {}), [playerId]: list.slice(-MAX_SUBSCRIPTIONS_PER_SEAT) };
    await this.save();
    this.broadcast({ type: "notify_status", data: { notify: this.notifyMap() } });
  }

  async handlePushUnsubscribe(ws, playerId, endpoint) {
    const list = this.game.push?.[playerId] || [];
    this.game.push = { ...(this.game.push || {}), [playerId]: list.filter((s) => s.endpoint !== endpoint) };
    await this.save();
    this.broadcast({ type: "notify_status", data: { notify: this.notifyMap() } });
  }

  async webSocketClose(ws, code) {
    this.broadcast({ type: "presence", data: { online: this.presence(ws) } }, ws);
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, "closing"); } catch { /* already closed */ }
  }

  async webSocketError(ws) {
    this.broadcast({ type: "presence", data: { online: this.presence(ws) } }, ws);
  }

  async alarm() {
    await this.load();
    if (!this.game) return;
    const ttl = this.game.status === "waiting" ? WAITING_TTL_MS : ACTIVE_TTL_MS;
    const expires = (this.game.lastActivity ?? 0) + ttl;
    if (Date.now() >= expires - 1000 && this.state.getWebSockets().length === 0) {
      await this.state.storage.deleteAll();
      this.game = null;
    } else {
      await this.state.storage.setAlarm(Math.max(Date.now() + 60 * 60 * 1000, expires));
    }
  }

  // --- Push ---

  // Web Push to a seat, unless one of its sockets is visible right now.
  async notify(playerId, { title, body }) {
    if (!pushConfigured(this.env)) return;
    const subs = this.game?.push?.[playerId] || [];
    if (!subs.length) return;
    const watching = this.state.getWebSockets(String(playerId)).some((s) => s.deserializeAttachment()?.visible !== false);
    if (watching) return;

    const roomId = this.game.roomId;
    const payload = { title, body, url: `/online/${roomId}/${playerId}`, tag: `gw-${roomId}` };
    const topic = `gw${String(roomId).slice(0, 24)}${playerId}`;
    const results = await Promise.all(subs.map((s) => sendPush(s, payload, this.env, { topic })));
    const alive = subs.filter((_, i) => !results[i].gone);
    if (alive.length !== subs.length) {
      this.game.push[playerId] = alive;
      await this.save();
    }
  }

  notifyMap() {
    return { 1: (this.game.push?.[1] || []).length > 0, 2: (this.game.push?.[2] || []).length > 0 };
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
      resignedBy: g.resignedBy ?? null,
      targetScore: g.targetScore,
      shotCount: g.shotCount,
      lastShot: g.lastShot ?? null,
      rematch: g.rematch,
      online: this.presence(),
      notify: this.notifyMap(),
      pushAvailable: pushConfigured(this.env),
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
