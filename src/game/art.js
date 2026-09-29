// Procedural art: backgrounds, planet sprites, black holes.
// Everything expensive is drawn once per level into offscreen canvases; the
// per-frame loop only blits. Purely visual — nothing here affects physics.

import { CANVAS_W, CANVAS_H } from "./constants.js";
import { createRng } from "./levelgen.js";

const TAU = Math.PI * 2;

export const TEAM = {
  1: { main: "#4a9eff", light: "#a8d4ff", rgb: "74,158,255", hue: 212 },
  2: { main: "#ff6b4a", light: "#ffb59f", rgb: "255,107,74", hue: 12 },
};

export function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

const range = (rand, a, b) => a + rand() * (b - a);

// --- Background ---------------------------------------------------------

const NEBULA_PALETTES = [
  [265, 205], [320, 250], [190, 280], [15, 285], [220, 170], [290, 30], [175, 230], [240, 330],
];

export function buildBackground(seed, level, scale) {
  const c = makeCanvas(CANVAS_W * scale, CANVAS_H * scale);
  const x = c.getContext("2d");
  x.scale(scale, scale);
  const rand = createRng((seed ^ 0x9e3779b9) + level * 131);

  const base = x.createRadialGradient(CANVAS_W * 0.5, CANVAS_H * 0.45, 40, CANVAS_W * 0.5, CANVAS_H * 0.5, CANVAS_W * 0.8);
  base.addColorStop(0, "#0c0c20");
  base.addColorStop(1, "#020207");
  x.fillStyle = base;
  x.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Nebula: clusters of soft additive puffs in a per-level palette, so every
  // level feels like a different corner of the galaxy.
  const [h1, h2] = NEBULA_PALETTES[Math.floor(rand() * NEBULA_PALETTES.length)];
  x.globalCompositeOperation = "lighter";
  const clouds = 4 + Math.floor(rand() * 4);
  for (let i = 0; i < clouds; i++) {
    const cx = rand() * CANVAS_W;
    const cy = rand() * CANVAS_H;
    const hue = rand() < 0.6 ? h1 : h2;
    const spread = 70 + rand() * 170;
    const puffs = 7 + Math.floor(rand() * 7);
    for (let j = 0; j < puffs; j++) {
      const px = cx + (rand() - 0.5) * spread * 2.2;
      const py = cy + (rand() - 0.5) * spread * 1.3;
      const pr = 50 + rand() * 190;
      const a = 0.02 + rand() * 0.035;
      const hh = hue + (rand() - 0.5) * 36;
      const rg = x.createRadialGradient(px, py, 0, px, py, pr);
      rg.addColorStop(0, `hsla(${hh}, 75%, 58%, ${a})`);
      rg.addColorStop(0.5, `hsla(${hh}, 70%, 45%, ${a * 0.45})`);
      rg.addColorStop(1, `hsla(${hh}, 70%, 40%, 0)`);
      x.fillStyle = rg;
      x.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    }
  }
  x.globalCompositeOperation = "source-over";

  // Static dust stars
  for (let i = 0; i < 480; i++) {
    const sx = rand() * CANVAS_W;
    const sy = rand() * CANVAS_H;
    const big = rand() > 0.88;
    const size = big ? 0.8 + rand() * 0.7 : 0.35 + rand() * 0.45;
    const b = 0.2 + rand() * 0.6;
    const tint = rand();
    x.fillStyle = tint < 0.12 ? `rgba(170,200,255,${b})` : tint < 0.2 ? `rgba(255,222,185,${b})` : `rgba(255,255,255,${b})`;
    x.beginPath();
    x.arc(sx, sy, size, 0, TAU);
    x.fill();
  }

  // A few bright stars with diffraction spikes
  for (let i = 0; i < 6; i++) {
    const sx = rand() * CANVAS_W;
    const sy = rand() * CANVAS_H;
    const L = 5 + rand() * 11;
    const rg = x.createRadialGradient(sx, sy, 0, sx, sy, L * 0.9);
    rg.addColorStop(0, "rgba(255,255,255,0.95)");
    rg.addColorStop(0.12, "rgba(205,222,255,0.4)");
    rg.addColorStop(1, "rgba(205,222,255,0)");
    x.fillStyle = rg;
    x.beginPath();
    x.arc(sx, sy, L * 0.9, 0, TAU);
    x.fill();
    x.strokeStyle = "rgba(215,228,255,0.28)";
    x.lineWidth = 0.6;
    x.beginPath();
    x.moveTo(sx - L, sy); x.lineTo(sx + L, sy);
    x.moveTo(sx, sy - L); x.lineTo(sx, sy + L);
    x.stroke();
  }

  const v = x.createRadialGradient(CANVAS_W / 2, CANVAS_H / 2, CANVAS_H * 0.45, CANVAS_W / 2, CANVAS_H / 2, CANVAS_W * 0.75);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.4)");
  x.fillStyle = v;
  x.fillRect(0, 0, CANVAS_W, CANVAS_H);
  return c;
}

export function makeTwinkles(seed, count = 70) {
  const rand = createRng(seed ^ 0x1234567);
  return Array.from({ length: count }, () => ({
    x: rand() * CANVAS_W,
    y: rand() * CANVAS_H,
    r: 0.6 + rand() * 1.1,
    speed: 0.6 + rand() * 2.2,
    phase: rand() * TAU,
    hue: rand() < 0.2 ? 210 : rand() < 0.3 ? 35 : 0,
  }));
}

// --- Planet styles ------------------------------------------------------

export function planetStyle(p, seed, level, index) {
  const rand = createRng((seed ^ 0x27d4eb2d) + level * 977 + index * 131);
  const featureSeed = Math.floor(rand() * 4294967296);
  if (p.kind === "blackhole") return { kind: "blackhole", tilt: range(rand, -0.5, 0.5), spin: rand() < 0.5 ? 1 : -1 };
  if (p.player) {
    const t = TEAM[p.player];
    return { kind: "home", player: p.player, hue: t.hue, atmo: t.rgb, featureSeed };
  }
  let kind;
  if (p.radius > 50 && rand() < 0.65) kind = "gas";
  else {
    const r = rand();
    kind = r < 0.26 ? "rocky" : r < 0.46 ? "desert" : r < 0.64 ? "ice" : r < 0.82 ? "ocean" : "lava";
  }
  const s = { kind, featureSeed };
  switch (kind) {
    case "gas": {
      const fam = [[32, 55], [200, 45], [285, 35], [350, 40], [48, 60]][Math.floor(rand() * 5)];
      s.hue = fam[0] + range(rand, -8, 8);
      s.sat = fam[1];
      s.light = range(rand, 48, 60);
      s.atmo = `hsl(${s.hue},60%,70%)`;
      s.ring = rand() < 0.55;
      s.tilt = range(rand, -0.35, 0.35);
      break;
    }
    case "rocky": s.hue = range(rand, 18, 40); s.sat = range(rand, 6, 18); s.light = range(rand, 38, 50); s.atmo = "hsl(30,20%,70%)"; break;
    case "desert": s.hue = range(rand, 25, 40); s.sat = range(rand, 45, 62); s.light = range(rand, 48, 58); s.atmo = "hsl(35,70%,70%)"; break;
    case "ice": s.hue = range(rand, 185, 210); s.sat = range(rand, 30, 50); s.light = range(rand, 70, 80); s.atmo = "hsl(195,80%,80%)"; break;
    case "ocean": s.hue = range(rand, 198, 215); s.sat = range(rand, 55, 70); s.light = range(rand, 34, 44); s.atmo = "hsl(200,90%,70%)"; break;
    case "lava": s.hue = range(rand, 6, 16); s.sat = range(rand, 30, 45); s.light = range(rand, 12, 18); s.atmo = "hsl(20,90%,55%)"; break;
  }
  return s;
}

const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;

function blob(x, rand, cx, cy, size, color, n = 7) {
  x.fillStyle = color;
  for (let i = 0; i < n; i++) {
    x.beginPath();
    x.arc(cx + (rand() - 0.5) * size * 1.4, cy + (rand() - 0.5) * size, size * (0.3 + rand() * 0.45), 0, TAU);
    x.fill();
  }
}

function crackLines(x, rand, r, count, color, width, glow) {
  x.strokeStyle = color;
  x.lineWidth = width;
  x.lineCap = "round";
  if (glow) { x.shadowColor = glow; x.shadowBlur = 6; }
  for (let i = 0; i < count; i++) {
    let px = (rand() - 0.5) * r * 1.8;
    let py = (rand() - 0.5) * r * 1.8;
    let a = rand() * TAU;
    x.beginPath();
    x.moveTo(px, py);
    const segs = 3 + Math.floor(rand() * 4);
    for (let j = 0; j < segs; j++) {
      a += (rand() - 0.5) * 1.4;
      const L = r * (0.12 + rand() * 0.22);
      px += Math.cos(a) * L;
      py += Math.sin(a) * L;
      x.lineTo(px, py);
    }
    x.stroke();
  }
  x.shadowBlur = 0;
}

function drawSurface(x, s, r) {
  const rand = s.rand;
  switch (s.kind) {
    case "gas": {
      let y = -r;
      while (y < r) {
        const h = r * range(rand, 0.05, 0.16);
        const dl = range(rand, -10, 10);
        x.fillStyle = hsl(s.hue + range(rand, -6, 6), s.sat, s.light + dl, 0.85);
        x.beginPath();
        x.moveTo(-r, y);
        for (let xx = -r; xx <= r; xx += r * 0.2) x.lineTo(xx, y + Math.sin(xx * 0.15 + y) * r * 0.02);
        x.lineTo(r, y + h);
        x.lineTo(-r, y + h);
        x.fill();
        y += h;
      }
      // Storm
      const sx = range(rand, -0.4, 0.4) * r;
      const sy = range(rand, -0.3, 0.5) * r;
      x.fillStyle = hsl(s.hue - 15, s.sat + 15, s.light - 12, 0.85);
      x.beginPath(); x.ellipse(sx, sy, r * 0.2, r * 0.11, 0, 0, TAU); x.fill();
      x.fillStyle = hsl(s.hue - 10, s.sat + 10, s.light + 8, 0.6);
      x.beginPath(); x.ellipse(sx, sy, r * 0.11, r * 0.05, 0, 0, TAU); x.fill();
      break;
    }
    case "rocky":
    case "desert": {
      for (let i = 0; i < 26; i++) {
        const bx = (rand() - 0.5) * r * 2;
        const by = (rand() - 0.5) * r * 2;
        const br = r * range(rand, 0.15, 0.45);
        const g = x.createRadialGradient(bx, by, 0, bx, by, br);
        const dl = rand() < 0.5 ? -10 : 8;
        g.addColorStop(0, hsl(s.hue, s.sat, s.light + dl, 0.35));
        g.addColorStop(1, hsl(s.hue, s.sat, s.light + dl, 0));
        x.fillStyle = g;
        x.fillRect(bx - br, by - br, br * 2, br * 2);
      }
      if (s.kind === "desert") {
        x.strokeStyle = hsl(s.hue, s.sat, s.light + 14, 0.25);
        x.lineWidth = r * 0.03;
        for (let i = 0; i < 9; i++) {
          x.beginPath();
          x.ellipse((rand() - 0.5) * r, (rand() - 0.5) * r * 1.6, r * range(rand, 0.4, 0.9), r * 0.12, range(rand, -0.3, 0.3), 0, Math.PI);
          x.stroke();
        }
      }
      const craters = s.kind === "rocky" ? 14 : 5;
      for (let i = 0; i < craters; i++) {
        const cr = r * range(rand, 0.05, 0.2);
        const cx = (rand() - 0.5) * r * 1.7;
        const cy = (rand() - 0.5) * r * 1.7;
        x.fillStyle = "rgba(0,0,0,0.22)";
        x.beginPath(); x.arc(cx, cy, cr, 0, TAU); x.fill();
        x.strokeStyle = "rgba(255,255,255,0.14)";
        x.lineWidth = cr * 0.25;
        x.beginPath(); x.arc(cx, cy, cr, 0.1 * Math.PI, 0.9 * Math.PI); x.stroke();
      }
      break;
    }
    case "ice": {
      for (let i = 0; i < 18; i++) {
        blob(x, rand, (rand() - 0.5) * r * 1.8, (rand() - 0.5) * r * 1.8, r * 0.25, hsl(s.hue, s.sat - 10, s.light + range(rand, -12, 10), 0.18), 4);
      }
      crackLines(x, rand, r, 10, hsl(s.hue + 10, 70, 88, 0.45), r * 0.025);
      x.fillStyle = "rgba(255,255,255,0.55)";
      x.beginPath(); x.ellipse(0, -r * 0.92, r * 0.7, r * 0.22, 0, 0, TAU); x.fill();
      x.beginPath(); x.ellipse(0, r * 0.95, r * 0.55, r * 0.16, 0, 0, TAU); x.fill();
      break;
    }
    case "ocean": {
      const land = range(rand, 90, 130);
      for (let i = 0; i < 6; i++) {
        blob(x, rand, (rand() - 0.5) * r * 1.6, (rand() - 0.5) * r * 1.5, r * range(rand, 0.2, 0.42), hsl(land, 35, 32 + rand() * 10, 0.9), 8);
      }
      x.strokeStyle = "rgba(255,255,255,0.28)";
      x.lineCap = "round";
      for (let i = 0; i < 9; i++) {
        x.lineWidth = r * range(rand, 0.04, 0.09);
        const cy = (rand() - 0.5) * r * 1.8;
        const cx = (rand() - 0.5) * r * 1.6;
        x.beginPath(); x.moveTo(cx, cy); x.quadraticCurveTo(cx + r * 0.3, cy - r * 0.1, cx + r * 0.6, cy + r * 0.02); x.stroke();
      }
      break;
    }
    case "lava": {
      for (let i = 0; i < 16; i++) {
        blob(x, rand, (rand() - 0.5) * r * 1.8, (rand() - 0.5) * r * 1.8, r * 0.3, hsl(s.hue, s.sat, s.light + range(rand, -6, 6), 0.4), 4);
      }
      crackLines(x, rand, r, 12, "rgba(255,170,60,0.9)", r * 0.035, "rgba(255,90,20,1)");
      for (let i = 0; i < 5; i++) {
        const hx = (rand() - 0.5) * r * 1.5;
        const hy = (rand() - 0.5) * r * 1.5;
        const g = x.createRadialGradient(hx, hy, 0, hx, hy, r * 0.25);
        g.addColorStop(0, "rgba(255,150,40,0.55)");
        g.addColorStop(1, "rgba(255,80,20,0)");
        x.fillStyle = g;
        x.fillRect(hx - r * 0.25, hy - r * 0.25, r * 0.5, r * 0.5);
      }
      break;
    }
    case "home": {
      if (s.player === 1) {
        const land = 150;
        for (let i = 0; i < 5; i++) blob(x, rand, (rand() - 0.5) * r * 1.6, (rand() - 0.5) * r * 1.5, r * 0.36, hsl(land, 40, 36, 0.9), 7);
        x.strokeStyle = "rgba(255,255,255,0.35)";
        x.lineCap = "round";
        for (let i = 0; i < 6; i++) {
          x.lineWidth = r * 0.07;
          const cy = (rand() - 0.5) * r * 1.8;
          const cx = (rand() - 0.5) * r * 1.6;
          x.beginPath(); x.moveTo(cx, cy); x.quadraticCurveTo(cx + r * 0.3, cy - r * 0.12, cx + r * 0.7, cy); x.stroke();
        }
      } else {
        for (let i = 0; i < 14; i++) blob(x, rand, (rand() - 0.5) * r * 1.8, (rand() - 0.5) * r * 1.8, r * 0.3, hsl(s.hue + range(rand, -8, 18), 60, range(rand, 30, 50), 0.4), 4);
        x.strokeStyle = hsl(30, 70, 70, 0.28);
        x.lineWidth = r * 0.05;
        for (let i = 0; i < 6; i++) {
          x.beginPath();
          x.ellipse((rand() - 0.5) * r, (rand() - 0.5) * r * 1.6, r * range(rand, 0.4, 0.8), r * 0.14, range(rand, -0.3, 0.3), 0, Math.PI);
          x.stroke();
        }
      }
      break;
    }
  }
}

function baseColors(s) {
  if (s.kind === "home") {
    return s.player === 1
      ? [hsl(205, 75, 62), hsl(212, 72, 44), hsl(222, 70, 22)]
      : [hsl(22, 85, 64), hsl(12, 75, 46), hsl(5, 70, 22)];
  }
  return [hsl(s.hue, s.sat, s.light + 14), hsl(s.hue, s.sat, s.light), hsl(s.hue, s.sat, s.light - 22)];
}

function drawRing(x, s, r, half) {
  x.save();
  x.rotate(s.tilt);
  x.beginPath();
  if (half === "back") x.rect(-r * 2.2, -r * 2.2, r * 4.4, r * 2.2);
  else x.rect(-r * 2.2, 0, r * 4.4, r * 2.2);
  x.clip();
  for (let i = 0; i < 7; i++) {
    const k = 1.3 + i * 0.09;
    x.strokeStyle = hsl(s.hue + i * 3, s.sat - 10, s.light + 10 - i * 2, half === "back" ? 0.25 : 0.5);
    x.lineWidth = r * 0.06;
    x.beginPath();
    x.ellipse(0, 0, r * k, r * k * 0.28, 0, 0, TAU);
    x.stroke();
  }
  x.restore();
}

// Draws a planet into its own canvas. `scars` are impact points (angles in
// radians from the planet's center) accumulated during the level.
export function buildPlanetSprite(p, s, scale, scars = []) {
  const r = p.radius;
  const pad = s.kind === "gas" && s.ring ? r * 1.25 : r * 0.55;
  const half = r + pad;
  const c = makeCanvas(half * 2 * scale, half * 2 * scale);
  const x = c.getContext("2d");
  x.scale(scale, scale);
  x.translate(half, half);

  // Fresh stream per build so rebuilding (resize, new scar) draws identical features.
  s.rand = createRng(s.featureSeed);

  const atmo = s.kind === "home" ? `rgba(${s.atmo},` : null;
  const ag = x.createRadialGradient(0, 0, r * 0.85, 0, 0, r + pad * (s.kind === "home" ? 0.9 : 0.6));
  if (atmo) {
    ag.addColorStop(0, `${atmo}0.55)`);
    ag.addColorStop(0.35, `${atmo}0.18)`);
    ag.addColorStop(1, `${atmo}0)`);
  } else {
    ag.addColorStop(0, s.atmo.replace("hsl", "hsla").replace(")", ",0.28)"));
    ag.addColorStop(1, s.atmo.replace("hsl", "hsla").replace(")", ",0)"));
  }
  x.fillStyle = ag;
  x.beginPath(); x.arc(0, 0, half, 0, TAU); x.fill();

  if (s.kind === "gas" && s.ring) drawRing(x, s, r, "back");

  x.save();
  x.beginPath(); x.arc(0, 0, r, 0, TAU); x.clip();
  const [lite, mid, dark] = baseColors(s);
  const bg = x.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r * 1.1);
  bg.addColorStop(0, lite);
  bg.addColorStop(0.6, mid);
  bg.addColorStop(1, dark);
  x.fillStyle = bg;
  x.fillRect(-r, -r, r * 2, r * 2);

  drawSurface(x, s, r);

  for (const a of scars) {
    const cx = Math.cos(a) * r * 0.86;
    const cy = Math.sin(a) * r * 0.86;
    const cr = Math.max(4, r * 0.24);
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, cr);
    g.addColorStop(0, "rgba(255,140,50,0.75)");
    g.addColorStop(0.3, "rgba(60,20,10,0.8)");
    g.addColorStop(0.75, "rgba(0,0,0,0.45)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g;
    x.beginPath(); x.arc(cx, cy, cr, 0, TAU); x.fill();
  }

  // Day/night terminator, lit from the upper left
  const sh = x.createRadialGradient(-r * 0.45, -r * 0.45, r * 0.05, -r * 0.15, -r * 0.15, r * 1.45);
  sh.addColorStop(0, "rgba(255,255,255,0.16)");
  sh.addColorStop(0.35, "rgba(0,0,0,0)");
  sh.addColorStop(0.72, "rgba(0,0,6,0.55)");
  sh.addColorStop(1, "rgba(0,0,10,0.9)");
  x.fillStyle = sh;
  x.fillRect(-r, -r, r * 2, r * 2);

  // City lights on the night side of homeworlds
  if (s.kind === "home") {
    const lights = createRng(p.player * 7777);
    for (let i = 0; i < 70; i++) {
      const a = lights() * TAU;
      const d = Math.sqrt(lights()) * r * 0.92;
      const lx = Math.cos(a) * d;
      const ly = Math.sin(a) * d;
      if (lx + ly < r * 0.35) continue;
      x.fillStyle = `rgba(255,${200 + Math.floor(lights() * 40)},140,${0.35 + lights() * 0.5})`;
      x.fillRect(lx, ly, 0.9, 0.9);
    }
  }

  // Limb glow (atmospheric scattering at the edge)
  const limb = x.createRadialGradient(0, 0, r * 0.78, 0, 0, r);
  const lc = atmo ? `${atmo}` : s.atmo.replace("hsl", "hsla").replace(")", ",");
  limb.addColorStop(0, `${lc}0)`);
  limb.addColorStop(1, `${lc}${atmo ? 0.55 : 0.3})`);
  x.fillStyle = limb;
  x.fillRect(-r, -r, r * 2, r * 2);
  x.restore();

  // Rim light on the sunlit edge
  x.strokeStyle = "rgba(255,255,255,0.35)";
  x.lineWidth = 1;
  x.beginPath(); x.arc(0, 0, r - 0.5, Math.PI * 0.95, Math.PI * 1.55); x.stroke();

  if (s.kind === "gas" && s.ring) drawRing(x, s, r, "front");

  return { canvas: c, half };
}

// --- Black hole (animated, drawn every frame) --------------------------

export function drawBlackHole(ctx, p, s, t) {
  const r = p.radius;
  ctx.save();
  ctx.translate(p.x, p.y);

  const halo = ctx.createRadialGradient(0, 0, r, 0, 0, r * 6);
  halo.addColorStop(0, "rgba(0,0,0,0.95)");
  halo.addColorStop(0.3, "rgba(8,0,18,0.55)");
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(0, 0, r * 6, 0, TAU); ctx.fill();

  const glow = ctx.createRadialGradient(0, 0, r * 1.2, 0, 0, r * 4);
  glow.addColorStop(0, "rgba(255,150,60,0.25)");
  glow.addColorStop(1, "rgba(160,60,255,0)");
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(0, 0, r * 4, 0, TAU); ctx.fill();
  ctx.globalCompositeOperation = "source-over";

  ctx.rotate(s.tilt);
  const disk = (front) => {
    ctx.save();
    ctx.beginPath();
    if (front) ctx.rect(-r * 5, 0, r * 10, r * 5);
    else ctx.rect(-r * 5, -r * 5, r * 10, r * 5);
    ctx.clip();
    ctx.scale(1, 0.3);
    ctx.globalCompositeOperation = "lighter";
    const dg = ctx.createRadialGradient(0, 0, r * 1.4, 0, 0, r * 4);
    dg.addColorStop(0, "rgba(255,245,220,0.95)");
    dg.addColorStop(0.3, "rgba(255,170,70,0.7)");
    dg.addColorStop(0.7, "rgba(200,60,40,0.3)");
    dg.addColorStop(1, "rgba(120,20,80,0)");
    ctx.fillStyle = dg;
    ctx.beginPath();
    ctx.arc(0, 0, r * 4, 0, TAU);
    ctx.arc(0, 0, r * 1.4, 0, TAU, true);
    ctx.fill();
    // Swirling hot streaks
    ctx.lineCap = "round";
    for (let i = 0; i < 6; i++) {
      const rr = r * (1.7 + i * 0.35);
      const a0 = s.spin * t * (2.4 - i * 0.25) + i * 1.9;
      ctx.strokeStyle = `rgba(255,${210 - i * 18},${150 - i * 18},${0.55 - i * 0.07})`;
      ctx.lineWidth = r * 0.22;
      ctx.beginPath(); ctx.arc(0, 0, rr, a0, a0 + 1.2); ctx.stroke();
    }
    ctx.restore();
  };
  disk(false);

  ctx.fillStyle = "#000";
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();

  // Photon ring + lensed top arc of the disk
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = "rgba(255,210,160,0.85)";
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(0, 0, r * 1.18, 0, TAU); ctx.stroke();
  ctx.strokeStyle = "rgba(255,170,90,0.45)";
  ctx.lineWidth = r * 0.35;
  ctx.beginPath(); ctx.arc(0, 0, r * 1.45, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
  ctx.globalCompositeOperation = "source-over";

  disk(true);
  ctx.restore();
}
