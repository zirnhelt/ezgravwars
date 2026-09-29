import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { createRoom, roomStatus, resignRoom } from "./net/client.js";
import { listGames, saveGame, forgetGame } from "./games.js";
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
      saveGame({ code: data.roomId, playerId: data.playerId, token: data.token, targetScore: data.targetScore });
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

        <YourGames onOpen={go} />

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

function ago(ts) {
  if (!ts) return "";
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

// Play-by-mail matches this browser holds a seat in, with live status.
function YourGames({ onOpen }) {
  const [games, setGames] = useState(listGames);
  const [status, setStatus] = useState({});

  useEffect(() => {
    let live = true;
    const refresh = () => {
      for (const g of listGames()) {
        roomStatus(g)
          .then((s) => live && setStatus((m) => ({ ...m, [g.code]: s })))
          .catch(() => live && setStatus((m) => ({ ...m, [g.code]: { error: true } })));
      }
    };
    refresh();
    const onVis = () => !document.hidden && refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  if (!games.length) return null;

  const describe = (g) => {
    const s = status[g.code];
    if (!s) return { rank: 3, label: "Checking…", cls: "" };
    if (s.gone) return { rank: 5, label: "Expired", cls: "muted" };
    if (s.error) return { rank: 4, label: "Can't reach server", cls: "muted" };
    if (s.status === "waiting") return { rank: 2, label: "Waiting for rival to join", cls: "" };
    if (s.status === "finished") {
      const won = s.winner === g.playerId;
      return { rank: 4, label: `${won ? "Won" : "Lost"}${s.resignedBy ? " · resigned" : ""}`, cls: won ? "won" : "muted" };
    }
    return s.turn === g.playerId
      ? { rank: 0, label: "Your move", cls: "your-move" }
      : { rank: 1, label: "Rival's move", cls: "" };
  };

  const rows = games.map((g) => ({ g, s: status[g.code], d: describe(g) })).sort((a, b) => a.d.rank - b.d.rank);

  const remove = async ({ g, s }) => {
    if (s?.status === "playing") {
      if (!window.confirm(`Resign match ${g.code}? Your rival wins.`)) return;
      await resignRoom(g).catch(() => {});
    } else if (s?.status === "waiting") {
      await resignRoom(g).catch(() => {}); // cancels the invite
    }
    forgetGame(g.code);
    setGames(listGames());
  };

  return (
    <section className="your-games" aria-label="Your games">
      <h2>Your games</h2>
      <ul>
        {rows.map(({ g, s, d }) => {
          const me = g.playerId - 1;
          return (
            <li key={g.code} className={d.cls}>
              <button className="yg-open" onClick={() => onOpen(`/online/${g.code}/${g.playerId}`)} disabled={!!s?.gone}>
                <span className="yg-code">{g.code}</span>
                <span className="yg-state">{d.label}</span>
                {s?.scores && s.status !== "waiting" && (
                  <span className="yg-score">you {s.scores[me]} – {s.scores[1 - me]} · lvl {s.level}</span>
                )}
                <span className="yg-ago">{ago(s?.lastActivity)}</span>
              </button>
              <button className="yg-remove" onClick={() => remove({ g, s })} title={s?.status === "playing" ? "Resign and remove" : "Remove"}>
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
