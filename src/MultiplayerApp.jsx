import { useState, useEffect, useRef } from "react";
import { GameClient } from "./net/client.js";
import GravityWars from "./App.jsx";

export default function MultiplayerApp({ roomId, playerId, seed }) {
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [gameStatus, setGameStatus] = useState("waiting");
  const [incomingShot, setIncomingShot] = useState(null);
  const [turn, setTurn] = useState(1);
  const [level, setLevel] = useState(1);
  const [scores, setScores] = useState([0, 0]);
  const clientRef = useRef(null);

  useEffect(() => {
    const client = new GameClient(
      roomId,
      playerId,
      handleMessage,
      setConnectionStatus
    );

    clientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
    };
  }, [roomId, playerId]);

  const handleMessage = (msg) => {
    console.log("Received message:", msg.type, msg.data);

    switch (msg.type) {
      case "room_state": {
        // Initial state on connect/reconnect
        setGameStatus(msg.data.status);
        setTurn(msg.data.turn);
        setLevel(msg.data.level);
        setScores(msg.data.scores);
        break;
      }

      case "player_joined": {
        setGameStatus("playing");
        break;
      }

      case "shot_fired": {
        // Opponent (or ourselves, echoed back) fired
        const { player, angle, power } = msg.data;
        // Set incoming shot, which triggers executeShot in GravityWars
        setIncomingShot({ player, angle, power, timestamp: Date.now() });
        break;
      }

      case "shot_result": {
        // Server confirms result and updates state
        const { hit, hitWhat, scores: newScores, level: newLevel, turn: newTurn } = msg.data;
        setScores(newScores);
        setLevel(newLevel);
        setTurn(newTurn);
        break;
      }

      case "player_disconnected": {
        // Could show a message to user
        console.log("Opponent disconnected");
        break;
      }

      case "player_reconnected": {
        console.log("Opponent reconnected");
        break;
      }

      default:
        console.warn("Unknown message type:", msg.type);
    }
  };

  const handleFire = (angle, power) => {
    if (clientRef.current) {
      clientRef.current.fire(angle, power);
    }
  };

  const handleShotComplete = (result) => {
    // After shot animation completes on active player's client, report result to server
    if (turn === playerId && clientRef.current) {
      clientRef.current.reportResult(result.hit, result.hitWhat);
    }
  };

  if (gameStatus === "waiting") {
    return (
      <div style={{
        background: "#04040a",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Courier New', monospace",
        color: "#ccc",
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 20, color: "#4a9eff", marginBottom: 10 }}>
            Waiting for opponent...
          </div>
          <div style={{ fontSize: 12, color: "#555" }}>
            Connection: {connectionStatus}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {connectionStatus !== "connected" && (
        <div style={{
          position: "fixed",
          top: 10,
          right: 10,
          background: "#aa3333",
          color: "#fff",
          padding: "8px 15px",
          borderRadius: 4,
          fontFamily: "'Courier New', monospace",
          fontSize: 11,
          zIndex: 1000,
        }}>
          {connectionStatus === "reconnecting" ? "Reconnecting..." : "Disconnected"}
        </div>
      )}
      <GravityWars
        mode="online"
        myPlayerId={playerId}
        roomSeed={seed}
        onFire={handleFire}
        incomingShot={incomingShot}
        onShotComplete={handleShotComplete}
      />
    </div>
  );
}
