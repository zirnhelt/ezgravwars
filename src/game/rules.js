// Match rules shared by the client (local/CPU games) and the GameRoom
// Durable Object (online games), so both advance state identically.

export const DEFAULT_TARGET_SCORE = 5;
export const TARGET_SCORE_OPTIONS = [3, 5, 7];

export function clampTargetScore(n) {
  const v = Number(n);
  return TARGET_SCORE_OPTIONS.includes(v) ? v : DEFAULT_TARGET_SCORE;
}

export function newMatchState(seed, targetScore = DEFAULT_TARGET_SCORE) {
  return {
    seed,
    level: 1,
    scores: [0, 0],
    turn: 1,
    status: "playing",
    winner: null,
    targetScore: clampTargetScore(targetScore),
  };
}

// A hit scores a point and moves both players to a fresh level (the player who
// was hit shoots first there). Reaching targetScore ends the match.
export function applyShot(state, shooter, hit) {
  const opponent = shooter === 1 ? 2 : 1;
  const scores = [...state.scores];
  let { level, status, winner } = state;

  if (hit) {
    scores[shooter - 1]++;
    if (scores[shooter - 1] >= state.targetScore) {
      status = "finished";
      winner = shooter;
    } else {
      level++;
    }
  }

  return { ...state, scores, level, status, winner, turn: opponent };
}
