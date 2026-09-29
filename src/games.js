// "My games": the online matches this browser holds a seat in.
// Each entry keeps the seat's secret token, so a match can be picked up days
// later (play-by-mail) without the invite link.

const KEY = "gw:games";

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private mode: seat lasts this tab */ }
}

const norm = (code) => String(code).toUpperCase();

export function listGames() {
  return read();
}

export function getGame(code) {
  return read().find((g) => g.code === norm(code)) || null;
}

export function saveGame({ code, playerId, token, targetScore }) {
  const list = read().filter((g) => g.code !== norm(code));
  list.unshift({ code: norm(code), playerId, token, targetScore, addedAt: Date.now(), seen: 0 });
  write(list.slice(0, 40));
}

export function forgetGame(code) {
  write(read().filter((g) => g.code !== norm(code)));
}

// Highest shot id this browser has watched play out, so a returning player
// can be shown the shot they missed.
export function markSeen(code, shotId) {
  const list = read();
  const g = list.find((x) => x.code === norm(code));
  if (!g || shotId <= (g.seen || 0)) return;
  g.seen = shotId;
  write(list);
}

// Private link that carries the seat token in the URL fragment (never sent to
// the server) — for moving a match to another device.
export function resumeLink(g) {
  return `${window.location.origin}/online/${g.code}/${g.playerId}#t=${g.token}`;
}
