// audio.js — WebAudio だけで作る BGM・エンジン音・効果音（外部アセット不要）
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.engineNodes = null;
    this.musicTimer = null;
    this.musicStep = 0;
    this.tempo = 138;
    this.enabled = true;
  }

  /* iOS 対策：ユーザー操作の中で必ず呼ぶ */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.32;
      this.musicGain.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    // 無音バッファを鳴らして確実にアンロック
    const buf = this.ctx.createBuffer(1, 1, 22050);
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.connect(this.master); src.start(0);
  }

  _osc(type, freq, t0, dur, gain, dest, glideTo = null) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(dest || this.master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  _noise(t0, dur, gain, filterFreq, dest) {
    const ctx = this.ctx;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(dest || this.master);
    src.start(t0);
  }

  /* ---------------- BGM ---------------- */
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    this.musicStep = 0;
    this._nextNoteTime = this.ctx.currentTime + 0.1;
    this.musicTimer = setInterval(() => this._schedule(), 60);
  }
  stopMusic() {
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
  }

  _schedule() {
    const stepDur = 60 / this.tempo / 2; // 8分音符
    while (this._nextNoteTime < this.ctx.currentTime + 0.25) {
      this._playStep(this.musicStep, this._nextNoteTime, stepDur);
      this._nextNoteTime += stepDur;
      this.musicStep = (this.musicStep + 1) % 64;
    }
  }

  _playStep(step, t, dur) {
    const N = (n) => 440 * Math.pow(2, (n - 69) / 12);
    // 明るいメロディ（Cメジャー・8小節ループ相当）
    const melody = [
      72, 0, 76, 0, 79, 76, 72, 0, 74, 0, 77, 0, 81, 77, 74, 0,
      76, 0, 79, 0, 84, 79, 76, 0, 77, 76, 74, 72, 74, 0, 67, 0,
      72, 0, 76, 0, 79, 76, 72, 0, 74, 0, 77, 0, 81, 84, 81, 77,
      79, 0, 76, 0, 72, 74, 76, 79, 84, 0, 84, 0, 84, 79, 76, 72,
    ];
    const bassRoots = [48, 48, 53, 53, 43, 43, 48, 48];
    const m = melody[step];
    if (m) this._osc('square', N(m), t, dur * 0.9, 0.09, this.musicGain);
    // ベース（4分）
    if (step % 2 === 0) {
      const root = bassRoots[Math.floor(step / 8) % 8];
      const note = step % 4 === 0 ? root : root + 7;
      this._osc('triangle', N(note), t, dur * 1.6, 0.16, this.musicGain);
    }
    // ハイハット
    if (step % 2 === 0) this._noise(t, 0.04, step % 8 === 4 ? 0.10 : 0.05, 6000, this.musicGain);
    // ハンドクラップ的なスネア
    if (step % 8 === 4) this._noise(t, 0.09, 0.08, 1800, this.musicGain);
  }

  /* ---------------- エンジン ---------------- */
  startEngine() {
    if (!this.ctx || this.engineNodes) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55;
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 27.5;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    const gain = ctx.createGain();
    gain.gain.value = 0.0;
    osc.connect(filter); osc2.connect(filter);
    filter.connect(gain); gain.connect(this.master);
    osc.start(); osc2.start();
    this.engineNodes = { osc, osc2, filter, gain };
  }
  setEngine(speedRatio, boosting) {
    if (!this.engineNodes) return;
    const e = this.engineNodes;
    const f = 48 + speedRatio * 130 + (boosting ? 55 : 0);
    e.osc.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.08);
    e.osc2.frequency.setTargetAtTime(f / 2, this.ctx.currentTime, 0.08);
    e.filter.frequency.setTargetAtTime(320 + speedRatio * 900, this.ctx.currentTime, 0.1);
    e.gain.gain.setTargetAtTime(0.05 + speedRatio * 0.075, this.ctx.currentTime, 0.1);
  }
  stopEngine() {
    if (!this.engineNodes) return;
    const e = this.engineNodes;
    e.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    setTimeout(() => { try { e.osc.stop(); e.osc2.stop(); } catch (_) {} }, 500);
    this.engineNodes = null;
  }

  /* ---------------- 効果音 ---------------- */
  get t0() { return this.ctx ? this.ctx.currentTime : 0; }

  coin() {
    if (!this.ctx) return;
    this._osc('square', 1318.5, this.t0, 0.07, 0.12);
    this._osc('square', 1975.5, this.t0 + 0.07, 0.16, 0.12);
  }
  itemGet() {
    if (!this.ctx) return;
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => this._osc('square', f, this.t0 + i * 0.07, 0.09, 0.1));
  }
  boost() {
    if (!this.ctx) return;
    this._osc('sawtooth', 180, this.t0, 0.5, 0.16, null, 900);
    this._noise(this.t0, 0.4, 0.12, 900);
  }
  star() {
    if (!this.ctx) return;
    const notes = [784, 988, 1175, 1568, 1976];
    notes.forEach((f, i) => this._osc('triangle', f, this.t0 + i * 0.06, 0.12, 0.12));
  }
  bump() {
    if (!this.ctx) return;
    this._osc('triangle', 90, this.t0, 0.15, 0.2, null, 45);
    this._noise(this.t0, 0.1, 0.1, 400);
  }
  countBeep(final = false) {
    if (!this.ctx) return;
    this._osc('square', final ? 880 : 440, this.t0, final ? 0.5 : 0.18, 0.16);
  }
  lap() {
    if (!this.ctx) return;
    [660, 880].forEach((f, i) => this._osc('square', f, this.t0 + i * 0.09, 0.12, 0.12));
  }
  fanfare() {
    if (!this.ctx) return;
    const seq = [
      [523, 0, 0.14], [523, 0.15, 0.14], [523, 0.3, 0.14], [659, 0.45, 0.3],
      [523, 0.8, 0.14], [659, 0.95, 0.14], [784, 1.1, 0.55],
    ];
    for (const [f, dt, dur] of seq) {
      this._osc('square', f, this.t0 + dt, dur, 0.13);
      this._osc('triangle', f / 2, this.t0 + dt, dur, 0.13);
    }
  }
  offroadTick() {
    if (!this.ctx) return;
    this._noise(this.t0, 0.05, 0.04, 300);
  }
}
