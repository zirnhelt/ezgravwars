// WebSocket client for multiplayer room communication.
// Handles connection, reconnection, and message routing.

import { API_URL, WS_URL } from '../config.js';

const RECONNECT_DELAYS = [500, 1000, 2000, 4000, 8000];

export class GameClient {
  constructor(roomId, playerId, onMessage, onStatusChange) {
    this.roomId = roomId;
    this.playerId = playerId;
    this.onMessage = onMessage;
    this.onStatusChange = onStatusChange;
    this.ws = null;
    this.reconnectAttempt = 0;
    this.closed = false;
    this.timer = null;
  }

  connect() {
    const url = `${WS_URL}/api/rooms/${encodeURIComponent(this.roomId)}/ws?player=${this.playerId}`;

    this.onStatusChange(this.reconnectAttempt ? "reconnecting" : "connecting");
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.onStatusChange("connected");
    };

    ws.onmessage = (event) => {
      try {
        this.onMessage(JSON.parse(event.data));
      } catch (e) {
        console.error("Bad message from server:", e);
      }
    };

    ws.onclose = () => {
      if (this.closed || this.ws !== ws) return;
      this.onStatusChange("disconnected");
      this._reconnect();
    };
  }

  send(type, data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }));
      return true;
    }
    return false;
  }

  fire(angle, power) {
    return this.send("fire", { angle, power });
  }

  rematch() {
    return this.send("rematch", {});
  }

  _reconnect() {
    if (this.closed) return;
    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    this.reconnectAttempt++;
    this.onStatusChange("reconnecting");
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.closed) this.connect();
    }, delay);
  }

  disconnect() {
    this.closed = true;
    clearTimeout(this.timer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// --- HTTP helpers for room management ---

const API_BASE = `${API_URL}/api/rooms`;

export async function createRoom(targetScore) {
  const res = await fetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetScore }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json(); // { roomId, playerId, seed, targetScore }
}

export class JoinError extends Error {
  constructor(status) {
    super(status === 404 ? "That room doesn't exist (or has expired)" : status === 409 ? "That room is already full" : `Join failed (HTTP ${status})`);
    this.status = status;
  }
}

// De-duplicates concurrent joins for the same room (React StrictMode runs
// effects twice in development, and a second join would get "room full").
const inflight = new Map();

export function joinRoom(roomId) {
  const key = roomId.toUpperCase();
  if (!inflight.has(key)) {
    const p = fetch(`${API_BASE}/${encodeURIComponent(roomId)}/join`, { method: "POST" })
      .then((res) => {
        if (!res.ok) throw new JoinError(res.status);
        return res.json();
      })
      .finally(() => setTimeout(() => inflight.delete(key), 5000));
    inflight.set(key, p);
  }
  return inflight.get(key);
}
