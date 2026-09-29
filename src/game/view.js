// GameView — owns the canvas and the render loop.
//
// React tells it what the game state is (level, turn, aim) and hands it
// precomputed shots to play back. Shots are simulated in full up front by
// simulateShot(), so the view knows how a shot ends before the missile gets
// there: it slows time for a finishing blow or a near miss, and fast-forwards
// long wandering orbits so nobody sits through 20 seconds of nothing.

import { CANVAS_W, CANVAS_H, MIN_POWER, MAX_POWER } from "./constants.js";
import { cannonTip, pathSpeed, STEPS_PER_SECOND } from "./physics.js";
import { TEAM, buildBackground, makeTwinkles, planetStyle, buildPlanetSprite, drawBlackHole } from "./art.js";
import { sfx as realSfx } from "./audio.js";

const TAU = Math.PI * 2;
const MAX_PARTICLES = 1400;
const reducedMotion =
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const quietSfx = new Proxy({}, { get: () => () => {} });

const isJump = (x0, y0, x1, y1) => Math.abs(x1 - x0) > CANVAS_W / 2 || Math.abs(y1 - y0) > CANVAS_H / 2;

function angleLerp(a, b, k) {
  let d = ((b - a + 540) % 360) - 180;
  return a + d * k;
}

export class GameView {
  constructor(canvas, { silent = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.sfx = silent ? quietSfx : realSfx;
    this.scale = 1;

    this.planets = [];
    this.styles = [];
    this.sprites = [];
    this.scars = [];
    this.destroyed = new Set();
    this.seed = 0;
    this.level = 0;
    this.bg = null;
    this.twinkles = makeTwinkles(7);

    this.trails = [];
    this.markers = [];
    this.particles = [];
    this.rings = [];
    this.texts = [];
    this.shakeAmp = 0;
    this.flash = 0;
    this.flashRgb = "255,255,255";

    this.turn = 1;
    this.labels = { 1: "P1", 2: "P2" };
    this.aim = null; // { player, angle, power, preview }
    this.turretTarget = { 1: 0, 2: 180 };
    this.turret = { 1: 0, 2: 180 };
    this.recoil = { 1: 0, 2: 0 };
    this.idle = false; // true while waiting on the other side (dims the guide)

    this.playback = null;
    this.transition = null;
    this.fastForward = false;
    this.celebration = null;

    this.time = 0;
    this.last = performance.now();
    this.dead = false;
    this._frame = this._frame.bind(this);
    this._onVis = () => {
      if (!document.hidden && !this.raf && !this.dead) {
        this.last = performance.now();
        this.raf = requestAnimationFrame(this._frame);
      }
    };
    document.addEventListener("visibilitychange", this._onVis);
    this.raf = requestAnimationFrame(this._frame);
  }

  destroy() {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    document.removeEventListener("visibilitychange", this._onVis);
    if (this.playback) this.sfx.stopHum();
  }

  // --- Layout ---

  resize(cssW, cssH) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    // Compare against our own last size, not the canvas's: a previous view
    // (e.g. React StrictMode's double mount) may have sized this canvas already.
    if (w === this.pxW && h === this.pxH) return;
    this.pxW = w;
    this.pxH = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.scale = w / CANVAS_W;
    this._rebuildArt();
  }

  toGame(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((clientY - rect.top) / rect.height) * CANVAS_H,
    };
  }

  // --- State from React ---

  setLevel(planets, seed, level) {
    this.planets = planets;
    this.seed = seed;
    this.level = level;
    this.styles = planets.map((p, i) => planetStyle(p, seed, level, i));
    this.scars = planets.map(() => []);
    this.destroyed = new Set();
    this.trails = [];
    this.markers = [];
    this._rebuildArt();
  }

  setState({ turn, labels, aim, turrets, idle }) {
    if (turn !== undefined) this.turn = turn;
    if (labels) this.labels = labels;
    if (aim !== undefined) this.aim = aim;
    if (idle !== undefined) this.idle = idle;
    if (turrets) {
      for (const k of [1, 2]) {
        if (turrets[k] === undefined) continue;
        this.turretTarget[k] = turrets[k];
        if (turrets.snap) this.turret[k] = turrets[k];
      }
    }
  }

  setFastForward(on) {
    this.fastForward = on;
  }

  _rebuildArt() {
    this.bg = buildBackground(this.seed, this.level, this.scale);
    this.sprites = this.planets.map((p, i) =>
      this.styles[i].kind === "blackhole" ? null : buildPlanetSprite(p, this.styles[i], this.scale, this.scars[i])
    );
  }

  // Hyperspace jump to a new level. Resolves once the new level is visible.
  transitionTo(planets, seed, level) {
    return new Promise((resolve) => {
      this.sfx.hyperspace();
      const rand = Math.random;
      this.transition = {
        t: 0,
        dur: reducedMotion ? 0.5 : 1.5,
        swapped: false,
        next: { planets, seed, level },
        resolve,
        streaks: Array.from({ length: 180 }, () => ({ a: rand() * TAU, d: rand(), w: 0.5 + rand() * 1.5 })),
      };
    });
  }

  celebrate(player) {
    this.celebration = { player, t: 0, next: 0 };
  }

  stopCelebrating() {
    this.celebration = null;
  }

  // --- Shots ---

  playShot(sim, { shooter, power }) {
    return new Promise((resolve) => {
      const planet = this.planets.find((p) => p.player === shooter);
      const n = sim.path.length / 2;
      this.playback = { sim, shooter, n, pos: 0, mult: 1, elapsed: 0, resolve, whooshed: false, sparkAcc: 0 };
      this.recoil[shooter] = 1;
      this.turret[shooter] = this.turretTarget[shooter];
      if (planet) {
        const a = (this.turret[shooter] * Math.PI) / 180;
        const tip = cannonTip(planet, this.turret[shooter]);
        const rgb = TEAM[shooter].rgb;
        for (let i = 0; i < 18; i++) {
          const sa = a + (Math.random() - 0.5) * 0.9;
          const sp = 80 + Math.random() * 220;
          this._particle({ x: tip.x, y: tip.y, vx: Math.cos(sa) * sp, vy: Math.sin(sa) * sp, life: 0.35, size: 1.8, color: rgb, kind: "spark", drag: 4 });
        }
        for (let i = 0; i < 5; i++) {
          this._particle({ x: tip.x, y: tip.y, vx: Math.cos(a) * 30 + (Math.random() - 0.5) * 30, vy: Math.sin(a) * 30 + (Math.random() - 0.5) * 30, life: 0.8, size: 7, color: "180,190,220", kind: "smoke", drag: 2 });
        }
      }
      this.sfx.launch(power);
      this.sfx.startHum();
    });
  }

  _stepPlayback(dt) {
    const pb = this.playback;
    const { sim, n } = pb;
    pb.elapsed += dt;

    let target = 1;
    if (pb.elapsed > 2.5) target = 1 + Math.min(4, (pb.elapsed - 2.5) * 1.1);
    if (this.fastForward) target = Math.max(target, 6);
    const stepsLeft = n - 1 - pb.pos;
    const nearMiss = !sim.hit && sim.closest.dist < 30;
    if (sim.hit && stepsLeft < 90) target = 0.3;
    else if (nearMiss && Math.abs(pb.pos - sim.closest.step) < 50) target = 0.35;
    pb.mult += (target - pb.mult) * Math.min(1, dt * (target < pb.mult ? 10 : 3));

    const prev = pb.pos;
    pb.pos = Math.min(n - 1, pb.pos + dt * STEPS_PER_SECOND * pb.mult);

    const p = sim.path;
    const rgb = TEAM[pb.shooter].rgb;
    for (let i = Math.floor(prev) + 1; i <= Math.floor(pb.pos); i++) {
      if (isJump(p[i * 2 - 2], p[i * 2 - 1], p[i * 2], p[i * 2 + 1])) {
        this._ring(p[i * 2 - 2], p[i * 2 - 1], { r: 4, vr: 60, life: 0.5, color: rgb, width: 2 });
        this._ring(p[i * 2], p[i * 2 + 1], { r: 30, vr: -50, life: 0.5, color: rgb, width: 2 });
        this.sfx.warp();
      }
    }

    if (!sim.hit && !pb.whooshed && sim.closest.dist < 45 && pb.pos >= sim.closest.step) {
      pb.whooshed = true;
      this.sfx.whoosh();
    }

    const { x, y } = this._missilePos();
    pb.sparkAcc += dt * 60;
    while (pb.sparkAcc >= 1) {
      pb.sparkAcc -= 1;
      this._particle({ x, y, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40, life: 0.45, size: 1.3, color: rgb, kind: "spark", drag: 2 });
    }
    this.sfx.setHum(pathSpeed(p, Math.floor(pb.pos)));

    if (pb.pos >= n - 1) this._endShot();
  }

  _missilePos() {
    const { sim, pos } = this.playback;
    const p = sim.path;
    const i = Math.floor(pos);
    const f = pos - i;
    const x0 = p[i * 2], y0 = p[i * 2 + 1];
    if (i * 2 + 3 >= p.length) return { x: x0, y: y0 };
    const x1 = p[i * 2 + 2], y1 = p[i * 2 + 3];
    if (isJump(x0, y0, x1, y1)) return { x: x0, y: y0 };
    return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f };
  }

  _endShot() {
    const { sim, shooter, resolve } = this.playback;
    this.playback = null;
    this.sfx.stopHum();

    this.trails.push({ pts: sim.trail, player: shooter, hit: sim.hit });
    if (this.trails.length > 10) this.trails.shift();

    let wait = 800;
    if (sim.impact) {
      const pi = sim.hitPlanetIndex;
      const planet = this.planets[pi];
      if (sim.hit) {
        this._bigExplosion(sim.impact, planet, pi, shooter);
        wait = 2100;
      } else if (planet.kind === "blackhole") {
        this._swallow(planet);
        wait = 1000;
      } else {
        this._explosion(sim.impact, planet, pi, sim.hitWhat === "self");
        wait = 950;
      }
    } else {
      const p = sim.path;
      this._fizzle(p[p.length - 2], p[p.length - 1]);
      wait = 800;
    }

    if (!sim.hit && sim.closest.dist < 70) {
      this.markers.push({ x: sim.closest.x, y: sim.closest.y, dist: Math.round(sim.closest.dist), player: shooter, born: this.time });
      if (sim.closest.dist < 18) this._text(sim.closest.x, sim.closest.y - 24, "SO CLOSE!", TEAM[shooter].light, 16);
    }
    setTimeout(resolve, wait);
  }

  // --- FX ---

  _particle(p) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    p.max = p.life;
    p.rot = Math.random() * TAU;
    p.vr = (Math.random() - 0.5) * 10;
    this.particles.push(p);
  }

  _ring(x, y, { r = 5, vr = 200, life = 0.6, color = "255,255,255", width = 3 }) {
    this.rings.push({ x, y, r, vr, life, max: life, color, width });
  }

  _text(x, y, text, color, size = 14) {
    this.texts.push({ x, y, text, color, size, life: 1.6, max: 1.6 });
  }

  _shake(a) {
    this.shakeAmp = Math.max(this.shakeAmp, reducedMotion ? a * 0.15 : a);
  }

  _flash(a, rgb = "255,255,255") {
    this.flash = Math.max(this.flash, reducedMotion ? a * 0.3 : a);
    this.flashRgb = rgb;
  }

  _burst(x, y, n, opts) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const sp = opts.speed * (0.25 + Math.random() * 0.9);
      const col = Array.isArray(opts.color) ? opts.color[Math.floor(Math.random() * opts.color.length)] : opts.color;
      this._particle({
        x, y,
        vx: Math.cos(a) * sp + (opts.vx || 0),
        vy: Math.sin(a) * sp + (opts.vy || 0),
        life: opts.life * (0.6 + Math.random() * 0.8),
        size: opts.size * (0.6 + Math.random() * 0.8),
        color: col,
        kind: opts.kind,
        drag: opts.drag ?? 1.5,
      });
    }
  }

  _debrisColors(pi) {
    const s = this.styles[pi];
    if (s.kind === "home") return s.player === 1 ? ["90,160,230", "60,120,90", "200,230,255"] : ["230,120,80", "160,70,40", "255,200,160"];
    if (s.hue === undefined) return ["150,150,150"];
    return [hslRgb(s.hue, s.sat, s.light), hslRgb(s.hue, s.sat, s.light - 18), hslRgb(s.hue, s.sat, s.light + 15)];
  }

  _addScar(planet, pi, impact) {
    if (!this.sprites[pi]) return;
    this.scars[pi].push(Math.atan2(impact.y - planet.y, impact.x - planet.x));
    this.sprites[pi] = buildPlanetSprite(planet, this.styles[pi], this.scale, this.scars[pi]);
  }

  _explosion(impact, planet, pi, self) {
    const { x, y } = impact;
    const nx = (x - planet.x) / planet.radius;
    const ny = (y - planet.y) / planet.radius;
    this._burst(x, y, 55, { speed: 260, life: 0.7, size: 1.8, color: ["255,220,140", "255,160,60", "255,255,230"], kind: "spark", vx: nx * 90, vy: ny * 90 });
    this._burst(x, y, 16, { speed: 140, life: 1.3, size: 2.6, color: this._debrisColors(pi), kind: "debris", vx: nx * 70, vy: ny * 70, drag: 1.2 });
    this._burst(x, y, 7, { speed: 40, life: 1.4, size: 10, color: "120,110,110", kind: "smoke", drag: 1.5 });
    this._ring(x, y, { r: 4, vr: 170, life: 0.5, color: "255,210,150", width: 2.5 });
    this._shake(self ? 10 : 7);
    this._flash(0.12, "255,200,150");
    this._addScar(planet, pi, impact);
    this.sfx.boom(self ? 1.3 : 1);
    if (self) this._text(planet.x, planet.y - planet.radius - 30, "FRIENDLY FIRE", "#ffd27a", 14);
  }

  _swallow(bh) {
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * TAU;
      const d = bh.radius * (3 + Math.random() * 4);
      this._particle({ x: bh.x + Math.cos(a) * d, y: bh.y + Math.sin(a) * d, vx: -Math.cos(a) * d * 2 + Math.sin(a) * 120, vy: -Math.sin(a) * d * 2 - Math.cos(a) * 120, life: 0.55, size: 1.6, color: i % 2 ? "255,190,120" : "190,140,255", kind: "spark", drag: 0 });
    }
    this._ring(bh.x, bh.y, { r: bh.radius * 6, vr: -bh.radius * 10, life: 0.5, color: "200,150,255", width: 2 });
    this._flash(0.1, "160,110,255");
    this._shake(4);
    this.sfx.fizzle();
    this._text(bh.x, bh.y - bh.radius * 3 - 10, "SWALLOWED", "#c9a6ff", 13);
  }

  _fizzle(x, y) {
    this._burst(x, y, 16, { speed: 60, life: 0.7, size: 1.4, color: "200,210,255", kind: "spark" });
    this._ring(x, y, { r: 2, vr: 40, life: 0.6, color: "200,210,255", width: 1.2 });
    this.sfx.fizzle();
    this._text(x, y - 18, "LOST IN SPACE", "rgba(200,210,255,0.8)", 12);
  }

  _bigExplosion(impact, planet, pi, shooter) {
    const { x, y } = impact;
    const rgb = TEAM[shooter].rgb;
    this._burst(x, y, 170, { speed: 420, life: 1.0, size: 2.2, color: ["255,255,230", "255,210,120", "255,140,60", rgb], kind: "spark" });
    this._burst(x, y, 12, { speed: 60, life: 1.8, size: 14, color: "110,100,110", kind: "smoke" });
    this._ring(x, y, { r: 6, vr: 520, life: 0.6, color: "255,255,255", width: 4 });
    this._ring(x, y, { r: 4, vr: 260, life: 0.9, color: rgb, width: 3 });
    this._shake(20);
    this._flash(0.75);
    this._addScar(planet, pi, impact);
    this.sfx.bigHit();

    setTimeout(() => {
      if (this.dead || this.planets[pi] !== planet) return;
      this.destroyed.add(pi);
      const cols = this._debrisColors(pi);
      this._burst(planet.x, planet.y, 70, { speed: 300, life: 2.2, size: 3.4, color: cols, kind: "debris", drag: 0.7 });
      this._burst(planet.x, planet.y, 120, { speed: 520, life: 1.1, size: 2, color: ["255,240,200", "255,170,80", rgb], kind: "spark" });
      this._burst(planet.x, planet.y, 16, { speed: 90, life: 2.2, size: 18, color: "120,90,90", kind: "smoke", drag: 1 });
      this._ring(planet.x, planet.y, { r: planet.radius, vr: 700, life: 0.8, color: rgb, width: 5 });
      this._shake(16);
      this._flash(0.4, rgb);
      this._text(planet.x, planet.y - planet.radius - 26, "DIRECT HIT", TEAM[shooter].light, 22);
      this.sfx.boom(2);
    }, 420);
  }

  // --- Frame loop ---

  _frame(now) {
    this.raf = null;
    if (this.dead) return;
    if (document.hidden) return;
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;

    if (this.playback) this._stepPlayback(dt);
    this._updateFx(dt);
    this._draw(dt);

    this.raf = requestAnimationFrame(this._frame);
  }

  _updateFx(dt) {
    for (const k of [1, 2]) {
      this.turret[k] = angleLerp(this.turret[k], this.turretTarget[k], Math.min(1, dt * 14));
      this.recoil[k] = Math.max(0, this.recoil[k] - dt * 4);
    }

    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) { ps.splice(i, 1); continue; }
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      r.r = Math.max(0, r.r + r.vr * dt);
      if (r.life <= 0) this.rings.splice(i, 1);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      t.y -= dt * 18;
      if (t.life <= 0) this.texts.splice(i, 1);
    }
    this.shakeAmp *= Math.exp(-dt * 7);
    this.flash = Math.max(0, this.flash - dt * 2.2);

    const tr = this.transition;
    if (tr) {
      tr.t += dt;
      if (!tr.swapped && tr.t >= tr.dur * 0.45) {
        tr.swapped = true;
        this.particles = [];
        this.rings = [];
        this.texts = [];
        this.setLevel(tr.next.planets, tr.next.seed, tr.next.level);
      }
      if (tr.t >= tr.dur) {
        this.transition = null;
        tr.resolve();
      }
    }

    const c = this.celebration;
    if (c) {
      c.t += dt;
      c.next -= dt;
      if (c.next <= 0 && c.t < 6) {
        c.next = 0.25 + Math.random() * 0.35;
        const x = 150 + Math.random() * (CANVAS_W - 300);
        const y = 120 + Math.random() * (CANVAS_H - 320);
        this._burst(x, y, 70, { speed: 260, life: 1.4, size: 2, color: [TEAM[c.player].rgb, "255,255,255", "255,220,140"], kind: "spark", drag: 1.2 });
        this._ring(x, y, { r: 2, vr: 160, life: 0.7, color: TEAM[c.player].rgb, width: 2 });
        this.sfx.boom(0.2);
      }
    }
  }

  _draw() {
    const ctx = this.ctx;
    const s = this.scale;
    const t = this.time;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#020207";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const sx = (Math.random() - 0.5) * 2 * this.shakeAmp;
    const sy = (Math.random() - 0.5) * 2 * this.shakeAmp;
    if (this.bg) ctx.drawImage(this.bg, sx * s, sy * s);
    ctx.setTransform(s, 0, 0, s, sx * s, sy * s);

    this._drawTwinkles(ctx, t);
    this._drawEdges(ctx);
    this._drawWells(ctx, t);
    this._drawTrails(ctx);
    this._drawMarkers(ctx);
    this._drawPlanets(ctx, t);
    this._drawTurrets(ctx, t);
    if (this.aim && !this.playback && !this.transition) this._drawAim(ctx, t);
    if (this.playback) this._drawMissile(ctx);
    this._drawFx(ctx);
    this._drawTexts(ctx);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.flash > 0.01) {
      ctx.fillStyle = `rgba(${this.flashRgb},${Math.min(0.85, this.flash)})`;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    if (this.transition) this._drawTransition(ctx);
  }

  _drawTwinkles(ctx, t) {
    for (const st of this.twinkles) {
      const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * st.speed + st.phase));
      ctx.fillStyle = st.hue ? `hsla(${st.hue},60%,85%,${a})` : `rgba(255,255,255,${a})`;
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r, 0, TAU);
      ctx.fill();
    }
  }

  _drawEdges(ctx) {
    ctx.strokeStyle = "rgba(120,170,255,0.08)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 9]);
    ctx.strokeRect(1.5, 1.5, CANVAS_W - 3, CANVAS_H - 3);
    ctx.setLineDash([]);
  }

  _drawWells(ctx, t) {
    this.planets.forEach((p, i) => {
      if (this.destroyed.has(i)) return;
      const rgb = p.player ? TEAM[p.player].rgb : p.kind === "blackhole" ? "180,130,255" : "200,190,160";
      const extent = 16 + Math.sqrt(p.mass) * 2.3;
      const strength = Math.min(1, 0.35 + p.mass / 600);
      ctx.lineWidth = 1;
      for (let k = 0; k < 3; k++) {
        const phase = (t * 0.22 + k / 3) % 1;
        const r = p.radius + 4 + extent * (1 - phase);
        const a = 0.12 * Math.sin(phase * Math.PI) * strength;
        ctx.strokeStyle = `rgba(${rgb},${a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, TAU);
        ctx.stroke();
      }
    });
  }

  _drawTrails(ctx) {
    const n = this.trails.length;
    const lastIdx = {};
    this.trails.forEach((tr, i) => { lastIdx[tr.player] = i; });
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    this.trails.forEach((tr, i) => {
      const pts = tr.pts;
      if (pts.length < 2) return;
      const recent = lastIdx[tr.player] === i;
      const age = (n - 1 - i) / Math.max(1, n);
      const a = recent ? 0.45 : 0.08 + 0.14 * (1 - age);
      ctx.strokeStyle = `rgba(${TEAM[tr.player].rgb},${a})`;
      ctx.lineWidth = recent ? 1.6 : 1.1;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let j = 1; j < pts.length; j++) {
        const p0 = pts[j - 1], p1 = pts[j];
        if (isJump(p0.x, p0.y, p1.x, p1.y)) ctx.moveTo(p1.x, p1.y);
        else ctx.lineTo(p1.x, p1.y);
      }
      ctx.stroke();
    });
    ctx.globalCompositeOperation = "source-over";
  }

  _drawMarkers(ctx) {
    ctx.font = "600 10px 'JetBrains Mono', monospace";
    ctx.textAlign = "left";
    for (const m of this.markers) {
      const col = TEAM[m.player].light;
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(m.x - 6, m.y - 6); ctx.lineTo(m.x + 6, m.y + 6);
      ctx.moveTo(m.x + 6, m.y - 6); ctx.lineTo(m.x - 6, m.y + 6);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.fillText(`${m.dist}px`, m.x + 9, m.y - 6);
      ctx.globalAlpha = 1;
    }
  }

  _drawPlanets(ctx, t) {
    this.planets.forEach((p, i) => {
      if (this.destroyed.has(i)) return;
      const st = this.styles[i];
      if (st.kind === "blackhole") {
        drawBlackHole(ctx, p, st, t);
      } else {
        const sp = this.sprites[i];
        if (sp) ctx.drawImage(sp.canvas, p.x - sp.half, p.y - sp.half, sp.half * 2, sp.half * 2);
      }
      if (!p.player) {
        ctx.fillStyle = "rgba(255,255,255,0.22)";
        ctx.font = "9px 'JetBrains Mono', monospace";
        ctx.textAlign = "center";
        const below = st.kind === "blackhole" ? p.radius * 3.2 + 8 : p.radius + 15;
        ctx.fillText(`m${Math.round(p.mass)}`, p.x, p.y + below);
      }
    });
  }

  _drawTurrets(ctx, t) {
    for (const pn of [1, 2]) {
      const pi = this.planets.findIndex((pp) => pp.player === pn);
      if (pi < 0 || this.destroyed.has(pi)) continue;
      const pl = this.planets[pi];
      const team = TEAM[pn];
      const active = pn === this.turn && !this.playback && !this.transition;

      if (active) {
        ctx.save();
        ctx.translate(pl.x, pl.y);
        ctx.rotate(t * 0.6);
        ctx.strokeStyle = `rgba(${team.rgb},${0.35 + 0.2 * Math.sin(t * 4)})`;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 8]);
        ctx.beginPath();
        ctx.arc(0, 0, pl.radius + 12, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      const ang = this.turret[pn];
      const a = (ang * Math.PI) / 180;
      const rec = this.recoil[pn] * 5;
      const ca = Math.cos(a), sa = Math.sin(a);
      const bx = pl.x + ca * (pl.radius + 2);
      const by = pl.y + sa * (pl.radius + 2);
      ctx.fillStyle = team.main;
      ctx.beginPath();
      ctx.arc(bx, by, 5.5, 0, TAU);
      ctx.fill();
      const b0 = pl.radius + 5 - rec;
      const b1 = pl.radius + 22 - rec;
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 5.5;
      ctx.beginPath();
      ctx.moveTo(pl.x + ca * b0, pl.y + sa * b0);
      ctx.lineTo(pl.x + ca * b1, pl.y + sa * b1);
      ctx.stroke();
      ctx.strokeStyle = team.light;
      ctx.lineWidth = 3.2;
      ctx.stroke();
      if (active) {
        ctx.globalCompositeOperation = "lighter";
        const tip = { x: pl.x + ca * b1, y: pl.y + sa * b1 };
        const g = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 9);
        g.addColorStop(0, `rgba(${team.rgb},${0.5 + 0.3 * Math.sin(t * 6)})`);
        g.addColorStop(1, `rgba(${team.rgb},0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(tip.x, tip.y, 9, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = "source-over";
      }

      // Name tag
      const label = this.labels[pn];
      if (!label) continue;
      ctx.font = "700 10px 'JetBrains Mono', monospace";
      const tw = ctx.measureText(label).width + 12;
      const ly = pl.y - pl.radius - 48;
      ctx.fillStyle = active ? team.main : "rgba(10,12,24,0.75)";
      ctx.strokeStyle = team.main;
      ctx.lineWidth = 1;
      roundRect(ctx, pl.x - tw / 2, ly - 8, tw, 16, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = active ? "#04060c" : team.light;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, pl.x, ly + 0.5);
      ctx.textBaseline = "alphabetic";
    }
  }

  _drawAim(ctx, t) {
    const { player, angle, power, preview } = this.aim;
    const pl = this.planets.find((p) => p.player === player);
    if (!pl) return;
    const team = TEAM[player];
    const dim = this.idle ? 0.6 : 1;

    // Power gauge around the planet
    const gr = pl.radius + 32;
    const frac = (power - MIN_POWER) / (MAX_POWER - MIN_POWER);
    ctx.lineCap = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = `rgba(255,255,255,${0.07 * dim})`;
    ctx.beginPath(); ctx.arc(pl.x, pl.y, gr, 0, TAU); ctx.stroke();
    ctx.strokeStyle = `rgba(${team.rgb},${0.65 * dim})`;
    ctx.beginPath(); ctx.arc(pl.x, pl.y, gr, -Math.PI / 2, -Math.PI / 2 + TAU * (0.04 + frac * 0.96)); ctx.stroke();

    // Launch vector: length tracks power
    const a = (angle * Math.PI) / 180;
    const tip = cannonTip(pl, angle);
    const len = 26 + power * 1.5;
    const ex = tip.x + Math.cos(a) * len;
    const ey = tip.y + Math.sin(a) * len;
    const g = ctx.createLinearGradient(tip.x, tip.y, ex, ey);
    g.addColorStop(0, `rgba(${team.rgb},${0.9 * dim})`);
    g.addColorStop(1, `rgba(${team.rgb},${0.15 * dim})`);
    ctx.strokeStyle = g;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 6]);
    ctx.lineDashOffset = -t * 30;
    ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    ctx.fillStyle = `rgba(${team.rgb},${0.8 * dim})`;
    ctx.beginPath();
    ctx.moveTo(ex + Math.cos(a) * 8, ey + Math.sin(a) * 8);
    ctx.lineTo(ex + Math.cos(a + 2.5) * 7, ey + Math.sin(a + 2.5) * 7);
    ctx.lineTo(ex + Math.cos(a - 2.5) * 7, ey + Math.sin(a - 2.5) * 7);
    ctx.fill();

    // Optional short trajectory preview (aim assist)
    if (preview && preview.length > 4) {
      for (let i = 2; i < preview.length / 2; i += 5) {
        const k = 1 - (i * 2) / preview.length;
        ctx.fillStyle = `rgba(255,255,255,${0.55 * k * dim})`;
        ctx.beginPath(); ctx.arc(preview[i * 2], preview[i * 2 + 1], 1.4, 0, TAU); ctx.fill();
      }
    }

    ctx.fillStyle = `rgba(255,255,255,${0.55 * dim})`;
    ctx.font = "600 11px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${angle}°  ${power}%`, pl.x, pl.y + pl.radius + 50);
  }

  _drawMissile(ctx) {
    const { sim, pos, shooter } = this.playback;
    const p = sim.path;
    const rgb = TEAM[shooter].rgb;
    const i = Math.floor(pos);

    // Faint full path so far
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = `rgba(${rgb},0.28)`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    for (let j = 1; j <= i; j++) {
      if (isJump(p[j * 2 - 2], p[j * 2 - 1], p[j * 2], p[j * 2 + 1])) ctx.moveTo(p[j * 2], p[j * 2 + 1]);
      else ctx.lineTo(p[j * 2], p[j * 2 + 1]);
    }
    const head = this._missilePos();
    ctx.lineTo(head.x, head.y);
    ctx.stroke();

    // Comet tail: tapered, brightening toward the head
    const TAIL = 70;
    const start = Math.max(0, i - TAIL);
    for (let j = start + 1; j <= i; j++) {
      const x0 = p[j * 2 - 2], y0 = p[j * 2 - 1], x1 = p[j * 2], y1 = p[j * 2 + 1];
      if (isJump(x0, y0, x1, y1)) continue;
      const k = (j - start) / TAIL;
      ctx.strokeStyle = `rgba(${rgb},${0.7 * k})`;
      ctx.lineWidth = 0.6 + 4 * k;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }

    const g = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 16);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(0.2, `rgba(${rgb},0.7)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(head.x, head.y, 16, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(head.x, head.y, 2.4, 0, TAU); ctx.fill();
  }

  _drawFx(ctx) {
    for (const p of this.particles) {
      const k = p.life / p.max;
      if (p.kind === "spark") {
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = `rgba(${p.color},${k})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * k), 0, TAU); ctx.fill();
      } else if (p.kind === "smoke") {
        ctx.globalCompositeOperation = "source-over";
        const r = p.size * (1 + (1 - k) * 2.5);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, `rgba(${p.color},${0.22 * k})`);
        g.addColorStop(1, `rgba(${p.color},0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = color(p.color, Math.min(1, k * 2));
        const sz = p.size;
        ctx.beginPath();
        ctx.moveTo(-sz, -sz * 0.6); ctx.lineTo(sz * 0.9, -sz * 0.3); ctx.lineTo(sz * 0.4, sz * 0.8); ctx.lineTo(-sz * 0.7, sz * 0.5);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.globalCompositeOperation = "lighter";
    for (const r of this.rings) {
      const k = r.life / r.max;
      ctx.strokeStyle = `rgba(${r.color},${k * 0.8})`;
      ctx.lineWidth = r.width * k + 0.3;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, TAU); ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  _drawTexts(ctx) {
    ctx.textAlign = "center";
    for (const tx of this.texts) {
      const k = tx.life / tx.max;
      const pop = k > 0.85 ? 1 + (k - 0.85) * 2 : 1;
      ctx.globalAlpha = Math.min(1, k * 2);
      ctx.font = `800 ${Math.round(tx.size * pop)}px Orbitron, 'JetBrains Mono', sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.strokeText(tx.text, tx.x, tx.y);
      ctx.fillStyle = tx.color;
      ctx.fillText(tx.text, tx.x, tx.y);
    }
    ctx.globalAlpha = 1;
  }

  _drawTransition(ctx) {
    const tr = this.transition;
    const p = tr.t / tr.dur;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dark = p < 0.45 ? p / 0.45 : 1 - (p - 0.45) / 0.55;
    ctx.fillStyle = `rgba(2,2,8,${0.9 * dark})`;
    ctx.fillRect(0, 0, W, H);
    if (reducedMotion) return;

    const k = Math.sin(Math.min(1, p) * Math.PI);
    const cx = W / 2, cy = H / 2;
    const R = Math.hypot(W, H) / 2;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (const st of tr.streaks) {
      const d = ((st.d + p * 1.6) % 1) * R;
      const L = 8 + k * 320 * (d / R) * this.scale;
      const ca = Math.cos(st.a), sa = Math.sin(st.a);
      ctx.strokeStyle = `rgba(190,215,255,${0.75 * k})`;
      ctx.lineWidth = st.w * this.scale;
      ctx.beginPath();
      ctx.moveTo(cx + ca * d, cy + sa * d);
      ctx.lineTo(cx + ca * (d + L), cy + sa * (d + L));
      ctx.stroke();
    }
    const f = Math.max(0, 1 - Math.abs(p - 0.45) * 8);
    if (f > 0) {
      ctx.fillStyle = `rgba(220,235,255,${0.5 * f})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalCompositeOperation = "source-over";
  }
}

function color(c, a) {
  return `rgba(${c},${a})`;
}

function hslRgb(h, s, l) {
  s /= 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `${Math.round(f(0) * 255)},${Math.round(f(8) * 255)},${Math.round(f(4) * 255)}`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
