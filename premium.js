/* Top Store — Premium interactions (لا يغيّر أي منطق في الموقع) */
(function () {
  "use strict";
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
  var body = document.body, raf = false;

  // خلفية حيّة + توهج الماوس + شريط التقدم
  var au = document.createElement("div"); au.className = "px-aurora"; au.innerHTML = "<i></i><i></i><i></i>"; body.insertBefore(au, body.firstChild);
  var bar = document.createElement("div"); bar.id = "pxProgress"; body.appendChild(bar);
  var cur = null;
  if (fine && !reduce) { cur = document.createElement("div"); cur.className = "px-cursor"; body.appendChild(cur); }

  var top = document.querySelector(".topbar");
  function onScroll() {
    if (raf) return; raf = true;
    requestAnimationFrame(function () {
      raf = false;
      var h = document.documentElement, max = h.scrollHeight - h.clientHeight;
      bar.style.transform = "scaleX(" + (max > 0 ? Math.min(1, h.scrollTop / max) : 0) + ")";
      if (top) top.classList.toggle("px-scrolled", h.scrollTop > 24);
    });
  }
  addEventListener("scroll", onScroll, { passive: true }); onScroll();

  // ميلان البطاقات + توهج يتبع المؤشر + أزرار مغناطيسية
  var lastCur = 0;
  document.addEventListener("pointermove", function (e) {
    if (e.pointerType !== "mouse") return;
    if (cur) { cur.style.opacity = 1; cur.style.transform = "translate3d(" + e.clientX + "px," + e.clientY + "px,0)"; }
    var t = e.target.closest ? e.target.closest(".product, .step, .surface") : null;
    if (t) {
      var r = t.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      t.style.setProperty("--mx", x + "px"); t.style.setProperty("--my", y + "px");
      if (!reduce && t.classList.contains("product")) {
        t.style.setProperty("--ry", ((x / r.width - .5) * -9).toFixed(2) + "deg");
        t.style.setProperty("--rx", ((y / r.height - .5) * 9).toFixed(2) + "deg");
      }
    }
    var b = !reduce && e.target.closest ? e.target.closest(".btn.primary") : null;
    if (b) {
      var q = b.getBoundingClientRect();
      b.style.setProperty("--tx", ((e.clientX - q.left - q.width / 2) * .12).toFixed(1) + "px");
      b.style.setProperty("--ty", ((e.clientY - q.top - q.height / 2) * .22).toFixed(1) + "px");
    }
  }, { passive: true });
  document.addEventListener("pointerout", function (e) {
    var t = e.target.closest ? e.target.closest(".product, .btn.primary") : null;
    if (t && !t.contains(e.relatedTarget)) { ["--rx", "--ry", "--tx", "--ty"].forEach(function (k) { t.style.removeProperty(k); }); }
  });
  document.addEventListener("mouseleave", function () { if (cur) cur.style.opacity = 0; });

  // تأثير الموجة عند الضغط
  document.addEventListener("pointerdown", function (e) {
    var b = e.target.closest ? e.target.closest(".btn, .add") : null;
    if (!b || reduce) return;
    var r = b.getBoundingClientRect(), s = Math.max(r.width, r.height) / 2, d = document.createElement("span");
    d.className = "px-ripple"; d.style.cssText = "width:" + s + "px;height:" + s + "px;left:" + (e.clientX - r.left - s / 2) + "px;top:" + (e.clientY - r.top - s / 2) + "px";
    if (getComputedStyle(b).position === "static") b.style.position = "relative";
    b.appendChild(d); setTimeout(function () { d.remove(); }, 750);
  });

  // ظهور تدريجي عند التمرير
  document.querySelectorAll(".step.reveal").forEach(function (el) { el.classList.remove("reveal", "delay1", "delay2", "delay3"); });
  if ("IntersectionObserver" in window && !reduce) {
    var io = new IntersectionObserver(function (en) {
      en.forEach(function (x) {
        if (!x.isIntersecting) return;
        var el = x.target; io.unobserve(el); el.classList.add("px-show"); el.classList.remove("px-hide");
        setTimeout(function () { el.classList.remove("px-show"); el.style.removeProperty("--d"); }, 1300);
      });
    }, { threshold: .12, rootMargin: "0px 0px -6% 0px" });
    document.querySelectorAll(".step, .heading, .section-divider, .rec, .cart-layout > .surface").forEach(function (el, i) {
      var sib = el.parentElement ? Array.prototype.indexOf.call(el.parentElement.children, el) : 0;
      el.style.setProperty("--d", (Math.min(sib, 4) * 0.1) + "s"); el.classList.add("px-hide"); io.observe(el);
    });
  }

  // نبضة على عدّاد السلة
  var cnt = document.getElementById("count");
  if (cnt && "MutationObserver" in window) {
    new MutationObserver(function () { cnt.classList.remove("px-bump"); void cnt.offsetWidth; cnt.classList.add("px-bump"); })
      .observe(cnt, { childList: true, characterData: true, subtree: true });
  }
})();
