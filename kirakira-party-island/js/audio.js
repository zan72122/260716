// WebAudio だけで効果音とBGMを合成する。外部音源ファイル不要。
// iOS では最初のタッチで resume() が必要なので unlock() を用意している。

class PartyAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.master = null;
    this.bgmGain = null;
    this.bgmTimer = null;
    this.bgmStep = 0;
    this.bgmMode = null;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      this.bgmGain = this.ctx.createGain();
      this.bgmGain.gain.value = 0.16;
      this.bgmGain.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
  }

  now() { return this.ctx ? this.ctx.currentTime : 0; }

  // ---- 基本発音ヘルパー ----
  tone({ freq = 440, type = 'sine', dur = 0.2, vol = 0.3, at = 0, slide = 0, target = null }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.now() + at;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(target || this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  noise({ dur = 0.15, vol = 0.2, at = 0, filterFreq = 3000 }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.now() + at;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0);
  }

  // ---- 効果音 ----
  tap()      { this.tone({ freq: 660, type: 'triangle', dur: 0.08, vol: 0.25 }); }
  hop(step = 0) {
    this.tone({ freq: 330 + step * 28, type: 'square', dur: 0.11, vol: 0.12, slide: 180 });
  }
  landing()  { this.noise({ dur: 0.1, vol: 0.12, filterFreq: 900 }); }
  dice()     {
    for (let i = 0; i < 5; i++) {
      this.tone({ freq: 500 + Math.random() * 500, type: 'square', dur: 0.05, vol: 0.08, at: i * 0.06 });
    }
  }
  diceResult(n) {
    this.tone({ freq: 520 + n * 60, type: 'triangle', dur: 0.25, vol: 0.3 });
    this.tone({ freq: (520 + n * 60) * 1.5, type: 'sine', dur: 0.3, vol: 0.2, at: 0.08 });
  }
  coin(i = 0) {
    this.tone({ freq: 988, type: 'square', dur: 0.07, vol: 0.12, at: i * 0.09 });
    this.tone({ freq: 1319, type: 'square', dur: 0.16, vol: 0.12, at: i * 0.09 + 0.07 });
  }
  pop() {
    this.noise({ dur: 0.08, vol: 0.3, filterFreq: 2500 });
    this.tone({ freq: 800, type: 'sine', dur: 0.1, vol: 0.2, slide: 500 });
  }
  boing() { this.tone({ freq: 200, type: 'sawtooth', dur: 0.25, vol: 0.15, slide: 300 }); }
  whoosh() { this.noise({ dur: 0.35, vol: 0.15, filterFreq: 1200 }); }
  sparkle() {
    this.tone({ freq: 1568, type: 'sine', dur: 0.12, vol: 0.15 });
    this.tone({ freq: 2093, type: 'sine', dur: 0.2, vol: 0.12, at: 0.07 });
  }
  yay() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 0.18, vol: 0.22, at: i * 0.09 }));
  }
  fanfare() {
    const seq = [
      [523, 0], [523, 0.12], [523, 0.24], [659, 0.36],
      [784, 0.6], [659, 0.78], [784, 0.92],
    ];
    seq.forEach(([f, at]) => {
      this.tone({ freq: f, type: 'square', dur: 0.22, vol: 0.16, at });
      this.tone({ freq: f * 2, type: 'triangle', dur: 0.22, vol: 0.1, at });
    });
    this.noise({ dur: 0.4, vol: 0.1, at: 0.9, filterFreq: 4000 });
  }
  starGet() {
    const seq = [[784, 0], [988, 0.1], [1175, 0.2], [1568, 0.32], [1976, 0.5]];
    seq.forEach(([f, at]) => this.tone({ freq: f, type: 'triangle', dur: 0.3, vol: 0.2, at }));
  }
  countTick(n) {
    this.tone({ freq: n === 0 ? 1047 : 587, type: 'square', dur: n === 0 ? 0.4 : 0.15, vol: 0.25 });
  }
  warp() {
    this.tone({ freq: 300, type: 'sine', dur: 0.6, vol: 0.2, slide: 900 });
    this.tone({ freq: 450, type: 'triangle', dur: 0.6, vol: 0.12, slide: 1200, at: 0.05 });
  }
  firework(i = 0) {
    this.noise({ dur: 0.5, vol: 0.2, at: i * 0.25, filterFreq: 600 + Math.random() * 2000 });
    this.tone({ freq: 900 + Math.random() * 600, type: 'sine', dur: 0.4, vol: 0.1, at: i * 0.25, slide: -400 });
  }

  // ---- BGM: 軽快なループを1小節ずつスケジュール ----
  startBgm(mode = 'board') {
    if (!this.ctx) return;
    if (this.bgmMode === mode && this.bgmTimer) return;
    this.stopBgm();
    this.bgmMode = mode;
    this.bgmStep = 0;
    const tempo = mode === 'minigame' ? 0.16 : 0.21; // 1ステップの秒数
    const play = () => {
      const s = this.bgmStep;
      const scale = mode === 'minigame'
        ? [523, 587, 659, 784, 880, 1047]
        : [392, 440, 523, 587, 659, 784];
      // ベース
      if (s % 4 === 0) {
        const bass = [131, 98, 110, 123][Math.floor(s / 8) % 4];
        this.tone({ freq: bass, type: 'triangle', dur: tempo * 3, vol: 0.5, target: this.bgmGain });
      }
      // メロディ(かんたんな上下フレーズ)
      const mel = [0, 2, 4, 2, 5, 4, 2, 0, 1, 3, 5, 3, 4, 2, 1, 0];
      if (s % 2 === 0) {
        const f = scale[mel[(s / 2) % mel.length]];
        this.tone({ freq: f, type: 'square', dur: tempo * 1.6, vol: 0.28, target: this.bgmGain });
      }
      // ハイハット風
      if (s % 2 === 1) this.noise({ dur: 0.03, vol: this.muted ? 0 : 0.03, filterFreq: 8000 });
      this.bgmStep++;
    };
    this.bgmTimer = setInterval(play, tempo * 1000);
  }

  stopBgm() {
    if (this.bgmTimer) clearInterval(this.bgmTimer);
    this.bgmTimer = null;
    this.bgmMode = null;
  }
}

export const audio = new PartyAudio();
