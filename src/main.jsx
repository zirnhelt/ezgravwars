import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, useParams, useNavigate } from "react-router-dom";
import Lobby from "./Lobby.jsx";
import MultiplayerApp from "./MultiplayerApp.jsx";
import GravityWars from "./App.jsx";
import { joinRoom } from "./net/client.js";

function RoomRoute() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [roomData, setRoomData] = useState(null);

  useEffect(() => {
    async function join() {
      try {
        const data = await joinRoom(roomId);
        setRoomData(data);
        setLoading(false);
      } catch (err) {
        setError(err.message);
        setLoading(false);
        setTimeout(() => navigate("/"), 3000);
      }
    }
    join();
  }, [roomId, navigate]);

  if (loading) {
    return (
      <div style={{
        background: "#04040a",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Courier New', monospace",
        color: "#4a9eff",
        fontSize: 18,
      }}>
        Joining room...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        background: "#04040a",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Courier New', monospace",
        textAlign: "center",
      }}>
        <div>
          <div style={{ color: "#ff6666", fontSize: 18, marginBottom: 10 }}>
            Failed to join room
          </div>
          <div style={{ color: "#888", fontSize: 14 }}>
            {error}
          </div>
          <div style={{ color: "#555", fontSize: 12, marginTop: 20 }}>
            Redirecting to lobby...
          </div>
        </div>
      </div>
    );
  }

  return (
    <MultiplayerApp
      roomId={roomData.roomId}
      playerId={roomData.playerId}
      seed={roomData.seed}
    />
  );
}

function LobbyRoute() {
  const navigate = useNavigate();

  const handleRoomReady = (roomId, playerId, seed) => {
    // Navigate to the multiplayer app
    navigate(`/play/${roomId}/${playerId}/${seed}`);
  };

  return <Lobby onRoomReady={handleRoomReady} />;
}

function PlayRoute() {
  const { roomId, playerId, seed } = useParams();
  return (
    <MultiplayerApp
      roomId={roomId}
      playerId={parseInt(playerId)}
      seed={parseInt(seed)}
    />
  );
}

function LocalRoute() {
  return <GravityWars mode="local" />;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LobbyRoute />} />
        <Route path="/room/:roomId" element={<RoomRoute />} />
        <Route path="/play/:roomId/:playerId/:seed" element={<PlayRoute />} />
        <Route path="/local" element={<LocalRoute />} />
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
