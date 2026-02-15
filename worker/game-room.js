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
    console.log('[handleJoin] Player 2 joining room');
    if (!this.game) await this.initialize();
    if (!this.game) {
      console.log('[handleJoin] Room not found');
      return new Response("Room not found", { status: 404 });
    }
    if (this.game.players[2]) {
      console.log('[handleJoin] Room full');
      return new Response("Room full", { status: 409 });
    }

    console.log('[handleJoin] Adding player 2, setting status to playing');
    this.game.players[2] = "waiting";
    this.game.status = "playing";
    await this.state.storage.put("game", this.game);

    console.log('[handleJoin] Broadcasting player_joined to notify player 1');
    // Notify player 1
    this.broadcast({ type: "player_joined", data: { status: "playing" } });

    console.log('[handleJoin] Join complete');
    return Response.json({ roomId: this.state.id.toString(), playerId: 2, seed: this.game.seed });
  }

  async handleWebSocket(request) {
    if (!this.game) await this.initialize();

    const url = new URL(request.url);
    const playerId = parseInt(url.searchParams.get("player"));
    console.log(`[handleWebSocket] Player ${playerId} connecting`);
    console.log(`[handleWebSocket] this.game exists: ${!!this.game}, status: ${this.game?.status}`);

    if (!this.game) {
      console.error(`[handleWebSocket] Game not found in storage!`);
      return new Response("Room not found", { status: 404 });
    }

    if (playerId !== 1 && playerId !== 2) {
      console.log(`[handleWebSocket] Invalid player ID: ${playerId}`);
      return new Response("Invalid player", { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const wasReconnect = this.sessions.has(playerId);
    console.log(`[handleWebSocket] Player ${playerId} wasReconnect: ${wasReconnect}`);

    this.state.acceptWebSocket(server, [String(playerId)]);
    this.sessions.set(playerId, server);
    console.log(`[handleWebSocket] Player ${playerId} added to sessions. Total sessions: ${this.sessions.size}`);

    // Cancel cleanup alarm if someone connects
    await this.state.storage.deleteAlarm();

    // Send current state
    const currentState = {
      type: "room_state",
      data: {
        ...this.game,
        playerId,
      },
    };
    console.log(`[handleWebSocket] Preparing room_state for player ${playerId}`);
    console.log(`[handleWebSocket] Game object:`, JSON.stringify(this.game, null, 2));
    console.log(`[handleWebSocket] room_state data:`, JSON.stringify(currentState.data, null, 2));
    server.send(JSON.stringify(currentState));

    // Notify other player if this was a reconnect
    if (wasReconnect) {
      this.broadcast({
        type: "player_reconnected",
        data: { player: playerId },
      });
    }

    console.log(`[handleWebSocket] Player ${playerId} WebSocket setup complete`);
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
    console.log(`[Broadcast] Broadcasting ${msg.type} to ${this.sessions.size} sessions`);
    console.log(`[Broadcast] Session player IDs:`, Array.from(this.sessions.keys()));

    const data = JSON.stringify(msg);
    let successCount = 0;
    let failCount = 0;

    for (const [playerId, ws] of this.sessions.entries()) {
      try {
        console.log(`[Broadcast] Sending to player ${playerId}, readyState: ${ws.readyState}`);
        ws.send(data);
        successCount++;
        console.log(`[Broadcast] Successfully sent to player ${playerId}`);
      } catch (e) {
        failCount++;
        console.error(`[Broadcast] Failed to send to player ${playerId}:`, e.message);
      }
    }

    console.log(`[Broadcast] Complete: ${successCount} succeeded, ${failCount} failed`);
  }
}
