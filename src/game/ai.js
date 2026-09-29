// CPU opponent.
//
// Search: brute-force the (angle, power) space with the same deterministic
// simulateShot the game uses, scoring each candidate by how close it gets to
// the opponent. Then refine around the most promising candidates.
//
// Personality: instead of adding random noise to a perfect solution (which in
// a chaotic gravity field produces wild, dumb-looking misses), the CPU picks a
// shot that *deliberately* misses by a shrinking margin — it walks its shots in
// like a human would. Each difficulty has a hit-chance curve and a miss-distance
// curve that tighten with every shot it takes on the current level.

import { simulateShot, normalizeAngle } from "./physics.js";
import { MIN_POWER, MAX_POWER } from "./constants.js";

export const CPU_LEVELS = {
  cadet: {
    label: "Cadet",
    blurb: "Learning the ropes",
    hitChance: (n) => Math.min(0.8, 0.05 + 0.12 * n),
    missBy: (n) => 150 * Math.pow(0.72, n),
  },
  captain: {
    label: "Captain",
    blurb: "Knows a slingshot",
    hitChance: (n) => Math.min(0.95, 0.18 + 0.2 * n),
    missBy: (n) => 90 * Math.pow(0.6, n),
  },
  admiral: {
    label: "Admiral",
    blurb: "Do not blink",
    hitChance: (n) => Math.min(1, 0.45 + 0.28 * n),
    missBy: (n) => 45 * Math.pow(0.5, n),
  },
};

const EVAL_MAX_STEPS = 6000; // long wanderers are rarely good shots; cap search cost
const SLICE_MS = 8;

const nextTick = () => new Promise((r) => setTimeout(r, 0));

function evaluate(planets, shooter, angle, power) {
  const r = simulateShot(planets, angle, power, shooter, { record: false, maxSteps: EVAL_MAX_STEPS });
  // Self-hits are embarrassing; never prefer them.
  const score = r.hit ? 0 : r.hitWhat === "self" ? 1e6 : r.closest.dist;
  return { angle, power, hit: r.hit, hitWhat: r.hitWhat, dist: r.closest.dist, score };
}

// Runs `jobs` (array of [angle, power]) in time slices so the render loop stays smooth.
async function runJobs(planets, shooter, jobs, out, seen, shouldAbort) {
  let sliceStart = performance.now();
  for (const [a, p] of jobs) {
    const angle = normalizeAngle(Math.round(a));
    const power = Math.max(MIN_POWER, Math.min(MAX_POWER, Math.round(p)));
    const key = angle * 1000 + power;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(evaluate(planets, shooter, angle, power));
    if (performance.now() - sliceStart > SLICE_MS) {
      await nextTick();
      if (shouldAbort?.()) return false;
      sliceStart = performance.now();
    }
  }
  return true;
}

// memory: { shotsOnLevel } — how many shots the CPU has already taken this level.
// Resolves to { angle, power } or null if aborted.
export async function planCpuShot(planets, shooter, difficulty, memory, shouldAbort) {
  const cfg = CPU_LEVELS[difficulty] ?? CPU_LEVELS.captain;
  const results = [];
  const seen = new Set();

  // Phase 1: coarse sweep of the whole firing circle.
  const coarse = [];
  for (let a = -180; a < 180; a += 3) {
    for (const p of [32, 45, 58, 71, 84, 97]) coarse.push([a + Math.random() * 2, p + Math.random() * 4 - 2]);
  }
  if (!(await runJobs(planets, shooter, coarse, results, seen, shouldAbort))) return null;

  // Phase 2: refine around the most promising distinct candidates.
  const refineAround = async (count, da, dp, stepA, stepP) => {
    const seeds = [...results].sort((x, y) => x.score - y.score).slice(0, count);
    const jobs = [];
    for (const s of seeds) {
      for (let a = -da; a <= da; a += stepA) {
        for (let p = -dp; p <= dp; p += stepP) jobs.push([s.angle + a, s.power + p]);
      }
    }
    return runJobs(planets, shooter, jobs, results, seen, shouldAbort);
  };
  if (!(await refineAround(6, 3, 8, 1, 2))) return null;
  if (!results.some((r) => r.hit)) {
    if (!(await refineAround(4, 2, 4, 1, 1))) return null;
  }

  const n = memory?.shotsOnLevel ?? 0;
  const hits = results.filter((r) => r.hit);
  const misses = results.filter((r) => !r.hit && r.hitWhat !== "self");

  if (hits.length && (Math.random() < cfg.hitChance(n) || misses.length === 0)) {
    // Prefer hits that sit inside a cluster of hits (robust, less of a fluke).
    const robust = hits.map((h) => ({
      h,
      support: hits.filter((o) => Math.abs(o.angle - h.angle) <= 1 && Math.abs(o.power - h.power) <= 2).length,
    }));
    robust.sort((a, b) => b.support - a.support);
    const top = robust.slice(0, Math.max(1, Math.ceil(robust.length / 4)));
    const pick = top[Math.floor(Math.random() * top.length)].h;
    return { angle: pick.angle, power: pick.power };
  }

  // Deliberate near-ish miss, tightening each shot.
  const want = cfg.missBy(n) * (0.7 + Math.random() * 0.6);
  const pool = misses.length ? misses : results;
  let best = pool[0];
  let bestErr = Infinity;
  for (const r of pool) {
    const err = Math.abs(r.dist - want);
    if (err < bestErr) { bestErr = err; best = r; }
  }
  return { angle: best.angle, power: best.power };
}
