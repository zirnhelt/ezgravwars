// Game field
export const CANVAS_W = 1125;
export const CANVAS_H = 800;

// Physics
export const G = 200;
export const MISSILE_SPEED_FACTOR = 9;
export const DT = 0.016;
export const MIN_GRAV_DIST = 25;
export const PLANET_HIT_BONUS = 2;
export const SIM_SUBSTEPS = 10;
export const MAX_SIM_STEPS = 12000;

// Trail / display
export const MAX_TRAIL = 2000;
export const EXPLOSION_DURATION = 40;
export const MAX_SHOT_HISTORY = 8;
// Shot playback speed as a multiple of real-time sim (1 = SIM_SUBSTEPS steps per 60 Hz frame).
export const PLAYBACK_SPEED = 0.1;
// Long flights speed up after this many seconds, to at most this multiple.
export const PLAYBACK_RAMP_DELAY = 4;
export const PLAYBACK_RAMP_MAX = 3;

// Level gen
export const MIN_PLANET_SPACING = 120;
export const PLAYER_RADIUS_MIN = 18;
export const PLAYER_RADIUS_MAX = 26;
export const PLAYER_MASS_MIN = 20;
export const PLAYER_MASS_MAX = 40;
export const NEUTRAL_RADIUS_MIN = 30;
export const NEUTRAL_RADIUS_MAX = 70;
export const NEUTRAL_MASS_MIN = 150;
export const NEUTRAL_MASS_MAX = 500;
export const BLACK_HOLE_RADIUS_MIN = 9;
export const BLACK_HOLE_RADIUS_MAX = 12;
export const BLACK_HOLE_MASS_MIN = 320;
export const BLACK_HOLE_MASS_MAX = 480;

// Controls
export const MIN_POWER = 20;
export const MAX_POWER = 100;
export const AIM_OFFSET_MIN = 30;
export const AIM_OFFSET_MAX = 60;
