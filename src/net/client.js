// WebSocket client for multiplayer room communication.
// Handles connection, reconnection, and message routing.

import { API_URL, WS_URL } from '../config.js';

const RECONNECT_DELAYS = [500, 1000, 2000, 4000, 8000];

export class GameClient {
  constructor(roomId, playerId, token, onMessage, onStatusChange) {
    this.roomId = roomId;
    this.playerId = playerId;
    this.token = token;
    this.onMessage = onMessage;
    this.onStatusChange = onStatusChange;
    this.ws = null;
    this.reconnectAttempt = 0;
    this.closed = false;
    this.timer = null;
    this.visible = typeof document === "undefined" ? true : !document.hidden;
  }

  connect() {
    const q = new URLSearchParams({ player: String(this.playerId), token: this.token || "" });
    const url = `${WS_URL}/api/rooms/${encodeURIComponent(this.roomId)}/ws?${q}`;

    this.onStatusChange(this.reconnectAttempt ? "reconnecting" : "connecting");
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.onStatusChange("connected");
      // The server only sends turn notifications to seats nobody is looking at.
      this.send("visibility", { visible: this.visible });
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "error" && msg.data?.fatal) this.closed = true;
        this.onMessage(msg);
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

  aim(angle, power) {
    return this.send("aim", { angle, power });
  }

  rematch() {
    return this.send("rematch", {});
  }

  resign() {
    return this.send("resign", {});
  }

  setVisible(visible) {
    this.visible = visible;
    this.send("visibility", { visible });
  }

  subscribePush(subscription) {
    return this.send("push_subscribe", { subscription });
  }

  unsubscribePush(endpoint) {
    return this.send("push_unsubscribe", { endpoint });
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
  return res.json(); // { roomId, playerId, seed, targetScore, token }
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
        return res.json(); // { roomId, playerId, seed, targetScore, token }
      })
      .finally(() => setTimeout(() => inflight.delete(key), 5000));
    inflight.set(key, p);
  }
  return inflight.get(key);
}

// Summary of a match for the "My games" list. Resolves to { gone: true } when
// the room has expired or the seat is no longer ours.
export async function roomStatus({ code, playerId, token }) {
  const q = new URLSearchParams({ player: String(playerId), token: token || "" });
  const res = await fetch(`${API_BASE}/${encodeURIComponent(code)}/status?${q}`);
  if (res.status === 404 || res.status === 403) return { gone: true };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function resignRoom({ code, playerId, token }) {
  const q = new URLSearchParams({ player: String(playerId), token: token || "" });
  await fetch(`${API_BASE}/${encodeURIComponent(code)}/resign?${q}`, { method: "POST" });
}

let pushKey;
export function getPushKey() {
  if (pushKey === undefined) {
    pushKey = fetch(`${API_URL}/api/push/key`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.publicKey ?? null)
      .catch(() => {
        pushKey = undefined; // retry next time
        return null;
      });
  }
  return pushKey;
}
