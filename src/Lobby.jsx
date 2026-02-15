import { useState } from "react";
import { createRoom, joinRoom } from "./net/client.js";

export default function Lobby({ onRoomReady }) {
  const [mode, setMode] = useState("menu"); // menu | creating | joining | waiting
  const [roomId, setRoomId] = useState("");
  const [playerId, setPlayerId] = useState(null);
  const [seed, setSeed] = useState(null);
  const [joinInput, setJoinInput] = useState("");
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const handleCreateRoom = async () => {
    setMode("creating");
    setError(null);
    try {
      const data = await createRoom();
      setRoomId(data.roomId);
      setPlayerId(data.playerId);
      setSeed(data.seed);
      // Connect to the room immediately so we can receive player_joined message
      onRoomReady(data.roomId, data.playerId, data.seed);
    } catch (err) {
      setError(`Failed to create room: ${err.message}`);
      setMode("menu");
    }
  };

  const handleJoinRoom = async () => {
    if (!joinInput.trim()) {
      setError("Please enter a room ID");
      return;
    }
    setMode("joining");
    setError(null);
    try {
      const data = await joinRoom(joinInput.trim());
      setRoomId(data.roomId);
      setPlayerId(data.playerId);
      setSeed(data.seed);
      onRoomReady(data.roomId, data.playerId, data.seed);
    } catch (err) {
      setError(`Failed to join room: ${err.message}`);
      setMode("menu");
    }
  };

  const copyRoomLink = () => {
    const link = `${window.location.origin}/room/${roomId}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (mode === "waiting") {
    const roomLink = `${window.location.origin}/room/${roomId}`;
    return (
      <div style={{
        background: "#04040a",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Courier New', monospace",
        color: "#ccc",
        padding: "20px",
      }}>
        <div style={{
          background: "#0a0a14",
          border: "2px solid #4a9eff",
          borderRadius: 8,
          padding: "40px 60px",
          maxWidth: 600,
          textAlign: "center",
        }}>
          <h1 style={{ color: "#4a9eff", fontSize: 32, margin: "0 0 20px 0", letterSpacing: 3 }}>
            GRAVITY WARS
          </h1>
          <div style={{ fontSize: 18, color: "#aaa", marginBottom: 30 }}>
            Waiting for opponent...
          </div>
          <div style={{
            background: "#06060e",
            border: "1px solid #222",
            borderRadius: 4,
            padding: 20,
            marginBottom: 20,
          }}>
            <div style={{ fontSize: 11, color: "#555", marginBottom: 8, letterSpacing: 1 }}>
              SHARE THIS LINK
            </div>
            <div style={{
              background: "#0a0a14",
              border: "1px solid #333",
              borderRadius: 3,
              padding: "10px 15px",
              fontFamily: "monospace",
              fontSize: 13,
              color: "#4a9eff",
              wordBreak: "break-all",
              marginBottom: 15,
            }}>
              {roomLink}
            </div>
            <button
              onClick={copyRoomLink}
              style={{
                background: copied ? "#2a8a2a" : "#4a9eff",
                color: "#000",
                border: "none",
                padding: "10px 30px",
                borderRadius: 4,
                fontFamily: "'Courier New', monospace",
                fontSize: 13,
                fontWeight: "bold",
                cursor: "pointer",
                letterSpacing: 1,
                transition: "background 0.2s",
              }}
            >
              {copied ? "✓ COPIED!" : "COPY LINK"}
            </button>
          </div>
          <div style={{ fontSize: 11, color: "#555" }}>
            Room ID: <span style={{ color: "#888" }}>{roomId}</span>
          </div>
          <div style={{ fontSize: 10, color: "#333", marginTop: 15 }}>
            Game will start automatically when opponent joins
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      background: "#04040a",
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'Courier New', monospace",
      color: "#ccc",
      padding: "20px",
    }}>
      <div style={{
        background: "#0a0a14",
        border: "1px solid #151520",
        borderRadius: 8,
        padding: "50px 80px",
        maxWidth: 500,
        textAlign: "center",
      }}>
        <h1 style={{
          color: "#ddd",
          fontSize: 42,
          margin: "0 0 10px 0",
          letterSpacing: 4,
          fontWeight: "bold",
        }}>
          GRAVITY WARS
        </h1>
        <div style={{ fontSize: 13, color: "#555", marginBottom: 50, letterSpacing: 2 }}>
          MULTIPLAYER ARTILLERY
        </div>

        {mode === "menu" && (
          <>
            <button
              onClick={handleCreateRoom}
              style={{
                background: "#4a9eff",
                color: "#000",
                border: "none",
                padding: "15px 50px",
                borderRadius: 4,
                fontFamily: "'Courier New', monospace",
                fontSize: 16,
                fontWeight: "bold",
                cursor: "pointer",
                width: "100%",
                marginBottom: 20,
                letterSpacing: 2,
              }}
            >
              CREATE GAME
            </button>

            <div style={{
              margin: "30px 0",
              color: "#333",
              fontSize: 12,
              letterSpacing: 1,
            }}>
              ── OR ──
            </div>

            <div>
              <input
                type="text"
                placeholder="Enter Room ID"
                value={joinInput}
                onChange={(e) => setJoinInput(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && handleJoinRoom()}
                style={{
                  width: "100%",
                  padding: "12px 15px",
                  background: "#06060e",
                  border: "1px solid #222",
                  borderRadius: 4,
                  color: "#ccc",
                  fontFamily: "'Courier New', monospace",
                  fontSize: 14,
                  marginBottom: 15,
                  boxSizing: "border-box",
                }}
              />
              <button
                onClick={handleJoinRoom}
                style={{
                  background: "#ff6b4a",
                  color: "#000",
                  border: "none",
                  padding: "15px 50px",
                  borderRadius: 4,
                  fontFamily: "'Courier New', monospace",
                  fontSize: 16,
                  fontWeight: "bold",
                  cursor: "pointer",
                  width: "100%",
                  letterSpacing: 2,
                }}
              >
                JOIN GAME
              </button>
            </div>
          </>
        )}

        {mode === "creating" && (
          <div style={{ fontSize: 16, color: "#4a9eff" }}>
            Creating room...
          </div>
        )}

        {mode === "joining" && (
          <div style={{ fontSize: 16, color: "#ff6b4a" }}>
            Joining room...
          </div>
        )}

        {error && (
          <div style={{
            marginTop: 25,
            padding: "12px 20px",
            background: "#2a0a0a",
            border: "1px solid #aa3333",
            borderRadius: 4,
            color: "#ff6666",
            fontSize: 12,
          }}>
            {error}
          </div>
        )}

        <div style={{
          marginTop: 40,
          fontSize: 10,
          color: "#333",
          lineHeight: 1.6,
        }}>
          Turn-based artillery with orbital mechanics<br />
          Toroidal wrapping · Deterministic physics
        </div>
      </div>
    </div>
  );
}
