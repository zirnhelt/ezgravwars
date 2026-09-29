import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { GameClient } from "./net/client.js";
import GravityWars from "./App.jsx";
import AttractBackground from "./ui/AttractBackground.jsx";
import { IconCopy, IconShare, IconBell, IconBellOff, IconFlag, IconDevices } from "./ui/icons.jsx";
import { sfx } from "./game/audio.js";
import { getGame, saveGame, forgetGame, markSeen, resumeLink } from "./games.js";
import { notifyCapability, subscribeToPush, currentEndpoint } from "./push.js";

// The seat token comes from this browser's "My games" list, or from a private
// resume link (#t=...) when moving a match to another device.
function resolveSeat(roomId, playerId) {
  const known = getGame(roomId);
  if (known && known.playerId === playerId) return known;
  const t = new URLSearchParams(window.location.hash.slice(1)).get("t");
  if (t && /^[0-9a-f]{32}$/.test(t)) {
    saveGame({ code: roomId, playerId, token: t });
    window.history.replaceState(null, "", window.location.pathname);
    return getGame(roomId);
  }
  return null;
}

export default function MultiplayerApp({ roomId, playerId }) {
  const navigate = useNavigate();
  const [seat] = useState(() => resolveSeat(roomId, playerId));
  const [connection, setConnection] = useState("connecting");
  const [room, setRoom] = useState(null);
  const [shot, setShot] = useState(null);
  const [online, setOnline] = useState({ 1: false, 2: false });
  const [notify, setNotify] = useState({ 1: false, 2: false });
  const [votes, setVotes] = useState({ 1: false, 2: false });
  const [rivalAim, setRivalAim] = useState(null);
  const [fatal, setFatal] = useState(seat ? null : "This seat isn't on this device. Open the game from the device you played on, or use your private resume link.");
  const [toast, setToast] = useState(null);
  const clientRef = useRef(null);
  const toastTimer = useRef(null);
  const rival = playerId === 1 ? 2 : 1;

  const flash = (text) => {
    clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  };

  const handleMessage = useCallback((msg) => {
    const d = msg.data || {};
    switch (msg.type) {
      case "room_state":
        // Authoritative snapshot (connect, reconnect, opponent joined, rematch, resign).
        setRoom(d);
        setOnline(d.online || {});
        setNotify(d.notify || {});
        setVotes(d.rematch || { 1: false, 2: false });
        break;
      case "shot_fired":
        setShot(d);
        break;
      case "aim":
        setRivalAim(d);
        break;
      case "presence":
        setOnline(d.online || {});
        break;
      case "notify_status":
        setNotify(d.notify || {});
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
    if (!seat) return;
    const client = new GameClient(roomId, playerId, seat.token, handleMessage, setConnection);
    clientRef.current = client;
    client.connect();
    const onVis = () => client.setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      client.disconnect();
    };
  }, [roomId, playerId, seat, handleMessage]);

  const onFire = useCallback((angle, power) => clientRef.current?.fire(angle, power), []);
  const onAim = useCallback((angle, power) => clientRef.current?.aim(angle, power), []);
  const onRematch = useCallback(() => clientRef.current?.rematch(), []);
  const onShotSeen = useCallback((id) => markSeen(roomId, id), [roomId]);

  const inviteLink = `${window.location.origin}/room/${roomId}`;

  const nudge = async () => {
    const text = `Your move in Gravity Wars! ${inviteLink}`;
    if (navigator.share) {
      navigator.share({ title: "Gravity Wars", text }).catch(() => {});
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      flash("Nudge copied — paste it into a message to your rival");
    } catch {
      window.prompt("Send this to your rival:", text);
    }
  };

  const copyResume = async () => {
    const link = resumeLink(seat);
    try {
      await navigator.clipboard.writeText(link);
      flash("Private link copied — open it on your other device. Don't share it: it's your seat.");
    } catch {
      window.prompt("Your private link (don't share it):", link);
    }
  };

  const resign = () => {
    if (window.confirm("Resign this match? Your rival wins.")) clientRef.current?.resign();
  };

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

  const bell = (
    <NotifyButton
      client={clientRef.current}
      enabled={!!notify[playerId]}
      pushAvailable={room.pushAvailable}
      onMessage={flash}
    />
  );

  if (room.status === "waiting") {
    const cancel = () => {
      if (!window.confirm("Cancel this invite? The room code will stop working.")) return;
      clientRef.current?.resign();
      forgetGame(roomId);
      navigate("/");
    };
    return (
      <WaitingRoom roomId={roomId} link={inviteLink} targetScore={room.targetScore} onLeave={() => navigate("/")} onCancel={cancel} bell={bell} toast={toast} />
    );
  }

  const remoteNote = online[rival]
    ? null
    : notify[rival]
    ? <span className="remote-note">They'll get a notification that it's their move.</span>
    : (
      <span className="remote-note">
        <button className="linklike" onClick={nudge}>Nudge them</button> so they know it's their move.
      </span>
    );

  return (
    <>
      {connection !== "connected" && (
        <div className="net-pill" role="status">
          {connection === "reconnecting" || connection === "connecting" ? "Reconnecting…" : "Offline"}
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
      <GravityWars
        mode="online"
        myPlayerId={playerId}
        room={room}
        incomingShot={shot}
        onFire={onFire}
        onAim={onAim}
        rivalAim={rivalAim}
        onRematch={onRematch}
        rematchVotes={votes}
        opponentOnline={online[rival] !== false}
        seenShotId={seat.seen || 0}
        onShotSeen={onShotSeen}
        remoteNote={remoteNote}
        onlineTools={
          <>
            {bell}
            <button className="gw-icon" onClick={copyResume} title="Continue on another device (copies your private link)">
              <IconDevices />
            </button>
            {room.status === "playing" && (
              <button className="gw-icon" onClick={resign} title="Resign">
                <IconFlag />
              </button>
            )}
          </>
        }
      />
    </>
  );
}

// Bell: opt in to "your move" notifications for this seat on this device.
function NotifyButton({ client, enabled, pushAvailable, onMessage }) {
  const [cap, setCap] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    notifyCapability().then((c) => live && setCap(c));
    return () => { live = false; };
  }, []);

  if (!pushAvailable || cap === null || cap === "unavailable") return null;

  const click = async () => {
    sfx.unlock();
    if (cap === "ios-install") {
      onMessage("On iPhone/iPad: tap Share → Add to Home Screen, open Gravity Wars from there, then tap the bell.");
      return;
    }
    if (cap === "unsupported") {
      onMessage("This browser can't do notifications — use Nudge instead.");
      return;
    }
    if (cap === "denied") {
      onMessage("Notifications are blocked for this site in your browser settings.");
      return;
    }
    setBusy(true);
    try {
      if (enabled) {
        const endpoint = await currentEndpoint();
        if (endpoint) client?.unsubscribePush(endpoint);
        onMessage("Notifications off for this match on this device.");
      } else {
        client?.subscribePush(await subscribeToPush());
        onMessage("You'll get a notification when it's your move.");
      }
    } catch (e) {
      onMessage(e.message);
      setCap(await notifyCapability());
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      className={`gw-icon ${enabled ? "on" : ""}`}
      onClick={click}
      disabled={busy}
      title={enabled ? "Turn notifications are on" : "Notify me when it's my move"}
      aria-pressed={enabled}
    >
      {enabled ? <IconBell /> : <IconBellOff />}
    </button>
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

function WaitingRoom({ roomId, link, targetScore, onLeave, onCancel, bell, toast }) {
  const [copied, setCopied] = useState(false);
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
      {toast && <div className="toast" role="status">{toast}</div>}
      <div className="wait-title">Waiting for a rival…</div>
      <p className="menu-copy">Send them the code or the link. They can join now or days from now — take turns whenever suits you both.</p>
      <div className="room-code" aria-label="Room code">{roomId}</div>
      <div className="room-link">{link}</div>
      <div className="wait-actions">
        <button className="gw-btn gw-btn-primary team-2" onClick={copy}>
          <IconCopy /> {copied ? "COPIED!" : "COPY LINK"}
        </button>
        {canShare && (
          <button className="gw-btn" onClick={share}><IconShare /> SHARE</button>
        )}
        {bell && <span className="wait-bell">{bell}</span>}
      </div>
      <p className="menu-copy small">
        First to {targetScore} · No need to wait here — it stays in <strong>Your games</strong> on the menu.
      </p>
      <div className="wait-actions">
        <button className="gw-btn" onClick={onLeave}>BACK TO MENU</button>
        <button className="linklike" onClick={onCancel}>cancel invite</button>
      </div>
      <div className="orbit-loader" aria-hidden="true"><i /></div>
    </CenterCard>
  );
}
