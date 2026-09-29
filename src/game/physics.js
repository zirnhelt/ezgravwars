import {
  CANVAS_W, CANVAS_H, G, MISSILE_SPEED_FACTOR, DT,
  MIN_GRAV_DIST, PLANET_HIT_BONUS, SIM_SUBSTEPS, MAX_SIM_STEPS, MAX_TRAIL,
} from "./constants.js";

// --- Coordinate wrapping (toroidal field) ---

export function wrapCoord(x, y) {
  let nx = x % CANVAS_W;
  if (nx < 0) nx += CANVAS_W;
  let ny = y % CANVAS_H;
  if (ny < 0) ny += CANVAS_H;
  return { x: nx, y: ny };
}

export function wrappedDelta(fx, fy, tx, ty) {
  let dx = tx - fx;
  let dy = ty - fy;
  if (dx > CANVAS_W / 2) dx -= CANVAS_W;
  else if (dx < -CANVAS_W / 2) dx += CANVAS_W;
  if (dy > CANVAS_H / 2) dy -= CANVAS_H;
  else if (dy < -CANVAS_H / 2) dy += CANVAS_H;
  return { dx, dy };
}

// Keep angles in (-180, 180] so sliders, readouts and the server agree.
export function normalizeAngle(a) {
  let n = ((a % 360) + 360) % 360;
  if (n > 180) n -= 360;
  return n;
}

// --- Cannon geometry ---

export function cannonTip(planet, angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  return {
    x: planet.x + Math.cos(a) * (planet.radius + 22),
    y: planet.y + Math.sin(a) * (planet.radius + 22),
  };
}

export function cannonBase(planet, angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  return {
    x: planet.x + Math.cos(a) * (planet.radius + 8),
    y: planet.y + Math.sin(a) * (planet.radius + 8),
  };
}

// --- Deterministic simulation ---
// The single source of truth for a shot. Clients animate by replaying `path`,
// the CPU player searches with it, and the server scores with it — so all three
// always agree. No Math.random() anywhere in here.
//
// Returns {
//   hit, hitWhat ("HIT!" | "self" | "planet" | "lost"), hitPlanetIndex,
//   path: [x0, y0, x1, y1, ...]   full flight (only when opts.record !== false)
//   trail: [{x, y}]               last MAX_TRAIL points, for faded history trails
//   steps, wraps,
//   closest: { dist, x, y, step } nearest approach to the opponent's surface
//   impact: { x, y } | null
// }

export function simulateShot(planets, angle, power, shooterPlayer, opts = {}) {
  const record = opts.record !== false;
  const maxSteps = opts.maxSteps ?? MAX_SIM_STEPS;

  const me = planets.find((p) => p.player === shooterPlayer);
  const opponent = shooterPlayer === 1 ? 2 : 1;
  const oppIndex = planets.findIndex((p) => p.player === opponent);
  const tip = cannonTip(me, angle);
  const rad = (angle * Math.PI) / 180;
  const speed = (power / 100) * MISSILE_SPEED_FACTOR;

  let mx = tip.x;
  let my = tip.y;
  let vx = Math.cos(rad) * speed;
  let vy = Math.sin(rad) * speed;

  const path = record ? [mx, my] : null;
  const closest = { dist: Infinity, x: mx, y: my, step: 0 };
  let steps = 0;
  let wraps = 0;

  const finish = (hit, hitWhat, hitPlanetIndex, impact) => {
    let trail = [];
    if (record) {
      const n = path.length / 2;
      for (let i = Math.max(0, n - MAX_TRAIL); i < n; i++) {
        trail.push({ x: path[i * 2], y: path[i * 2 + 1] });
      }
    }
    return { hit, hitWhat, hitPlanetIndex, path, trail, steps, wraps, closest, impact };
  };

  while (steps < maxSteps) {
    let ax = 0;
    let ay = 0;

    for (let pi = 0; pi < planets.length; pi++) {
      const p = planets[pi];
      const { dx, dy } = wrappedDelta(mx, my, p.x, p.y);
      const distSq = dx * dx + dy * dy;
      const dist = Math.sqrt(distSq);

      if (pi === oppIndex) {
        const surf = dist - p.radius - PLANET_HIT_BONUS;
        if (surf < closest.dist) {
          closest.dist = Math.max(0, surf);
          closest.x = mx;
          closest.y = my;
          closest.step = steps;
        }
      }

      // Collision
      if (dist < p.radius + PLANET_HIT_BONUS) {
        const impact = { x: mx, y: my };
        if (p.player === opponent) return finish(true, "HIT!", pi, impact);
        return finish(false, p.player === shooterPlayer ? "self" : "planet", pi, impact);
      }

      // Gravity with distance clamp
      const force = (G * p.mass) / Math.max(distSq, MIN_GRAV_DIST * MIN_GRAV_DIST);
      ax += (force * dx) / dist;
      ay += (force * dy) / dist;
    }

    vx += ax * DT;
    vy += ay * DT;
    mx += vx;
    my += vy;

    if (mx < 0 || mx >= CANVAS_W || my < 0 || my >= CANVAS_H) {
      const w = wrapCoord(mx, my);
      mx = w.x;
      my = w.y;
      wraps++;
    }

    if (record) path.push(mx, my);
    steps++;
  }

  return finish(false, "lost", null, null);
}

// Speed of the missile at a given path index (pixels per step), for audio/FX.
export function pathSpeed(path, i) {
  if (i < 1) return 0;
  let dx = path[i * 2] - path[i * 2 - 2];
  let dy = path[i * 2 + 1] - path[i * 2 - 1];
  if (Math.abs(dx) > CANVAS_W / 2) dx -= Math.sign(dx) * CANVAS_W;
  if (Math.abs(dy) > CANVAS_H / 2) dy -= Math.sign(dy) * CANVAS_H;
  return Math.hypot(dx, dy);
}

// Steps of simulated time rendered per animation frame at normal speed.
// Matches the original feel (10 substeps per 60 Hz frame).
export const STEPS_PER_SECOND = SIM_SUBSTEPS * 60;
