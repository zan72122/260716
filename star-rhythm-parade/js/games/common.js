// ================================================================
// RhythmGame — ミニゲーム共通基盤
// ・曲の再生開始時刻(AudioContext時刻)を基準に拍→時刻を計算
// ・タップ判定(ぴったり/いいね/おしい)と自動ミス処理
// ・お手本音や演出イベントの先行スケジューリング
//
// サブクラスが実装するもの:
//   song()        : 楽曲spec
//   buildCues()   : [{beat, ...}] プレイヤーが叩く拍
//   buildGuides() : [{beat, fn(when)}] お手本音・演出の予約(任意)
//   mount()       : 小道具・キャラを this.group に構築(初回のみ)
//   camera()      : {pos, target}
//   onCueHit(cue, grade), onCueMiss(cue), onFreeTap(), tick(dt, beat), onBeat(n)
// ================================================================

import * as THREE from 'three';
import { JUDGE, starCount } from '../config.js';

const PRAISE = {
  perfect: ['ぴったり!', 'すごい!', 'さいこう!', 'きらーん☆'],
  good: ['いいね!', 'じょうず!', 'その ちょうし!'],
  miss: ['おしい!'],
};

export class RhythmGame {
  /**
   * ctx: { audio, world, particles, ui, r3d }
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.visible = false;
    ctx.world.props.add(this.group);
    this.mounted = false;
    this.playing = false;
    this.critters = []; // mount()で登録すると自動update
  }

  /* ---------------- lifecycle ---------------- */

  start(onFinish) {
    if (!this.mounted) { this.mount(); this.mounted = true; }
    this.group.visible = true;
    this.playing = true;
    this.onFinish = onFinish;

    const spec = this.song();
    this.spb = 60 / spec.bpm;

    this.t0 = this.ctx.audio.playSong(spec, {
      delay: 0.6,
      onEnd: () => this._finish(),
    });

    this.cues = this.buildCues().map((c) => ({
      ...c,
      time: this.t0 + c.beat * this.spb,
      judged: false,
    }));
    this.guides = (this.buildGuides ? this.buildGuides() : []).map((g) => ({
      ...g,
      time: this.t0 + g.beat * this.spb,
      scheduled: false,
    }));

    this.hits = 0;
    this.perfects = 0;
    this._lastBeat = -999;
    this._guideIdx = 0;

    this.ctx.ui.setHudStars(0);
    this.reset();
  }

  stop() {
    this.playing = false;
    this.group.visible = false;
    this.ctx.audio.stopSong();
  }

  _finish() {
    if (!this.playing) return;
    this.playing = false;
    const total = this.cues.length || 1;
    const rate = this.hits / total;
    const stars = starCount(rate);
    const cb = this.onFinish;
    this.onFinish = null;
    if (cb) cb({ stars, hits: this.hits, perfects: this.perfects, total, rate });
  }

  /* ---------------- 時間ヘルパ ---------------- */

  /** 曲頭からの経過秒 */
  get songTime() { return this.ctx.audio.now - this.t0; }
  /** 曲頭からの経過拍(小数) */
  get songBeat() { return this.songTime / this.spb; }
  beatTime(b) { return this.t0 + b * this.spb; }

  /* ---------------- 更新 ---------------- */

  update(dt) {
    if (!this.playing) return;
    const now = this.ctx.audio.now;
    const beat = this.songBeat;

    // お手本音・演出の先行予約(0.25秒先まで)
    while (this._guideIdx < this.guides.length && this.guides[this._guideIdx].time < now + 0.25) {
      const g = this.guides[this._guideIdx++];
      if (g.time > now - 0.1) g.fn(Math.max(g.time, now));
    }

    // 取り逃したキューを自動ミスに(音は鳴らさず、キャラだけ小さく反応)
    for (const c of this.cues) {
      if (!c.judged && now > c.time + JUDGE.good) {
        c.judged = true;
        c.grade = 'miss';
        this.onCueMiss(c);
      }
    }

    // 拍の頭で世界がはずむ
    const bi = Math.floor(beat);
    if (bi !== this._lastBeat && beat >= 0) {
      this._lastBeat = bi;
      this.ctx.world.onBeat(bi % 4 === 0 ? 1 : 0.55);
      if (this.onBeat) this.onBeat(bi);
    }

    this.tick(dt, beat);
    for (const c of this.critters) c.update(dt);
  }

  /* ---------------- 入力 ---------------- */

  onTap() {
    if (!this.playing) return;
    const now = this.ctx.audio.now;

    // 一番近い未判定キューを探す
    let best = null;
    let bestAbs = Infinity;
    for (const c of this.cues) {
      if (c.judged) continue;
      const d = Math.abs(now - c.time);
      if (d < bestAbs) { bestAbs = d; best = c; }
    }

    if (best && bestAbs <= JUDGE.perfect) {
      best.judged = true;
      best.grade = 'perfect';
      this.hits++; this.perfects++;
      this.ctx.audio.perfect();
      this.ctx.ui.feedback(pick(PRAISE.perfect), 'perfect');
      this.ctx.ui.setHudStars(this.hits);
      this.ctx.ui.flash();
      this.onCueHit(best, 'perfect');
    } else if (best && bestAbs <= JUDGE.good) {
      best.judged = true;
      best.grade = 'good';
      this.hits++;
      this.ctx.audio.good();
      this.ctx.ui.feedback(pick(PRAISE.good), 'good');
      this.ctx.ui.setHudStars(this.hits);
      this.onCueHit(best, 'good');
    } else if (best && bestAbs <= 0.55) {
      // 早すぎ/遅すぎ(でも狙ってた)→ おしい!
      best.judged = true;
      best.grade = 'miss';
      this.ctx.audio.miss();
      this.ctx.ui.feedback(PRAISE.miss[0], 'miss');
      this.onCueMiss(best, true);
    } else {
      // リズムに関係ないタップ → 軽い手応えだけ(減点なし)
      this.ctx.audio.tap();
      this.onFreeTap();
    }
  }

  /* ---------------- サブクラスのデフォルト ---------------- */

  reset() {}
  tick() {}
  onCueHit() {}
  onCueMiss() {}
  onFreeTap() {}
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
