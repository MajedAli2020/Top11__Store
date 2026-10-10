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
const publicProduct = ({ id, group, name, category, description, price, image }) => ({ id, group, name, category, description, price, image });
const publicOrder = (o) => ({
  id: o.id, date: o.createdAt, status: o.status, transferor: o.transferor,
  serverLink: o.serverLink, nitroUser: o.nitroUser, nitroId: o.nitroId || "", items: o.items, total: o.total,
  customerName: o.customer ? o.customer.name : "",
});
const adminOrder = (o) => ({ ...publicOrder(o), history: o.history, customer: o.customer || null, lastDm: o.lastDm || null });
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
  const order = db.createOrder({
    id: newOrderId(), createdAt: now, status: "new", transferor, serverLink, nitroUser, nitroId, items,
    total: items.reduce((s, i) => s + i.price * i.quantity, 0),
    history: [{ status: "new", by: "customer", at: now }],
    customer: { id: cust.uid, name: cust.name, avatar: cust.avatar || null },
    notify: null,
  });
  bot.notifyNewOrder(order); // ما ننتظره: لو فشل البوت الطلب يبقى محفوظ
  bot.notifyCustomer(order); // رسالة «قيد المعالجة» في الخاص
  console.log("[server] طلب جديد:", order.id, "| الإشعار مفعّل:", bot.botEnabled());
  res.status(201).json(publicOrder(order));
});

app.get("/api/me", async (req, res) => {
  const c = readCustomer(req);
  if (!c) return res.status(401).json({ error: "غير مسجّل" });
  res.json({ id: c.uid, name: c.name, avatar: c.avatar, inGuild: await bot.isMember(c.uid) });
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

/* ---------- تسجيل الدخول بديسكورد (للعميل وللإدارة) ---------- */
function startAuth(purpose) {
  return (req, res) => {
    if (!CLIENT_ID || !CLIENT_SECRET) return res.redirect(purpose === "customer" ? "/?auth=setup" : "/admin?error=setup");
    const state = crypto.randomBytes(16).toString("hex");
    setCookie(res, "oauth_state", state, 10 * 60 * 1000);
    setCookie(res, "oauth_purpose", purpose, 10 * 60 * 1000);
    const q = new URLSearchParams({
      client_id: CLIENT_ID, redirect_uri: BASE_URL + "/auth/callback",
      response_type: "code", scope: "identify", state, prompt: "none",
    });
    res.redirect("https://discord.com/oauth2/authorize?" + q);
  };
}
app.get("/auth/login", startAuth("admin"));
app.get("/auth/customer", startAuth("customer"));

app.get("/auth/callback", async (req, res) => {
  const ck = cookies(req);
  const purpose = ck.oauth_purpose === "customer" ? "customer" : "admin";
  const fail = (code) => res.redirect(purpose === "customer" ? "/?auth=error" : "/admin?error=" + code);
  try {
    const { code, state } = req.query;
    if (!code || !state || state !== ck.oauth_state) return fail("state");
    const tr = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "authorization_code",
        code: String(code), redirect_uri: BASE_URL + "/auth/callback",
      }),
    });
    const tok = await tr.json();
    if (!tok.access_token) return fail("oauth");
    const ur = await fetch("https://discord.com/api/users/@me", { headers: { Authorization: "Bearer " + tok.access_token } });
    const u = await ur.json();
    if (!u.id) return fail("oauth");
    setCookie(res, "oauth_state", "", 0);
    setCookie(res, "oauth_purpose", "", 0);
    const name = u.global_name || u.username;
    if (purpose === "customer") {
      setCookie(res, "customer", makeToken({ uid: u.id, name, avatar: u.avatar || null, exp: Date.now() + CUSTOMER_MS }), CUSTOMER_MS);
      return res.redirect("/?auth=ok");
    }
    if (!(await bot.isStaff(u.id))) return res.redirect("/admin?error=denied");
    setCookie(res, "session", makeToken({ uid: u.id, name, avatar: u.avatar || null, exp: Date.now() + SESSION_MS }), SESSION_MS);
    res.redirect("/admin");
  } catch (e) {
    console.error("[auth]", e.message);
    fail("oauth");
  }
});

app.get("/auth/logout", (req, res) => {
  setCookie(res, "session", "", 0);
  res.redirect("/admin");
});
app.get("/auth/customer/logout", (req, res) => {
  setCookie(res, "customer", "", 0);
  res.redirect("/");
});

/* ---------- API الإدارة (محمي) ---------- */
async function requireStaff(req, res, next) {
  const s = readToken(cookies(req).session);
  if (!s) return res.status(401).json({ error: "سجّل الدخول" });
  if (!(await bot.isStaff(s.uid))) return res.status(403).json({ error: "ما عندك صلاحية" });
  if (req.method !== "GET" && req.get("X-Requested-With") !== "admin-panel") return res.status(403).json({ error: "طلب مرفوض" });
  req.staff = s;
  next();
}

app.get("/api/admin/me", requireStaff, (req, res) =>
  res.json({ id: req.staff.uid, name: req.staff.name, avatar: req.staff.avatar }));

app.get("/api/admin/orders", requireStaff, (req, res) =>
  res.json(db.listOrders().map(adminOrder)));

app.patch("/api/admin/orders/:id", requireStaff, async (req, res) => {
  const status = req.body && req.body.status;
  if (!db.STATUSES.includes(status)) return res.status(400).json({ error: "حالة غير صالحة" });
  const prev = (db.getOrder(String(req.params.id)) || {}).status;
  const o = db.setStatus(String(req.params.id), status, `${req.staff.name} (الموقع)`);
  if (!o) return res.status(404).json({ error: "الطلب غير موجود" });
  await bot.syncOrderMessage(o);
  if (prev !== o.status) await bot.notifyCustomer(o); // رسالة خاصة للعميل
  res.json(adminOrder(o));
});

app.get("/api/admin/products", requireStaff, (req, res) => res.json(db.getProducts()));

app.patch("/api/admin/products/:id", requireStaff, (req, res) => {
  const p = db.updateProduct(String(req.params.id), req.body || {});
  if (!p) return res.status(404).json({ error: "المنتج غير موجود" });
  res.json(p);
});

/* ---------- الملفات ---------- */
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.use(express.static(path.join(__dirname, "public"), { index: "index.html" }));

db.ready.then(() => bot.startBot()).then(() => {
  app.listen(PORT, () => {
    console.log(`\nالمتجر:        ${BASE_URL}`);
    console.log(`لوحة الإدارة:  ${BASE_URL}/admin\n`);
  });
});
