// قاعدة بيانات بسيطة في ملف JSON (تكفي للتجربة وللمتاجر الصغيرة)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DIR = path.join(__dirname, "data");
const FILE = path.join(DIR, "db.json");
const IMG_DIR = path.join(DIR, "img");

const NOTE_DEFAULT = "ملاحظة: السعر غير ثابت";
const SEED_PRODUCTS = [
  { id: "nitro", group: "main", name: "نيترو دسكورد", category: "الأكثر طلباً", description: "اشتراك نيترو يرفع تجربتك داخل ديسكورد بمزايا قوية وفورية.", price: 22, image: "assets/nitro.png", note: NOTE_DEFAULT, active: true },
  { id: "boosts", group: "main", name: "14 بوست شهر", category: "للسيرفرات", description: "حزمة 14 بوست لتطوير السيرفر وفتح مزايا إضافية بشكل أنيق.", price: 15, image: "assets/boosts.png", note: NOTE_DEFAULT, active: true },
  { id: "sources", group: "main", name: "سورسات", category: "للمطورين - للسيرفرات العامة", description: "سورسات ديسكورد جاهزة للتشغيل والتخصيص.", price: 99, image: "assets/sources.png", note: "", active: true },
  ...[[2015, 250], [2016, 65], [2017, 47], [2018, 35], [2019, 30], [2020, 27], [2021, 18], [2022, 15], [2023, 12], [2024, 10], [2025, 5]].map(([y, price]) => ({
    id: "account-" + y, group: "accounts", name: "حساب " + y, category: "حسابات دسكورد",
    description: "حساب دسكورد مميز من سنة " + y + ".", price, image: "assets/ad_" + y + ".png", note: "", active: true,
  })),
];

const GROUPS = ["main", "accounts"];
const DEFAULT_CAT = { main: "منتجات", accounts: "حسابات دسكورد" };
// منتجات أساسية: السيرفر يعتمد عليها في الطلبات (رابط السيرفر / مستلم النيترو)، فتقدر تخفيها بس ما تنحذف
const PROTECTED = new Set(["nitro", "boosts"]);
const STATUSES = ["new", "accepted", "delivered", "rejected"];

// يضمن إن كل منتج فيه كل الحقول (للبيانات القديمة اللي ما فيها note)
const normProduct = (p) => ({
  ...p,
  group: GROUPS.includes(p.group) ? p.group : "main",
  note: typeof p.note === "string" ? p.note : (PROTECTED.has(p.id) ? NOTE_DEFAULT : ""),
});
const fromRaw = (s) => ({ orders: s.orders || [], products: (s.products || SEED_PRODUCTS).map(normProduct) });

let state = { orders: [], products: SEED_PRODUCTS.map(normProduct) };

// تخزين خارجي اختياري (Upstash Redis - مجاني بدون بطاقة) للاستضافات اللي تمسح الملفات مثل Render
const REMOTE_URL = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, "");
const REMOTE_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const REMOTE_KEY = "top-store:db";
const IMG_PREFIX = "top-store:img:";
const remoteOn = !!(REMOTE_URL && REMOTE_TOKEN);

async function remoteCmd(cmd) {
  const r = await fetch(REMOTE_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + REMOTE_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error("Upstash HTTP " + r.status);
  return (await r.json()).result;
}

let pushing = false, pushAgain = false;
async function pushRemote() {
  if (pushing) { pushAgain = true; return; }
  pushing = true;
  try {
    await remoteCmd(["SET", REMOTE_KEY, JSON.stringify(state)]);
  } catch (e) {
    console.error("[db] فشل الحفظ في Upstash:", e.message);
  } finally {
    pushing = false;
    if (pushAgain) { pushAgain = false; pushRemote(); }
  }
}

let booting = true; // أثناء الإقلاع لا نرفع شي لـ Upstash قبل ما نحمّل اللي فيه
function save() {
  if (remoteOn && !booting) pushRemote();
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

function load() {
  try {
    state = fromRaw(JSON.parse(fs.readFileSync(FILE, "utf8")));
  } catch (e) {
    state = { orders: [], products: SEED_PRODUCTS.map(normProduct) };
  }
  save();
}
load();

// يُنتظر قبل تشغيل السيرفر: يحمّل البيانات من Upstash لو مفعّل
let remoteFailed = false;
const ready = (async () => {
  if (!remoteOn) { booting = false; return; }
  try {
    const raw = await remoteCmd(["GET", REMOTE_KEY]);
    if (raw) {
      state = fromRaw(JSON.parse(raw));
      console.log("[db] تم تحميل البيانات من Upstash:", state.orders.length, "طلب");
    } else {
      await remoteCmd(["SET", REMOTE_KEY, JSON.stringify(state)]);
      console.log("[db] قاعدة Upstash فاضية، تم رفع البيانات الحالية");
    }
  } catch (e) {
    console.error("[db] تعذر الاتصال بـ Upstash، نكمل بالملف المحلي:", e.message);
    remoteFailed = true;
  } finally {
    booting = false;
  }
})();

/* ---------- صور المنتجات المرفوعة ---------- */
// تنحفظ كل صورة لحالها (ملف محلي + Upstash لو مفعّل) عشان ما تضخّم قاعدة الطلبات وما تنمسح مع استضافة Render
const IMG_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
const IMG_ID_RE = /^[a-f0-9]{18}$/;
const imgCache = new Map();
const fail = (msg, status = 400) => { throw Object.assign(new Error(msg), { status }); };

function sniff(buf) {
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

async function storeImage(dataUrl) {
  if (typeof dataUrl !== "string" || dataUrl.length > 450000) fail("الصورة كبيرة، جرّب صورة أصغر");
  const m = IMG_RE.exec(dataUrl);
  if (!m) fail("صيغة الصورة غير مدعومة (PNG أو JPG أو WEBP)");
  const buf = Buffer.from(m[2], "base64");
  const mime = sniff(buf);
  if (!mime) fail("الملف ليس صورة صالحة");
  const id = crypto.randomBytes(9).toString("hex");
  const data = `data:${mime};base64,${buf.toString("base64")}`;
  if (remoteOn) {
    try { await remoteCmd(["SET", IMG_PREFIX + id, data]); }
    catch (e) { console.error("[db] فشل حفظ الصورة في Upstash:", e.message); fail("تعذر حفظ الصورة، حاول مرة ثانية", 502); }
  }
  fs.mkdirSync(IMG_DIR, { recursive: true });
  fs.writeFileSync(path.join(IMG_DIR, id), data);
  imgCache.set(id, { mime, buf });
  return id;
}

async function getImage(id) {
  if (!IMG_ID_RE.test(id)) return null;
  if (imgCache.has(id)) return imgCache.get(id);
  let data = null;
  try { data = fs.readFileSync(path.join(IMG_DIR, id), "utf8"); } catch (e) { /* ما في نسخة محلية */ }
  if (!data && remoteOn) {
    try {
      data = await remoteCmd(["GET", IMG_PREFIX + id]);
      if (data) { fs.mkdirSync(IMG_DIR, { recursive: true }); fs.writeFileSync(path.join(IMG_DIR, id), data); }
    } catch (e) { console.error("[db] تعذر جلب الصورة من Upstash:", e.message); }
  }
  const m = data && IMG_RE.exec(data);
  if (!m) return null;
  const v = { mime: m[1], buf: Buffer.from(m[2], "base64") };
  imgCache.set(id, v);
  return v;
}

function removeImage(url) {
  if (typeof url !== "string" || !url.startsWith("/img/")) return; // صور assets الجاهزة ما نحذفها
  const id = url.slice(5);
  if (!IMG_ID_RE.test(id)) return;
  imgCache.delete(id);
  try { fs.unlinkSync(path.join(IMG_DIR, id)); } catch (e) { /* مو موجود */ }
  if (remoteOn) remoteCmd(["DEL", IMG_PREFIX + id]).catch(() => {});
}

/* ---------- المنتجات ---------- */
const getProducts = () => state.products;
const getActiveProducts = () => state.products.filter((p) => p.active);
const getProduct = (id) => state.products.find((p) => p.id === id);

function readFields(b, partial) {
  const o = {};
  if (!partial || b.name !== undefined) {
    const v = String(b.name ?? "").trim();
    if (!v || v.length > 80) fail("اسم المنتج مطلوب (حد أقصى 80 حرف)");
    o.name = v;
  }
  if (!partial || b.price !== undefined) {
    const n = Number(b.price);
    if (b.price === "" || b.price == null || !Number.isFinite(n) || n < 0 || n > 100000) fail("السعر غير صالح");
    o.price = n;
  }
  if (b.description !== undefined) {
    const v = String(b.description).trim();
    if (v.length > 300) fail("الوصف طويل (حد أقصى 300 حرف)");
    o.description = v;
  }
  if (b.category !== undefined) {
    const v = String(b.category).trim();
    if (v.length > 40) fail("التصنيف طويل (حد أقصى 40 حرف)");
    o.category = v;
  }
  if (b.note !== undefined) {
    const v = String(b.note).trim();
    if (v.length > 60) fail("الملاحظة طويلة (حد أقصى 60 حرف)");
    o.note = v;
  }
  if (b.group !== undefined) {
    if (!GROUPS.includes(b.group)) fail("القسم غير صالح");
    o.group = b.group;
  }
  if (b.active !== undefined) o.active = b.active === true || b.active === "true";
  return o;
}

async function createProduct(b) {
  const f = readFields({ group: "main", ...b }, false);
  if (!b.image) fail("اختر صورة للمنتج");
  const imgId = await storeImage(b.image);
  const p = {
    id: "p-" + crypto.randomBytes(5).toString("hex"),
    group: f.group,
    name: f.name,
    category: f.category || DEFAULT_CAT[f.group],
    description: f.description || "",
    price: f.price,
    image: "/img/" + imgId,
    note: f.note || "",
    active: f.active !== false,
  };
  state.products.push(p);
  save();
  return p;
}

async function updateProduct(id, b) {
  const p = getProduct(id);
  if (!p) return null;
  const f = readFields(b, true);
  const imgId = b.image ? await storeImage(b.image) : null;
  const oldImage = p.image;
  Object.assign(p, f);
  if (f.category === "") p.category = DEFAULT_CAT[p.group];
  if (imgId) { p.image = "/img/" + imgId; removeImage(oldImage); }
  save();
  return p;
}

function deleteProduct(id) {
  const p = getProduct(id);
  if (!p) return false;
  if (PROTECTED.has(id)) fail("هذا منتج أساسي ما ينحذف، تقدر تخفيه من المتجر.");
  state.products = state.products.filter((x) => x.id !== id);
  removeImage(p.image);
  save();
  return true;
}

// تحريك المنتج داخل قسمه (فوق / تحت)
function moveProduct(id, dir) {
  const p = getProduct(id);
  if (!p) return null;
  const same = state.products.filter((x) => x.group === p.group);
  const j = same.indexOf(p) + (dir === "up" ? -1 : 1);
  if (j >= 0 && j < same.length) {
    const a = state.products.indexOf(p), b = state.products.indexOf(same[j]);
    [state.products[a], state.products[b]] = [state.products[b], state.products[a]];
    save();
  }
  return state.products;
}

/* ---------- الطلبات ---------- */
function createOrder(order) {
  state.orders.unshift(order);
  save();
  return order;
}
const getOrder = (id) => state.orders.find((o) => o.id === id);
const listOrders = () => state.orders;

function setStatus(id, status, by) {
  const o = getOrder(id);
  if (!o || !STATUSES.includes(status)) return null;
  if (o.status === status) return o;
  o.status = status;
  o.history.push({ status, by: by || "system", at: new Date().toISOString() });
  save();
  return o;
}

function setLastDm(id, v) {
  const o = getOrder(id);
  if (!o) return;
  o.lastDm = v;
  save();
}

function setNotifyRef(id, ref) {
  const o = getOrder(id);
  if (!o) return;
  o.notify = ref;
  save();
}

module.exports = {
  ready, setLastDm, STATUSES, PROTECTED,
  getProducts, getActiveProducts, getProduct, createProduct, updateProduct, deleteProduct, moveProduct, getImage,
  createOrder, getOrder, listOrders, setStatus, setNotifyRef,
};
