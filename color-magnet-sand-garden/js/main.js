/* =========================================================
 * 起動・ループ・UI・性能自動調整
 * ======================================================= */
"use strict";

(function () {
  var canvas = document.getElementById("game");
  var stage = document.getElementById("stage");
  var titleEl = document.getElementById("title");
  var startBtn = document.getElementById("startBtn");
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
      sim.resize(s.w, s.h);
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

  /* ---- 入力 ---- */
  var input = new InputHandler(canvas, sim, renderer, function (name) {
    if (name === "pop") GameAudio.pop();
  });

  /* ---- ボタン ---- */
  function pressShake(e) {
    if (e) e.preventDefault();
    if (sim.startShake()) {
      GameAudio.whoosh(CONFIG.shake.waveTime + 0.2);
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
    muted = !muted;
    GameAudio.setMuted(muted);
    muteBtn.textContent = muted ? "🔇" : "🔊";
    muteBtn.classList.toggle("muted", muted);
    try { localStorage.setItem("sandMuted", muted ? "1" : "0"); } catch (err) {}
  });

  themeBtn.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    themeIdx = (themeIdx + 1) % THEMES.length;
    renderer.setTheme(themeIdx);
    GameAudio.pop();
    try { localStorage.setItem("sandTheme", String(themeIdx)); } catch (err) {}
  });

  /* ---- タイトル → 開始(音のアンロックを兼ねる) ---- */
  function start() {
    if (started) return;
    started = true;
    GameAudio.resume();
    titleEl.classList.add("hidden");
    shakeBtn.classList.add("wiggling");
  }
  startBtn.addEventListener("pointerdown", function (e) { e.preventDefault(); start(); });
  startBtn.addEventListener("click", start);
  titleEl.addEventListener("pointerdown", start);

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

    /* 音: 磁石の速さ → さらさら、山が落ち着く → ふわっ */
    if (started) {
      var sp = 0;
      for (var i = 0; i < 2; i++) {
        var m = sim.magnets[i];
        if (m.active && m.speed > sp) sp = m.speed;
      }
      var activity = Math.min(1, sp / 900);
      var busy = Math.min(1, sim.capturedCount / (sim.count * 0.4));
      GameAudio.updateSand(activity, busy);

      for (var e = 0; e < sim.events.length; e++) {
        var ev = sim.events[e];
        if (ev === "settled") GameAudio.settlePuff(0.4 + busy);
        else if (ev === "merge") GameAudio.chime();
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
    start: start,
    shake: pressShake,
    isStarted: function () { return started; },
  };
})();
