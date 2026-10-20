/* Top Store — أشكال النجوم/الشبكة في الخلفية + تطبيق صورة الخلفية. تُستدعى applyBackdrop من إعدادات المتجر. */
(function () {
  "use strict";
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var small = matchMedia("(max-width: 850px), (hover: none)").matches;
  var body = document.body;

  // طبقة صورة الخلفية (تحت كل شي)
  var bg = document.createElement("div"); bg.id = "siteBg";
  bg.innerHTML = '<div class="img"></div><div class="dim"></div>';
  body.insertBefore(bg, body.firstChild);

  // كانفس الأشكال
  var cv = document.createElement("canvas"); cv.id = "siteShapes"; cv.setAttribute("aria-hidden", "true");
  var aur = document.querySelector(".px-aurora");
  if (aur && aur.nextSibling) body.insertBefore(cv, aur.nextSibling); else body.insertBefore(cv, bg.nextSibling);
  var ctx = cv.getContext("2d"), W = 0, H = 0, dpr = 1, clusters = [], dots = [], tris = [], rgb = [240, 107, 208];
  var running = false, enabled = true, last = 0;

  function parseColor() {
    var v = getComputedStyle(document.documentElement).getPropertyValue("--blue2").trim();
    var m = /^#([0-9a-f]{6})$/i.exec(v);
    if (m) rgb = [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4), 16)];
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  function build() {
    clusters = []; dots = []; tris = [];
    var n = small ? 4 : 8;
    for (var i = 0; i < n; i++) {
      var cx = rnd(0, W), cy = rnd(0, H), k = 3 + Math.floor(Math.random() * 3), pts = [];
      var spread = small ? rnd(40, 80) : rnd(60, 130);
      for (var j = 0; j < k; j++) pts.push({ x: rnd(-spread, spread), y: rnd(-spread * .6, spread * .6), r: rnd(1.6, 3.2) });
      clusters.push({ x: cx, y: cy, vx: rnd(-.12, .12), vy: rnd(-.08, .08), pts: pts, closed: Math.random() < .6, ph: rnd(0, 6.28) });
    }
    var nd = small ? 8 : 18;
    for (var d = 0; d < nd; d++) dots.push({ x: rnd(0, W), y: rnd(0, H), r: rnd(1, 2.2), vx: rnd(-.06, .06), vy: rnd(-.05, .05), ph: rnd(0, 6.28) });
    var nt = small ? 2 : 3;
    for (var t = 0; t < nt; t++) tris.push({ x: rnd(0, W), y: rnd(0, H), s: rnd(160, 320), a: rnd(0, 6.28), va: rnd(-.0006, .0006), vx: rnd(-.05, .05), vy: rnd(-.03, .03) });
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = innerWidth; H = innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build(); draw(0);
  }

  function wrap(o, pad) {
    if (o.x < -pad) o.x = W + pad; else if (o.x > W + pad) o.x = -pad;
    if (o.y < -pad) o.y = H + pad; else if (o.y > H + pad) o.y = -pad;
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    var c = rgb[0] + "," + rgb[1] + "," + rgb[2];
    // مثلثات كبيرة شفافة
    for (var i = 0; i < tris.length; i++) {
      var q = tris[i];
      ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.a);
      ctx.beginPath(); ctx.moveTo(0, -q.s * .58); ctx.lineTo(q.s * .5, q.s * .29); ctx.lineTo(-q.s * .5, q.s * .29); ctx.closePath();
      ctx.fillStyle = "rgba(255,255,255,.035)"; ctx.fill();
      ctx.strokeStyle = "rgba(" + c + ",.10)"; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    }
    // مجموعات النقاط المتصلة
    for (var a = 0; a < clusters.length; a++) {
      var cl = clusters[a], p = cl.pts;
      ctx.beginPath();
      for (var j = 0; j < p.length; j++) { var X = cl.x + p[j].x, Y = cl.y + p[j].y; if (j) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }
      if (cl.closed && p.length > 2) ctx.closePath();
      ctx.strokeStyle = "rgba(" + c + ",.42)"; ctx.lineWidth = 1; ctx.stroke();
      for (var k = 0; k < p.length; k++) {
        var tw = .65 + .35 * Math.sin(t * .0012 + cl.ph + k);
        var px = cl.x + p[k].x, py = cl.y + p[k].y;
        ctx.beginPath(); ctx.arc(px, py, p[k].r * 2.6, 0, 6.2832); ctx.fillStyle = "rgba(" + c + "," + (.10 * tw) + ")"; ctx.fill();
        ctx.beginPath(); ctx.arc(px, py, p[k].r, 0, 6.2832); ctx.fillStyle = "rgba(" + c + "," + (.55 + .45 * tw) + ")"; ctx.fill();
      }
    }
    // نقاط مفردة
    for (var m = 0; m < dots.length; m++) {
      var d = dots[m], tw2 = .5 + .5 * Math.sin(t * .0015 + d.ph);
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 6.2832); ctx.fillStyle = "rgba(" + c + "," + (.35 + .5 * tw2) + ")"; ctx.fill();
    }
  }

  function step(ts) {
    if (!running) return;
    requestAnimationFrame(step);
    if (document.documentElement.classList.contains("nav-busy")) return; // لحظة التنقل بين الصفحات: نوقف رسم الأشكال
    var gap = small ? 50 : 33; // جوال ~20fps، كمبيوتر ~30fps
    if (ts - last < gap) return;
    last = ts;
    for (var i = 0; i < clusters.length; i++) { clusters[i].x += clusters[i].vx; clusters[i].y += clusters[i].vy; wrap(clusters[i], 150); }
    for (var j = 0; j < dots.length; j++) { dots[j].x += dots[j].vx; dots[j].y += dots[j].vy; wrap(dots[j], 10); }
    for (var k = 0; k < tris.length; k++) { tris[k].x += tris[k].vx; tris[k].y += tris[k].vy; tris[k].a += tris[k].va * gap; wrap(tris[k], 200); }
    draw(ts);
  }
  function start() { if (running || reduce || !enabled || document.hidden) return; running = true; requestAnimationFrame(step); }
  function stop() { running = false; }
  document.addEventListener("visibilitychange", function () { if (document.hidden) stop(); else start(); });
  var rt; addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(function () { if (Math.abs(innerWidth - W) > 40 || Math.abs(innerHeight - H) > 120) resize(); }, 250); });

  // يُستدعى من إعدادات المتجر
  window.applyBackdrop = function (st) {
    if (!st) return;
    // صورة الخلفية + قوة التعتيم
    var on = !!st.bgImage;
    bg.classList.toggle("on", on);
    bg.firstChild.style.backgroundImage = on ? 'url("' + String(st.bgImage).replace(/"/g, "%22") + '")' : "";
    var dim = Number(st.bgDim); if (!isFinite(dim)) dim = 45;
    bg.lastChild.style.opacity = Math.min(0.9, Math.max(0, dim / 100));
    // الأشكال (تتلوّن بلون --blue2 الحالي)
    enabled = st.shapes !== false;
    cv.hidden = !enabled;
    parseColor();
    if (enabled) { if (!W) resize(); else draw(0); start(); } else stop();
  };

  resize();
  if (window.SITE && SITE.st) window.applyBackdrop(SITE.st); else start();
})();
