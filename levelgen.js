import {
  CANVAS_W, CANVAS_H, MIN_PLANET_SPACING,
  PLAYER_RADIUS_MIN, PLAYER_RADIUS_MAX, PLAYER_MASS_MIN, PLAYER_MASS_MAX,
  NEUTRAL_RADIUS_MIN, NEUTRAL_RADIUS_MAX, NEUTRAL_MASS_MIN, NEUTRAL_MASS_MAX,
} from "./constants.js";

// --- Seeded PRNG (mulberry32) ---
// Deterministic: same seed always produces same sequence.

export function createRng(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Helper: seeded range
function rng(rand, min, max) {
  return min + rand() * (max - min);
}

// --- Level generation ---
// Fully deterministic given (seed, levelNum).
// Returns array of planet objects.

export function generateLevel(seed, levelNum) {
  const rand = createRng(seed + levelNum * 9973);
  const numNeutral = Math.min(4 + Math.floor(levelNum / 2), 8);

  const planets = [];

  const tooClose = (x, y, r) =>
    planets.some(
      (p) => Math.hypot(p.x - x, p.y - y) < p.radius + r + MIN_PLANET_SPACING
    );

  // Player 1 — left side
  planets.push({
    x: rng(rand, 90, 250),
    y: rng(rand, 180, CANVAS_H - 180),
    radius: rng(rand, PLAYER_RADIUS_MIN, PLAYER_RADIUS_MAX),
    mass: rng(rand, PLAYER_MASS_MIN, PLAYER_MASS_MAX),
    color: "#4a9eff",
    player: 1,
  });

  // Player 2 — right side
  let p2;
  let att = 0;
  do {
    p2 = {
      x: rng(rand, CANVAS_W - 250, CANVAS_W - 90),
      y: rng(rand, 180, CANVAS_H - 180),
      radius: rng(rand, PLAYER_RADIUS_MIN, PLAYER_RADIUS_MAX),
      mass: rng(rand, PLAYER_MASS_MIN, PLAYER_MASS_MAX),
      color: "#ff6b4a",
      player: 2,
    };
    att++;
  } while (tooClose(p2.x, p2.y, p2.radius) && att < 80);
  planets.push(p2);

  // Neutral planets — mixed placement
  const p1p = planets[0];
  const p2p = planets[1];

  for (let i = 0; i < numNeutral; i++) {
    let tries = 0;
    let np;
    do {
      const r = rng(rand, NEUTRAL_RADIUS_MIN, NEUTRAL_RADIUS_MAX);
      let nx, ny;
      const roll = rand();

      if (roll < 0.35) {
        // Corridor: between players
        const t = rng(rand, 0.25, 0.75);
        nx = p1p.x + (p2p.x - p1p.x) * t + rng(rand, -100, 100);
        ny = p1p.y + (p2p.y - p1p.y) * t + rng(rand, -120, 120);
      } else if (roll < 0.6) {
        // Edge-biased: block wrap shots
        const edge = Math.floor(rand() * 4);
        if (edge === 0) {
          nx = rng(rand, r + 10, CANVAS_W - r - 10);
          ny = rng(rand, r + 10, r + 100);
        } else if (edge === 1) {
          nx = rng(rand, r + 10, CANVAS_W - r - 10);
          ny = rng(rand, CANVAS_H - r - 100, CANVAS_H - r - 10);
        } else if (edge === 2) {
          nx = rng(rand, r + 10, r + 100);
          ny = rng(rand, r + 10, CANVAS_H - r - 10);
        } else {
          nx = rng(rand, CANVAS_W - r - 100, CANVAS_W - r - 10);
          ny = rng(rand, r + 10, CANVAS_H - r - 10);
        }
      } else {
        // Random scatter
        nx = rng(rand, r + 20, CANVAS_W - r - 20);
        ny = rng(rand, r + 20, CANVAS_H - r - 20);
      }

      nx = Math.max(r + 10, Math.min(CANVAS_W - r - 10, nx));
      ny = Math.max(r + 10, Math.min(CANVAS_H - r - 10, ny));

      const hue = rng(rand, 25, 55);
      const sat = rng(rand, 30, 55);
      const light = rng(rand, 32, 52);

      np = {
        x: nx,
        y: ny,
        radius: r,
        mass: rng(rand, NEUTRAL_MASS_MIN, NEUTRAL_MASS_MAX),
        color: `hsl(${hue}, ${sat}%, ${light}%)`,
        player: 0,
      };
      tries++;
    } while (tooClose(np.x, np.y, np.radius) && tries < 100);
    if (tries < 100) planets.push(np);
  }

  return planets;
}

// --- Starfield (seeded, generated once per session) ---

export function generateStars(seed, count) {
  const rand = createRng(seed);
  const stars = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: rand() * CANVAS_W,
      y: rand() * CANVAS_H,
      size: rand() < 0.08 ? 2 : rand() < 0.3 ? 1.2 : 0.7,
      brightness: 0.15 + rand() * 0.65,
      twinkleSpeed: 0.5 + rand() * 2,
      twinkleOffset: rand() * Math.PI * 2,
      hue: rand() < 0.1 ? 220 : rand() < 0.05 ? 30 : 0,
      saturation: rand() < 0.15 ? 40 + rand() * 40 : 0,
    });
  }
  return stars;
}
