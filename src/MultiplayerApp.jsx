import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { GameClient } from "./net/client.js";
import GravityWars from "./App.jsx";
import AttractBackground from "./ui/AttractBackground.jsx";
import { IconCopy, IconShare } from "./ui/icons.jsx";
import { sfx } from "./game/audio.js";

export default function MultiplayerApp({ roomId, playerId }) {
  const navigate = useNavigate();
  const [connection, setConnection] = useState("connecting");
  const [room, setRoom] = useState(null);
  const [shot, setShot] = useState(null);
  const [online, setOnline] = useState({ 1: false, 2: false });
  const [votes, setVotes] = useState({ 1: false, 2: false });
  const [fatal, setFatal] = useState(null);
  const clientRef = useRef(null);

  const handleMessage = useCallback((msg) => {
    const d = msg.data || {};
    switch (msg.type) {
      case "room_state":
        // Authoritative snapshot (connect, reconnect, opponent joined, rematch).
        setRoom(d);
        setOnline(d.online || {});
        setVotes(d.rematch || { 1: false, 2: false });
        break;
      case "shot_fired":
        setShot(d);
        break;
      case "presence":
        setOnline(d.online || {});
        break;
      case "rematch_vote":
        setVotes(d.votes || {});
        break;
      case "error":
        if (d.fatal) setFatal(d.message);
        else console.warn("[server]", d.message);
        break;
      default:
        break;
    }
  }, []);

  useEffect(() => {
    const client = new GameClient(roomId, playerId, handleMessage, setConnection);
    clientRef.current = client;
    client.connect();
    return () => client.disconnect();
  }, [roomId, playerId, handleMessage]);

  const onFire = useCallback((angle, power) => clientRef.current?.fire(angle, power), []);
  const onRematch = useCallback(() => clientRef.current?.rematch(), []);

  if (fatal) {
    return (
      <CenterCard>
        <div className="wait-title" style={{ color: "var(--p2)" }}>Room unavailable</div>
        <p className="menu-copy">{fatal}</p>
        <button className="gw-btn gw-btn-primary team-1" onClick={() => navigate("/")}>BACK TO MENU</button>
      </CenterCard>
    );
  }

  if (!room) {
    return (
      <CenterCard>
        <div className="wait-title">Connecting to room…</div>
        <p className="menu-copy">{connection === "reconnecting" ? "Retrying — the server may be waking up." : "Establishing uplink."}</p>
      </CenterCard>
    );
  }

  if (room.status === "waiting") {
    return <WaitingRoom roomId={roomId} targetScore={room.targetScore} onLeave={() => navigate("/")} />;
  }

  const opponent = playerId === 1 ? 2 : 1;
  return (
    <>
      {connection !== "connected" && (
        <div className="net-pill" role="status">
          {connection === "reconnecting" || connection === "connecting" ? "Reconnecting…" : "Offline"}
        </div>
      )}
      <GravityWars
        mode="online"
        myPlayerId={playerId}
        room={room}
        incomingShot={shot}
        onFire={onFire}
        onRematch={onRematch}
        rematchVotes={votes}
        opponentOnline={online[opponent] !== false}
      />
    </>
  );
}

function CenterCard({ children }) {
  return (
    <div className="menu">
      <AttractBackground />
      <div className="menu-veil" />
      <div className="wait-card">{children}</div>
    </div>
  );
}

function WaitingRoom({ roomId, targetScore, onLeave }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/room/${roomId}`;
  const canShare = typeof navigator !== "undefined" && !!navigator.share;

  const copy = async () => {
    sfx.unlock();
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", link);
    }
  };

  const share = () => {
    navigator.share({ title: "Gravity Wars", text: `Duel me in Gravity Wars — room ${roomId}`, url: link }).catch(() => {});
  };

  return (
    <CenterCard>
      <div className="wait-title">Waiting for a rival…</div>
      <p className="menu-copy">Send them the code or the link. The match starts the moment they join.</p>
      <div className="room-code" aria-label="Room code">{roomId}</div>
      <div className="room-link">{link}</div>
      <div className="wait-actions">
        <button className="gw-btn gw-btn-primary team-2" onClick={copy}>
          <IconCopy /> {copied ? "COPIED!" : "COPY LINK"}
        </button>
        {canShare && (
          <button className="gw-btn" onClick={share}><IconShare /> SHARE</button>
        )}
      </div>
      <p className="menu-copy small">First to {targetScore} · <button className="linklike" onClick={onLeave}>cancel</button></p>
      <div className="orbit-loader" aria-hidden="true"><i /></div>
    </CenterCard>
  );
}
