/* ============================================================
   テニス フィーバー!  —  audio.js
   All sound is synthesized with WebAudio (no assets needed):
   a cheerful chiptune BGM loop plus bouncy toy-like SFX.
   ============================================================ */

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
    this.bgmPlaying = false;
    this.fever = false;
    this._schedTimer = null;
    this._nextNoteTime = 0;
    this._step = 0;
    this._crowdNode = null;
  }

  /* Must be called from a user gesture (iOS requirement). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);

    // gentle master compression keeps toddler-volume levels safe
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 20;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    comp.connect(this.master);
    this._out = comp;

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.34;
    this.musicBus.connect(comp);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.85;
    this.sfxBus.connect(comp);

    this._startCrowdBed();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
    }
  }

  /* ---------------- little synth helpers ---------------- */

  _env(gainNode, t, peak, attack, decay) {
    const g = gainNode.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  _tone({ type = 'sine', freq = 440, t, peak = 0.3, attack = 0.005, decay = 0.2,
          slideTo = null, slideTime = 0.1, bus = null }) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(slideTo, t + slideTime);
    this._env(g, t, peak, attack, decay);
    osc.connect(g);
    g.connect(bus || this.sfxBus);
    osc.start(t);
    osc.stop(t + attack + decay + 0.05);
  }

  _noise({ t, peak = 0.2, attack = 0.002, decay = 0.12, filterFreq = 3000, q = 1, type = 'bandpass', bus = null }) {
    if (!this.ctx) return;
    const len = Math.ceil(this.ctx.sampleRate * (attack + decay + 0.1));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterFreq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    this._env(g, t, peak, attack, decay);
    src.connect(f); f.connect(g); g.connect(bus || this.sfxBus);
    src.start(t);
    src.stop(t + attack + decay + 0.1);
  }

  /* ---------------- SFX ---------------- */

  uiTap() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone({ type: 'triangle', freq: 660, t, peak: 0.25, decay: 0.09 });
    this._tone({ type: 'triangle', freq: 990, t: t + 0.05, peak: 0.2, decay: 0.12 });
  }

  /* racket hit — pitch climbs with the rally for a sense of building excitement */
  hit(rally = 0, nice = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const base = 330 * Math.pow(2, Math.min(rally, 12) / 24);
    this._noise({ t, peak: 0.32, decay: 0.05, filterFreq: 5200, q: 0.8 });
    this._tone({ type: 'square', freq: base, t, peak: 0.22, decay: 0.14, slideTo: base * 1.5, slideTime: 0.06 });
    this._tone({ type: 'sine', freq: base * 2, t, peak: 0.25, decay: 0.18 });
    if (nice) {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        this._tone({ type: 'triangle', freq: f, t: t + 0.06 + i * 0.055, peak: 0.2, decay: 0.22 });
      });
    }
  }

  bounce() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone({ type: 'sine', freq: 220, t, peak: 0.22, decay: 0.1, slideTo: 140, slideTime: 0.08 });
    this._noise({ t, peak: 0.1, decay: 0.04, filterFreq: 2000 });
  }

  swishMiss() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._noise({ t, peak: 0.18, attack: 0.02, decay: 0.25, filterFreq: 1200, q: 0.6 });
  }

  /* gentle "poyon" — missing is never scary */
  miss() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone({ type: 'sine', freq: 520, t, peak: 0.24, decay: 0.3, slideTo: 260, slideTime: 0.28 });
    this._tone({ type: 'sine', freq: 390, t: t + 0.18, peak: 0.18, decay: 0.35, slideTo: 195, slideTime: 0.3 });
  }

  sparkle() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [1318.5, 1567.98, 2093.0].forEach((f, i) => {
      this._tone({ type: 'sine', freq: f, t: t + i * 0.045, peak: 0.12, decay: 0.25 });
    });
  }

  fanfare() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const seq = [
      [523.25, 0], [659.25, 0.12], [783.99, 0.24], [1046.5, 0.38],
      [783.99, 0.56], [1046.5, 0.68], [1318.5, 0.84],
    ];
    seq.forEach(([f, dt]) => {
      this._tone({ type: 'square', freq: f, t: t + dt, peak: 0.18, decay: 0.3 });
      this._tone({ type: 'triangle', freq: f / 2, t: t + dt, peak: 0.16, decay: 0.3 });
    });
    this.cheer(1.2);
  }

  cheer(strength = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const dur = 1.1 * strength;
    const len = Math.ceil(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.linearRampToValueAtTime(1500, t + dur * 0.4);
    f.frequency.linearRampToValueAtTime(800, t + dur);
    f.Q.value = 0.5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16 * strength, t + dur * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.sfxBus);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  firework() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._noise({ t, peak: 0.2, attack: 0.001, decay: 0.5, filterFreq: 700, q: 0.4, type: 'lowpass' });
    this._tone({ type: 'sine', freq: 900, t, peak: 0.1, decay: 0.4, slideTo: 250, slideTime: 0.4 });
    for (let i = 0; i < 5; i++) {
      this._tone({
        type: 'sine', freq: 1400 + Math.random() * 1200,
        t: t + 0.1 + Math.random() * 0.3, peak: 0.06, decay: 0.3,
      });
    }
  }

  /* quiet stadium ambience so the world always feels alive */
  _startCrowdBed() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    const g = this.ctx.createGain();
    g.gain.value = 0.025;
    src.connect(f); f.connect(g); g.connect(this._out);
    src.start();
    this._crowdNode = g;
  }

  /* ---------------- BGM (chiptune scheduler) ---------------- */

  startBGM() {
    if (!this.ctx || this.bgmPlaying) return;
    this.bgmPlaying = true;
    this._step = 0;
    this._nextNoteTime = this.ctx.currentTime + 0.1;
    this._schedTimer = setInterval(() => this._schedule(), 40);
  }

  stopBGM() {
    this.bgmPlaying = false;
    if (this._schedTimer) clearInterval(this._schedTimer);
    this._schedTimer = null;
  }

  setFever(on) {
    this.fever = on;
  }

  _schedule() {
    if (!this.bgmPlaying) return;
    const bpm = this.fever ? 152 : 118;
    const spb = 60 / bpm / 2; // 8th notes
    while (this._nextNoteTime < this.ctx.currentTime + 0.25) {
      this._playStep(this._step, this._nextNoteTime);
      this._nextNoteTime += spb;
      this._step = (this._step + 1) % 64;
    }
  }

  _playStep(step, t) {
    // C major happy loop: C - G - Am - F  (8 eighth-notes per chord)
    const chords = [
      [261.63, 329.63, 392.0],   // C
      [246.94, 293.66, 392.0],   // G
      [220.0, 261.63, 329.63],   // Am
      [174.61, 220.0, 261.63],   // F
    ];
    const bassNotes = [130.81, 98.0, 110.0, 87.31];
    const bar = Math.floor(step / 8) % 4;
    const beat = step % 8;
    const chord = chords[bar];
    const bass = bassNotes[bar];

    // bass: bouncy root on 0 and 4, fifth on 6
    if (beat === 0 || beat === 4) {
      this._tone({ type: 'triangle', freq: bass, t, peak: 0.5, attack: 0.005, decay: 0.16, bus: this.musicBus });
    } else if (beat === 6) {
      this._tone({ type: 'triangle', freq: bass * 1.5, t, peak: 0.4, attack: 0.005, decay: 0.12, bus: this.musicBus });
    }

    // chord stabs on offbeats
    if (beat === 2 || beat === 6) {
      chord.forEach(f => {
        this._tone({ type: 'square', freq: f, t, peak: 0.06, attack: 0.004, decay: 0.09, bus: this.musicBus });
      });
    }

    // hat
    if (beat % 2 === 0) {
      this._noise({ t, peak: this.fever ? 0.05 : 0.035, decay: 0.03, filterFreq: 8000, type: 'highpass', bus: this.musicBus });
    }

    // melody — a singable little hook, one note per 8th (rests included)
    const melA = [523.25, 0, 659.25, 0, 783.99, 659.25, 523.25, 0,
                  587.33, 0, 493.88, 0, 587.33, 0, 493.88, 392.0,
                  440.0, 0, 523.25, 0, 659.25, 523.25, 440.0, 0,
                  349.23, 440.0, 523.25, 587.33, 659.25, 0, 523.25, 0];
    const melB = [783.99, 0, 1046.5, 0, 783.99, 659.25, 783.99, 0,
                  587.33, 783.99, 987.77, 0, 587.33, 0, 493.88, 0,
                  659.25, 0, 880.0, 0, 659.25, 523.25, 659.25, 0,
                  698.46, 0, 587.33, 659.25, 523.25, 0, 0, 0];
    const mel = (step < 32) ? melA : melB;
    const note = mel[step % 32];
    if (note) {
      this._tone({
        type: 'square', freq: note, t, peak: 0.085,
        attack: 0.006, decay: this.fever ? 0.1 : 0.14, bus: this.musicBus,
      });
      // sweet detuned double
      this._tone({
        type: 'triangle', freq: note * 2.003, t, peak: 0.04,
        attack: 0.006, decay: 0.1, bus: this.musicBus,
      });
    }

    // fever: sparkling arpeggio on top
    if (this.fever && beat % 2 === 1) {
      const arp = [1046.5, 1318.5, 1568.0, 2093.0];
      this._tone({
        type: 'sine', freq: arp[(step >> 1) % 4], t, peak: 0.06,
        attack: 0.004, decay: 0.12, bus: this.musicBus,
      });
    }
  }
}
