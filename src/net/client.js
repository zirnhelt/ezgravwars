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
  }

  connect() {
    const url = `${WS_URL}/api/rooms/${this.roomId}/ws?player=${this.playerId}`;

    this.onStatusChange("connecting");
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.onStatusChange("connected");
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.onMessage(msg);
      } catch (e) {
        console.error("Bad message from server:", e);
      }
    };

    this.ws.onclose = () => {
      if (this.closed) return;
      this.onStatusChange("disconnected");
      this._reconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire after this
    };
  }

  send(type, data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }));
    }
  }

  fire(angle, power) {
    this.send("fire", { angle, power });
  }

  reportResult(hit, hitWhat) {
    this.send("report_result", { hit, hitWhat });
  }

  _reconnect() {
    if (this.closed) return;
    const delay = RECONNECT_DELAYS[
      Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)
    ];
    this.reconnectAttempt++;
    this.onStatusChange("reconnecting");
    setTimeout(() => {
      if (!this.closed) this.connect();
    }, delay);
  }

  disconnect() {
    this.closed = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// --- HTTP helpers for room management ---

const API_BASE = `${API_URL}/api/rooms`;

export async function createRoom() {
  const res = await fetch(API_BASE, { method: "POST" });
  if (!res.ok) throw new Error(`Create room failed: ${res.status}`);
  return res.json(); // { roomId, playerId, seed }
}

export async function joinRoom(roomId) {
  const res = await fetch(`${API_BASE}/${roomId}/join`, { method: "POST" });
  if (!res.ok) throw new Error(`Join room failed: ${res.status}`);
  return res.json(); // { roomId, playerId, seed }
}
