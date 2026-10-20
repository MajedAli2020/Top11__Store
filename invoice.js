// مولّد صورة الفاتورة (PNG) لطلبات توب ستور المكتملة
const path = require("path");
const fs = require("fs");
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");

const FONT_DIR = path.join(__dirname, "fonts");
const FAMILY = "TajawalInv";
let fontsOk = false;
function ensureFonts() {
  if (fontsOk) return;
  for (const [file, name] of [["Tajawal-Regular.ttf", FAMILY], ["Tajawal-Medium.ttf", FAMILY], ["Tajawal-Bold.ttf", FAMILY]]) {
    const p = path.join(FONT_DIR, file);
    if (fs.existsSync(p)) GlobalFonts.registerFromPath(p, name);
  }
  fontsOk = true;
}

const C = {
  paper: "#fbf8f3", dark: "#2b2118", bronze: "#c9a07a", light: "#e3c19a", cream: "#f3e6d3",
  line: "#d9c3a6", soft: "#e8d9c4", muted: "#8a7560", text: "#2b2118", text2: "#5a4838",
  tile: "#f1e3cf", tileInk: "#7a5632", green: "#3b6d11", greenDark: "#27500a",
  red: "#b3342f", redDark: "#7d211d", redTint: "#f8e8e5", redSoft: "#f0a39d",
};


function riyadhDate(iso) {
  const d = new Date(iso || Date.now());
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}/${p.month}/${p.day} - ${p.hour}:${p.minute}`;
}

function deliveryDuration(order) {
  const h = order.history || [];
  const start = Date.parse(order.createdAt);
  const end = Date.parse((h.slice().reverse().find((x) => x.status === "delivered") || {}).at);
  if (!start || !end || end < start) return "";
  const mins = Math.max(1, Math.round((end - start) / 60000));
  if (mins < 60) return `خلال ${mins} دقيقة`;
  const hrs = Math.floor(mins / 60);
  const rest = mins % 60;
  if (hrs < 24) return rest ? `خلال ${hrs} ساعة و${rest} دقيقة` : `خلال ${hrs} ساعة`;
  return `خلال ${Math.round(hrs / 24)} يوم`;
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// نص: align = "right" (عربي) أو "left"، والاتجاه يتحدد حسب المحاذاة
function text(ctx, s, x, y, { size = 26, weight = 400, color = C.text, align = "right", dir } = {}) {
  ctx.font = `${weight} ${size}px ${FAMILY}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.direction = dir || (align === "left" ? "ltr" : "rtl");
  ctx.fillText(String(s), x, y);
}

function dashed(ctx, x1, x2, y, color = C.line, dash = [6, 6]) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.restore();
}
function solid(ctx, x1, x2, y, color = C.soft) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
}

// أيقونات بسيطة ترسم بالمسارات (هدية / صاروخ-برق / مستخدم)
function icon(ctx, kind, cx, cy) {
  ctx.save();
  ctx.strokeStyle = C.tileInk;
  ctx.fillStyle = C.tileInk;
  ctx.lineWidth = 2.6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (kind === "nitro") {
    rr(ctx, cx - 12, cy - 4, 24, 15, 3); ctx.stroke();
    rr(ctx, cx - 14, cy - 11, 28, 7, 3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - 11); ctx.lineTo(cx, cy + 11); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx - 5, cy - 14, 4, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + 5, cy - 14, 4, 0, Math.PI * 2); ctx.stroke();
  } else if (kind === "boosts") {
    ctx.beginPath();
    ctx.moveTo(cx + 3, cy - 14); ctx.lineTo(cx - 9, cy + 2); ctx.lineTo(cx - 1, cy + 2);
    ctx.lineTo(cx - 3, cy + 14); ctx.lineTo(cx + 9, cy - 3); ctx.lineTo(cx + 1, cy - 3);
    ctx.closePath(); ctx.fill();
  } else {
    ctx.beginPath(); ctx.arc(cx, cy - 5, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy + 15, 12, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
  }
  ctx.restore();
}
const kindOf = (it) => (it.id === "nitro" ? "nitro" : /boost|بوست/i.test(`${it.id} ${it.name}`) ? "boosts" : "account");

function subOf(it) {
  if (it.id === "nitro") return "نيترو ديسكورد";
  if (/boost|بوست/i.test(`${it.id} ${it.name}`)) return "بوستات سيرفر";
  return "منتج رقمي";
}

// يصغّر الخط لين يدخل النص في العرض المتاح
function fitSize(ctx, s, maxW, size, weight, min = 12) {
  let f = size;
  while (f > min) {
    ctx.font = `${weight} ${f}px ${FAMILY}`;
    if (ctx.measureText(String(s)).width <= maxW) break;
    f -= 1;
  }
  return f;
}
// يقسم النص لأسطر حسب العرض (بالكلمات)
function wrapLines(ctx, s, maxW, size, weight, maxLines = 3) {
  ctx.font = `${weight} ${size}px ${FAMILY}`;
  const words = String(s).split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (cur && ctx.measureText(t).width > maxW) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines);
}


// وقت آخر مرة وصل فيها الطلب لحالة معيّنة
function statusAt(order, status) {
  const h = (order && order.history) || [];
  const hit = h.slice().reverse().find((x) => x.status === status);
  return hit ? hit.at : null;
}

/* ---------- الختم ----------
   الختم يُرسم كـ «ملصق» (sprite) شفاف مستقل: نفس الدالة تستخدم في صورة الفاتورة وفي معاينة الإدارة
   وفي أنميشن الموقع، فيطلع شكله مطابق في كل مكان. الإحداثيات بوحدات تخطيط الفاتورة (عرضها 420). */
const STAMP_SHAPES = ["box", "double", "round", "plain"];
function renderStampSprite(label, cfg, S = 2) {
  const mctx = createCanvas(10, 10).getContext("2d");
  const size = fitSize(mctx, label, 168, 24, 700, 12);
  mctx.font = `700 ${size}px ${FAMILY}`;
  const tw = mctx.measureText(String(label)).width;
  const bw = Math.min(200, Math.max(88, tw + 32)), bh = 44;
  const round = cfg.shape === "round";
  const ex = (round ? bw / 2 + 8 : bw / 2) + 4, ey = (round ? 30 : bh / 2) + 4;
  const a = (cfg.rot * Math.PI) / 180, sc = cfg.scale;
  const hw = (Math.abs(Math.cos(a)) * ex + Math.abs(Math.sin(a)) * ey) * sc + 6;
  const hh = (Math.abs(Math.sin(a)) * ex + Math.abs(Math.cos(a)) * ey) * sc + 6;
  const w = Math.ceil(hw * 2), h = Math.ceil(hh * 2);
  const canvas = createCanvas(w * S, h * S);
  const ctx = canvas.getContext("2d");
  ctx.scale(S, S);
  ctx.translate(w / 2, h / 2);
  ctx.rotate(a);
  ctx.scale(sc, sc);
  ctx.strokeStyle = cfg.color; ctx.fillStyle = cfg.color;
  ctx.lineWidth = 2.6; ctx.lineJoin = "round";
  if (cfg.shape === "box" || cfg.shape === "double") {
    rr(ctx, -bw / 2, -bh / 2, bw, bh, 7); ctx.stroke();
    if (cfg.shape === "double") { ctx.lineWidth = 1.2; rr(ctx, -bw / 2 + 4.5, -bh / 2 + 4.5, bw - 9, bh - 9, 4); ctx.stroke(); }
  } else if (round) {
    ctx.beginPath(); ctx.ellipse(0, 0, bw / 2 + 8, 30, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1.2; ctx.beginPath(); ctx.ellipse(0, 0, bw / 2 + 2.5, 24.5, 0, 0, Math.PI * 2); ctx.stroke();
  }
  text(ctx, label, 0, size * 0.375, { size, weight: 700, color: cfg.color, align: "center" });
  // تأثير حبر قديم: نقاط صغيرة تُمسح من الختم (ثابتة لنفس النص عشان ما تتغير بين المعاينة والفاتورة)
  if (cfg.grunge) {
    ctx.setTransform(S, 0, 0, S, 0, 0);
    ctx.globalCompositeOperation = "destination-out";
    let seed = hash(String(label) + cfg.shape);
    for (let i = 0; i < 110; i++) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      const x = (seed % 1000) / 1000 * w;
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      const y = (seed % 1000) / 1000 * h;
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      ctx.globalAlpha = 0.25 + (seed % 50) / 100;
      ctx.beginPath(); ctx.arc(x, y, 0.5 + (seed % 17) / 10, 0, Math.PI * 2); ctx.fill();
    }
  }
  return { canvas, w, h };
}

function sampleOrder(status) {
  const t0 = new Date(Date.now() - 12 * 60000).toISOString(), t1 = new Date().toISOString();
  const rejected = status === "rejected";
  return {
    id: "TS-4F9A2C", createdAt: t0, status: rejected ? "rejected" : "delivered",
    customer: { id: "0", name: "اسم العميل" }, transferor: "اسم المحوّل",
    history: [{ status: "new", at: t0 }, { status: rejected ? "rejected" : "delivered", at: t1 }],
    items: [
      { id: "nitro", name: "نيترو جيمنج", price: 40.5, oldPrice: 45, discount: 10, quantity: 1 },
      { id: "boosts", name: "سيرفر بوست 14", price: 30, quantity: 2 },
      { id: "accounts", name: "حساب ديسكورد", price: 15, quantity: 1 },
    ],
    total: 115.5,
  };
}

// يرسم الفاتورة. opts: { transparent، settings, variant: "paid" | "rejected", reason, at, deliveredAt, stamp: false (بدون ختم) }
// يرجع { canvas, meta, sprite } — meta فيها أبعاد الورقة ومكان الختم بوحدات التخطيط (العرض 420)
async function drawInvoice(order, opts = {}) {
  ensureFonts();
  const db = require("./db");
  const cfg = opts.settings || db.getInvoice();
  const T = { ...db.INVOICE_DEFAULTS.texts, ...(cfg.texts || {}) };
  const variant = opts.variant === "rejected" ? "rejected" : "paid";
  const rej = variant === "rejected";
  const reason = rej ? String(opts.reason || "").replace(/\s+/g, " ").trim().slice(0, 140) : "";
  const stampCfg = ((cfg.stamps || {})[variant]) || db.STAMP_DEFAULTS[variant];
  const stampText = rej ? T.stampRejected : T.stamp;
  const showTimeline = cfg.showTimeline !== false, showStamp = cfg.showStamp !== false && opts.stamp !== false, showBarcode = cfg.showBarcode !== false;
  const money = (n) => `${Math.round(Number(n) * 100) / 100} ${T.currency}`;
  const mctx = createCanvas(10, 10).getContext("2d");
  const S = 2; // دقة مضاعفة
  const W = 420;
  const items = order.items || [];
  const rowH = 62;
  const subtotal = Math.round(items.reduce((s, i) => s + (i.oldPrice && i.oldPrice > i.price ? i.oldPrice : i.price) * i.quantity, 0) * 100) / 100;
  const discount = Math.round((subtotal - Number(order.total)) * 100) / 100;

  const headerH = 92;
  const metaH = 118;
  const timelineH = showTimeline ? 86 : 22;
  const itemsHead = 40;
  const reasonLines = reason ? wrapLines(mctx, reason, W - 40 - 36, 14.5, 500, 3) : [];
  const reasonH = reason ? 66 + reasonLines.length * 21 : 0;
  const totalsH = (discount > 0.009 ? 108 : 78) + 26;
  const barcodeH = showBarcode ? 98 : 30;
  const thanksLines = wrapLines(mctx, rej ? T.thanksRejected : T.thanks, W - 60, 15, 500, 2);
  const footerLines = wrapLines(mctx, rej ? T.footerRejected : T.footer, W - 60, 12.5, 400, 3);
  const footerH = 34 + thanksLines.length * 22 + footerLines.length * 19;
  const tearH = 14;
  const H = headerH + metaH + timelineH + itemsHead + items.length * rowH + reasonH + totalsH + barcodeH + footerH + tearH + 8;

  const canvas = createCanvas(W * S, H * S);
  const ctx = canvas.getContext("2d");
  ctx.scale(S, S);
  if (!opts.transparent) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H); } // خلفية بيضاء للإرسال في ديسكورد، وشفافة للموقع

  // ورقة الفاتورة مع حافة ممزقة بالأسفل
  const paperH = H - tearH;
  ctx.fillStyle = C.paper;
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W, paperH);
  const teeth = 42;
  const tw = W / teeth;
  for (let i = 0; i < teeth; i++) {
    const x = W - (i + 0.5) * tw;
    ctx.lineTo(x, paperH + tearH - 2);
    ctx.lineTo(W - (i + 1) * tw, paperH);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  ctx.stroke();

  // الهيدر
  ctx.fillStyle = C.dark;
  ctx.fillRect(0, 0, W, headerH);
  if (rej) { ctx.fillStyle = C.red; ctx.fillRect(0, headerH - 4, W, 4); }
  const logoX = W - 20 - 50;
  try {
    const logo = await loadImage(path.join(__dirname, "public", "assets", "logo.png"));
    ctx.save();
    ctx.beginPath(); ctx.arc(logoX + 25, headerH / 2, 25, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(logo, logoX, headerH / 2 - 25, 50, 50);
    ctx.restore();
    ctx.strokeStyle = C.bronze; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(logoX + 25, headerH / 2, 25, 0, Math.PI * 2); ctx.stroke();
  } catch (e) {
    ctx.strokeStyle = C.bronze; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(logoX + 25, headerH / 2, 25, 0, Math.PI * 2); ctx.stroke();
    text(ctx, "T", logoX + 25, headerH / 2 + 9, { size: 26, weight: 500, color: C.light, align: "center" });
  }
  const nameSize = fitSize(mctx, T.storeName, 140, 26, 700, 15);
  text(ctx, T.storeName, logoX - 14, headerH / 2 + 2, { size: nameSize, weight: 700, color: C.light });
  const subSize = fitSize(mctx, T.storeSub, 140, 12, 400, 9);
  text(ctx, T.storeSub, logoX - 14, headerH / 2 + 22, { size: subSize, color: C.bronze, align: "right", dir: "ltr" });
  const titleStr = rej ? T.titleRejected : T.title;
  text(ctx, titleStr, 20, 38, { size: fitSize(mctx, titleStr, 130, 14, 400, 10), color: rej ? C.redSoft : C.bronze, align: "left", dir: "rtl" });
  text(ctx, `#${order.id}`, 20, 64, { size: 19, weight: 500, color: C.cream, align: "left" });

  // بيانات الطلب
  let y = headerH + 26;
  const colR = W - 20;
  const colL = W / 2 - 4;
  const cust = (order.customer && order.customer.name) || "—";
  const dur = deliveryDuration(order);
  const whenIso = rej ? (opts.at || statusAt(order, "rejected") || undefined) : (opts.deliveredAt || order.createdAt);
  const meta = [
    [T.labelCustomer, cust, colR, y],
    [T.labelDate, riyadhDate(whenIso), colL, y],
    [T.labelTransferor, order.transferor || "—", colR, y + 54],
    rej ? [T.labelStatus, T.statusRejected, colL, y + 54] : [T.labelDelivery, dur || "—", colL, y + 54],
  ];
  for (const [label, val, x, yy] of meta) {
    text(ctx, label, x, yy, { size: 13, color: C.muted });
    let v = String(val);
    if (v.length > 22) v = v.slice(0, 21) + "…";
    text(ctx, v, x, yy + 22, { size: 16, weight: 500, color: rej && val === T.statusRejected ? C.red : C.text });
  }

  // شريط الحالة
  y = headerH + metaH;
  dashed(ctx, 20, W - 20, y);
  if (showTimeline) {
    const steps = rej ? [[T.stepNew, "ok"], [T.stepReview, "ok"], [T.stepRejected, "bad"]] : [[T.stepNew, ""], [T.stepAccepted, ""], [T.stepDelivered, "last"]];
    const cxs = [W - 60, W / 2, 60];
    const ty = y + 28;
    ctx.strokeStyle = rej ? C.bronze : C.green; ctx.lineWidth = 2; // تم التسليم: الخط كامل أخضر
    ctx.beginPath(); ctx.moveTo(cxs[0] - 14, ty); ctx.lineTo(cxs[1] + 14, ty); ctx.moveTo(cxs[1] - 14, ty); ctx.lineTo(cxs[2] + 14, ty); ctx.stroke();
    if (rej) { ctx.strokeStyle = C.red; ctx.beginPath(); ctx.moveTo(cxs[1] - 14, ty); ctx.lineTo(cxs[2] + 14, ty); ctx.stroke(); }
    steps.forEach(([label, kind], i) => {
      const last = kind === "last", bad = kind === "bad";
      ctx.fillStyle = bad ? C.red : rej ? C.bronze : C.green;
      ctx.beginPath(); ctx.arc(cxs[i], ty, 13, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath();
      if (bad) { ctx.moveTo(cxs[i] - 4.5, ty - 4.5); ctx.lineTo(cxs[i] + 4.5, ty + 4.5); ctx.moveTo(cxs[i] + 4.5, ty - 4.5); ctx.lineTo(cxs[i] - 4.5, ty + 4.5); }
      else { ctx.moveTo(cxs[i] - 5, ty); ctx.lineTo(cxs[i] - 1, ty + 4); ctx.lineTo(cxs[i] + 6, ty - 4); }
      ctx.stroke();
      text(ctx, label, cxs[i], ty + 34, { size: 13, weight: last || bad ? 700 : 400, color: bad ? C.redDark : rej ? C.text2 : C.greenDark, align: "center" });
    });
    dashed(ctx, 20, W - 20, y + timelineH - 6);
  } else dashed(ctx, 20, W - 20, y + timelineH - 6);

  // المنتجات
  y = headerH + metaH + timelineH;
  text(ctx, T.colProduct, W - 20, y + 16, { size: 13, color: C.muted });
  text(ctx, T.colQty, 112, y + 16, { size: 13, color: C.muted, align: "center" });
  text(ctx, T.colPrice, 20, y + 16, { size: 13, color: C.muted, align: "left", dir: "rtl" });
  y += itemsHead - 10;
  items.forEach((it, idx) => {
    solid(ctx, 20, W - 20, y);
    const cy = y + rowH / 2;
    const tx = W - 20 - 40;
    ctx.fillStyle = C.tile;
    rr(ctx, tx, cy - 20, 40, 40, 9); ctx.fill();
    icon(ctx, kindOf(it), tx + 20, cy);
    let name = String(it.name || "منتج");
    if (name.length > 26) name = name.slice(0, 25) + "…";
    text(ctx, name, tx - 12, cy - 3, { size: 16, weight: 500 });
    text(ctx, subOf(it), tx - 12, cy + 17, { size: 12, color: C.muted });
    text(ctx, it.quantity, 112, cy + 5, { size: 16, align: "center" });
    const line = it.price * it.quantity;
    text(ctx, money(line), 20, cy + (it.oldPrice && it.oldPrice > it.price ? -2 : 5), { size: 16, weight: 500, align: "left", dir: "rtl" });
    if (it.oldPrice && it.oldPrice > it.price) {
      const old = money(it.oldPrice * it.quantity);
      text(ctx, old, 20, cy + 17, { size: 12, color: C.muted, align: "left", dir: "rtl" });
      ctx.font = `400 12px ${FAMILY}`;
      const w = ctx.measureText(old).width;
      ctx.strokeStyle = C.muted; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(20, cy + 12); ctx.lineTo(20 + w, cy + 12); ctx.stroke();
    }
    y += rowH;
    if (idx === items.length - 1) solid(ctx, 20, W - 20, y, C.line);
  });

  // سبب الرفض (فاتورة مرفوضة فقط، واختياري)
  if (reason) {
    const by = y + 16, bh = reasonH - 26;
    ctx.fillStyle = C.redTint;
    rr(ctx, 20, by, W - 40, bh, 9); ctx.fill();
    ctx.save(); ctx.strokeStyle = C.red; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]);
    rr(ctx, 20, by, W - 40, bh, 9); ctx.stroke(); ctx.restore();
    text(ctx, T.labelReason, W - 36, by + 24, { size: 13, weight: 700, color: C.red });
    reasonLines.forEach((ln, i) => text(ctx, ln, W - 36, by + 47 + i * 21, { size: 14.5, weight: 500, color: C.redDark }));
    y += reasonH;
  }

  // الإجماليات
  y += 22;
  text(ctx, T.labelSubtotal, W - 20, y, { size: 15, color: C.text2 });
  text(ctx, money(subtotal), 20, y, { size: 15, color: C.text2, align: "left", dir: "rtl" });
  if (discount > 0.009) {
    y += 28;
    text(ctx, T.labelDiscount, W - 20, y, { size: 15, color: C.green });
    text(ctx, `- ${money(discount)}`, 20, y, { size: 15, color: C.green, align: "left", dir: "rtl" });
  }
  y += 24;
  ctx.fillStyle = C.dark;
  rr(ctx, 20, y, W - 40, 56, 8); ctx.fill();
  text(ctx, T.labelTotal, W - 36, y + 35, { size: 16, color: C.cream });
  text(ctx, money(order.total), 36, y + 38, { size: 25, weight: 700, color: rej ? C.redSoft : C.light, align: "left", dir: "rtl" });
  // مركز صندوق الإجمالي = نقطة الارتكاز للختم (إزاحة الختم تُحسب منها، فيبقى مكانه ثابت مهما اختلف عدد المنتجات)
  const anchor = { x: W / 2, y: y + 28 };
  y += 56;

  // الختم (مكانه وشكله وزاويته من إعدادات الإدارة)
  const sprite = renderStampSprite(stampText, stampCfg, S);
  const stampPos = { x: anchor.x + stampCfg.dx, y: anchor.y + stampCfg.dy, w: sprite.w, h: sprite.h };
  if (showStamp) {
    ctx.save();
    ctx.globalAlpha = stampCfg.opacity;
    ctx.drawImage(sprite.canvas, stampPos.x - sprite.w / 2, stampPos.y - sprite.h / 2, sprite.w, sprite.h);
    ctx.restore();
  }

  // باركود (من رقم الطلب)
  if (showBarcode) {
    y += 24;
    let seed = hash(order.id);
    let bx = (W - 200) / 2;
    ctx.fillStyle = C.dark;
    while (bx < (W + 200) / 2 - 3) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      const w = 1 + (seed % 4);
      ctx.fillRect(bx, y, w, 34);
      bx += w + 2 + ((seed >> 8) % 3);
    }
    text(ctx, order.id, W / 2, y + 54, { size: 12, color: C.muted, align: "center", dir: "ltr" });
    y += 84;
  } else {
    y += 30;
  }

  // الخاتمة
  thanksLines.forEach((ln, i) => text(ctx, ln, W / 2, y + i * 22, { size: 15, color: C.text2, weight: 500, align: "center" }));
  y += (thanksLines.length - 1) * 22 + 22;
  footerLines.forEach((ln, i) => text(ctx, ln, W / 2, y + i * 19, { size: 12.5, color: C.muted, align: "center" }));

  return {
    canvas, sprite,
    meta: { W, H, variant, paperH, anchor, stamp: { ...stampPos, opacity: stampCfg.opacity, enabled: cfg.showStamp !== false } },
  };
}

// صورة الفاتورة كاملة (مع الختم): للإرسال في الخاص والتحميل
async function buildInvoice(order, opts = {}) {
  const r = await drawInvoice(order, opts);
  return r.canvas.toBuffer("image/png");
}

// الفاتورة على طبقتين: الورقة بدون ختم + الختم لوحده (شفاف)، عشان الواجهة تحرّك الختم وتنزّله بأنميشن أو تسحبه بالمعاينة
async function buildInvoiceLayers(order, opts = {}) {
  const r = await drawInvoice(order, { ...opts, stamp: false, transparent: true });
  return { base: r.canvas.toBuffer("image/png"), stamp: r.sprite.canvas.toBuffer("image/png"), meta: r.meta };
}

module.exports = { buildInvoice, buildInvoiceLayers, sampleOrder, statusAt };
