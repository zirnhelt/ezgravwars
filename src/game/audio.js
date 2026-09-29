// Synthesized sound effects (Web Audio) — no asset files to load.
// The AudioContext is created lazily on the first user gesture (autoplay policy).

const MUTE_KEY = "gw:muted";

function readMuted() {
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}

class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.hum = null;
    this.muted = readMuted();
    this.listeners = new Set();
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(comp).connect(this.ctx.destination);

    const len = this.ctx.sampleRate * 1.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem(MUTE_KEY, m ? "1" : "0"); } catch { /* private mode */ }
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.02);
    this.listeners.forEach((fn) => fn(m));
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get ready() {
    return !!this.ctx && !this.muted;
  }

  _env(gainNode, t, attack, peak, decay) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  _noise(t, { dur, peak, type = "lowpass", freq = 800, freqEnd, q = 0.7, attack = 0.005 }) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = this.ctx.createGain();
    this._env(g, t, attack, peak, dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + attack + 0.05);
  }

  _tone(t, { freq, freqEnd, dur, peak, type = "sine", attack = 0.005 }) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = this.ctx.createGain();
    this._env(g, t, attack, peak, dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + attack + 0.05);
  }

  launch(power = 50) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const k = power / 100;
    this._noise(t, { dur: 0.35 + k * 0.2, peak: 0.5, type: "bandpass", freq: 2200, freqEnd: 300, q: 1.2 });
    this._tone(t, { freq: 180 + k * 120, freqEnd: 50, dur: 0.25, peak: 0.45, type: "triangle" });
  }

  startHum() {
    if (!this.ready || this.hum) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = 90;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 500;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.04, t + 0.2);
    o.connect(f).connect(g).connect(this.master);
    o.start(t);
    this.hum = { o, f, g };
  }

  // speed: pixels per sim step (≈ 1.5–15)
  setHum(speed) {
    if (!this.hum) return;
    const t = this.ctx.currentTime;
    this.hum.o.frequency.setTargetAtTime(70 + speed * 22, t, 0.05);
    this.hum.f.frequency.setTargetAtTime(300 + speed * 90, t, 0.05);
  }

  stopHum() {
    if (!this.hum) return;
    const { o, g } = this.hum;
    const t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setTargetAtTime(0.0001, t, 0.05);
    o.stop(t + 0.3);
    this.hum = null;
  }

  whoosh() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._noise(t, { dur: 0.5, peak: 0.35, type: "bandpass", freq: 600, freqEnd: 3000, q: 2, attack: 0.15 });
  }

  warp() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._tone(t, { freq: 900, freqEnd: 300, dur: 0.18, peak: 0.12, type: "sine" });
  }

  boom(size = 1) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._noise(t, { dur: 0.5 + size * 0.5, peak: 0.6 + size * 0.2, freq: 1400, freqEnd: 80 });
    this._tone(t, { freq: 110, freqEnd: 30, dur: 0.4 + size * 0.4, peak: 0.6, type: "sine" });
  }

  bigHit() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.boom(2);
    this._noise(t + 0.08, { dur: 1.6, peak: 0.5, freq: 600, freqEnd: 40 });
    this._tone(t, { freq: 60, freqEnd: 24, dur: 1.4, peak: 0.8, type: "sine" });
  }

  fizzle() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._tone(t, { freq: 520, freqEnd: 140, dur: 0.5, peak: 0.12, type: "triangle" });
  }

  turn() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._tone(t, { freq: 660, dur: 0.12, peak: 0.12, type: "sine" });
    this._tone(t + 0.09, { freq: 990, dur: 0.18, peak: 0.1, type: "sine" });
  }

  tick() {
    if (!this.ready) return;
    this._tone(this.ctx.currentTime, { freq: 1800, dur: 0.02, peak: 0.03, type: "square" });
  }

  hyperspace() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._noise(t, { dur: 1.0, peak: 0.25, type: "bandpass", freq: 200, freqEnd: 4000, q: 3, attack: 0.3 });
    this._tone(t, { freq: 80, freqEnd: 600, dur: 0.9, peak: 0.12, type: "sawtooth", attack: 0.3 });
  }

  fanfare(win = true) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const notes = win ? [523, 659, 784, 1047] : [392, 349, 311, 262];
    notes.forEach((f, i) => {
      this._tone(t + i * 0.14, { freq: f, dur: 0.35, peak: 0.16, type: "triangle" });
      this._tone(t + i * 0.14, { freq: f * 2, dur: 0.25, peak: 0.04, type: "sine" });
    });
  }
}

export const sfx = new Sfx();
