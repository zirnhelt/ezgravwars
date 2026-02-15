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
// Runs the full shot to completion synchronously.
// Returns { trail: [{x,y}...], hit: bool, hitWhat: string, hitPlanetIndex: int|null }
//
// Both clients call this with identical (planets, angle, power, shooterPlayer)
// and get identical results — no Math.random() anywhere in here.

export function simulateShot(planets, angle, power, shooterPlayer) {
  const me = planets.find((p) => p.player === shooterPlayer);
  const opponent = shooterPlayer === 1 ? 2 : 1;
  const tip = cannonTip(me, angle);
  const rad = (angle * Math.PI) / 180;
  const speed = (power / 100) * MISSILE_SPEED_FACTOR;

  let mx = tip.x;
  let my = tip.y;
  let vx = Math.cos(rad) * speed;
  let vy = Math.sin(rad) * speed;

  const trail = [{ x: mx, y: my }];
  let steps = 0;

  while (steps < MAX_SIM_STEPS) {
    for (let sub = 0; sub < SIM_SUBSTEPS; sub++) {
      let ax = 0;
      let ay = 0;

      for (let pi = 0; pi < planets.length; pi++) {
        const p = planets[pi];
        const { dx, dy } = wrappedDelta(mx, my, p.x, p.y);
        const distSq = dx * dx + dy * dy;
        const dist = Math.sqrt(distSq);

        // Collision check
        if (dist < p.radius + PLANET_HIT_BONUS) {
          trail.push({ x: mx, y: my });
          if (p.player === opponent) {
            return { trail, hit: true, hitWhat: "HIT!", hitPlanetIndex: pi };
          } else {
            const what = p.player === shooterPlayer ? "self" : "planet";
            return { trail, hit: false, hitWhat: what, hitPlanetIndex: pi };
          }
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

      // Wrap
      const w = wrapCoord(mx, my);
      mx = w.x;
      my = w.y;

      trail.push({ x: mx, y: my });
      if (trail.length > MAX_TRAIL) trail.shift();

      steps++;
      if (steps >= MAX_SIM_STEPS) {
        return { trail, hit: false, hitWhat: "lost", hitPlanetIndex: null };
      }
    }
  }

  return { trail, hit: false, hitWhat: "lost", hitPlanetIndex: null };
}

// --- Animated simulation (for client rendering) ---
// Runs the sim step-by-step via requestAnimationFrame so players see the
// missile fly. Calls onStep(simState) each frame and onComplete(result) at end.

export function animateShot(planets, angle, power, shooterPlayer, onStep, onComplete) {
  const me = planets.find((p) => p.player === shooterPlayer);
  const opponent = shooterPlayer === 1 ? 2 : 1;
  const tip = cannonTip(me, angle);
  const rad = (angle * Math.PI) / 180;
  const speed = (power / 100) * MISSILE_SPEED_FACTOR;

  const sim = {
    mx: tip.x,
    my: tip.y,
    vx: Math.cos(rad) * speed,
    vy: Math.sin(rad) * speed,
    active: true,
    trail: [{ x: tip.x, y: tip.y }],
    explosion: null,
    playerFiring: shooterPlayer,
  };

  let steps = 0;

  function tick() {
    if (!sim.active) return;

    for (let sub = 0; sub < SIM_SUBSTEPS; sub++) {
      let ax = 0;
      let ay = 0;

      for (let pi = 0; pi < planets.length; pi++) {
        const p = planets[pi];
        const { dx, dy } = wrappedDelta(sim.mx, sim.my, p.x, p.y);
        const distSq = dx * dx + dy * dy;
        const dist = Math.sqrt(distSq);

        if (dist < p.radius + PLANET_HIT_BONUS) {
          sim.active = false;
          sim.explosion = { x: sim.mx, y: sim.my, frame: 0, radius: p.radius * 0.6 };

          const hit = p.player === opponent;
          const hitWhat = hit ? "HIT!" : p.player === shooterPlayer ? "self" : "planet";
          onStep({ ...sim });
          onComplete({
            trail: [...sim.trail],
            hit,
            hitWhat,
            hitPlanetIndex: pi,
            explosion: sim.explosion,
          });
          return;
        }

        const force = (G * p.mass) / Math.max(distSq, MIN_GRAV_DIST * MIN_GRAV_DIST);
        ax += (force * dx) / dist;
        ay += (force * dy) / dist;
      }

      sim.vx += ax * DT;
      sim.vy += ay * DT;
      sim.mx += sim.vx;
      sim.my += sim.vy;

      const w = wrapCoord(sim.mx, sim.my);
      sim.mx = w.x;
      sim.my = w.y;

      sim.trail.push({ x: sim.mx, y: sim.my });
      if (sim.trail.length > MAX_TRAIL) sim.trail.shift();

      steps++;
      if (steps >= MAX_SIM_STEPS) {
        sim.active = false;
        onStep({ ...sim });
        onComplete({
          trail: [...sim.trail],
          hit: false,
          hitWhat: "lost",
          hitPlanetIndex: null,
          explosion: null,
        });
        return;
      }
    }

    onStep({ ...sim });
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
  return sim; // caller can read sim.active to check if still running
}
