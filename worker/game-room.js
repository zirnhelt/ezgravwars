// GameRoom Durable Object
// Manages a single game room: player connections, turn validation, state sync.
// Does NOT run physics — clients simulate deterministically from shared inputs.

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map(); // playerId -> WebSocket
    this.game = null;
  }

  async initialize() {
    this.game = await this.state.storage.get("game");
  }

  async fetch(request) {
    const url = new URL(request.url);

    // POST /create — initialize a new room
    if (request.method === "POST" && url.pathname.endsWith("/create")) {
      return this.handleCreate(request);
    }

    // POST /join — second player joins
    if (request.method === "POST" && url.pathname.endsWith("/join")) {
      return this.handleJoin(request);
    }

    // GET /ws — WebSocket upgrade
    if (url.pathname.endsWith("/ws")) {
      return this.handleWebSocket(request);
    }

    return new Response("Not found", { status: 404 });
  }

  async handleCreate(request) {
    const seed = Math.floor(Math.random() * 2147483647);
    this.game = {
      seed,
      level: 1,
      scores: [0, 0],
      turn: 1,
      players: { 1: "waiting" },
      status: "waiting",
      shotHistory: [],
    };
    await this.state.storage.put("game", this.game);
    return Response.json({ roomId: this.state.id.toString(), playerId: 1, seed });
  }

  async handleJoin(request) {
    if (!this.game) await this.initialize();
    if (!this.game) return new Response("Room not found", { status: 404 });
    if (this.game.players[2]) return new Response("Room full", { status: 409 });

    this.game.players[2] = "waiting";
    this.game.status = "playing";
    await this.state.storage.put("game", this.game);

    // Notify player 1
    this.broadcast({ type: "player_joined", data: { status: "playing" } });

    return Response.json({ roomId: this.state.id.toString(), playerId: 2, seed: this.game.seed });
  }

  async handleWebSocket(request) {
    if (!this.game) await this.initialize();

    const url = new URL(request.url);
    const playerId = parseInt(url.searchParams.get("player"));
    if (playerId !== 1 && playerId !== 2) {
      return new Response("Invalid player", { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const wasReconnect = this.sessions.has(playerId);

    this.state.acceptWebSocket(server, [String(playerId)]);
    this.sessions.set(playerId, server);

    // Cancel cleanup alarm if someone connects
    await this.state.storage.deleteAlarm();

    // Send current state
    server.send(JSON.stringify({
      type: "room_state",
      data: {
        ...this.game,
        playerId,
      },
    }));

    // Notify other player if this was a reconnect
    if (wasReconnect) {
      this.broadcast({
        type: "player_reconnected",
        data: { player: playerId },
      });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    if (!this.game) await this.initialize();

    const msg = JSON.parse(message);

    // Get player ID from WebSocket tags
    const tags = this.state.getTags(ws);
    const playerId = tags && tags.length > 0 ? parseInt(tags[0]) : null;

    switch (msg.type) {
      case "fire": {
        const { angle, power } = msg.data;

        // Validate it's actually this player's turn
        if (playerId !== this.game.turn) {
          ws.send(JSON.stringify({
            type: "error",
            data: { message: "Not your turn" }
          }));
          return;
        }

        // Broadcast to both players
        this.broadcast({
          type: "shot_fired",
          data: { player: this.game.turn, angle, power },
        });
        break;
      }

      case "report_result": {
        const { hit, hitWhat } = msg.data;

        // Validate it's the active player reporting
        if (playerId !== this.game.turn) {
          ws.send(JSON.stringify({
            type: "error",
            data: { message: "Not your turn to report" }
          }));
          return;
        }

        const opponent = this.game.turn === 1 ? 2 : 1;

        if (hit) {
          this.game.scores[this.game.turn - 1]++;
          this.game.level++;
        }
        this.game.turn = opponent;
        this.game.shotHistory.push({
          player: this.game.turn === 1 ? 2 : 1, // the one who just fired
          result: hitWhat,
        });

        await this.state.storage.put("game", this.game);

        this.broadcast({
          type: "shot_result",
          data: {
            hit,
            hitWhat,
            scores: this.game.scores,
            level: this.game.level,
            seed: this.game.seed,
            turn: this.game.turn,
          },
        });
        break;
      }
    }
  }

  async webSocketClose(ws) {
    // Find which player disconnected
    for (const [playerId, socket] of this.sessions) {
      if (socket === ws) {
        this.sessions.delete(playerId);
        this.broadcast({
          type: "player_disconnected",
          data: { player: playerId },
        });
        break;
      }
    }

    // Set alarm to clean up room after 1 hour of no connections
    if (this.sessions.size === 0) {
      const oneHour = 60 * 60 * 1000;
      await this.state.storage.setAlarm(Date.now() + oneHour);
    }
  }

  async alarm() {
    // Clean up room if no one is connected
    if (this.sessions.size === 0) {
      await this.state.storage.deleteAll();
    }
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const ws of this.sessions.values()) {
      try { ws.send(data); } catch (e) { /* dead socket */ }
    }
  }
}
