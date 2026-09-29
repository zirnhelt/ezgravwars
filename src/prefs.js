// Small localStorage helpers. Every access is guarded: storage can throw in
// private mode or when site data is blocked, and the game must still work.

const PREFS_KEY = "gw:prefs";
const RECORD_KEY = "gw:record";

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

export const DEFAULT_PREFS = { targetScore: 5, difficulty: "captain", assist: false };

export const loadPrefs = () => read(PREFS_KEY, DEFAULT_PREFS);
export const savePrefs = (p) => write(PREFS_KEY, p);

// Win/loss record against each CPU rank — a light progression hook.
const EMPTY_RECORD = { cadet: { w: 0, l: 0 }, captain: { w: 0, l: 0 }, admiral: { w: 0, l: 0 } };

export const loadRecord = () => read(RECORD_KEY, EMPTY_RECORD);

export function recordCpuResult(difficulty, won) {
  const rec = loadRecord();
  const r = { ...(rec[difficulty] || { w: 0, l: 0 }) };
  if (won) r.w++;
  else r.l++;
  write(RECORD_KEY, { ...rec, [difficulty]: r });
}
