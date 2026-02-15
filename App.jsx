import { useState, useRef, useEffect, useCallback } from "react";
import {
  CANVAS_W, CANVAS_H, EXPLOSION_DURATION, MAX_SHOT_HISTORY,
  MIN_POWER, MAX_POWER, AIM_OFFSET_MIN, AIM_OFFSET_MAX,
} from "./game/constants.js";
import { wrappedDelta, cannonTip, cannonBase, animateShot } from "./game/physics.js";
import { generateLevel, generateStars, createRng } from "./game/levelgen.js";

// --- Rendering helpers ---

function lighten(color, amount) {
  const c = document.createElement("canvas"); c.width = c.height = 1;
  const x = c.getContext("2d"); x.fillStyle = color; x.fillRect(0, 0, 1, 1);
  const [r, g, b] = x.getImageData(0, 0, 1, 1).data;
  return `rgb(${Math.min(255, Math.round(r + (255 - r) * amount))},${Math.min(255, Math.round(g + (255 - g) * amount))},${Math.min(255, Math.round(b + (255 - b) * amount))})`;
}

function darken(color, amount) {
  const c = document.createElement("canvas"); c.width = c.height = 1;
  const x = c.getContext("2d"); x.fillStyle = color; x.fillRect(0, 0, 1, 1);
  const [r, g, b] = x.getImageData(0, 0, 1, 1).data;
  const f = 1 - amount;
  return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
}

// --- Main Component ---

// Props for multiplayer mode (all optional — omit for local 2P):
//   mode: "local" | "online"
//   myPlayerId: 1 | 2
//   roomSeed: number
//   onFire: (angle, power) => void  — called instead of local sim in online mode
//   incomingShot: { angle, power, player } | null — set by parent when opponent fires

const STAR_SEED = 42424242; // Fixed for consistent starfield

export default function GravityWars({
  mode = "local",
  myPlayerId = null,
  roomSeed = null,
  onFire = null,
  incomingShot = null,
}) {
  const canvasRef = useRef(null);
  const frameRef = useRef(null);
  const simRef = useRef(null);
  const timeRef = useRef(0);

  // Use room seed if provided, otherwise random
  const [seed] = useState(() => roomSeed ?? Math.floor(Math.random() * 2147483647));
  const [stars] = useState(() => generateStars(STAR_SEED, 300));

  const [turn, setTurn] = useState(1);
  const [angle, setAngle] = useState(0);
  const [power, setPower] = useState(50);
  const [firing, setFiring] = useState(false);
  const [scores, setScores] = useState([0, 0]);
  const [level, setLevel] = useState(1);
  const [planets, setPlanets] = useState(() => generateLevel(seed, 1));
  const [message, setMessage] = useState(
    mode === "local" ? "Player 1 — aim and fire!" : "Waiting for game to start..."
  );
  const [shotHistory, setShotHistory] = useState([]);
  const [allTrails, setAllTrails] = useState([]);
  const allTrailsRef = useRef([]);
  useEffect(() => { allTrailsRef.current = allTrails; }, [allTrails]);

  // Refs for values needed in callbacks/draw loop
  const planetsRef = useRef(planets);
  const scoresRef = useRef(scores);
  const turnRef = useRef(turn);
  const levelRef = useRef(level);
  const angleRef = useRef(angle);
  const powerRef = useRef(power);
  const firingRef = useRef(firing);
  const seedRef = useRef(seed);
  useEffect(() => { planetsRef.current = planets; }, [planets]);
  useEffect(() => { scoresRef.current = scores; }, [scores]);
  useEffect(() => { turnRef.current = turn; }, [turn]);
  useEffect(() => { levelRef.current = level; }, [level]);
  useEffect(() => { angleRef.current = angle; }, [angle]);
  useEffect(() => { powerRef.current = power; }, [power]);
  useEffect(() => { firingRef.current = firing; }, [firing]);

  const getPlayerPlanet = useCallback(
    (p) => planets.find((pl) => pl.player === p),
    [planets]
  );

  // Is it my turn? (In local mode, always true)
  const isMyTurn = mode === "local" || turn === myPlayerId;

  // Default aim: offset from direct line to opponent
  useEffect(() => {
    const me = getPlayerPlanet(turn);
    const them = getPlayerPlanet(turn === 1 ? 2 : 1);
    if (me && them) {
      const { dx, dy } = wrappedDelta(me.x, me.y, them.x, them.y);
      const direct = (Math.atan2(dy, dx) * 180) / Math.PI;
      // Use seeded RNG for offset so both clients get the same default
      const offsetRng = createRng(seed + level * 31 + turn * 7);
      const offsetDir = offsetRng() < 0.5 ? 1 : -1;
      const offsetAmount = AIM_OFFSET_MIN + offsetRng() * (AIM_OFFSET_MAX - AIM_OFFSET_MIN);
      setAngle(Math.round(direct + offsetDir * offsetAmount));
    }
  }, [turn, planets, getPlayerPlanet, seed, level]);

  // Handle incoming shot from opponent (online mode)
  useEffect(() => {
    if (!incomingShot || mode !== "online") return;
    if (incomingShot.player === myPlayerId) return; // don't replay own shots
    executeShot(incomingShot.angle, incomingShot.power, incomingShot.player);
  }, [incomingShot]);

  // --- Shot execution (shared between local fire and incoming online shots) ---

  const executeShot = useCallback((shotAngle, shotPower, shotPlayer) => {
    setFiring(true);
    setMessage("Firing...");

    const curPlanets = planetsRef.current;
    const curScores = scoresRef.current;
    const curLevel = levelRef.current;
    const curSeed = seedRef.current;
    const opponent = shotPlayer === 1 ? 2 : 1;

    animateShot(
      curPlanets,
      shotAngle,
      shotPower,
      shotPlayer,
      // onStep: update sim ref for draw loop
      (simState) => {
        simRef.current = simState;
      },
      // onComplete: handle result
      (result) => {
        // Record trail
        setAllTrails((prev) => {
          const next = [...prev, { trail: result.trail, player: shotPlayer, hit: result.hit }];
          return next.length > MAX_SHOT_HISTORY * 2 ? next.slice(-MAX_SHOT_HISTORY * 2) : next;
        });
        setShotHistory((prev) =>
          [{ player: shotPlayer, angle: shotAngle, power: shotPower, result: result.hitWhat }, ...prev].slice(0, MAX_SHOT_HISTORY)
        );

        // Animate explosion then transition
        const explosionSim = simRef.current;

        const animateExplosion = () => {
          if (explosionSim && explosionSim.explosion) {
            explosionSim.explosion.frame++;
            simRef.current = { ...explosionSim };
            if (explosionSim.explosion.frame < EXPLOSION_DURATION) {
              requestAnimationFrame(animateExplosion);
              return;
            }
          }

          setTimeout(() => {
            if (result.hit) {
              const ns = [...curScores];
              ns[shotPlayer - 1]++;
              setScores(ns);
              setMessage(`Player ${shotPlayer} scores! 🎯`);
              setTimeout(() => {
                const nl = curLevel + 1;
                setLevel(nl);
                setPlanets(generateLevel(curSeed, nl));
                setAllTrails([]);
                setTurn(opponent);
                setMessage(
                  mode === "local"
                    ? `Level ${nl} — Player ${opponent}'s turn!`
                    : opponent === myPlayerId
                    ? `Level ${nl} — Your turn!`
                    : `Level ${nl} — Opponent's turn...`
                );
                setFiring(false);
                simRef.current = null;
              }, 600);
            } else {
              if (result.hitWhat === "self") {
                setMessage(`Player ${shotPlayer} hit themselves!`);
              } else if (result.hitWhat === "planet") {
                setMessage(`Player ${shotPlayer} hit a planet!`);
              } else {
                setMessage("Missile lost in space!");
              }
              setTimeout(() => {
                setTurn(opponent);
                setMessage(
                  mode === "local"
                    ? `Player ${opponent}'s turn!`
                    : opponent === myPlayerId
                    ? "Your turn!"
                    : "Opponent's turn..."
                );
                setFiring(false);
                simRef.current = null;
              }, 400);
            }
          }, result.hit ? 0 : 100);
        };

        requestAnimationFrame(animateExplosion);
      }
    );
  }, [mode, myPlayerId]);

  // --- Fire action ---

  const fire = useCallback(() => {
    if (firingRef.current) return;
    if (mode === "online" && !isMyTurn) return;

    const a = angleRef.current;
    const p = powerRef.current;
    const t = turnRef.current;

    if (mode === "online" && onFire) {
      // In online mode, notify server; shot will come back via incomingShot
      onFire(a, p);
    }

    // Execute locally immediately (both modes)
    executeShot(a, p, t);
  }, [mode, isMyTurn, onFire, executeShot]);

  // --- New game ---

  function newGame() {
    setScores([0, 0]);
    setLevel(1);
    setPlanets(generateLevel(seed, 1));
    setTurn(1);
    setFiring(false);
    setMessage(mode === "local" ? "Player 1 — aim and fire!" : "Your turn!");
    setAllTrails([]);
    setShotHistory([]);
    simRef.current = null;
  }

  // --- Keyboard controls ---

  useEffect(() => {
    const handleKey = (e) => {
      if (firingRef.current) return;
      if (mode === "online" && turnRef.current !== myPlayerId) return;
      const fine = e.shiftKey ? 1 : 5;
      if (e.key === "ArrowLeft" || e.key === "a") setAngle((a) => a - fine);
      else if (e.key === "ArrowRight" || e.key === "d") setAngle((a) => a + fine);
      else if (e.key === "ArrowUp" || e.key === "w") setPower((p) => Math.min(MAX_POWER, p + fine));
      else if (e.key === "ArrowDown" || e.key === "s") setPower((p) => Math.max(MIN_POWER, p - fine));
      else if (e.key === " " || e.key === "Enter") { e.preventDefault(); fire(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [fire, mode, myPlayerId]);

  // ===================== DRAW LOOP =====================

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const draw = () => {
      timeRef.current += 0.016;
      const t = timeRef.current;

      ctx.fillStyle = "#06060e";
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // Nebula
      const ng1 = ctx.createRadialGradient(CANVAS_W * 0.2, CANVAS_H * 0.3, 0, CANVAS_W * 0.2, CANVAS_H * 0.3, 300);
      ng1.addColorStop(0, "rgba(40,20,80,0.07)"); ng1.addColorStop(1, "transparent");
      ctx.fillStyle = ng1; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      const ng2 = ctx.createRadialGradient(CANVAS_W * 0.75, CANVAS_H * 0.7, 0, CANVAS_W * 0.75, CANVAS_H * 0.7, 250);
      ng2.addColorStop(0, "rgba(20,40,80,0.05)"); ng2.addColorStop(1, "transparent");
      ctx.fillStyle = ng2; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // Stars
      for (const s of stars) {
        const tw = 0.7 + 0.3 * Math.sin(t * s.twinkleSpeed + s.twinkleOffset);
        const alpha = s.brightness * tw;
        ctx.fillStyle = s.saturation > 0
          ? `hsla(${s.hue},${s.saturation}%,80%,${alpha})`
          : `rgba(255,255,255,${alpha})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
      }

      // Wrap edge hint
      ctx.strokeStyle = "rgba(255,255,255,0.025)";
      ctx.lineWidth = 1; ctx.setLineDash([4, 8]);
      ctx.strokeRect(1, 1, CANVAS_W - 2, CANVAS_H - 2);
      ctx.setLineDash([]);

      // Trail drawing helper
      const drawTrailSegments = (trail, color, lineW) => {
        for (let i = 1; i < trail.length; i++) {
          const p0 = trail[i - 1], p1 = trail[i];
          if (Math.abs(p1.x - p0.x) > CANVAS_W * 0.4 || Math.abs(p1.y - p0.y) > CANVAS_H * 0.4) continue;
          ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
          ctx.strokeStyle = color; ctx.lineWidth = lineW; ctx.stroke();
        }
      };

      // Old trails
      const curTrails = allTrailsRef.current;
      for (const rec of curTrails) {
        if (rec.trail.length < 2) continue;
        const c = rec.player === 1 ? "74,158,255" : "255,107,74";
        const a = rec.hit ? 0.4 : 0.25;
        drawTrailSegments(rec.trail, `rgba(${c},${a})`, 1.5);
        const step = Math.max(10, Math.floor(rec.trail.length / 35));
        for (let i = 0; i < rec.trail.length; i += step) {
          const pt = rec.trail[i];
          ctx.beginPath(); ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${c},${a * 1.5})`; ctx.fill();
        }
      }

      // Live trail
      const sim = simRef.current;
      if (sim && sim.trail.length > 1) {
        const c = sim.playerFiring === 1 ? [74, 158, 255] : [255, 107, 74];
        for (let i = 1; i < sim.trail.length; i++) {
          const p0 = sim.trail[i - 1], p1 = sim.trail[i];
          if (Math.abs(p1.x - p0.x) > CANVAS_W * 0.4 || Math.abs(p1.y - p0.y) > CANVAS_H * 0.4) continue;
          const al = 0.1 + 0.6 * (i / sim.trail.length);
          ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
          ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${al})`; ctx.lineWidth = 2; ctx.stroke();
        }
      }

      // Planets
      const curPlanets = planetsRef.current;
      for (const p of curPlanets) {
        for (let ring = 3; ring >= 1; ring--) {
          const rr = p.radius + ring * 18 + Math.sin(t * 0.5 + ring) * 3;
          ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
          const gc = p.player === 1 ? `rgba(74,158,255,${0.03 * ring})` :
                     p.player === 2 ? `rgba(255,107,74,${0.03 * ring})` :
                     `rgba(180,160,100,${0.02 * ring})`;
          ctx.strokeStyle = gc; ctx.lineWidth = 0.5; ctx.stroke();
        }
        const gc = p.player === 1 ? "74,158,255" : p.player === 2 ? "255,107,74" : "180,160,100";
        const grad = ctx.createRadialGradient(p.x, p.y, p.radius * 0.3, p.x, p.y, p.radius * 2.2);
        grad.addColorStop(0, `rgba(${gc},0.2)`); grad.addColorStop(1, "transparent");
        ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(p.x, p.y, p.radius * 2.2, 0, Math.PI * 2); ctx.fill();
        const bg = ctx.createRadialGradient(p.x - p.radius * 0.3, p.y - p.radius * 0.3, p.radius * 0.1, p.x, p.y, p.radius);
        bg.addColorStop(0, lighten(p.color, 0.2)); bg.addColorStop(0.7, p.color); bg.addColorStop(1, darken(p.color, 0.5));
        ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fill();
        const sp = ctx.createRadialGradient(p.x - p.radius * 0.35, p.y - p.radius * 0.35, 0, p.x - p.radius * 0.2, p.y - p.radius * 0.2, p.radius * 0.5);
        sp.addColorStop(0, "rgba(255,255,255,0.25)"); sp.addColorStop(1, "transparent");
        ctx.fillStyle = sp; ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fill();
        if (!p.player) {
          ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.font = "10px monospace"; ctx.textAlign = "center";
          ctx.fillText(`m${Math.round(p.mass)}`, p.x, p.y + p.radius + 16);
        }
      }

      // Cannons
      const curTurn = turnRef.current;
      const curAngle = angleRef.current;
      const curFiring = firingRef.current;
      [1, 2].forEach((pn) => {
        const pl = curPlanets.find((pp) => pp.player === pn);
        if (!pl) return;
        const isActive = pn === curTurn && !curFiring;
        const a = isActive ? curAngle : (pn === curTurn ? curAngle : (pn === 1 ? 0 : 180));
        const base = cannonBase(pl, a);
        const tip = cannonTip(pl, a);
        ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(tip.x, tip.y);
        ctx.strokeStyle = pn === 1 ? "#7ac0ff" : "#ffaa88"; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.stroke();
        ctx.fillStyle = pn === 1 ? "#4a9eff" : "#ff6b4a";
        ctx.font = "bold 12px monospace"; ctx.textAlign = "center";
        const label = mode === "online"
          ? (pn === myPlayerId ? "YOU" : "OPP")
          : `P${pn}`;
        ctx.fillText(label, pl.x, pl.y - pl.radius - 12);
      });

      // Live missile
      if (sim && sim.active) {
        ctx.beginPath(); ctx.arc(sim.mx, sim.my, 10, 0, Math.PI * 2);
        ctx.fillStyle = sim.playerFiring === 1 ? "rgba(74,158,255,0.15)" : "rgba(255,107,74,0.15)"; ctx.fill();
        ctx.beginPath(); ctx.arc(sim.mx, sim.my, 4, 0, Math.PI * 2);
        ctx.fillStyle = sim.playerFiring === 1 ? "#8ac8ff" : "#ffbb99"; ctx.fill();
        ctx.beginPath(); ctx.arc(sim.mx, sim.my, 2, 0, Math.PI * 2);
        ctx.fillStyle = "#fff"; ctx.fill();
      }

      // Explosion
      if (sim && sim.explosion) {
        const e = sim.explosion;
        const prog = e.frame / EXPLOSION_DURATION;
        const r = e.radius * (0.5 + prog * 2);
        const al = 1 - prog;
        for (let ring = 3; ring >= 0; ring--) {
          const rr = r * (1 + ring * 0.5);
          const a2 = al * (1 - ring * 0.2);
          ctx.beginPath(); ctx.arc(e.x, e.y, rr, 0, Math.PI * 2);
          ctx.fillStyle = ring === 0 ? `rgba(255,255,220,${a2})` :
            ring === 1 ? `rgba(255,200,60,${a2 * 0.6})` :
            ring === 2 ? `rgba(255,100,30,${a2 * 0.3})` : `rgba(255,40,10,${a2 * 0.15})`;
          ctx.fill();
        }
        for (let i = 0; i < 8; i++) {
          const sa = (i / 8) * Math.PI * 2 + prog * 2;
          const sr = r * (1.2 + prog * 0.8);
          ctx.beginPath(); ctx.arc(e.x + Math.cos(sa) * sr, e.y + Math.sin(sa) * sr, 1.5 * (1 - prog), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,220,100,${al * 0.6})`; ctx.fill();
        }
      }

      // Aim readout
      if (!curFiring) {
        const pl = curPlanets.find((p) => p.player === curTurn);
        if (pl) {
          ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "11px monospace"; ctx.textAlign = "center";
          ctx.fillText(`${curAngle}° | ${powerRef.current}%`, pl.x, pl.y + pl.radius + 28);
        }
      }

      frameRef.current = requestAnimationFrame(draw);
    };
    frameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameRef.current);
  }, []);

  // ===================== UI =====================

  const activeColor = turn === 1 ? "#4a9eff" : "#ff6b4a";
  const controlsDisabled = firing || (mode === "online" && !isMyTurn);

  return (
    <div style={{ background: "#04040a", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "'Courier New', monospace", color: "#ccc", padding: "10px", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: CANVAS_W + 162 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
          <span style={{ fontSize: 20, fontWeight: "bold", color: "#ddd", letterSpacing: 3 }}>GRAVITY WARS</span>
          <span style={{ fontSize: 11, color: "#555" }}>LEVEL {level}</span>
          <span style={{ fontSize: 10, color: "#333" }}>edges wrap</span>
        </div>
        <div style={{ display: "flex", gap: 24, fontSize: 14 }}>
          <span><span style={{ color: "#4a9eff" }}>{mode === "online" && myPlayerId === 1 ? "YOU" : "P1"}</span> <span style={{ color: "#eee", fontWeight: "bold" }}>{scores[0]}</span></span>
          <span><span style={{ color: "#ff6b4a" }}>{mode === "online" && myPlayerId === 2 ? "YOU" : "P2"}</span> <span style={{ color: "#eee", fontWeight: "bold" }}>{scores[1]}</span></span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H}
          style={{ border: "1px solid #111820", borderRadius: 3, display: "block", cursor: isMyTurn && !firing ? "crosshair" : "default" }} tabIndex={0} />
        <div style={{ width: 152, background: "#0a0a14", border: "1px solid #151520", borderRadius: 3, padding: "8px 10px", fontSize: 10 }}>
          <div style={{ color: "#555", letterSpacing: 1, marginBottom: 6, fontSize: 9 }}>SHOT LOG</div>
          {shotHistory.length === 0 && <div style={{ color: "#2a2a3a" }}>No shots yet</div>}
          {shotHistory.map((s, i) => (
            <div key={i} style={{ marginBottom: 4, padding: "3px 0", borderBottom: "1px solid #111118", opacity: 0.4 + 0.6 * (1 - i / shotHistory.length) }}>
              <span style={{ color: s.player === 1 ? "#4a9eff" : "#ff6b4a", fontWeight: i === 0 ? "bold" : "normal" }}>
                {mode === "online" ? (s.player === myPlayerId ? "YOU" : "OPP") : `P${s.player}`}
              </span>
              <span style={{ color: "#555" }}> {s.angle}° {s.power}% </span>
              <span style={{ color: s.result === "HIT!" ? "#4eff7a" : s.result === "lost" ? "#555" : "#aa6644" }}>{s.result}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ width: CANVAS_W + 162, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 20, alignItems: "center", opacity: controlsDisabled && !firing ? 0.4 : 1 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <label style={{ fontSize: 9, color: "#555", letterSpacing: 1 }}>ANGLE</label>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input type="range" min={-180} max={180} value={angle} onChange={(e) => setAngle(Number(e.target.value))} disabled={controlsDisabled} style={{ width: 180, accentColor: activeColor }} />
              <span style={{ fontSize: 13, color: activeColor, minWidth: 40, textAlign: "right" }}>{angle}°</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <label style={{ fontSize: 9, color: "#555", letterSpacing: 1 }}>POWER</label>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input type="range" min={MIN_POWER} max={MAX_POWER} value={power} onChange={(e) => setPower(Number(e.target.value))} disabled={controlsDisabled} style={{ width: 180, accentColor: activeColor }} />
              <span style={{ fontSize: 13, color: activeColor, minWidth: 32, textAlign: "right" }}>{power}%</span>
            </div>
          </div>
          <button onClick={fire} disabled={controlsDisabled} style={{
            background: controlsDisabled ? "#222" : activeColor, color: controlsDisabled ? "#555" : "#000",
            border: "none", padding: "8px 28px", borderRadius: 3,
            fontFamily: "'Courier New', monospace", fontSize: 13, fontWeight: "bold",
            cursor: controlsDisabled ? "default" : "pointer", letterSpacing: 1, marginTop: 10,
          }}>FIRE</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
          <span style={{ fontSize: 13, color: activeColor }}>{message}</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 9, color: "#383838" }}>Arrows/WASD aim · Shift=fine · Space=fire</span>
            {mode === "local" && (
              <button onClick={newGame} style={{
                background: "none", border: "1px solid #222", color: "#555", padding: "2px 10px",
                borderRadius: 3, fontFamily: "'Courier New', monospace", fontSize: 9, cursor: "pointer",
              }}>NEW GAME</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
