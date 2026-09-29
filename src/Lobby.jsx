import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createRoom } from "./net/client.js";
import { CPU_LEVELS } from "./game/ai.js";
import { TARGET_SCORE_OPTIONS } from "./game/rules.js";
import { sfx } from "./game/audio.js";
import { loadPrefs, savePrefs, loadRecord } from "./prefs.js";
import AttractBackground from "./ui/AttractBackground.jsx";

export default function Lobby() {
  const navigate = useNavigate();
  const [prefs, setPrefs] = useState(loadPrefs);
  const [record] = useState(loadRecord);
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const update = (patch) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePrefs(next);
  };

  const qs = (extra = "") => `to=${prefs.targetScore}${prefs.assist ? "&assist=1" : ""}${extra}`;

  const go = (path) => {
    sfx.unlock();
    navigate(path);
  };

  const handleCreate = async () => {
    sfx.unlock();
    setBusy(true);
    setError(null);
    try {
      const data = await createRoom(prefs.targetScore);
      rememberSeat(data.roomId, data.playerId);
      navigate(`/online/${data.roomId}/${data.playerId}`);
    } catch (err) {
      setError(`Couldn't create a room (${err.message}). Is the game server reachable?`);
      setBusy(false);
    }
  };

  const handleJoin = (e) => {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      setError("Enter the room code your rival shared");
      return;
    }
    go(`/room/${code}`);
  };

  return (
    <div className="menu">
      <AttractBackground />
      <div className="menu-veil" />

      <div className="menu-content">
        <header className="menu-hero">
          <h1 className="menu-title">GRAVITY WARS</h1>
          <p className="menu-tagline">Artillery across curved space. Edges wrap. Gravity always wins.</p>
        </header>

        <div className="menu-cards">
          <section className="menu-card card-cpu">
            <h2>Solo <span>vs CPU</span></h2>
            <div className="seg" role="radiogroup" aria-label="CPU rank">
              {Object.entries(CPU_LEVELS).map(([key, lvl]) => {
                const r = record[key];
                return (
                  <button
                    key={key}
                    role="radio"
                    aria-checked={prefs.difficulty === key}
                    className={prefs.difficulty === key ? "on" : ""}
                    onClick={() => update({ difficulty: key })}
                  >
                    <strong>{lvl.label}</strong>
                    <small>{r && r.w + r.l > 0 ? `${r.w}W · ${r.l}L` : lvl.blurb}</small>
                  </button>
                );
              })}
            </div>
            <button className="gw-btn gw-btn-primary team-1" onClick={() => go(`/play/cpu?d=${prefs.difficulty}&${qs()}`)}>
              LAUNCH
            </button>
          </section>

          <section className="menu-card card-local">
            <h2>Hot seat <span>2 players · 1 screen</span></h2>
            <p className="menu-copy">Pass the mouse, trade shots, argue about who moved the slider.</p>
            <button className="gw-btn gw-btn-primary team-3" onClick={() => go(`/play/local?${qs()}`)}>
              PLAY LOCAL
            </button>
          </section>

          <section className="menu-card card-online">
            <h2>Online duel <span>share a code</span></h2>
            <button className="gw-btn gw-btn-primary team-2" onClick={handleCreate} disabled={busy}>
              {busy ? "OPENING ROOM…" : "CREATE ROOM"}
            </button>
            <form className="join-row" onSubmit={handleJoin}>
              <input
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={64}
                placeholder="ROOM CODE"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.replace(/\s/g, ""))}
                aria-label="Room code"
              />
              <button className="gw-btn" type="submit">JOIN</button>
            </form>
          </section>
        </div>

        <div className="menu-settings">
          <div className="setting">
            <span>Match</span>
            <div className="seg seg-small" role="radiogroup" aria-label="Match length">
              {TARGET_SCORE_OPTIONS.map((n) => (
                <button key={n} role="radio" aria-checked={prefs.targetScore === n} className={prefs.targetScore === n ? "on" : ""} onClick={() => update({ targetScore: n })}>
                  First to {n}
                </button>
              ))}
            </div>
          </div>
          <label className="setting toggle">
            <input type="checkbox" checked={prefs.assist} onChange={(e) => update({ assist: e.target.checked })} />
            <span>Aim assist <small>(offline modes)</small></span>
          </label>
        </div>

        {error && <div className="menu-error" role="alert">{error}</div>}

        <footer className="menu-help">
          Drag on the field or use ←→ / ↑↓ to aim · Space to fire · Hold Space to fast-forward · M to mute
        </footer>
      </div>
    </div>
  );
}

export function rememberSeat(roomId, playerId) {
  try { sessionStorage.setItem(`gw:seat:${roomId.toUpperCase()}`, String(playerId)); } catch { /* ignore */ }
}

export function recallSeat(roomId) {
  try { return Number(sessionStorage.getItem(`gw:seat:${roomId.toUpperCase()}`)) || null; } catch { return null; }
}
