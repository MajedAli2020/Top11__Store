// قاعدة بيانات بسيطة في ملف JSON (تكفي للتجربة وللمتاجر الصغيرة)
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "data");
const FILE = path.join(DIR, "db.json");

const SEED_PRODUCTS = [
  { id: "nitro", group: "main", name: "نيترو دسكورد", category: "الأكثر طلباً", description: "اشتراك نيترو يرفع تجربتك داخل ديسكورد بمزايا قوية وفورية.", price: 22, image: "assets/nitro.png", active: true },
  { id: "boosts", group: "main", name: "14 بوست شهر", category: "للسيرفرات", description: "حزمة 14 بوست لتطوير السيرفر وفتح مزايا إضافية بشكل أنيق.", price: 15, image: "assets/boosts.png", active: true },
  { id: "sources", group: "main", name: "سورسات", category: "للمطورين - للسيرفرات العامة", description: "سورسات ديسكورد جاهزة للتشغيل والتخصيص.", price: 99, image: "assets/sources.png", active: true },
  ...[[2015, 250], [2016, 65], [2017, 47], [2018, 35], [2019, 30], [2020, 27], [2021, 18], [2022, 15], [2023, 12], [2024, 10], [2025, 5]].map(([y, price]) => ({
    id: "account-" + y, group: "accounts", name: "حساب " + y, category: "حسابات دسكورد",
    description: "حساب دسكورد مميز من سنة " + y + ".", price, image: "assets/ad_" + y + ".png", active: true,
  })),
];

const STATUSES = ["new", "accepted", "delivered", "rejected"];
let state = { orders: [], products: SEED_PRODUCTS };

// تخزين خارجي اختياري (Upstash Redis - مجاني بدون بطاقة) للاستضافات اللي تمسح الملفات مثل Render
const REMOTE_URL = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, "");
const REMOTE_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const REMOTE_KEY = "top-store:db";
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
    const s = JSON.parse(fs.readFileSync(FILE, "utf8"));
    state = { orders: s.orders || [], products: s.products || SEED_PRODUCTS };
  } catch (e) {
    state = { orders: [], products: SEED_PRODUCTS };
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
      const s = JSON.parse(raw);
      state = { orders: s.orders || [], products: s.products || SEED_PRODUCTS };
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

const getProducts = () => state.products;
const getActiveProducts = () => state.products.filter((p) => p.active);
const getProduct = (id) => state.products.find((p) => p.id === id);

function updateProduct(id, patch) {
  const p = getProduct(id);
  if (!p) return null;
  if (typeof patch.name === "string" && patch.name.trim()) p.name = patch.name.trim().slice(0, 80);
  if (typeof patch.description === "string") p.description = patch.description.trim().slice(0, 300);
  if (patch.price !== undefined && Number.isFinite(+patch.price) && +patch.price >= 0 && +patch.price <= 100000) p.price = +patch.price;
  if (typeof patch.active === "boolean") p.active = patch.active;
  if (typeof patch.image === "string" && patch.image) p.image = patch.image;
  if (typeof patch.category === "string" && patch.category.trim()) p.category = patch.category.trim().slice(0, 40);
  save();
  return p;
}

function addProduct(p) {
  state.products.push(p);
  save();
  return p;
}

function deleteProduct(id) {
  const i = state.products.findIndex((p) => p.id === id);
  if (i < 0) return false;
  state.products.splice(i, 1);
  save();
  return true;
}

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

module.exports = { ready, setLastDm, STATUSES, getProducts, getActiveProducts, getProduct, updateProduct, addProduct, deleteProduct, createOrder, getOrder, listOrders, setStatus, setNotifyRef };
