/* =========================================================
 * 音: すべて WebAudio でその場で合成(外部ファイルなし)
 *  - さらさら: 磁石の速さに追従するノイズ(速いほど高く明るく)
 *  - ふわっ:   砂山が落ち着いた瞬間の低い息のような音
 *  - ぽん/きらん/しゅわー: 配置・合体・ならし
 * ======================================================= */
"use strict";

var GameAudio = (function () {
  var ctx = null;
  var master = null;
  var muted = false;

  // さらさらノイズ声部
  var sandGain = null, sandFilter = null;
  // ふわっ声部
  var calmGain = null, calmFilter = null;

  function makeNoiseBuffer(seconds) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function init() {
    if (ctx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);

    var noise = makeNoiseBuffer(2.0);

    // --- さらさら(帯域ノイズ、速度でカットオフと音量が動く) ---
    var src1 = ctx.createBufferSource();
    src1.buffer = noise;
    src1.loop = true;
    sandFilter = ctx.createBiquadFilter();
    sandFilter.type = "bandpass";
    sandFilter.frequency.value = 1200;
    sandFilter.Q.value = 0.9;
    sandGain = ctx.createGain();
    sandGain.gain.value = 0;
    src1.connect(sandFilter).connect(sandGain).connect(master);
    src1.start();

    // --- ふわっ(低いローパスノイズの息) ---
    var src2 = ctx.createBufferSource();
    src2.buffer = noise;
    src2.loop = true;
    calmFilter = ctx.createBiquadFilter();
    calmFilter.type = "lowpass";
    calmFilter.frequency.value = 260;
    calmFilter.Q.value = 0.5;
    calmGain = ctx.createGain();
    calmGain.gain.value = 0;
    src2.connect(calmFilter).connect(calmGain).connect(master);
    src2.start();
  }

  function resume() {
    if (!ctx) init();
    if (ctx && ctx.state === "suspended") ctx.resume();
  }

  /* 毎フレーム: activity = 0..1 (磁石の速さ×運ばれている粒), busy = 捕獲粒割合 */
  function updateSand(activity, busy) {
    if (!ctx) return;
    var t = ctx.currentTime;
    var vol = Math.min(0.30, activity * 0.34) * (0.35 + 0.65 * busy);
    sandGain.gain.setTargetAtTime(vol, t, 0.06);
    sandFilter.frequency.setTargetAtTime(700 + activity * 4200, t, 0.08);
  }

  /* 山が落ち着いた瞬間に一度だけ呼ぶ */
  function settlePuff(strength) {
    if (!ctx) return;
    var t = ctx.currentTime;
    var s = Math.min(1, strength);
    calmFilter.frequency.setValueAtTime(320, t);
    calmFilter.frequency.linearRampToValueAtTime(150, t + 0.9);
    calmGain.gain.cancelScheduledValues(t);
    calmGain.gain.setValueAtTime(calmGain.gain.value, t);
    calmGain.gain.linearRampToValueAtTime(0.16 * s, t + 0.18);
    calmGain.gain.linearRampToValueAtTime(0, t + 1.0);
  }

  /* 磁石を置いた時の「ぽん」 */
  function pop() {
    if (!ctx) return;
    var t = ctx.currentTime;
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(680, t + 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.28, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.3);
  }

  /* 合体の「きらん」 */
  function chime() {
    if (!ctx) return;
    var t = ctx.currentTime;
    var notes = [660, 880, 1320];
    for (var i = 0; i < notes.length; i++) {
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = "triangle";
      o.frequency.value = notes[i];
      var t0 = t + i * 0.07;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      o.connect(g).connect(master);
      o.start(t0);
      o.stop(t0 + 0.55);
    }
  }

  /* ならしの「しゅわー」(下降ノイズ) */
  function whoosh(duration) {
    if (!ctx) return;
    var t = ctx.currentTime;
    var dur = duration || 1.3;
    var src = ctx.createBufferSource();
    src.buffer = makeNoiseBuffer(dur + 0.2);
    var f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(3200, t);
    f.frequency.exponentialRampToValueAtTime(180, t + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.30, t + 0.10);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.1);
  }

  function setMuted(m) {
    muted = m;
    if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.03);
  }

  return {
    resume: resume,
    updateSand: updateSand,
    settlePuff: settlePuff,
    pop: pop,
    chime: chime,
    whoosh: whoosh,
    setMuted: setMuted,
    isMuted: function () { return muted; },
  };
})();
