import { createRng } from "./levelgen.js";

const FIRST = [
  "Cygnus", "Vela", "Carina", "Lyra", "Draco", "Hydra", "Perseus", "Auriga", "Orion", "Pavo",
  "Corvus", "Lupus", "Norma", "Pyxis", "Tucana", "Volans", "Sagitta", "Fornax", "Cetus", "Ara",
];
const SECOND = [
  "Reach", "Drift", "Expanse", "Rift", "Shoals", "Verge", "Deep", "Gate", "Hollow", "Narrows",
  "Wake", "Maw", "Crossing", "Tangle", "Spiral", "Anchorage",
];

// Every level gets a named sector — same seed + level, same name on both screens.
export function sectorName(seed, level) {
  const r = createRng((seed ^ 0x51ed27) + level * 4099);
  return `${FIRST[Math.floor(r() * FIRST.length)]} ${SECOND[Math.floor(r() * SECOND.length)]}`;
}
