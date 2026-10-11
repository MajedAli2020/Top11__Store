require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const db = require("./db");
const bot = require("./bot");

const PORT = +process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const { CLIENT_ID, CLIENT_SECRET } = process.env;
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
if (!process.env.SESSION_SECRET) console.warn("[server] SESSION_SECRET غير موجود — تسجيل الدخول سيتصفّر عند كل إعادة تشغيل.");
const SECURE = BASE_URL.startsWith("https://");
const SESSION_MS = 12 * 60 * 60 * 1000;

const app = express();
app.disable("x-powered-by");
app.use("/api/admin/products", express.json({ limit: "600kb" })); // صور المنتجات (تنضغط في المتصفح قبل الرفع)
app.use("/api/orders", express.json({ limit: "3mb" })); // الطلب + صورة الإيصال (تنضغط في المتصفح قبل الرفع)
app.use(express.json({ limit: "20kb" }));
app.use((req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin" });
  next();
});

/* ---------- جلسات موقّعة (كوكي) ---------- */
const sign = (v) => crypto.createHmac("sha256", SECRET).update(v).digest("base64url");
function makeToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return body + "." + sign(body);
}
function readToken(tok) {
  if (!tok || !tok.includes(".")) return null;
  const [body, sig] = tok.split(".");
  const good = sign(body);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    return p.exp > Date.now() ? p : null;
  } catch (e) { return null; }
}
function cookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((c) => {
    const i = c.indexOf("=");
    if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}
function setCookie(res, name, value, maxAgeMs) {
  res.append("Set-Cookie", `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${SECURE ? "; Secure" : ""}`);
}

/* ---------- حد الطلبات (بسيط) ---------- */
const hits = new Map();
function limit(max, windowMs) {
  return (req, res, next) => {
    const key = req.ip + req.path;
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: "محاولات كثيرة، حاول بعد شوي." });
    arr.push(now);
    hits.set(key, arr);
    next();
  };
}
setInterval(() => hits.clear(), 60 * 60 * 1000).unref();

/* ---------- API المتجر (عام) ---------- */
const publicProduct = ({ id, group, name, category, description, price, image, note }) => ({ id, group, name, category, description, price, image, note: note || "" });
const publicOrder = (o) => ({
  id: o.id, date: o.createdAt, status: o.status, transferor: o.transferor,
  serverLink: o.serverLink, nitroUser: o.nitroUser, nitroId: o.nitroId || "", items: o.items, total: o.total,
  customerName: o.customer ? o.customer.name : "",
});
const adminOrder = (o) => ({ ...publicOrder(o), history: o.history, customer: o.customer || null, lastDm: o.lastDm || null });
// الإيصال: صورة (png/jpeg/webp) كـ data URL، نتحقق من النوع الحقيقي من أول بايتات الملف
const RECEIPT_MAX = 2.5 * 1024 * 1024;
function parseReceipt(v) {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(v || ""));
  if (!m) return null;
  const buf = Buffer.from(m[2], "base64");
  if (buf.length < 1000 || buf.length > RECEIPT_MAX) return null;
  const isPng = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isWebp = buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP";
  const ext = isPng ? "png" : isJpg ? "jpg" : isWebp ? "webp" : null;
  return ext ? { buf, ext } : null;
}
const CUSTOMER_MS = 7 * 24 * 60 * 60 * 1000;
const readCustomer = (req) => readToken(cookies(req).customer);

app.get("/api/products", (req, res) => res.json(db.getActiveProducts().map(publicProduct)));

const INVITE_RE = /^(https?:\/\/)?(www\.)?(discord\.gg|discord(app)?\.com\/invite)\/[\w-]+\/?$/i;
function newOrderId() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const r = crypto.randomBytes(4);
  const t = Date.now().toString(36).toUpperCase().slice(-5);
  return "TOP-" + t + Array.from(r, (b) => A[b % 32]).join("");
}

app.post("/api/orders", limit(10, 10 * 60 * 1000), async (req, res) => {
  const cust = readCustomer(req);
  if (!cust) return res.status(401).json({ error: "سجّل الدخول بحساب Discord أولاً" });
  const b = req.body || {};
  const transferor = String(b.transferor || "").trim();
  if (transferor.length < 2 || transferor.length > 60) return res.status(400).json({ error: "اكتب اسم المحوّل" });
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 20) return res.status(400).json({ error: "السلة فارغة" });

  const receipt = parseReceipt(b.receipt);
  if (!receipt) return res.status(400).json({ error: "لازم ترفق صورة إيصال التحويل (صورة واضحة، أقل من 2.5 ميجا)" });
  if (!bot.botEnabled()) return res.status(503).json({ error: "الإرسال للإدارة غير متاح حالياً، حاول بعد شوي" });

  const merged = new Map();
  for (const it of b.items) {
    const q = Math.floor(+it.quantity);
    const p = db.getProduct(String(it.id));
    if (!p || !p.active || !(q >= 1 && q <= 20)) return res.status(400).json({ error: "منتج غير صالح في السلة" });
    merged.set(p.id, Math.min((merged.get(p.id) || 0) + q, 20));
  }
  const items = [...merged].map(([id, quantity]) => {
    const p = db.getProduct(id); // السعر يُحسب من السيرفر دائماً
    return { id, name: p.name, price: p.price, quantity };
  });

  // نيترو / بوستات: لازم إقرار العميل على التنبيه (تأكد من البيانات والإدارة غير مسؤولة عن الخطأ)
  const needsAck = merged.has("nitro") || merged.has("boosts");
  if (needsAck && b.agreed !== true) return res.status(400).json({ error: "لازم تقرأ التنبيه وتوافق عليه قبل تأكيد الطلب" });

  let serverLink = "", nitroUser = "";
  if (merged.has("boosts")) {
    serverLink = String(b.serverLink || "").trim();
    if (!INVITE_RE.test(serverLink)) return res.status(400).json({ error: "اكتب رابط السيرفر (رابط دعوة ديسكورد)" });
  }
  let nitroId = "";
  if (merged.has("nitro")) {
    if (String(b.nitroFor) === "other") {
      const v = String(b.nitroUser || "").trim();
      if (String(b.nitroType) === "id") {
        if (!/^\d{17,20}$/.test(v)) return res.status(400).json({ error: "الآيدي لازم يكون أرقام فقط (17 إلى 20 رقم)" });
        nitroId = v;
        nitroUser = "ID: " + v;
      } else {
        if (v.length < 2 || v.length > 40) return res.status(400).json({ error: "اكتب يوزر الشخص الذي يوصله النيترو" });
        nitroUser = "@" + v.replace(/^@/, "");
      }
    } else {
      nitroId = cust.uid; // النيترو لصاحب الحساب نفسه
      nitroUser = `نفس العميل (${cust.name}) — ID: ${cust.uid}`;
    }
  }

  const now = new Date().toISOString();
  const id = newOrderId();
  const order = {
    id, createdAt: now, status: "new", transferor, serverLink, nitroUser, nitroId, items,
    total: items.reduce((s, i) => s + i.price * i.quantity, 0),
    history: [{ status: "new", by: "customer", at: now }],
    agreedAt: needsAck ? now : null,
    customer: { id: cust.uid, name: cust.name, avatar: cust.avatar || null },
    receipt: { name: `receipt-${id}.${receipt.ext}` },
    notify: null,
  };
  // نرسل للإدارة أولاً: لو فشل الإرسال ما نسجّل الطلب، والعميل يعيد المحاولة
  const ref = await bot.notifyNewOrder(order, { buf: receipt.buf, name: order.receipt.name });
  if (!ref) return res.status(502).json({ error: "تعذر إرسال الإيصال للإدارة، حاول مرة ثانية" });
  order.notify = ref;
  db.createOrder(order);
  bot.notifyCustomer(order); // رسالة «قيد المراجعة» في الخاص
  console.log("[server] طلب جديد:", order.id, "| الإشعار مفعّل:", bot.botEnabled());
  res.status(201).json(publicOrder(order));
});

app.get("/api/me", async (req, res) => {
  const c = readCustomer(req);
  if (!c) return res.status(401).json({ error: "غير مسجّل" });
  res.json({ id: c.uid, name: c.name, username: c.username || "", email: c.email || "", avatar: c.avatar, inGuild: await bot.isMember(c.uid), staff: await bot.isStaff(c.uid) });
});

app.get("/api/my/orders", (req, res) => {
  const c = readCustomer(req);
  if (!c) return res.status(401).json({ error: "غير مسجّل" });
  res.json(db.listOrders().filter((o) => o.customer && o.customer.id === c.uid).map(publicOrder));
});

app.get("/api/orders/:id", limit(120, 10 * 60 * 1000), (req, res) => {
  const o = db.getOrder(String(req.params.id).toUpperCase());
  if (!o) return res.status(404).json({ error: "ما لقيت هذا الرقم" });
  res.json(publicOrder(o));
});

/* ---------- تسجيل الدخول بديسكورد ---------- */
// الكل يسجّل من نفس المكان. اللي عنده رتبة الإدارة (أو المالك) يفتح له النظام اللوحة تلقائياً.
app.get("/auth/customer", (req, res) => {
  if (!CLIENT_ID || !CLIENT_SECRET) return res.redirect("/?auth=setup");
  const state = crypto.randomBytes(16).toString("hex");
  setCookie(res, "oauth_state", state, 10 * 60 * 1000);
  const q = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: BASE_URL + "/auth/callback",
    response_type: "code", scope: "identify email", state, prompt: "none",
  });
  res.redirect("https://discord.com/oauth2/authorize?" + q);
});

app.get("/auth/callback", async (req, res) => {
  const ck = cookies(req);
  const fail = () => res.redirect("/?auth=error");
  try {
    const { code, state } = req.query;
    if (!code || !state || state !== ck.oauth_state) return fail();
    const tr = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "authorization_code",
        code: String(code), redirect_uri: BASE_URL + "/auth/callback",
      }),
    });
    const tok = await tr.json();
    if (!tok.access_token) return fail();
    const ur = await fetch("https://discord.com/api/users/@me", { headers: { Authorization: "Bearer " + tok.access_token } });
    const u = await ur.json();
    if (!u.id) return fail();
    setCookie(res, "oauth_state", "", 0);
    const name = u.global_name || u.username;
    setCookie(res, "customer", makeToken({ uid: u.id, name, username: u.username || "", email: u.email || "", avatar: u.avatar || null, exp: Date.now() + CUSTOMER_MS }), CUSTOMER_MS);
    res.redirect("/?auth=ok");
  } catch (e) {
    console.error("[auth]", e.message);
    fail();
  }
});

// خروج واحد: يمسح حساب العميل وجلسة الإدارة معاً
const logout = (req, res) => {
  setCookie(res, "customer", "", 0);
  setCookie(res, "session", "", 0);
  res.redirect("/");
};
app.get("/auth/logout", logout);
app.get("/auth/customer/logout", logout);

/* ---------- API الإدارة (محمي) ---------- */
async function requireStaff(req, res, next) {
  const s = readToken(cookies(req).session);
  // 401 حتى لو سُحبت الرتبة: الواجهة ترجّعه للمتجر بدون ما تكشف وجود لوحة
  if (!s || !(await bot.isStaff(s.uid))) return res.status(401).json({ error: "غير مصرّح" });
  if (req.method !== "GET" && req.get("X-Requested-With") !== "admin-panel") return res.status(403).json({ error: "طلب مرفوض" });
  req.staff = s;
  next();
}
// المنتجات والأسعار للمالك فقط (OWNER_ID في .env)
function requireOwner(req, res, next) {
  if (!bot.isOwner(req.staff.uid)) return res.status(403).json({ error: "هذه الصلاحية للمالك فقط" });
  next();
}
const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error("[server]", e);
    res.status(500).json({ error: "خطأ في السيرفر" });
  }
};

app.get("/api/admin/me", requireStaff, (req, res) =>
  res.json({ id: req.staff.uid, name: req.staff.name, avatar: req.staff.avatar, owner: bot.isOwner(req.staff.uid) }));

app.get("/api/admin/orders", requireStaff, (req, res) =>
  res.json(db.listOrders().map(adminOrder)));

app.patch("/api/admin/orders/:id", requireStaff, async (req, res) => {
  const status = req.body && req.body.status;
  if (!db.STATUSES.includes(status)) return res.status(400).json({ error: "حالة غير صالحة" });
  const prev = (db.getOrder(String(req.params.id)) || {}).status;
  const o = db.setStatus(String(req.params.id), status, `${req.staff.name} (الموقع)`);
  if (!o) return res.status(404).json({ error: "الطلب غير موجود" });
  await bot.syncOrderMessage(o);
  const note = typeof req.body.message === "string" ? req.body.message.slice(0, 1500) : "";
  if (prev !== o.status) await bot.notifyCustomer(o, status === "delivered" ? note : ""); // رسالة خاصة للعميل
  res.json(adminOrder(o));
});

app.get("/api/admin/products", requireStaff, requireOwner, (req, res) => res.json(db.getProducts()));

app.post("/api/admin/products", requireStaff, requireOwner, wrap(async (req, res) => {
  res.status(201).json(await db.createProduct(req.body || {}));
}));

app.patch("/api/admin/products/:id", requireStaff, requireOwner, wrap(async (req, res) => {
  const p = await db.updateProduct(String(req.params.id), req.body || {});
  if (!p) return res.status(404).json({ error: "المنتج غير موجود" });
  res.json(p);
}));

app.post("/api/admin/products/:id/move", requireStaff, requireOwner, wrap(async (req, res) => {
  const dir = req.body && req.body.dir;
  if (dir !== "up" && dir !== "down") return res.status(400).json({ error: "اتجاه غير صالح" });
  const list = db.moveProduct(String(req.params.id), dir);
  if (!list) return res.status(404).json({ error: "المنتج غير موجود" });
  res.json(list);
}));

app.delete("/api/admin/products/:id", requireStaff, requireOwner, wrap(async (req, res) => {
  if (!db.deleteProduct(String(req.params.id))) return res.status(404).json({ error: "المنتج غير موجود" });
  res.json({ ok: true });
}));

/* ---------- الملفات ---------- */
// صور المنتجات اللي ترفعها من اللوحة (كل صورة لها آيدي فريد فنقدر نكاشيها)
app.get("/img/:id", async (req, res) => {
  const img = await db.getImage(String(req.params.id));
  if (!img) return res.status(404).end();
  res.set({ "Content-Type": img.mime, "Cache-Control": "public, max-age=31536000, immutable" });
  res.send(img.buf);
});

// صفحة الإدارة خارج public: ما تنعرض إلا لصاحب الرتبة أو المالك، وغيرهم يشوف 404 عادي (ولا كأنها موجودة)
app.get("/admin", async (req, res, next) => {
  const ck = cookies(req);
  let s = readToken(ck.session);
  if (!s) {
    const c = readToken(ck.customer);
    if (c) s = { uid: c.uid, name: c.name, avatar: c.avatar || null };
  }
  if (!s || !(await bot.isStaff(s.uid))) return next();
  setCookie(res, "session", makeToken({ uid: s.uid, name: s.name, avatar: s.avatar || null, exp: Date.now() + SESSION_MS }), SESSION_MS);
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "private", "admin.html"));
});
app.use(express.static(path.join(__dirname, "public"), { index: "index.html" }));

// أخطاء الـ API بصيغة JSON (حجم كبير / JSON خربان)
app.use((err, req, res, next) => {
  if (err.type === "entity.too.large") return res.status(413).json({ error: "الحجم كبير، جرّب صورة أصغر" });
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "بيانات غير صالحة" });
  next(err);
});

db.ready.then(() => bot.startBot()).then(() => {
  app.listen(PORT, () => {
    console.log(`\nالمتجر:        ${BASE_URL}`);
    console.log(`لوحة الإدارة:  ${BASE_URL}/admin\n`);
  });
});
