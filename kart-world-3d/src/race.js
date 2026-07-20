// race.js — アーケードカート物理・AI・ラップ管理・アイテム
import * as THREE from 'three';
import { ROAD_HALF, WALL_HALF } from './world.js';
import { animateKart } from './kart.js';

export const LAPS = 3;
export const ITEM_TYPES = ['rocket', 'star', 'magnet'];

const MAX_SPEED = 36;
const ACCEL = 16;
const STEER_RATE = 11.5;

export class Racer {
  constructor(kart, index, isPlayer) {
    this.kart = kart;
    this.index = index;
    this.isPlayer = isPlayer;
    this.s = 0;
    this.lat = 0;
    this.speed = 0;
    this.steer = 0;
    this.lap = 0; // スタートラインを最初に切って 1 周目開始
    this.prevS = 0;
    this.coins = 0;
    this.item = null;
    this.itemTimer = 0;
    this.boostT = 0;
    this.starT = 0;
    this.magnetT = 0;
    this.finished = false;
    this.rank = index + 1;
    this.aiPhase = index * 2.3 + 1.1;
    this.aiSkill = [0, 0.965, 0.93, 0.90][index] || 0.9;
    this.bumpCool = 0;
    this.offroad = false;
  }
  progressKey(total) { return this.lap * total + this.s; }
}

export class Race {
  constructor(world, racers, fx, audio, hooks) {
    this.world = world;
    this.track = world.track;
    this.racers = racers;
    this.fx = fx;
    this.audio = audio;
    this.hooks = hooks; // { onLap, onCoin, onItem, onRank, onFinish, onBoost, toast }
    this.phase = 'grid'; // grid | racing | done
    this.playerFinished = false;
    this._smp = {};
    this._smp2 = {};
    this.placeOnGrid();
  }

  placeOnGrid() {
    const total = this.track.total;
    const n = this.racers.length;
    this.racers.forEach((r, i) => {
      // プレイヤー（i=0）は最後尾：自分のカートが常によく見えて、抜く楽しさもある
      const slot = n - 1 - i;
      r.s = total - 9 - Math.floor(slot / 2) * 7;
      r.lat = (slot % 2 === 0 ? -1 : 1) * 3.6;
      r.speed = 0; r.lap = 0; r.coins = 0; r.item = null;
      r.boostT = r.starT = r.magnetT = 0;
      r.finished = false;
      r.prevS = r.s;
      this.applyTransform(r, 0);
    });
  }

  start() { this.phase = 'racing'; }

  /* s, lat からカートの位置と向きを決める */
  applyTransform(r, dt) {
    const t1 = this.track.sample(r.s, this._smp);
    const pos = new THREE.Vector3().copy(t1.pos).addScaledVector(t1.side, r.lat);
    const t2 = this.track.sample(r.s + 2.5, this._smp2);
    const ahead = new THREE.Vector3().copy(t2.pos).addScaledVector(t2.side, r.lat);
    r.kart.position.copy(pos);
    const dir = ahead.sub(pos).normalize();
    // ドリフト風に少し外へ向く
    const yaw = Math.atan2(dir.x, dir.z) - r.steer * 0.28;
    const pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    r.kart.rotation.set(0, yaw, 0);
    r.kart.rotateX(-pitch);
  }

  maxSpeedFor(r) {
    let m = MAX_SPEED;
    if (!r.isPlayer) {
      m *= r.aiSkill;
      // ラバーバンド：プレイヤーとの差で加減速
      const total = this.track.total;
      const player = this.racers[0];
      const diff = player.progressKey(total) - r.progressKey(total);
      if (diff > 40) m *= 1.16;
      else if (diff > 15) m *= 1.07;
      else if (diff < -30) m *= 0.86;
      else if (diff < -10) m *= 0.95;
    } else {
      m *= 1 + Math.min(r.coins, 10) * 0.006; // コインでちょっと速く
    }
    if (r.boostT > 0) m *= 1.45;
    if (r.starT > 0) m *= 1.25;
    if (r.offroad && r.boostT <= 0 && r.starT <= 0) m *= 0.72;
    return m;
  }

  update(dt, t, input) {
    if (this.phase === 'grid') {
      // グリッドで待機（アイドル演出のみ）
      for (const r of this.racers) {
        animateKart(r.kart, dt, t, {
          speed: 0, steer: 0, maxSpeed: MAX_SPEED, boosting: false, star: 0, airborne: false,
        });
      }
      return;
    }

    const total = this.track.total;

    for (const r of this.racers) {
      r.bumpCool = Math.max(0, r.bumpCool - dt);
      r.boostT = Math.max(0, r.boostT - dt);
      r.starT = Math.max(0, r.starT - dt);
      r.magnetT = Math.max(0, r.magnetT - dt);

      // ---- ステアリング ----
      let steerInput;
      if (r.isPlayer && !r.finished) {
        steerInput = input.steer;
      } else {
        steerInput = this.aiSteer(r, t);
      }
      r.steer += (steerInput - r.steer) * Math.min(1, dt * 7);

      // ---- 加速（オートアクセル） ----
      const maxS = this.maxSpeedFor(r) * (r.finished ? 0.55 : 1);
      r.speed += (maxS - r.speed) * Math.min(1, dt * (r.speed < maxS ? ACCEL / 8 : 3.2));
      if (this.phase === 'grid') r.speed = 0;

      // ---- 横移動と壁 ----
      const speedRatio = r.speed / MAX_SPEED;
      r.lat += r.steer * STEER_RATE * dt * (0.35 + speedRatio * 0.65);
      // 手を離しているときは ゆるやかに真ん中へ（よちよち運転アシスト）
      if (r.isPlayer && !r.finished && Math.abs(steerInput) < 0.05) {
        r.lat -= r.lat * 0.22 * dt;
      }
      if (Math.abs(r.lat) > WALL_HALF) {
        r.lat = Math.sign(r.lat) * WALL_HALF;
        if (r.bumpCool <= 0 && speedRatio > 0.4) {
          r.bumpCool = 0.5;
          r.speed *= 0.9;
          if (r.isPlayer) { this.audio.bump(); this.hooks.shake?.(0.35); }
        }
      }
      r.offroad = Math.abs(r.lat) > ROAD_HALF + 1.0;

      // ---- 前進 ----
      r.prevS = r.s;
      r.s = (r.s + r.speed * dt) % total;

      // ---- ラップ判定 ----
      if (!r.finished && r.prevS > total * 0.85 && r.s < total * 0.15) {
        r.lap++;
        if (r.lap > LAPS) {
          r.finished = true;
          if (r.isPlayer) this.finishPlayer(r);
        } else if (r.isPlayer) {
          if (r.lap > 1) this.audio.lap();
          this.hooks.onLap?.(r.lap);
        }
      }

      // ---- ギミック ----
      if (!r.finished || !r.isPlayer) {
        this.checkBoostPads(r);
        this.checkItemBoxes(r, t);
      }
      if (r.isPlayer && !r.finished) this.checkCoins(r);

      // ---- アイテム自動発動（4歳児が押さなくても楽しい） ----
      if (r.item) {
        r.itemTimer += dt;
        if (!r.isPlayer && r.itemTimer > 1.2) this.useItem(r);
        else if (r.isPlayer && r.itemTimer > 6) this.useItem(r);
      }

      // ---- 見た目 ----
      this.applyTransform(r, dt);
      animateKart(r.kart, dt, t, {
        speed: r.speed, steer: r.steer, maxSpeed: MAX_SPEED,
        boosting: r.boostT > 0, star: r.starT, airborne: false,
      });

      // ---- FX ----
      if (r.boostT > 0) this.fx.boostTrail(r.kart);
      if (r.starT > 0) this.fx.starTrail(r.kart, t);
      if (r.offroad && r.speed > 6) {
        this.fx.dust(r.kart, speedRatio);
        if (r.isPlayer && Math.random() < 0.2) this.audio.offroadTick();
      }
      if (!r.offroad) this.fx.driftSparks(r.kart, r.steer, speedRatio);
      const flames = r.kart.userData.flames;
      if (flames) {
        for (const f of flames) {
          f.visible = r.boostT > 0;
          if (f.visible) {
            const sc = 0.8 + Math.random() * 0.5;
            f.scale.set(sc, sc, sc * (1.1 + Math.random() * 0.4));
          }
        }
      }
    }

    this.collideKarts();
    this.updateRanks();
  }

  aiSteer(r, t) {
    // 進行方向のうねり + 目標ラインへ寄せる
    const wig = Math.sin(r.s * 0.025 + r.aiPhase) * 3.2;
    let target = wig;
    // 前方のカートをよける
    for (const o of this.racers) {
      if (o === r) continue;
      let ds = o.s - r.s;
      const total = this.track.total;
      if (ds < -total / 2) ds += total;
      if (ds > total / 2) ds -= total;
      if (ds > 0.5 && ds < 9 && Math.abs(o.lat - r.lat) < 3) {
        target += (r.lat >= o.lat ? 4 : -4);
      }
    }
    target = THREE.MathUtils.clamp(target, -ROAD_HALF + 1.5, ROAD_HALF - 1.5);
    return THREE.MathUtils.clamp((target - r.lat) * 0.32, -1, 1);
  }

  checkBoostPads(r) {
    for (const p of this.world.boostPads.defs) {
      let ds = r.s - p.s;
      const total = this.track.total;
      if (ds < -total / 2) ds += total;
      if (Math.abs(ds) < p.len / 2 && Math.abs(r.lat - p.lat) < p.halfW && r.boostT < 0.9) {
        r.boostT = 1.5;
        if (r.isPlayer) {
          this.audio.boost();
          this.hooks.onBoost?.();
          this.hooks.toast?.('ダッシュ！');
        }
      }
    }
  }

  checkItemBoxes(r, t) {
    for (const b of this.world.itemBoxes.defs) {
      if (b.taken) continue;
      let ds = r.s - b.s;
      const total = this.track.total;
      if (ds < -total / 2) ds += total;
      if (ds > total / 2) ds -= total;
      if (Math.abs(ds) < 2.6 && Math.abs(r.lat - b.lat) < 2.4) {
        b.taken = true; b.respawn = 3.5;
        this.fx.boxBurst(b.pos);
        if (!r.item) {
          r.item = ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)];
          r.itemTimer = 0;
          if (r.isPlayer) {
            this.audio.itemGet();
            this.hooks.onItem?.(r.item);
          }
        }
      }
    }
  }

  checkCoins(r) {
    const total = this.track.total;
    const magnet = r.magnetT > 0;
    for (const c of this.world.coins.defs) {
      if (c.taken) continue;
      let ds = r.s - c.s;
      if (ds < -total / 2) ds += total;
      if (ds > total / 2) ds -= total;
      const near = magnet
        ? (Math.abs(ds) < 12)
        : (Math.abs(ds) < 2.4 && Math.abs(r.lat - c.lat) < 2.2);
      if (near) {
        c.taken = true;
        r.coins++;
        this.fx.coinBurst(c.pos);
        this.audio.coin();
        this.hooks.onCoin?.(r.coins);
      }
    }
    // 周回でコイン復活
    if (r.prevS > total * 0.85 && r.s < total * 0.15) {
      for (const c of this.world.coins.defs) c.taken = false;
    }
  }

  useItem(r) {
    const item = r.item;
    if (!item) return;
    r.item = null;
    r.itemTimer = 0;
    if (item === 'rocket') {
      r.boostT = 2.4;
      if (r.isPlayer) { this.audio.boost(); this.hooks.onBoost?.(); this.hooks.toast?.('ロケット ダッシュ！'); }
    } else if (item === 'star') {
      r.starT = 5.0;
      if (r.isPlayer) { this.audio.star(); this.hooks.toast?.('キラキラ スター！'); }
    } else if (item === 'magnet') {
      r.magnetT = 6.0;
      if (r.isPlayer) { this.audio.itemGet(); this.hooks.toast?.('コイン マグネット！'); }
    }
    if (r.isPlayer) this.hooks.onItem?.(null);
  }

  collideKarts() {
    const total = this.track.total;
    for (let i = 0; i < this.racers.length; i++) {
      for (let j = i + 1; j < this.racers.length; j++) {
        const a = this.racers[i], b = this.racers[j];
        let ds = a.s - b.s;
        if (ds < -total / 2) ds += total;
        if (ds > total / 2) ds -= total;
        const dl = a.lat - b.lat;
        if (Math.abs(ds) < 3.2 && Math.abs(dl) < 2.5) {
          const push = (2.5 - Math.abs(dl)) * 0.5 * Math.sign(dl || (Math.random() - 0.5));
          a.lat = THREE.MathUtils.clamp(a.lat + push, -WALL_HALF, WALL_HALF);
          b.lat = THREE.MathUtils.clamp(b.lat - push, -WALL_HALF, WALL_HALF);
          if ((a.isPlayer || b.isPlayer) && a.bumpCool <= 0) {
            a.bumpCool = 0.6;
            this.audio.bump();
            this.hooks.shake?.(0.25);
          }
          // スター中は相手を減速
          if (a.starT > 0 && b.starT <= 0) b.speed *= 0.55;
          if (b.starT > 0 && a.starT <= 0) a.speed *= 0.55;
        }
      }
    }
  }

  updateRanks() {
    const total = this.track.total;
    const order = [...this.racers].sort((x, y) => y.progressKey(total) - x.progressKey(total));
    order.forEach((r, i) => {
      const newRank = i + 1;
      if (r.isPlayer && newRank !== r.rank && !r.finished) {
        this.hooks.onRank?.(newRank, newRank < r.rank);
      }
      r.rank = newRank;
    });
  }

  finishPlayer(r) {
    this.playerFinished = true;
    this.phase = 'done';
    this.hooks.onFinish?.(r.rank, r.coins);
  }
}
