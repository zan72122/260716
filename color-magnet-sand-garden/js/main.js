/* =========================================================
 * 起動・ループ・UI・性能自動調整
 * ======================================================= */
"use strict";

(function () {
  var canvas = document.getElementById("game");
  var stage = document.getElementById("stage");
  var titleEl = document.getElementById("title");
  var shakeBtn = document.getElementById("shakeBtn");
  var muteBtn = document.getElementById("muteBtn");
  var themeBtn = document.getElementById("themeBtn");

  var sim = new Sim();
  var renderer = new Renderer(canvas);
  var started = false;
  var lastT = 0;

  /* ---- 保存された設定 ---- */
  var themeIdx = 0, muted = false;
  try {
    themeIdx = parseInt(localStorage.getItem("sandTheme") || "0", 10) || 0;
    muted = localStorage.getItem("sandMuted") === "1";
  } catch (e) {}
  themeIdx = themeIdx % THEMES.length;
  GameAudio.setMuted(muted);
  if (muted) { muteBtn.classList.add("muted"); muteBtn.textContent = "🔇"; }

  /* ---- サイズ ---- */
  function viewSize() {
    var vv = window.visualViewport;
    return {
      w: Math.round(vv ? vv.width : window.innerWidth),
      h: Math.round(vv ? vv.height : window.innerHeight),
    };
  }

  function doResize() {
    var s = viewSize();
    if (s.w < 10 || s.h < 10) return;
    renderer.resize(s.w, s.h, window.devicePixelRatio || 1);
    if (sim.W === 0) {
      sim.setup(s.w, s.h, CONFIG.particle.baseCount);
    } else {
      var map = sim.resize(s.w, s.h);
      if (map) renderer.remap(map);
    }
  }

  renderer.setTheme(themeIdx);
  doResize();

  window.addEventListener("resize", doResize);
  window.addEventListener("orientationchange", function () {
    setTimeout(doResize, 250);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", doResize);
  }

  /* ---- おさそい(無操作が続いたら磁石がぷるっと誘う) ---- */
  var nextInviteT = Infinity;
  function noteActivity() {
    if (started) nextInviteT = lastT + CONFIG.idle.delay;
  }
  function invite() {
    var m = sim.magnets[0].active ? sim.magnets[0] : sim.magnets[1];
    if (!m.active) return;
    m.wobble = 1;
    sim.pokeAt(m.x, m.y, CONFIG.idle.pokeRadius, CONFIG.idle.pokeMax);
    GameAudio.poke(0.5);
  }

  /* ---- 入力 ---- */
  var input = new InputHandler(canvas, sim, renderer, function (name) {
    if (name === "pop") GameAudio.pop();
    else if (name === "poke") GameAudio.poke();
  }, noteActivity);

  /* ---- ボタン ---- */
  function pressShake(e) {
    if (e) e.preventDefault();
    noteActivity();
    if (sim.startShake()) {
      GameAudio.powerDown();                        // 磁力が切れる「きゅうん」
      GameAudio.whoosh(CONFIG.shake.waveTime + 0.2); // 色の波
      stage.classList.remove("shaking");
      void stage.offsetWidth;   // アニメを再始動
      stage.classList.add("shaking");
      shakeBtn.classList.add("pressed");
      setTimeout(function () { shakeBtn.classList.remove("pressed"); }, 300);
    }
  }
  shakeBtn.addEventListener("pointerdown", pressShake);

  muteBtn.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    noteActivity();
    muted = !muted;
    GameAudio.setMuted(muted);
    muteBtn.textContent = muted ? "🔇" : "🔊";
    muteBtn.classList.toggle("muted", muted);
    try { localStorage.setItem("sandMuted", muted ? "1" : "0"); } catch (err) {}
  });

  themeBtn.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    noteActivity();
    themeIdx = (themeIdx + 1) % THEMES.length;
    renderer.setTheme(themeIdx);
    GameAudio.pop();
    try { localStorage.setItem("sandTheme", String(themeIdx)); } catch (err) {}
  });

  /* ---- タイトル → 開始(どこをタップしても開始。音のアンロックを兼ねる) ---- */
  function start() {
    if (started) return;
    started = true;
    GameAudio.resume();
    titleEl.classList.add("hidden");
    shakeBtn.classList.add("wiggling");
    nextInviteT = (performance.now() / 1000) + CONFIG.idle.delay;
  }
  titleEl.addEventListener("pointerdown", function (e) { e.preventDefault(); start(); });
  titleEl.addEventListener("click", start);

  /* ---- 性能の自動調整 ---- */
  var fpsAccum = 0, fpsFrames = 0, fpsTimer = 0, slowStreak = 0, fastStreak = 0;

  function tunePerformance(dt) {
    fpsTimer += dt;
    fpsFrames++;
    if (fpsTimer >= CONFIG.perf.sampleTime) {
      var fps = fpsFrames / fpsTimer;
      fpsTimer = 0; fpsFrames = 0;
      if (fps < CONFIG.perf.lowFps) {
        slowStreak++; fastStreak = 0;
        if (slowStreak >= 2) {
          sim.setCount(sim.count * CONFIG.perf.step);
          slowStreak = 0;
        }
      } else if (fps > CONFIG.perf.highFps) {
        fastStreak++; slowStreak = 0;
        if (fastStreak >= 4 && sim.count < CONFIG.particle.baseCount * 1.4) {
          sim.setCount(sim.count * 1.1);
          fastStreak = 0;
        }
      } else {
        slowStreak = 0; fastStreak = 0;
      }
    }
  }

  /* ---- メインループ ---- */
  function frame(tms) {
    var t = tms / 1000;
    var dt = lastT ? t - lastT : 1 / 60;
    lastT = t;
    if (dt > 1 / 20) dt = 1 / 20;   // タブ復帰などの巨大なdtを抑える
    if (dt <= 0) dt = 1 / 60;

    sim.update(dt);

    /* おさそい: 無操作が続いたら磁石が誘う(触れば即中断) */
    if (started && t >= nextInviteT) {
      if (!input.anyPointerDown() && !sim.shakeActive && sim.fieldOff <= 0) invite();
      nextInviteT = t + CONFIG.idle.repeat;
    }

    /* 音: 磁石の速さ → さらさら(大きい山ほど低い)、山が落ち着く → ふわっ */
    if (started) {
      var sp = 0;
      for (var i = 0; i < 2; i++) {
        var m = sim.magnets[i];
        if (m.active && m.speed > sp) sp = m.speed;
      }
      var activity = Math.min(1, sp / 900);
      var busy = Math.min(1, sim.capturedCount / (sim.count * 0.4));
      var moundNorm = Math.min(1, Math.max(sim.moundCount[0], sim.moundCount[1]) / 1200);
      GameAudio.updateSand(activity, busy, moundNorm);

      for (var e = 0; e < sim.events.length; e++) {
        var ev = sim.events[e];
        if (ev === "settled") GameAudio.settlePuff(0.4 + busy, moundNorm);
        else if (ev === "merge") GameAudio.chime();
        else if (ev === "bridge") GameAudio.glissando();
        else if (ev === "bridgeBreak") GameAudio.pluck();
        else if (ev === "land") GameAudio.pop();
        else if (ev === "reboot") GameAudio.pop();
      }
    }

    renderer.draw(sim, dt);
    if (started) tunePerformance(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ---- テスト用フック ---- */
  window.__game = {
    sim: sim,
    renderer: renderer,
    input: input,
    start: start,
    shake: pressShake,
    invite: invite,
    isStarted: function () { return started; },
  };
})();
