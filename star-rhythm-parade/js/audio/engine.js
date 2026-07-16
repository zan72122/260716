// ================================================================
// AudioEngine — WebAudio だけで音楽と効果音を完全合成する。
// 外部音源ファイルは一切使わない(オフラインでも鳴る・軽い)。
//
// ・playSong(spec): songs.js のステップシーケンサ譜面を演奏
// ・sfx 系メソッド: when(AudioContext時刻)指定でぴったり鳴らせる
// ・時刻の基準はすべて AudioContext.currentTime(端末間で最も正確)
// ================================================================

const NOTE_BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'C4' 'F#3' 'Bb2' → 周波数(Hz) */
export function noteHz(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) return 440;
  let semi = NOTE_BASE[m[1]];
  if (m[2] === '#') semi += 1;
  if (m[2] === 'b') semi -= 1;
  const oct = parseInt(m[3], 10);
  const midi = (oct + 1) * 12 + semi;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
    this._noiseBuf = null;

    // song playback state
    this._events = [];      // {t, fn} sorted by t
    this._evIdx = 0;
    this._timer = null;
    this._song = null;
    this.songStart = 0;
    this.songEnd = 0;
    this._loop = false;
    this._onEnd = null;
    this._endedFired = true;
  }

  /* ---------------- lifecycle ---------------- */

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });

      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 20;
      comp.ratio.value = 6;
      comp.attack.value = 0.004;
      comp.release.value = 0.18;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.62;
      this.musicBus.connect(this.master);

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 1.0;
      this.sfxBus.connect(this.master);

      // 共有ノイズバッファ(2秒)
      const len = this.ctx.sampleRate * 2;
      this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this._noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      // iOSはバックグラウンド復帰でsuspendされることがある
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && this.ctx && this.ctx.state === 'suspended') {
          this.ctx.resume();
        }
      });
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    // 無音を一発鳴らして確実にアンロック
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    g.gain.value = 0.0001;
    o.connect(g); g.connect(this.ctx.destination);
    o.start(); o.stop(this.ctx.currentTime + 0.02);
  }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  /* ---------------- song sequencer ---------------- */

  /**
   * spec: songs.js 形式 { bpm, sections:[{repeat, drums:{kick,hat,snare,clap},
   *        bass:[[step,note,len?]], lead:[[step,note,len?]], chords:[[step,[notes],len?]] }] }
   * 返り値: 開始時刻(AudioContext時刻)。拍計算の基準に使う。
   */
  playSong(spec, { loop = false, onEnd = null, delay = 0.25 } = {}) {
    this.stopSong();
    const t0 = this.now + delay;
    this._song = spec;
    this._loop = loop;
    this._onEnd = onEnd;
    this._endedFired = false;
    this.songStart = t0;

    this._events = this._buildEvents(spec, t0);
    this._evIdx = 0;
    this.songEnd = t0 + this._songDuration(spec);

    this._timer = setInterval(() => this._pump(), 25);
    this._pump();
    return t0;
  }

  stopSong() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this._events = [];
    this._evIdx = 0;
    this._endedFired = true;
  }

  /** 曲開始からの経過秒(演奏していなければ -1) */
  get songTime() {
    if (!this._song) return -1;
    return this.now - this.songStart;
  }

  _songDuration(spec) {
    const spb = 60 / spec.bpm;
    let measures = 0;
    for (const s of spec.sections) measures += (s.repeat || 1);
    return measures * 4 * spb;
  }

  _buildEvents(spec, t0) {
    const ev = [];
    const spb = 60 / spec.bpm;       // 1拍の秒数
    const stepDur = spb / 4;         // 16分音符
    let tm = t0;                     // 小節先頭時刻

    for (const sec of spec.sections) {
      const rep = sec.repeat || 1;
      for (let r = 0; r < rep; r++) {
        const base = tm;
        const drums = sec.drums || {};
        for (const [kind, pat] of Object.entries(drums)) {
          for (let i = 0; i < pat.length && i < 16; i++) {
            if (pat[i] !== 'x' && pat[i] !== 'X') continue;
            const t = base + i * stepDur;
            const acc = pat[i] === 'X' ? 1.25 : 1;
            if (kind === 'kick') ev.push({ t, fn: () => this._kick(t, acc) });
            else if (kind === 'hat') ev.push({ t, fn: () => this._hat(t, acc) });
            else if (kind === 'snare') ev.push({ t, fn: () => this._snare(t, acc) });
            else if (kind === 'clap') ev.push({ t, fn: () => this._clap(t, acc) });
            else if (kind === 'shaker') ev.push({ t, fn: () => this._shaker(t, acc) });
          }
        }
        for (const [step, note, len = 2] of (sec.bass || [])) {
          const t = base + step * stepDur;
          ev.push({ t, fn: () => this._bass(t, noteHz(note), len * stepDur) });
        }
        for (const [step, note, len = 2] of (sec.lead || [])) {
          const t = base + step * stepDur;
          ev.push({ t, fn: () => this._lead(t, noteHz(note), len * stepDur) });
        }
        for (const [step, notes, len = 4] of (sec.chords || [])) {
          const t = base + step * stepDur;
          ev.push({ t, fn: () => this._chord(t, notes.map(noteHz), len * stepDur) });
        }
        for (const [step, note, len = 4] of (sec.bell || [])) {
          const t = base + step * stepDur;
          ev.push({ t, fn: () => this._bell(t, noteHz(note), len * stepDur) });
        }
        tm += 16 * stepDur;
      }
    }
    ev.sort((a, b) => a.t - b.t);
    return ev;
  }

  _pump() {
    if (!this.ctx) return;
    const horizon = this.now + 0.18;
    while (this._evIdx < this._events.length && this._events[this._evIdx].t < horizon) {
      const e = this._events[this._evIdx++];
      if (e.t > this.now - 0.05) e.fn();
    }
    if (this._evIdx >= this._events.length) {
      if (this._loop && this._song) {
        // そのままシームレスに次周へ
        const t0 = this.songEnd;
        this.songStart = t0;
        this._events = this._buildEvents(this._song, t0);
        this._evIdx = 0;
        this.songEnd = t0 + this._songDuration(this._song);
      } else if (!this._endedFired && this.now >= this.songEnd) {
        this._endedFired = true;
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
        const cb = this._onEnd;
        this._onEnd = null;
        if (cb) cb();
      }
    }
  }

  /* ---------------- instruments ---------------- */

  _env(t, a, d, peak = 1, sustain = 0, r = 0.03) {
    const g = this.ctx.createGain();
    const p = g.gain;
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(peak, t + a);
    p.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t + a + d);
    return g;
  }

  _kick(t, acc = 1) {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    const g = this._env(t, 0.002, 0.16, 0.85 * acc);
    o.connect(g); g.connect(this.musicBus);
    o.start(t); o.stop(t + 0.2);
  }

  _hat(t, acc = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this._noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 7500;
    const g = this._env(t, 0.001, 0.05, 0.16 * acc);
    s.connect(f); f.connect(g); g.connect(this.musicBus);
    s.start(t); s.stop(t + 0.08);
  }

  _shaker(t, acc = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this._noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 5200; f.Q.value = 1.4;
    const g = this._env(t, 0.02, 0.09, 0.12 * acc);
    s.connect(f); f.connect(g); g.connect(this.musicBus);
    s.start(t); s.stop(t + 0.15);
  }

  _snare(t, acc = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this._noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.8;
    const g = this._env(t, 0.001, 0.12, 0.4 * acc);
    s.connect(f); f.connect(g); g.connect(this.musicBus);
    s.start(t); s.stop(t + 0.18);
    const o = this.ctx.createOscillator();
    o.type = 'triangle'; o.frequency.setValueAtTime(210, t);
    const g2 = this._env(t, 0.001, 0.07, 0.25 * acc);
    o.connect(g2); g2.connect(this.musicBus);
    o.start(t); o.stop(t + 0.1);
  }

  _clap(t, acc = 1) {
    for (let i = 0; i < 3; i++) {
      const tt = t + i * 0.012;
      const s = this.ctx.createBufferSource();
      s.buffer = this._noiseBuf;
      s.playbackRate.value = 1 + i * 0.06;
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 1.6;
      const g = this._env(tt, 0.001, 0.09, 0.3 * acc);
      s.connect(f); f.connect(g); g.connect(this.musicBus);
      s.start(tt); s.stop(tt + 0.12);
    }
  }

  _bass(t, hz, dur) {
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = hz;
    const o2 = this.ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.value = hz;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 700;
    const g = this._env(t, 0.006, dur, 0.42, 0.0001);
    const g2 = this.ctx.createGain(); g2.gain.value = 0.25;
    o.connect(g); o2.connect(g2); g2.connect(g);
    g.connect(f); f.connect(this.musicBus);
    o.start(t); o.stop(t + dur + 0.05);
    o2.start(t); o2.stop(t + dur + 0.05);
  }

  _lead(t, hz, dur) {
    const g = this._env(t, 0.008, dur * 1.1, 0.2, 0.0001);
    for (const det of [-4, 4]) {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = hz;
      o.detune.value = det;
      o.connect(g);
      o.start(t); o.stop(t + dur + 0.08);
    }
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 3600;
    g.connect(f); f.connect(this.musicBus);
  }

  _chord(t, hzs, dur) {
    for (const hz of hzs) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = hz;
      const g = this._env(t, 0.02, dur, 0.09, 0.0001);
      o.connect(g); g.connect(this.musicBus);
      o.start(t); o.stop(t + dur + 0.1);
    }
  }

  _bell(t, hz, dur) {
    const o = this.ctx.createOscillator();
    o.type = 'sine'; o.frequency.value = hz;
    const o2 = this.ctx.createOscillator();
    o2.type = 'sine'; o2.frequency.value = hz * 3.01;
    const g = this._env(t, 0.002, dur, 0.16, 0.0001);
    const g2 = this._env(t, 0.002, dur * 0.4, 0.05, 0.0001);
    o.connect(g); o2.connect(g2); g2.connect(g);
    g.connect(this.musicBus);
    o.start(t); o.stop(t + dur + 0.1);
    o2.start(t); o2.stop(t + dur + 0.1);
  }

  /* ---------------- SFX (ゲーム用) ---------------- */

  /** お手本の合図音(NPCの「ぽん」)。pitchで音程を変えられる */
  cue(when = this.now, pitch = 1) {
    const t = Math.max(when, this.now);
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(620 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(430 * pitch, t + 0.09);
    const g = this._env(t, 0.004, 0.14, 0.5);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.2);
  }

  /** プレイヤーのタップ音(判定前の手応え) */
  tap(when = this.now) {
    const t = Math.max(when, this.now);
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(880, t);
    o.frequency.exponentialRampToValueAtTime(660, t + 0.05);
    const g = this._env(t, 0.002, 0.08, 0.3);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.12);
  }

  /** ぴったり!(キラキラ上昇アルペジオ) */
  perfect(when = this.now) {
    const t = Math.max(when, this.now);
    const seq = [1046.5, 1318.5, 1568, 2093]; // C6 E6 G6 C7
    seq.forEach((hz, i) => {
      const tt = t + i * 0.055;
      const o = this.ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = hz;
      const g = this._env(tt, 0.003, 0.22, 0.32);
      o.connect(g); g.connect(this.sfxBus);
      o.start(tt); o.stop(tt + 0.3);
    });
    // シャリッとした空気感
    const s = this.ctx.createBufferSource();
    s.buffer = this._noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 9000;
    const g = this._env(t, 0.01, 0.3, 0.1);
    s.connect(f); f.connect(g); g.connect(this.sfxBus);
    s.start(t); s.stop(t + 0.35);
  }

  /** いいね!(二音チャイム) */
  good(when = this.now) {
    const t = Math.max(when, this.now);
    [784, 1046.5].forEach((hz, i) => {
      const tt = t + i * 0.07;
      const o = this.ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = hz;
      const g = this._env(tt, 0.004, 0.18, 0.3);
      o.connect(g); g.connect(this.sfxBus);
      o.start(tt); o.stop(tt + 0.25);
    });
  }

  /** おしい…(ふわっと下がる・悲しくしすぎない) */
  miss(when = this.now) {
    const t = Math.max(when, this.now);
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(340, t + 0.16);
    const g = this._env(t, 0.008, 0.2, 0.22);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.26);
  }

  /** もちつきの「ぺったん!」 */
  pettan(when = this.now) {
    const t = Math.max(when, this.now);
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.12);
    const g = this._env(t, 0.002, 0.18, 0.9);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.25);
    const s = this.ctx.createBufferSource();
    s.buffer = this._noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 1200;
    const g2 = this._env(t, 0.001, 0.08, 0.35);
    s.connect(f); f.connect(g2); g2.connect(this.sfxBus);
    s.start(t); s.stop(t + 0.12);
  }

  /** ジャンプの「ぼよん!」 */
  boing(when = this.now) {
    const t = Math.max(when, this.now);
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(760, t + 0.14);
    const g = this._env(t, 0.004, 0.2, 0.4);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.26);
  }

  /** 星キャッチの「しゃらん」 */
  sparkle(when = this.now) {
    const t = Math.max(when, this.now);
    [1568, 1976, 2637].forEach((hz, i) => {
      const tt = t + i * 0.04;
      const o = this.ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = hz;
      const g = this._env(tt, 0.002, 0.16, 0.22);
      o.connect(g); g.connect(this.sfxBus);
      o.start(tt); o.stop(tt + 0.22);
    });
  }

  /** 決定ボタン */
  select(when = this.now) {
    const t = Math.max(when, this.now);
    [660, 880].forEach((hz, i) => {
      const tt = t + i * 0.06;
      const o = this.ctx.createOscillator();
      o.type = 'square'; o.frequency.value = hz;
      const g = this._env(tt, 0.003, 0.1, 0.14);
      o.connect(g); g.connect(this.sfxBus);
      o.start(tt); o.stop(tt + 0.15);
    });
  }

  /** リザルトのファンファーレ */
  fanfare(when = this.now) {
    const t = Math.max(when, this.now);
    const seq = [
      [0, 523.25], [0.12, 659.25], [0.24, 784], [0.36, 1046.5],
      [0.6, 784], [0.72, 1046.5],
    ];
    for (const [dt, hz] of seq) {
      const tt = t + dt;
      for (const det of [-5, 5]) {
        const o = this.ctx.createOscillator();
        o.type = 'square'; o.frequency.value = hz; o.detune.value = det;
        const g = this._env(tt, 0.004, 0.22, 0.12);
        o.connect(g); g.connect(this.sfxBus);
        o.start(tt); o.stop(tt + 0.3);
      }
    }
    this.perfect(t + 0.85);
  }

  /** 歓声っぽい「わーっ」 */
  cheer(when = this.now) {
    const t = Math.max(when, this.now);
    const s = this.ctx.createBufferSource();
    s.buffer = this._noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(700, t);
    f.frequency.linearRampToValueAtTime(1500, t + 0.5);
    f.Q.value = 1.2;
    const g = this._env(t, 0.12, 0.8, 0.3);
    s.connect(f); f.connect(g); g.connect(this.sfxBus);
    s.start(t); s.stop(t + 1);
  }
}
