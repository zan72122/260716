/* ============================================================
   audio.js — 全て WebAudio で合成する環境音 & 効果音
   (音声ファイル不要 / iOS はユーザー操作で unlock)
   ・自販機のハム音 + コンプレッサー周期運転
   ・物理接触イベント駆動の硬貨チャリン / 缶ゴトン / フラップのガコンッ
   ・スローモーション時はピッチ/時間も引き伸ばす
   ============================================================ */

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ambGain = null;
    this.sfxGain = null;
    this.muted = false;
    this.noiseBuf = null;
    this.timeScale = 1;
    this._lastSfx = new Map();     // body id → 最終発音時刻 (スロットル)
    this._humOsc = null;
    this._compTimer = 0;
    this._compOn = false;
    this._compNodes = null;
    this._motorNodes = null;
  }

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

    this.ambGain = this.ctx.createGain();
    this.ambGain.gain.value = 0.55;
    this.ambGain.connect(this.master);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.9;
    this.sfxGain.connect(this.master);

    const len = this.ctx.sampleRate * 1.2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this._startHum();
    this._compTimer = 6 + Math.random() * 10;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
    }
  }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume()  { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  /* ---- 自販機のハム音 (60Hz + 120Hz + ノイズ床) ---- */
  _startHum() {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = 0.05;
    g.connect(this.ambGain);
    const o1 = c.createOscillator();
    o1.type = 'triangle'; o1.frequency.value = 60;
    const g1 = c.createGain(); g1.gain.value = 0.6;
    o1.connect(g1); g1.connect(g);
    const o2 = c.createOscillator();
    o2.type = 'sine'; o2.frequency.value = 120;
    const g2 = c.createGain(); g2.gain.value = 0.25;
    o2.connect(g2); g2.connect(g);
    const n = c.createBufferSource();
    n.buffer = this.noiseBuf; n.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 240;
    const g3 = c.createGain(); g3.gain.value = 0.10;
    n.connect(lp); lp.connect(g3); g3.connect(g);
    // ゆっくりした振幅ゆらぎ
    const lfo = c.createOscillator();
    lfo.type = 'sine'; lfo.frequency.value = 0.4;
    const lfoG = c.createGain(); lfoG.gain.value = 0.012;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    o1.start(); o2.start(); n.start(); lfo.start();
    this._humOsc = { o1, o2, g };
  }

  /* ---- コンプレッサー周期運転 (数十秒おきに20秒回る) ---- */
  tick(dt) {
    if (!this.ctx) return;
    this._compTimer -= dt;
    if (this._compTimer <= 0) {
      if (this._compOn) {
        this._stopCompressor();
        this._compTimer = 35 + Math.random() * 45;
      } else {
        this._startCompressor();
        this._compTimer = 16 + Math.random() * 10;
      }
      this._compOn = !this._compOn;
    }
  }

  _startCompressor() {
    const c = this.ctx, t = c.currentTime;
    this._clunk(0.5);
    const n = c.createBufferSource();
    n.buffer = this.noiseBuf; n.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 180; bp.Q.value = 1.4;
    const o = c.createOscillator();
    o.type = 'sawtooth'; o.frequency.value = 100 * this._pitchK();
    const og = c.createGain(); og.gain.value = 0.25;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.075, t + 1.6);
    n.connect(bp); bp.connect(g);
    o.connect(og); og.connect(g);
    g.connect(this.ambGain);
    n.start(); o.start();
    this._compNodes = { n, o, g };
  }

  _stopCompressor() {
    if (!this._compNodes) return;
    const { n, o, g } = this._compNodes;
    const t = this.ctx.currentTime;
    g.gain.setTargetAtTime(0.0001, t, 0.4);
    setTimeout(() => { try { n.stop(); o.stop(); } catch (e) {} }, 1600);
    this._clunk(0.4);
    this._compNodes = null;
  }

  _clunk(vol = 0.5) {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.09);
    const g = c.createGain();
    g.gain.setValueAtTime(vol * 0.4, t);
    g.gain.exponentialRampToValueAtTime(0.003, t + 0.14);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t + 0.16);
  }

  /* スローモーション係数 (√でピッチ・1/xで時間) */
  setTimeScale(s) {
    this.timeScale = s;
    if (this._humOsc && this.ctx) {
      const k = Math.sqrt(Math.max(0.08, s));
      this._humOsc.o1.frequency.setTargetAtTime(60 * k, this.ctx.currentTime, 0.15);
      this._humOsc.o2.frequency.setTargetAtTime(120 * k, this.ctx.currentTime, 0.15);
      this._humOsc.g.gain.setTargetAtTime(s === 0 ? 0.012 : 0.05, this.ctx.currentTime, 0.2);
    }
    if (this._motorNodes) {
      const k = Math.sqrt(Math.max(0.08, s));
      this._motorNodes.o.frequency.setTargetAtTime(90 * k, this.ctx.currentTime, 0.1);
    }
  }

  _pitchK() { return Math.sqrt(Math.max(0.08, this.timeScale)); }
  _timeK() { return 1 / Math.max(0.2, Math.sqrt(Math.max(0.08, this.timeScale))); }

  /* ============================================================
     物理接触イベント → 効果音
     info: {body, material, jn, x, y}
     ============================================================ */
  contact(info) {
    if (!this.ctx || this.timeScale === 0) return;
    const now = this.ctx.currentTime;
    const last = this._lastSfx.get(info.body.id) ?? -1;
    if (now - last < 0.045) return;
    const vol = Math.min(1, info.jn / (info.body.userData.kind === 'coin' ? 0.004 : 0.05));
    if (vol < 0.06) return;
    this._lastSfx.set(info.body.id, now);
    const kind = info.body.userData.kind;
    if (kind === 'coin') {
      if (info.material === 'coin2') this._coinClack(vol, info.body.userData.denom);
      else if (info.material === 'plastic') this._coinCup(vol, info.body.userData.denom);
      else this._coinTick(vol, info.body.userData.denom);
    } else if (kind === 'product') {
      const pet = info.body.userData.product.kind === 'pet';
      if (info.material === 'flap' || info.material === 'port') this._bigThunk(vol, pet);
      else this._canThunk(vol, pet, info.body.userData.product.r);
    }
  }

  /* 硬貨がレール/金属に当たる: 高い金属チン (金種で音程差) */
  _coinTick(vol, denom) {
    const c = this.ctx, t = c.currentTime;
    // 直径が小さいほど高い音
    const base = { 10: 5200, 50: 6000, 100: 5600, 500: 4300 }[denom] ?? 5000;
    const k = this._pitchK(), tk = this._timeK();
    for (const [mul, v] of [[1, 0.5], [1.483, 0.3], [2.31, 0.14]]) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = base * mul * k * (0.98 + Math.random() * 0.04);
      const g = c.createGain();
      g.gain.setValueAtTime(vol * v * 0.16, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.05 * tk);
      o.connect(g); g.connect(this.sfxGain);
      o.start(t); o.stop(t + 0.06 * tk);
    }
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 6000 * k;
    const g = c.createGain();
    g.gain.setValueAtTime(vol * 0.05, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.02 * tk);
    s.connect(hp); hp.connect(g); g.connect(this.sfxGain);
    s.start(t); s.stop(t + 0.03 * tk);
  }

  /* 硬貨同士: 詰まった低めのカチッ */
  _coinClack(vol, denom) {
    const c = this.ctx, t = c.currentTime;
    const k = this._pitchK(), tk = this._timeK();
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = (2600 + (500 - denom) * 2) * k;
    const g = c.createGain();
    g.gain.setValueAtTime(vol * 0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.045 * tk);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t + 0.05 * tk);
  }

  /* 硬貨がプラスチックのカップへ: コトッ */
  _coinCup(vol, denom) {
    const c = this.ctx, t = c.currentTime;
    const k = this._pitchK(), tk = this._timeK();
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(1500 * k, t);
    o.frequency.exponentialRampToValueAtTime(700 * k, t + 0.05 * tk);
    const g = c.createGain();
    g.gain.setValueAtTime(vol * 0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09 * tk);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t + 0.1 * tk);
  }

  /* 缶/ペットが棚に当たる: コンッ */
  _canThunk(vol, pet, r) {
    const c = this.ctx, t = c.currentTime;
    const k = this._pitchK(), tk = this._timeK();
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = (pet ? 420 : 900 - r * 8000) * k;
    bp.Q.value = pet ? 0.9 : 1.8;
    const g = c.createGain();
    g.gain.setValueAtTime(vol * (pet ? 0.24 : 0.3), t);
    g.gain.exponentialRampToValueAtTime(0.002, t + (pet ? 0.07 : 0.1) * tk);
    s.connect(bp); bp.connect(g); g.connect(this.sfxGain);
    s.start(t); s.stop(t + 0.12 * tk);
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime((pet ? 150 : 210) * k, t);
    o.frequency.exponentialRampToValueAtTime(70 * k, t + 0.08 * tk);
    const og = c.createGain();
    og.gain.setValueAtTime(vol * 0.2, t);
    og.gain.exponentialRampToValueAtTime(0.002, t + 0.1 * tk);
    o.connect(og); og.connect(this.sfxGain);
    o.start(t); o.stop(t + 0.12 * tk);
  }

  /* フラップ/取出口に当たる: ガコンッ! */
  _bigThunk(vol, pet) {
    const c = this.ctx, t = c.currentTime;
    const k = this._pitchK(), tk = this._timeK();
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900 * k;
    const g = c.createGain();
    g.gain.setValueAtTime(vol * 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.003, t + 0.22 * tk);
    s.connect(lp); lp.connect(g); g.connect(this.sfxGain);
    s.start(t); s.stop(t + 0.24 * tk);
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(95 * k, t);
    o.frequency.exponentialRampToValueAtTime(48 * k, t + 0.16 * tk);
    const og = c.createGain();
    og.gain.setValueAtTime(vol * 0.42, t);
    og.gain.exponentialRampToValueAtTime(0.002, t + 0.28 * tk);
    o.connect(og); og.connect(this.sfxGain);
    o.start(t); o.stop(t + 0.3 * tk);
  }

  /* ============ UI/機構の一発音 ============ */

  /** 硬貨投入口に入る音 */
  coinInsert() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 3000; bp.Q.value = 2;
    const g = c.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.002, t + 0.08);
    s.connect(bp); bp.connect(g); g.connect(this.sfxGain);
    s.start(t); s.stop(t + 0.1);
  }

  /** 検銭OK: チャリーン (認証チャイム) */
  accept(denom) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const f = { 10: 1980, 50: 2350, 100: 2140, 500: 1760 }[denom] ?? 2000;
    for (const [dt, mul, v] of [[0, 1, 0.2], [0.045, 1.5, 0.1]]) {
      const o = c.createOscillator();
      o.type = 'sine'; o.frequency.value = f * mul;
      const g = c.createGain();
      g.gain.setValueAtTime(v, t + dt);
      g.gain.exponentialRampToValueAtTime(0.002, t + dt + 0.28);
      o.connect(g); g.connect(this.sfxGain);
      o.start(t + dt); o.stop(t + dt + 0.3);
    }
  }

  /** ボタン: ピッ */
  beep() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'square'; o.frequency.value = 2093;
    const g = c.createGain();
    g.gain.setValueAtTime(0.11, t);
    g.gain.setValueAtTime(0.11, t + 0.05);
    g.gain.linearRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t + 0.08);
  }

  /** 押せないボタン: ブーッ */
  buzz() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'square'; o.frequency.value = 160;
    const g = c.createGain();
    g.gain.setValueAtTime(0.09, t);
    g.gain.setValueAtTime(0.09, t + 0.18);
    g.gain.linearRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t + 0.24);
  }

  /** ベンドモーター始動/停止 */
  motorStart() {
    if (!this.ctx || this._motorNodes) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 90 * this._pitchK();
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 500;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.1);
    o.connect(lp); lp.connect(g); g.connect(this.sfxGain);
    o.start();
    this._motorNodes = { o, g };
  }
  motorStop() {
    if (!this._motorNodes) return;
    const { o, g } = this._motorNodes;
    g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.08);
    setTimeout(() => { try { o.stop(); } catch (e) {} }, 500);
    this._motorNodes = null;
  }

  /** 払出しエジェクタ: カシャッ */
  eject() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2500;
    const g = c.createGain();
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.002, t + 0.05);
    s.connect(hp); hp.connect(g); g.connect(this.sfxGain);
    s.start(t); s.stop(t + 0.06);
    this._clunk(0.25);
  }

  /** 返却レバー: ガチャ */
  lever() {
    if (!this.ctx) return;
    this._clunk(0.7);
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 1.2;
    const g = c.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.002, t + 0.11);
    s.connect(bp); bp.connect(g); g.connect(this.sfxGain);
    s.start(t); s.stop(t + 0.12);
  }

  /** 扉のきしみ */
  doorCreak(open) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 6;
    bp.frequency.setValueAtTime(open ? 300 : 500, t);
    bp.frequency.exponentialRampToValueAtTime(open ? 700 : 250, t + 0.7);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.002, t + 0.8);
    s.connect(bp); bp.connect(g); g.connect(this.sfxGain);
    s.start(t); s.stop(t + 0.9);
    setTimeout(() => this._clunk(0.5), open ? 750 : 500);
  }

  /** 商品を取った: シュポ */
  take() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(500, t);
    o.frequency.exponentialRampToValueAtTime(1100, t + 0.14);
    const g = c.createGain();
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.002, t + 0.2);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t + 0.22);
  }

  /** 回収: ジャラジャラ */
  jingle(n = 6) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    for (let i = 0; i < Math.min(n, 10); i++) {
      const st = t + i * 0.05 + Math.random() * 0.02;
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = 3800 + Math.random() * 2600;
      const g = c.createGain();
      g.gain.setValueAtTime(0.08, st);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.07);
      o.connect(g); g.connect(this.sfxGain);
      o.start(st); o.stop(st + 0.08);
    }
  }
}
