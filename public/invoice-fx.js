/* توب ستور — فاتورة صفحة الطلب (تظهر يسار الطلب بأنميشن طباعة + ختم)
   الاستخدام: InvoiceFX.sync(order) — تُستدعى من renderConfirmation. ما تعيد الأنميشن لو الفاتورة نفسها (نفس الحالة) انعرضت قبل. */
(function () {
  "use strict";
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
  var pane = null, layout = null, shownKey = "", req = 0;

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  }
  function hide() {
    pane = pane || document.getElementById("invPane");
    layout = layout || document.getElementById("orderLayout");
    if (!pane) return;
    pane.hidden = true;
    pane.textContent = "";
    if (layout) layout.classList.remove("has-invoice");
    shownKey = "";
  }
  function pct(n) { return (Math.round(n * 1000) / 1000) + "%"; }

  function build(data, orderId) {
    var m = data.meta, rej = data.variant === "rejected";
    var card = el("div", "inv-card" + (rej ? " rej" : ""));
    var head = el("div", "inv-head");
    head.append(el("i"), el("span", "", rej ? "فاتورة الطلب المرفوض" : "فاتورة طلبك جاهزة"), el("small", "", "#" + orderId));
    var stage = el("div", "inv-stage");
    var float_ = el("div", "inv-float"), tilt = el("div", "inv-tilt"), impact = el("div", "inv-impact");
    var slot = el("div", "inv-slot");
    var sheet = el("div", "inv-sheet");
    var base = el("img", "inv-base"); base.alt = "الفاتورة"; base.draggable = false; base.src = data.base;
    sheet.append(base, el("div", "inv-shine"));
    var scan = el("div", "inv-scan");
    impact.append(slot, sheet, scan);

    var stampImgs = [];
    if (m.stamp && m.stamp.enabled) {
      var cx = m.stamp.x / m.W * 100, cy = m.stamp.y / m.H * 100;
      var st = el("img", "inv-stamp"); st.alt = ""; st.draggable = false; st.src = data.stamp;
      st.style.left = pct((m.stamp.x - m.stamp.w / 2) / m.W * 100);
      st.style.top = pct((m.stamp.y - m.stamp.h / 2) / m.H * 100);
      st.style.width = pct(m.stamp.w / m.W * 100);
      st.style.setProperty("--so", String(m.stamp.opacity));
      var ring = el("div", "inv-ring"), rd = m.stamp.w * 0.62; // الحلقة بالنسب المئوية (تشتغل حتى والصفحة مخفية)
      ring.style.width = pct(rd / m.W * 100);
      ring.style.left = pct((m.stamp.x - rd / 2) / m.W * 100);
      ring.style.top = pct((m.stamp.y - rd / 2) / m.H * 100);
      impact.append(ring, st);
      stampImgs = [st, ring];
      // شرر صغير يتطاير من مكان الختم
      for (var i = 0; i < 10; i++) {
        var sp = el("i", "inv-spark"), a = (i / 10) * Math.PI * 2 + Math.random() * 0.5, d = 46 + Math.random() * 50;
        sp.style.left = pct(cx); sp.style.top = pct(cy);
        sp.style.setProperty("--dx", Math.round(Math.cos(a) * d) + "px");
        sp.style.setProperty("--dy", Math.round(Math.sin(a) * d * 0.7) + "px");
        sp.style.animationDelay = (3.38 + Math.random() * 0.06) + "s";
        impact.append(sp);
      }
    }
    tilt.append(impact); float_.append(tilt); stage.append(float_);

    var actions = el("div", "inv-actions");
    var replay = el("button", "btn", "↻ إعادة الأنميشن"); replay.type = "button";
    var dl = el("a", "btn primary", "⤓ تحميل الفاتورة"); dl.href = "/api/orders/" + encodeURIComponent(orderId) + "/invoice.png"; dl.setAttribute("download", "invoice-" + orderId + ".png");
    actions.append(replay, dl);
    card.append(head, stage, actions);

    function play() {
      card.classList.remove("run", "done");
      void card.offsetWidth;
      card.classList.add("run");
      clearTimeout(card._t);
      card._t = setTimeout(function () { card.classList.add("done"); }, reduce ? 50 : 4300);
    }
    replay.onclick = play;
    card._play = play;

    if (fine && !reduce) {
      stage.addEventListener("pointermove", function (e) {
        var r = stage.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
        tilt.style.setProperty("--ry", (x * 7).toFixed(2) + "deg");
        tilt.style.setProperty("--rx", (y * -5).toFixed(2) + "deg");
      });
      stage.addEventListener("pointerleave", function () { tilt.style.setProperty("--rx", "0deg"); tilt.style.setProperty("--ry", "0deg"); });
    }
    return card;
  }

  async function sync(order) {
    pane = pane || document.getElementById("invPane");
    layout = layout || document.getElementById("orderLayout");
    if (!pane || !order) return;
    if (order.status !== "delivered" && order.status !== "rejected") return hide();
    var my = ++req;
    try {
      var r = await fetch("/api/orders/" + encodeURIComponent(order.id) + "/invoice", { cache: "no-store" });
      if (my !== req) return;
      if (!r.ok) return hide();
      var data = await r.json();
      if (my !== req) return;
      if (data.key === shownKey && pane.firstChild) return; // نفس الفاتورة، لا نعيد الأنميشن
      // ننتظر الصورة تجهز قبل ما نبدأ الأنميشن (عشان ما تنكشف فاضية)
      var pre = new Image(); pre.src = data.base;
      try { await pre.decode(); } catch (e) {}
      if (my !== req) return;
      shownKey = data.key;
      var card = build(data, order.id);
      pane.textContent = "";
      pane.append(card);
      pane.hidden = false;
      if (layout) layout.classList.add("has-invoice");
      requestAnimationFrame(function () { card._play(); });
    } catch (e) { /* ما نعطّل صفحة الطلب لو تعذرت الفاتورة */ }
  }

  window.InvoiceFX = { sync: sync, hide: hide };
})();
