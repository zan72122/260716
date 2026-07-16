/* ============================================================
   audio.js — 全て WebAudio で合成する BGM & 効果音
   (音声ファイル不要 / iOS はユーザー操作で unlock)
   ============================================================ */

const NOTE = (() => {
  // note name → frequency table  (A4 = 440)
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const t = {};
  for (let oct = 1; oct <= 7; oct++) {
    for (let i = 0; i < 12; i++) {
      const midi = (oct + 1) * 12 + i;
      t[names[i] + oct] = 440 * Math.pow(2, (midi - 69) / 12);
    }
  }
  return t;
})();

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.bgmGain = null;
    this.sfxGain = null;
    this.muted = false;
    this.bgmTimer = null;
    this.chargeOsc = null;
    this.chargeGain = null;
    this.boostNoiseBuf = null;
    this._combo = 0;
  }

  /* ---- boot (must be called from a user gesture) ---- */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);

    this.bgmGain = this.ctx.createGain();
    this.bgmGain.gain.value = 0.34;
    this.bgmGain.connect(this.master);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.9;
    this.sfxGain.connect(this.master);

    // pre-render a noise buffer for whoosh/hats
    const len = this.ctx.sampleRate * 1.2;
    this.boostNoiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.boostNoiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
    }
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume()  { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  /* ============================================================
     BGM — 8小節ループのゆかいなチップチューン (先読みスケジューラ)
     ============================================================ */
  startBGM() {
    if (!this.ctx || this.bgmTimer) return;
    const bpm = 138;
    this.spb = 60 / bpm;               // seconds per beat
    this.stepLen = this.spb / 2;       // 8th note steps
    this.stepIdx = 0;
    this.nextStepTime = this.ctx.currentTime + 0.1;

    // ---- 8小節 (64 steps of 8th notes) ----
    // メロディ: 明るくはずむ、カービィ風のごきげんな旋律 (オリジナル)
    const M = NOTE;
    this.melody = [
      // bar 1-2
      M.E5, 0, M.G5, M.E5, M.C6, 0, M.G5, 0,
      M.A5, M.G5, M.E5, 0, M.G5, 0, 0, 0,
      // bar 3-4
      M.D5, 0, M.F5, M.D5, M.B5, 0, M.F5, 0,
      M.G5, M.F5, M.D5, 0, M.E5, 0, 0, 0,
      // bar 5-6
      M.C5, M.E5, M.G5, M.C6, M.B5, M.G5, M.A5, 0,
      M.G5, 0, M.E5, M.C5, M.D5, 0, M.E5, M.F5,
      // bar 7-8
      M.G5, 0, M.E5, 0, M.A5, M.G5, M.F5, M.D5,
      M.C5, 0, M.E5, M.G5, M.C6, 0, 0, 0,
    ];
    // ベース: ルート弾みパターン
    const B = [
      M.C3, M.C3, M.G3, M.C3, M.C3, M.C3, M.G3, M.C3,
      M.A2, M.A2, M.E3, M.A2, M.A2, M.A2, M.E3, M.A2,
      M.F2, M.F2, M.C3, M.F2, M.F2, M.F2, M.C3, M.F2,
      M.G2, M.G2, M.D3, M.G2, M.G2, M.G2, M.B2, M.D3,
    ];
    this.bass = [...B, ...B];
    // 和音パッド (小節頭)
    this.pads = [
      [M.C4, M.E4, M.G4], null, [M.A3, M.C4, M.E4], null,
      [M.F3, M.A3, M.C4], null, [M.G3, M.B3, M.D4], null,
    ];

    const scheduler = () => {
      if (!this.ctx) return;
      while (this.nextStepTime < this.ctx.currentTime + 0.25) {
        this._scheduleStep(this.stepIdx, this.nextStepTime);
        this.nextStepTime += this.stepLen;
        this.stepIdx = (this.stepIdx + 1) % 64;
      }
    };
    this.bgmTimer = setInterval(scheduler, 90);
    scheduler();
  }

  stopBGM() {
    if (this.bgmTimer) { clearInterval(this.bgmTimer); this.bgmTimer = null; }
  }

  _scheduleStep(i, t) {
    const c = this.ctx;
    // --- melody ---
    const f = this.melody[i];
    if (f) {
      const o = c.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = 0.8;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.004, t + this.stepLen * 1.7);
      o.connect(lp); lp.connect(g); g.connect(this.bgmGain);
      o.start(t); o.stop(t + this.stepLen * 2);
      // sparkle 2nd voice one octave up, quieter
      const o2 = c.createOscillator();
      o2.type = 'triangle'; o2.frequency.value = f * 2;
      const g2 = c.createGain();
      g2.gain.setValueAtTime(0.05, t);
      g2.gain.exponentialRampToValueAtTime(0.003, t + this.stepLen);
      o2.connect(g2); g2.connect(this.bgmGain);
      o2.start(t); o2.stop(t + this.stepLen);
    }
    // --- bass (every step) ---
    const bf = this.bass[i % this.bass.length];
    if (bf && i % 2 === 0) {
      const o = c.createOscillator();
      o.type = 'triangle'; o.frequency.value = bf;
      const g = c.createGain();
      g.gain.setValueAtTime(0.22, t);
      g.gain.exponentialRampToValueAtTime(0.01, t + this.stepLen * 0.9);
      o.connect(g); g.connect(this.bgmGain);
      o.start(t); o.stop(t + this.stepLen);
    }
    // --- pad chords (bar heads) ---
    if (i % 8 === 0) {
      const chord = this.pads[(i / 8) % this.pads.length];
      if (chord) {
        for (const cf of chord) {
          const o = c.createOscillator();
          o.type = 'sine'; o.frequency.value = cf;
          const g = c.createGain();
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.05, t + 0.06);
          g.gain.exponentialRampToValueAtTime(0.003, t + this.spb * 1.8);
          o.connect(g); g.connect(this.bgmGain);
          o.start(t); o.stop(t + this.spb * 2);
        }
      }
    }
    // --- hat ticks ---
    if (i % 2 === 1 && this.boostNoiseBuf) {
      const s = c.createBufferSource();
      s.buffer = this.boostNoiseBuf;
      const hp = c.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 8000;
      const g = c.createGain();
      g.gain.setValueAtTime(0.045, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      s.connect(hp); hp.connect(g); g.connect(this.bgmGain);
      s.start(t); s.stop(t + 0.06);
    }
  }

  /* ============================================================
     SFX
     ============================================================ */

  /** ほしゲット: コンボで音階がのぼる キラン♪ */
  collect() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const scale = [NOTE.C6, NOTE.E6, NOTE.G6, NOTE.A6, NOTE.C7];
    const f = scale[this._combo % scale.length];
    this._combo++;
    clearTimeout(this._comboT);
    this._comboT = setTimeout(() => { this._combo = 0; }, 1400);

    const o = c.createOscillator();
    o.type = 'sine'; o.frequency.setValueAtTime(f, t);
    const g = c.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.002, t + 0.3);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t + 0.32);

    const o2 = c.createOscillator();
    o2.type = 'triangle';
    o2.frequency.setValueAtTime(f * 1.5, t + 0.03);
    const g2 = c.createGain();
    g2.gain.setValueAtTime(0.1, t + 0.03);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o2.connect(g2); g2.connect(this.sfxGain);
    o2.start(t + 0.03); o2.stop(t + 0.25);
  }

  /** チャージ中の上昇音 (レベル 0..1 で呼び続ける) */
  setCharge(level) {
    if (!this.ctx) return;
    const c = this.ctx;
    if (level > 0.02) {
      if (!this.chargeOsc) {
        this.chargeOsc = c.createOscillator();
        this.chargeOsc.type = 'sawtooth';
        this.chargeGain = c.createGain();
        this.chargeGain.gain.value = 0;
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 900;
        this.chargeOsc.connect(lp); lp.connect(this.chargeGain);
        this.chargeGain.connect(this.sfxGain);
        this.chargeOsc.start();
      }
      this.chargeOsc.frequency.setTargetAtTime(120 + level * 620, c.currentTime, 0.05);
      this.chargeGain.gain.setTargetAtTime(0.028 + level * 0.05, c.currentTime, 0.05);
    } else if (this.chargeOsc) {
      const o = this.chargeOsc, g = this.chargeGain;
      this.chargeOsc = null; this.chargeGain = null;
      g.gain.setTargetAtTime(0, c.currentTime, 0.03);
      setTimeout(() => { try { o.stop(); } catch (e) {} }, 200);
    }
  }

  /** ブースト発射: ビューン! */
  boost(power = 1) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    // noise whoosh
    const s = c.createBufferSource();
    s.buffer = this.boostNoiseBuf;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(3200, t + 0.28);
    bp.frequency.exponentialRampToValueAtTime(500, t + 0.85);
    const g = c.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.4 * power, t + 0.09);
    g.gain.exponentialRampToValueAtTime(0.003, t + 0.9);
    s.connect(bp); bp.connect(g); g.connect(this.sfxGain);
    s.start(t); s.stop(t + 1);
    // rising gliss
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(240, t);
    o.frequency.exponentialRampToValueAtTime(1400, t + 0.22);
    const og = c.createGain();
    og.gain.setValueAtTime(0.12 * power, t);
    og.gain.exponentialRampToValueAtTime(0.002, t + 0.3);
    o.connect(og); og.connect(this.sfxGain);
    o.start(t); o.stop(t + 0.32);
  }

  /** リング通過ファンファーレ */
  ring() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const arp = [NOTE.C6, NOTE.E6, NOTE.G6, NOTE.C7, NOTE.E7];
    arp.forEach((f, i) => {
      const st = t + i * 0.055;
      const o = c.createOscillator();
      o.type = 'triangle'; o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0.16, st);
      g.gain.exponentialRampToValueAtTime(0.002, st + 0.35);
      o.connect(g); g.connect(this.sfxGain);
      o.start(st); o.stop(st + 0.38);
    });
  }

  /** 1しゅう!ファンファーレ */
  lap() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const seq = [
      [NOTE.C5, 0, 0.12], [NOTE.C5, 0.12, 0.12], [NOTE.C5, 0.24, 0.12],
      [NOTE.G5, 0.4, 0.32], [NOTE.E5, 0.72, 0.16], [NOTE.G5, 0.9, 0.5],
    ];
    for (const [f, dt, len] of seq) {
      for (const [type, mul, vol] of [['square', 1, 0.16], ['triangle', 2, 0.07]]) {
        const o = c.createOscillator();
        o.type = type; o.frequency.value = f * mul;
        const g = c.createGain();
        g.gain.setValueAtTime(vol, t + dt);
        g.gain.exponentialRampToValueAtTime(0.002, t + dt + len);
        o.connect(g); g.connect(this.sfxGain);
        o.start(t + dt); o.stop(t + dt + len + 0.05);
      }
    }
  }

  /** ぽよん (かべ・NPCタッチ) */
  bump() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(340, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.22);
    const g = c.createGain();
    g.gain.setValueAtTime(0.26, t);
    g.gain.exponentialRampToValueAtTime(0.003, t + 0.26);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t + 0.28);
  }

  /** ジャンプ: ひゅーん */
  jump() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(950, t + 0.3);
    const g = c.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.002, t + 0.4);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t + 0.42);
  }

  /** 着地ぽふっ */
  land() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = this.boostNoiseBuf;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 500;
    const g = c.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.005, t + 0.18);
    s.connect(lp); lp.connect(g); g.connect(this.sfxGain);
    s.start(t); s.stop(t + 0.2);
  }

  /** ダッシュパネル: シュイン! */
  dash() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(500, t);
    o.frequency.exponentialRampToValueAtTime(1800, t + 0.18);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2400;
    const g = c.createGain();
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.002, t + 0.28);
    o.connect(lp); lp.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t + 0.3);
  }

  /** ライバルをぬかした: きゃっ♪ */
  pass() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    [[NOTE.A5, 0], [NOTE.C6, 0.07]].forEach(([f, dt]) => {
      const o = c.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0.14, t + dt);
      g.gain.exponentialRampToValueAtTime(0.002, t + dt + 0.16);
      o.connect(g); g.connect(this.sfxGain);
      o.start(t + dt); o.stop(t + dt + 0.18);
    });
  }
}
