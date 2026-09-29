import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  CANVAS_W, CANVAS_H, MIN_POWER, MAX_POWER, AIM_OFFSET_MIN, AIM_OFFSET_MAX,
} from "./game/constants.js";
import { simulateShot, wrappedDelta, normalizeAngle, STEPS_PER_SECOND } from "./game/physics.js";
import { generateLevel, createRng } from "./game/levelgen.js";
import { applyShot, newMatchState } from "./game/rules.js";
import { planCpuShot, CPU_LEVELS } from "./game/ai.js";
import { GameView } from "./game/view.js";
import { sfx } from "./game/audio.js";
import { sectorName } from "./game/names.js";
import { recordCpuResult } from "./prefs.js";
import { IconSound, IconMute, IconClose, IconAssist } from "./ui/icons.jsx";

const ASPECT = CANVAS_W / CANVAS_H;
const IDLE_PHASES = new Set(["init", "aim", "remote", "sent", "over"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const randomSeed = () => Math.floor(Math.random() * 2147483646) + 1;
const other = (p) => (p === 1 ? 2 : 1);
const emptyStats = () => ({ shots: 0, hits: 0, self: 0, closest: Infinity, longest: 0, wraps: 0 });

function shortestLerp(a, b, k) {
  const d = ((b - a + 540) % 360) - 180;
  return normalizeAngle(Math.round(a + d * k));
}

// Opening aim for a player on a level: roughly toward the opponent, offset so
// nobody gets a free straight shot. Seeded so both online clients agree.
function defaultAim(planets, seed, level, player) {
  const me = planets.find((p) => p.player === player);
  const them = planets.find((p) => p.player === other(player));
  const { dx, dy } = wrappedDelta(me.x, me.y, them.x, them.y);
  const direct = (Math.atan2(dy, dx) * 180) / Math.PI;
  const r = createRng(seed + level * 31 + player * 7);
  const dir = r() < 0.5 ? 1 : -1;
  const off = AIM_OFFSET_MIN + r() * (AIM_OFFSET_MAX - AIM_OFFSET_MIN);
  return { angle: normalizeAngle(Math.round(direct + dir * off)), power: 50 };
}

// Props (all optional for a local hot-seat game):
//   mode: "local" | "cpu" | "online"
//   cpuLevel, targetScore, assist        — local/CPU match settings
//   myPlayerId, room, incomingShot,      — online: server-driven state
//   onFire(angle, power), onRematch(), rematchVotes, opponentOnline, roomCode
export default function GravityWars(props) {
  const {
    mode = "local", cpuLevel = "captain", targetScore = 5, assist = false,
    myPlayerId = null, room = null, incomingShot = null, rematchVotes = null, opponentOnline = true,
  } = props;
  const navigate = useNavigate();
  const online = mode === "online";
  const cpu = mode === "cpu";
  const assistAllowed = !online;

  const propsRef = useRef(props);
  propsRef.current = props;

  // ---- Core state (refs are the source of truth for async flows) ----
  const initialRef = useRef(null);
  if (!initialRef.current) {
    initialRef.current = online && room
      ? { seed: room.seed, level: room.level, scores: [...room.scores], turn: room.turn, status: room.status, winner: room.winner ?? null, targetScore: room.targetScore }
      : newMatchState(randomSeed(), targetScore);
  }
  const [game, setGame] = useState(initialRef.current);
  const gameRef = useRef(initialRef.current);
  const planetsRef = useRef(null);
  if (!planetsRef.current) planetsRef.current = generateLevel(initialRef.current.seed, initialRef.current.level);

  const [phase, setPhase] = useState("init");
  const phaseRef = useRef("init");
  const aimsRef = useRef(null);
  const [aim, setAimState] = useState({ angle: 0, power: 50 });
  const [log, setLog] = useState([]);
  const [stats, setStats] = useState({ 1: emptyStats(), 2: emptyStats() });
  const [banner, setBanner] = useState(null);
  const [muted, setMuted] = useState(sfx.muted);
  const [assistOn, setAssistOn] = useState(assist && assistAllowed);
  const assistRef = useRef(assistOn);
  assistRef.current = assistOn;
  const [ff, setFf] = useState(false);

  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const viewRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const aliveRef = useRef(true);
  const cpuTokenRef = useRef(0);
  const cpuMemRef = useRef({ shotsOnLevel: 0 });
  const queueRef = useRef([]);
  // Shots with id <= this are already reflected in the room state we hold.
  const baseShotRef = useRef(online && room ? room.shotCount ?? 0 : 0);
  const pendingRoomRef = useRef(null);
  const sentTimerRef = useRef(null);
  const lastMissRef = useRef({});
  const dragRef = useRef(false);
  const bannerTimerRef = useRef(null);

  const labels = online
    ? { [myPlayerId]: "YOU", [other(myPlayerId)]: "RIVAL" }
    : cpu ? { 1: "YOU", 2: "CPU" } : { 1: "P1", 2: "P2" };
  const nameOf = (p) =>
    online ? (p === myPlayerId ? "You" : "Rival") : cpu ? (p === 1 ? "You" : "CPU") : `Player ${p}`;
  const isHuman = (turn) => (online ? turn === myPlayerId : cpu ? turn === 1 : true);

  if (!aimsRef.current) initLevelAims();

  function initLevelAims() {
    const g = gameRef.current;
    const pl = planetsRef.current;
    aimsRef.current = { 1: defaultAim(pl, g.seed, g.level, 1), 2: defaultAim(pl, g.seed, g.level, 2) };
    cpuMemRef.current = { shotsOnLevel: 0 };
    lastMissRef.current = {};
  }

  const setPhaseBoth = (p) => {
    phaseRef.current = p;
    setPhase(p);
  };
  const commitGame = (g) => {
    gameRef.current = g;
    setGame(g);
  };

  function showBanner(title, sub, player, ms = 2200) {
    clearTimeout(bannerTimerRef.current);
    setBanner({ title, sub, player, key: Math.random() });
    if (ms) bannerTimerRef.current = setTimeout(() => setBanner(null), ms);
  }

  function syncView() {
    const view = viewRef.current;
    if (!view) return;
    const g = gameRef.current;
    const ph = phaseRef.current;
    const human = isHuman(g.turn);
    const a = aimsRef.current[g.turn];
    const showAim = (ph === "aim" && human) || ph === "cpu";
    let preview = null;
    if (showAim && human && assistRef.current && assistAllowed) {
      preview = simulateShot(planetsRef.current, a.angle, a.power, g.turn, { maxSteps: 160 }).path;
    }
    view.setState({
      turn: g.turn,
      labels,
      aim: showAim ? { player: g.turn, angle: a.angle, power: a.power, preview } : null,
      turrets: { 1: aimsRef.current[1].angle, 2: aimsRef.current[2].angle },
      idle: !human,
    });
  }

  // ---- Turn flow ----

  function beginTurn() {
    if (!aliveRef.current) return;
    const g = gameRef.current;
    if (g.status === "finished") {
      setPhaseBoth("over");
      syncView();
      viewRef.current?.celebrate(g.winner);
      sfx.fanfare(online ? g.winner === myPlayerId : cpu ? g.winner === 1 : true);
      return;
    }
    const miss = lastMissRef.current[g.turn];
    const sub = miss != null ? `Last shot missed by ${miss}px` : "Gravity bends everything";
    if (isHuman(g.turn)) {
      setAimState({ ...aimsRef.current[g.turn] });
      setPhaseBoth("aim");
      showBanner(online || cpu ? "YOUR TURN" : `PLAYER ${g.turn}`, sub, g.turn, 1800);
      sfx.turn();
    } else if (cpu) {
      setPhaseBoth("cpu");
      runCpu();
    } else {
      setPhaseBoth("remote");
    }
    syncView();
    pump();
  }

  function fire() {
    if (phaseRef.current !== "aim") return;
    const g = gameRef.current;
    if (!isHuman(g.turn)) return;
    sfx.unlock();
    const { angle, power } = aimsRef.current[g.turn];
    if (online) {
      setPhaseBoth("sent");
      syncView();
      propsRef.current.onFire?.(angle, power);
      clearTimeout(sentTimerRef.current);
      sentTimerRef.current = setTimeout(() => {
        if (phaseRef.current !== "sent") return;
        setPhaseBoth("aim");
        showBanner("NO SIGNAL", "Your shot didn't reach the server — try again", g.turn, 3000);
        syncView();
      }, 7000);
      return;
    }
    runShot(g.turn, angle, power, null);
  }

  async function runShot(shooter, angle, power, server) {
    const view = viewRef.current;
    aimsRef.current[shooter] = { angle, power };
    setPhaseBoth("flight");
    setBanner(null);
    view.setState({ turrets: { [shooter]: angle, snap: true }, aim: null });

    const sim = simulateShot(planetsRef.current, angle, power, shooter);
    const hit = server ? server.hit : sim.hit;
    const hitWhat = server ? server.hitWhat : sim.hitWhat;
    await view.playShot(sim, { shooter, power });
    view.setFastForward(false);
    setFf(false);
    if (!aliveRef.current) return;

    recordShot(shooter, angle, power, sim, hit, hitWhat);
    if (cpu && shooter === 2) cpuMemRef.current.shotsOnLevel++;

    const prev = gameRef.current;
    const next = server ? { ...prev, ...server.next } : applyShot(prev, shooter, hit);

    if (!hit) {
      if (hitWhat !== "self") lastMissRef.current[shooter] = Math.round(sim.closest.dist);
      commitGame(next);
      beginTurn();
      return;
    }

    const trick = sim.wraps > 0 ? `Wrapped the edge ×${sim.wraps}` : sim.steps / STEPS_PER_SECOND > 7 ? "The scenic route" : "Direct hit";
    const who = nameOf(shooter);
    const scoreTitle = online || cpu ? (isHuman(shooter) ? "YOU SCORE" : `${who.toUpperCase()} SCORES`) : `${who.toUpperCase()} SCORES`;

    if (next.status === "finished") {
      commitGame(next);
      if (cpu) recordCpuResult(cpuLevel, next.winner === 1);
      beginTurn();
      return;
    }

    showBanner(scoreTitle, `${trick} · ${next.scores[0]} – ${next.scores[1]}`, shooter, 1600);
    commitGame({ ...prev, scores: next.scores });
    await sleep(900);
    if (!aliveRef.current) return;
    await goToLevel(next);
  }

  async function goToLevel(next) {
    const planets = generateLevel(next.seed, next.level);
    await viewRef.current.transitionTo(planets, next.seed, next.level);
    if (!aliveRef.current) return;
    planetsRef.current = planets;
    commitGame(next);
    initLevelAims();
    beginTurn();
    showBanner(`LEVEL ${next.level}`, sectorName(next.seed, next.level), next.turn, 2000);
  }

  function recordShot(shooter, angle, power, sim, hit, hitWhat) {
    setLog((l) => [
      { id: Math.random(), player: shooter, angle, power, result: hitWhat, dist: hit ? 0 : Math.round(sim.closest.dist) },
      ...l,
    ].slice(0, 6));
    setStats((s) => {
      const st = { ...s[shooter] };
      st.shots++;
      if (hit) {
        st.hits++;
        st.longest = Math.max(st.longest, sim.steps / STEPS_PER_SECOND);
      } else if (hitWhat !== "self") {
        st.closest = Math.min(st.closest, sim.closest.dist);
      }
      if (hitWhat === "self") st.self++;
      st.wraps += sim.wraps;
      return { ...s, [shooter]: st };
    });
  }

  // ---- CPU ----

  async function runCpu() {
    const token = ++cpuTokenRef.current;
    const stale = () => !aliveRef.current || token !== cpuTokenRef.current;
    const started = performance.now();
    const plan = await planCpuShot(planetsRef.current, 2, cpuLevel, cpuMemRef.current, stale);
    if (!plan || stale()) return;
    await sleep(Math.max(0, 700 - (performance.now() - started)));
    const from = { ...aimsRef.current[2] };
    for (let i = 1; i <= 4; i++) {
      if (stale()) return;
      const k = 1 - Math.pow(1 - i / 4, 2);
      aimsRef.current[2] = {
        angle: shortestLerp(from.angle, plan.angle, k),
        power: Math.round(from.power + (plan.power - from.power) * k),
      };
      syncView();
      sfx.tick();
      await sleep(i === 4 ? 450 : 230);
    }
    if (stale()) return;
    runShot(2, plan.angle, plan.power, null);
  }

  // ---- Online: queued shots and room resyncs ----

  function pump() {
    if (!IDLE_PHASES.has(phaseRef.current)) return;
    const s = queueRef.current.shift();
    if (s) {
      clearTimeout(sentTimerRef.current);
      runShot(s.player, s.angle, s.power, { hit: s.hit, hitWhat: s.hitWhat, next: s.next });
      return;
    }
    applyPendingRoom();
  }

  async function applyPendingRoom() {
    const r = pendingRoomRef.current;
    if (!r || !IDLE_PHASES.has(phaseRef.current) || queueRef.current.length) return;
    pendingRoomRef.current = null;
    baseShotRef.current = Math.max(baseShotRef.current, r.shotCount ?? 0);
    const g = gameRef.current;
    const same = g.seed === r.seed && g.level === r.level && g.turn === r.turn && g.status === r.status &&
      g.scores[0] === r.scores[0] && g.scores[1] === r.scores[1];
    if (same) return;
    const next = { seed: r.seed, level: r.level, scores: [...r.scores], turn: r.turn, status: r.status, winner: r.winner ?? null, targetScore: r.targetScore };
    if (g.status === "finished" && r.status === "playing") {
      resetMatchUi();
      setPhaseBoth("flight");
      await goToLevel(next);
      return;
    }
    if (g.seed !== r.seed || g.level !== r.level) {
      planetsRef.current = generateLevel(next.seed, next.level);
      commitGame(next);
      viewRef.current.setLevel(planetsRef.current, next.seed, next.level);
      initLevelAims();
    } else {
      commitGame(next);
    }
    beginTurn();
  }

  useEffect(() => {
    if (!online || !incomingShot || incomingShot.id <= baseShotRef.current) return;
    baseShotRef.current = incomingShot.id;
    queueRef.current.push(incomingShot);
    pump();
  }, [incomingShot]);

  useEffect(() => {
    if (!online || !room) return;
    pendingRoomRef.current = room;
    pump();
  }, [room]);

  // ---- Match reset ----

  function resetMatchUi() {
    viewRef.current?.stopCelebrating();
    setStats({ 1: emptyStats(), 2: emptyStats() });
    setLog([]);
  }

  async function rematch() {
    sfx.unlock();
    if (online) {
      propsRef.current.onRematch?.();
      return;
    }
    cpuTokenRef.current++;
    resetMatchUi();
    setPhaseBoth("flight");
    await goToLevel(newMatchState(randomSeed(), gameRef.current.targetScore));
  }

  // ---- Aim input ----

  function setAim(angle, power) {
    const g = gameRef.current;
    if (phaseRef.current !== "aim" || !isHuman(g.turn)) return;
    const a = { angle: normalizeAngle(Math.round(angle)), power: clamp(Math.round(power), MIN_POWER, MAX_POWER) };
    aimsRef.current[g.turn] = a;
    setAimState(a);
    syncView();
  }

  function aimAtPointer(e) {
    const view = viewRef.current;
    const g = gameRef.current;
    const me = planetsRef.current.find((p) => p.player === g.turn);
    const { x, y } = view.toGame(e.clientX, e.clientY);
    const dx = x - me.x;
    const dy = y - me.y;
    const dist = Math.hypot(dx, dy);
    if (dist < me.radius * 0.5) return;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const power = MIN_POWER + (dist - (me.radius + 24)) / 2.2;
    setAim(angle, power);
  }

  const onPointerDown = (e) => {
    sfx.unlock();
    if (phaseRef.current === "flight") {
      viewRef.current.setFastForward(true);
      setFf(true);
      return;
    }
    if (phaseRef.current !== "aim" || !isHuman(gameRef.current.turn)) return;
    dragRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    aimAtPointer(e);
  };
  const onPointerMove = (e) => {
    if (dragRef.current) aimAtPointer(e);
  };
  const onPointerUp = () => {
    dragRef.current = false;
    viewRef.current?.setFastForward(false);
    setFf(false);
  };

  // Keep the latest closures reachable from long-lived listeners.
  const actionsRef = useRef({});
  actionsRef.current = { fire, setAim, syncView, beginTurn };

  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.tagName === "INPUT" && e.target.type === "text") return;
      sfx.unlock();
      const ph = phaseRef.current;
      if (e.key === "m" || e.key === "M") {
        sfx.setMuted(!sfx.muted);
        return;
      }
      if (ph === "flight" && (e.key === " " || e.key === "f")) {
        e.preventDefault();
        viewRef.current?.setFastForward(true);
        setFf(true);
        return;
      }
      if (ph !== "aim") return;
      const g = gameRef.current;
      const a = aimsRef.current[g.turn];
      const fine = e.shiftKey ? 1 : 5;
      const act = actionsRef.current;
      let handled = true;
      if (e.key === "ArrowLeft" || e.key === "a") act.setAim(a.angle - fine, a.power);
      else if (e.key === "ArrowRight" || e.key === "d") act.setAim(a.angle + fine, a.power);
      else if (e.key === "ArrowUp" || e.key === "w") act.setAim(a.angle, a.power + fine);
      else if (e.key === "ArrowDown" || e.key === "s") act.setAim(a.angle, a.power - fine);
      else if ((e.key === " " || e.key === "Enter") && !e.repeat) act.fire();
      else handled = false;
      if (handled) e.preventDefault();
    };
    const onKeyUp = (e) => {
      if (e.key === " " || e.key === "f") {
        viewRef.current?.setFastForward(false);
        setFf(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    const unsub = sfx.subscribe(setMuted);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      unsub();
    };
  }, []);

  // ---- View lifecycle + responsive sizing ----

  useLayoutEffect(() => {
    aliveRef.current = true;
    const view = new GameView(canvasRef.current);
    viewRef.current = view;
    view.setLevel(planetsRef.current, gameRef.current.seed, gameRef.current.level);

    const fit = () => {
      const el = stageRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const w = Math.floor(Math.max(200, Math.min(r.width, r.height * ASPECT)));
      const h = Math.floor(w / ASPECT);
      setSize({ w, h });
      view.resize(w, h);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(stageRef.current);

    actionsRef.current.beginTurn();
    if (gameRef.current.status !== "finished") {
      const g = gameRef.current;
      showBanner(`LEVEL ${g.level}`, sectorName(g.seed, g.level), g.turn, 2000);
    }

    return () => {
      aliveRef.current = false;
      cpuTokenRef.current++;
      clearTimeout(sentTimerRef.current);
      clearTimeout(bannerTimerRef.current);
      ro.disconnect();
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    syncView();
  }, [assistOn, myPlayerId]);

  // ===================== UI =====================

  const turn = game.turn;
  const humanTurn = isHuman(turn);
  const controlsLive = phase === "aim" && humanTurn;
  const teamClass = `team-${humanTurn ? turn : online ? myPlayerId : 1}`;
  const status = (() => {
    if (phase === "aim") return online || cpu ? "Your shot — drag on the field or use the sliders" : `Player ${turn}, your shot`;
    if (phase === "cpu") return `${CPU_LEVELS[cpuLevel]?.label ?? "CPU"} is lining up a shot…`;
    if (phase === "remote") return opponentOnline ? "Rival is aiming…" : "Rival disconnected — waiting for them to return";
    if (phase === "sent") return "Transmitting…";
    if (phase === "flight") return ff ? "Fast-forward ▸▸" : "Hold SPACE or press on the field to fast-forward";
    return "";
  })();

  const winnerIsMe = online ? game.winner === myPlayerId : cpu ? game.winner === 1 : null;

  return (
    <div className={`gw-root ${teamClass}`}>
      <header className="gw-top">
        <div className="gw-brand">
          <button className="gw-logo" onClick={() => navigate("/")} title="Back to menu">GRAVITY WARS</button>
          <span className="gw-level">
            LVL {game.level}<span className="gw-sector"> · {sectorName(game.seed, game.level)}</span>
          </span>
        </div>

        <div className="gw-scoreboard">
          {[1, 2].map((p) => (
            <div key={p} className={`gw-score team-${p} ${turn === p && phase !== "over" ? "is-turn" : ""}`}>
              <span className="gw-score-name">{labels[p]}</span>
              <span className="gw-pips">
                {Array.from({ length: game.targetScore }, (_, i) => (
                  <i key={i} className={i < game.scores[p - 1] ? "on" : ""} />
                ))}
              </span>
              <span className="gw-score-num">{game.scores[p - 1]}</span>
            </div>
          ))}
        </div>

        <div className="gw-tools">
          {assistAllowed && (
            <button
              className={`gw-icon ${assistOn ? "on" : ""}`}
              onClick={() => setAssistOn((v) => !v)}
              title="Aim assist: preview the first moments of your shot"
              aria-pressed={assistOn}
            >
              <IconAssist />
            </button>
          )}
          <button className="gw-icon" onClick={() => { sfx.unlock(); sfx.setMuted(!muted); }} title="Sound (M)" aria-pressed={!muted}>
            {muted ? <IconMute /> : <IconSound />}
          </button>
          <button className="gw-icon" onClick={() => navigate("/")} title="Leave game">
            <IconClose />
          </button>
        </div>
      </header>

      <main className="gw-stage" ref={stageRef}>
        <div className="gw-canvas-wrap" style={{ width: size.w, height: size.h }}>
          <canvas
            ref={canvasRef}
            className={controlsLive ? "can-aim" : ""}
            style={{ width: size.w, height: size.h }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />

          {banner && (
            <div key={banner.key} className={`gw-banner team-${banner.player}`}>
              <div className="gw-banner-title">{banner.title}</div>
              {banner.sub && <div className="gw-banner-sub">{banner.sub}</div>}
            </div>
          )}

          {online && !opponentOnline && phase !== "over" && (
            <div className="gw-toast">Rival disconnected — the room stays open for them</div>
          )}

          {log.length > 0 && phase !== "over" && (
            <ol className="gw-log" aria-label="Shot log">
              {log.map((s, i) => (
                <li key={s.id} style={{ opacity: 1 - i * 0.13 }}>
                  <span className={`who team-${s.player}`}>{labels[s.player]}</span>
                  <span className="nums">{s.angle}° {s.power}%</span>
                  <span className={`res res-${s.result === "HIT!" ? "hit" : s.result}`}>
                    {s.result === "HIT!" ? "HIT" : s.result === "lost" ? `lost·${s.dist}` : s.result === "self" ? "self" : `${s.dist}px`}
                  </span>
                </li>
              ))}
            </ol>
          )}

          {phase === "over" && (
            <VictoryPanel
              game={game}
              stats={stats}
              labels={labels}
              winnerIsMe={winnerIsMe}
              mode={mode}
              cpuLevel={cpuLevel}
              rematchVotes={rematchVotes}
              myPlayerId={myPlayerId}
              onRematch={rematch}
              onMenu={() => navigate("/")}
              onPromote={(d) => navigate(`/play/cpu?d=${d}&to=${game.targetScore}${assistOn ? "&assist=1" : ""}`, { replace: true })}
            />
          )}
        </div>
      </main>

      <footer className={`gw-controls ${controlsLive ? "" : "is-locked"}`}>
        <label className="gw-slider">
          <span className="gw-slider-label">ANGLE</span>
          <input
            type="range" min={-180} max={180} value={aim.angle}
            onChange={(e) => setAim(Number(e.target.value), aim.power)}
            disabled={!controlsLive}
          />
          <span className="gw-slider-val">{aim.angle}°</span>
        </label>
        <label className="gw-slider">
          <span className="gw-slider-label">POWER</span>
          <input
            type="range" min={MIN_POWER} max={MAX_POWER} value={aim.power}
            onChange={(e) => setAim(aim.angle, Number(e.target.value))}
            disabled={!controlsLive}
          />
          <span className="gw-slider-val">{aim.power}%</span>
        </label>
        <button
          className="gw-fire"
          disabled={!controlsLive}
          onClick={(e) => { e.currentTarget.blur(); fire(); }}
        >
          FIRE
        </button>
        <div className="gw-status">
          <span>{status}</span>
          <span className="gw-keys">←→ angle · ↑↓ power · shift fine · space fire · M mute</span>
          <span className="gw-rotate-hint">Tip: turn your phone sideways for a bigger battlefield</span>
        </div>
      </footer>
    </div>
  );
}

function fmtPct(st) {
  return st.shots ? `${Math.round((st.hits / st.shots) * 100)}%` : "—";
}

function VictoryPanel({ game, stats, labels, winnerIsMe, mode, cpuLevel, rematchVotes, myPlayerId, onRematch, onMenu, onPromote }) {
  const w = game.winner;
  const title = winnerIsMe === null ? `PLAYER ${w} WINS` : winnerIsMe ? "VICTORY" : "DEFEAT";
  const ranks = Object.keys(CPU_LEVELS);
  const nextRank = mode === "cpu" && winnerIsMe ? ranks[ranks.indexOf(cpuLevel) + 1] : null;
  const myVote = mode === "online" && rematchVotes?.[myPlayerId];
  const theirVote = mode === "online" && rematchVotes?.[other(myPlayerId)];
  const rows = [
    ["Accuracy", (s) => fmtPct(s)],
    ["Shots fired", (s) => s.shots],
    ["Closest miss", (s) => (Number.isFinite(s.closest) ? `${Math.round(s.closest)}px` : "—")],
    ["Longest hit", (s) => (s.longest ? `${s.longest.toFixed(1)}s` : "—")],
    ["Edge wraps", (s) => s.wraps],
    ["Friendly fire", (s) => s.self],
  ];
  return (
    <div className={`gw-victory team-${w}`} role="dialog" aria-label="Match over">
      <div className="gw-victory-card">
        <div className="gw-victory-title">{title}</div>
        <div className="gw-victory-sub">
          {game.scores[0]} – {game.scores[1]} · first to {game.targetScore}
          {mode === "cpu" && ` · vs ${CPU_LEVELS[cpuLevel].label}`}
        </div>
        <table className="gw-stats">
          <thead>
            <tr><th /><th className="team-1">{labels[1]}</th><th className="team-2">{labels[2]}</th></tr>
          </thead>
          <tbody>
            {rows.map(([name, f]) => (
              <tr key={name}><td>{name}</td><td>{f(stats[1])}</td><td>{f(stats[2])}</td></tr>
            ))}
          </tbody>
        </table>
        {mode === "online" && theirVote && !myVote && <div className="gw-victory-note">Your rival wants a rematch!</div>}
        <div className="gw-victory-actions">
          {nextRank && (
            <button className="gw-btn gw-btn-primary" onClick={() => onPromote(nextRank)}>
              PROMOTE: VS {CPU_LEVELS[nextRank].label.toUpperCase()}
            </button>
          )}
          <button className={`gw-btn ${nextRank ? "" : "gw-btn-primary"}`} onClick={onRematch} disabled={!!myVote}>
            {myVote ? "WAITING FOR RIVAL…" : "REMATCH"}
          </button>
          <button className="gw-btn" onClick={onMenu}>MENU</button>
        </div>
      </div>
    </div>
  );
}
