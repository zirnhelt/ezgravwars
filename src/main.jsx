import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, useParams, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import Lobby, { rememberSeat, recallSeat } from "./Lobby.jsx";
import MultiplayerApp from "./MultiplayerApp.jsx";
import GravityWars from "./App.jsx";
import { joinRoom } from "./net/client.js";
import { CPU_LEVELS } from "./game/ai.js";
import { clampTargetScore } from "./game/rules.js";
import { sfx } from "./game/audio.js";
import AttractBackground from "./ui/AttractBackground.jsx";
import "./styles.css";

// Browsers only allow audio after a user gesture.
const unlockAudio = () => sfx.unlock();
window.addEventListener("pointerdown", unlockAudio, { once: true });
window.addEventListener("keydown", unlockAudio, { once: true });

function RoomRoute() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState(null);

  useEffect(() => {
    const seat = recallSeat(roomId);
    if (seat) {
      navigate(`/online/${roomId}/${seat}`, { replace: true });
      return;
    }
    let cancelled = false;
    joinRoom(roomId)
      .then((data) => {
        if (cancelled) return;
        rememberSeat(data.roomId, data.playerId);
        navigate(`/online/${data.roomId}/${data.playerId}`, { replace: true });
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => { cancelled = true; };
  }, [roomId, navigate]);

  return (
    <div className="menu">
      <AttractBackground />
      <div className="menu-veil" />
      <div className="wait-card">
        {error ? (
          <>
            <div className="wait-title" style={{ color: "var(--p2)" }}>Couldn't join {roomId}</div>
            <p className="menu-copy">{error}</p>
            <button className="gw-btn gw-btn-primary team-1" onClick={() => navigate("/")}>BACK TO MENU</button>
          </>
        ) : (
          <>
            <div className="wait-title">Joining room {roomId}…</div>
            <div className="orbit-loader" aria-hidden="true"><i /></div>
          </>
        )}
      </div>
    </div>
  );
}

function OnlineRoute() {
  const { roomId, playerId } = useParams();
  const pid = parseInt(playerId, 10);
  if (pid !== 1 && pid !== 2) return <Navigate to="/" replace />;
  return <MultiplayerApp key={`${roomId}/${pid}`} roomId={roomId} playerId={pid} />;
}

function LegacyPlayRoute() {
  const { roomId, playerId } = useParams();
  return <Navigate to={`/online/${roomId}/${playerId}`} replace />;
}

function OfflineRoute({ mode }) {
  const [params] = useSearchParams();
  const location = useLocation();
  const d = params.get("d");
  const cpuLevel = CPU_LEVELS[d] ? d : "captain";
  return (
    <GravityWars
      key={location.key + location.search}
      mode={mode}
      cpuLevel={cpuLevel}
      targetScore={clampTargetScore(params.get("to"))}
      assist={params.get("assist") === "1"}
    />
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Lobby />} />
        <Route path="/play/local" element={<OfflineRoute mode="local" />} />
        <Route path="/play/cpu" element={<OfflineRoute mode="cpu" />} />
        <Route path="/local" element={<Navigate to="/play/local" replace />} />
        <Route path="/room/:roomId" element={<RoomRoute />} />
        <Route path="/online/:roomId/:playerId" element={<OnlineRoute />} />
        <Route path="/play/:roomId/:playerId/:seed" element={<LegacyPlayRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
