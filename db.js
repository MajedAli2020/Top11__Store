// قاعدة بيانات بسيطة في ملف JSON (تكفي للتجربة وللمتاجر الصغيرة)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DIR = path.join(__dirname, "data");
const FILE = path.join(DIR, "db.json");
const IMG_DIR = path.join(DIR, "img");

const DELIVERY_DEFAULT = "بعد اعتماد الإيصال من الإدارة، وغالباً خلال دقائق.";
const METHOD_DEFAULT = "يوصلك التسليم والتحديثات في رسائل Discord الخاصة من البوت، أو عبر التكت مع الإدارة.";
const NOTE_DEFAULT = "ملاحظة: السعر غير ثابت";
const BUNDLE = {
  id: "package-full", group: "bots", name: "البكج الشامل", category: "البكجات",
  description: "بكج كامل بسعر خرافي 🔥", price: 249, image: "assets/sources.png", note: "", active: true,
  details: "البكج الشامل يوفر عليك فلوس، بكج كامل بسعر خرافي 🔥\n- سورس الدعم الفني\n- سورس الجرد للإدارة\n- موقع إلكتروني أعلى باقة\n- رتبة التوريد لمدة أسبوع",
};
const SEED_PRODUCTS = [
  { id: "nitro", group: "main", name: "نيترو دسكورد", category: "الأكثر طلباً", description: "اشتراك نيترو يرفع تجربتك داخل ديسكورد بمزايا قوية وفورية.", price: 22, image: "assets/nitro.png", note: NOTE_DEFAULT, active: true },
  { id: "boosts", group: "main", name: "14 بوست شهر", category: "للسيرفرات", description: "حزمة 14 بوست لتطوير السيرفر وفتح مزايا إضافية بشكل أنيق.", price: 15, image: "assets/boosts.png", note: NOTE_DEFAULT, active: true },
  { id: "sources", group: "bots", name: "سورسات", category: "للمطورين - للسيرفرات العامة", description: "سورسات ديسكورد جاهزة للتشغيل والتخصيص.", price: 99, image: "assets/sources.png", note: "", active: true },
  BUNDLE,
  ...[[2015, 250], [2016, 65], [2017, 47], [2018, 35], [2019, 30], [2020, 27], [2021, 18], [2022, 15], [2023, 12], [2024, 10], [2025, 5]].map(([y, price]) => ({
    id: "account-" + y, group: "accounts", name: "حساب " + y, category: "حسابات دسكورد",
    description: "حساب دسكورد مميز من سنة " + y + ".", price, image: "assets/accounts.png", note: "", active: true,
  })),
];

const SEED_REVIEWS = [
  ["فهد العتيبي", "توب الأفضل"], ["نورة القحطاني", "الثقة في محلها"], ["عبدالله الشمري", "تسليم سريع جداً"],
  ["ريم الدوسري", "تعامل راقي وأسعار ممتازة"], ["سلطان المطيري", "مضمون ١٠٠٪"], ["منيرة الحربي", "ما قصروا، شكراً لكم"],
  ["تركي الغامدي", "أفضل متجر تعاملت معه"], ["لمى الزهراني", "خدمة ممتازة ورد سريع"], ["بندر السبيعي", "أنصح فيه بقوة"],
  ["هديل العنزي", "سرعة وأمانة، تسلمون"], ["ماجد البقمي", "تجربة رائعة وراح أكررها"], ["جود الشهري", "الدعم متعاون جداً"],
].map(([name, text], i) => ({ id: "r-seed" + (i + 1), name, text, stars: 5, gender: [2, 4, 6, 8, 10, 12].includes(i + 1) ? "female" : "male", active: true, at: new Date(2026, 9, 1, 12, i).toISOString() }));

/* ---------- إعدادات المتجر (ألوان / شعار / نصوص) ---------- */
// القيم الافتراضية = اللي مكتوب في صفحة المتجر. أي حقل فاضي أو مطابق للافتراضي ما ينحفظ.
const COLOR_DEFAULTS = { bg: "#0b0907", panel: "#15110d", text: "#f7f1ea", muted: "#a8967f", accent: "#a07a58", accent2: "#c9a07a", ice: "#ecd5bb" };
const TEXT_FIELDS = {
  storeName: ["توب ستور", 40], tabSuffix: ["تجربة رقمية", 60], navSub: ["Discord Services", 40],
  heroEyebrow: ["تسليم سريع • موثوق • آمن", 80], heroTitle1: ["خلّ تجربتك", 40], heroTitle2: ["أفضل مع متجر", 40], heroTitle3: ["توب.", 40],
  heroLead: ["منتجات رقمية مختارة بعناية، طلب سهل بالتحويل البنكي، وتسليم مباشر إلى حسابك في Discord بعد اعتماد الإيصال.", 300],
  btnProducts: ["تصفح المنتجات ←", 40], btnCart: ["افتح السلة", 40],
  homeHeading: ["تجربة مرتبة من البداية", 80],
  ctaTitle: ["جاهز تبدأ؟", 60], ctaText: ["اختر منتجك، أضفه للسلة، وابدأ تجربة توب ستور.", 200], ctaButton: ["ابدأ طلبك الآن ←", 40],
  navHome: ["الرئيسية", 24], navProducts: ["المنتجات", 24], navHow: ["كيف تطلب؟", 24], navTrack: ["تتبع طلبي", 24], navCart: ["السلة", 24],
  catAllLabel: ["الكل", 30], catAllSub: ["كل المنتجات", 50],
  visitorsLabel: ["عدد الزوار", 30],
  homeProductsTitle: ["المنتجات", 40], homeProductsAll: ["عرض الكل", 24],
  reviewsTitle: ["تقييمات العملاء", 60], footerLeft: ["توب ستور — منتجات رقمية بتجربة مختلفة", 120], footerRight: ["Top STORE / 2026", 60],
};
// أقسام المنتجات: المعرّفات ثابتة (المنتجات مرتبطة فيها)، والاسم والوصف والترتيب تتعدل
const SECTION_DEFAULTS = [
  { id: "main", label: "نيترو وبوست", sub: "نيترو وبوستات السيرفرات" },
  { id: "subs", label: "اشتراكات", sub: "اشتراكات رقمية" },
  { id: "accounts", label: "حسابات دسكورد", sub: "حسابات قديمة ومميزة" },
  { id: "bots", label: "سورسات (بوتات الديسكورد)", sub: "سورسات وبوتات جاهزة" },
];
const SETTINGS_DEFAULTS = { colors: COLOR_DEFAULTS, texts: Object.fromEntries(Object.entries(TEXT_FIELDS).map(([k, [v]]) => [k, v])), sections: SECTION_DEFAULTS };
const clampDim = (v) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? 45 : Math.min(90, Math.max(0, Math.round(Number(v)))));
const clampHome = (v) => (Number.isInteger(Number(v)) && Number(v) >= 3 && Number(v) <= 6 ? Number(v) : 3);
const normSettings = (x) => ({ colors: { ...((x && x.colors) || {}) }, texts: { ...((x && x.texts) || {}) }, logo: typeof (x && x.logo) === "string" ? x.logo : "", heroImage: typeof (x && x.heroImage) === "string" ? x.heroImage : "", bgImage: typeof (x && x.bgImage) === "string" ? x.bgImage : "", bgDim: clampDim(x && x.bgDim), shapes: !(x && x.shapes === false), showVisitors: !!(x && x.showVisitors), maintenance: !!(x && x.maintenance), homeProducts: !(x && x.homeProducts === false), homeCount: clampHome(x && x.homeCount), homeImages: !!(x && x.homeImages), sections: Array.isArray(x && x.sections) ? x.sections : null });

// إحصائيات الزوار: بدون تخزين أي IP أو معرّف. الزائر الجديد = متصفح ما عنده كوكي الزيارة، واليومي = أول زيارة له اليوم.
const normStats = (x) => ({ salesResetAt: typeof (x && x.salesResetAt) === "string" ? x.salesResetAt : "", visitors: Number(x && x.visitors) || 0, visits: Number(x && x.visits) || 0, days: { ...((x && x.days) || {}) } });
const dayKey = (t = Date.now()) => new Date(t + 3 * 3600 * 1000).toISOString().slice(0, 10); // توقيت السعودية

const GROUPS = ["main", "subs", "accounts", "bots"];
const DEFAULT_CAT = { main: "نيترو وبوست", subs: "اشتراكات", accounts: "حسابات دسكورد", bots: "سورسات (بوتات ديسكورد)" };
// منتجات أساسية: السيرفر يعتمد عليها في الطلبات (رابط السيرفر / مستلم النيترو)، فتقدر تخفيها بس ما تنحذف
const PROTECTED = new Set(["nitro", "boosts"]);
const STATUSES = ["new", "accepted", "delivered", "rejected"];

// يضمن إن كل منتج فيه كل الحقول (للبيانات القديمة اللي ما فيها note)
const HOME_ICONS = ["auto","discord","rocket","code","user","bell","spark","image"];
const normProduct = (p) => ({
  ...p,
  image: /^assets\/ad_\d{4}\.png$/.test(p.image || "") ? "assets/accounts.png" : p.image, // صور السنوات القديمة الناقصة -> صورة الحسابات الموحّدة
  group: GROUPS.includes(p.group) ? p.group : "main",
  soldOut: p.soldOut === true,
  featured: p.featured === true,
  homeName: typeof p.homeName === "string" ? p.homeName : "",
  homeChip: typeof p.homeChip === "string" ? p.homeChip : "",
  homeIcon: HOME_ICONS.includes(p.homeIcon) ? p.homeIcon : "auto",
  homeImage: typeof p.homeImage === "string" ? p.homeImage : "",
  discount: Math.min(95, Math.max(0, Math.round(Number(p.discount) || 0))),
  discountEnds: typeof p.discountEnds === "string" ? p.discountEnds : "",
  note: typeof p.note === "string" ? p.note : (PROTECTED.has(p.id) ? NOTE_DEFAULT : ""),
  details: typeof p.details === "string" ? p.details : "",
  delivery: typeof p.delivery === "string" ? p.delivery : DELIVERY_DEFAULT,
  method: typeof p.method === "string" ? p.method : METHOD_DEFAULT,
});
// ترحيل (مرة وحدة): منتج «سورسات» القديم كان في قسم main، ننقله لقسم السورسات الجديد
const fromRaw = (s) => {
  const products = (s.products || SEED_PRODUCTS).map((p) => normProduct(!s.v && p.id === "sources" && p.group === "main" ? { ...p, group: "bots" } : p));
  // ترحيل (مرة وحدة): نضيف «البكج الشامل» للمتجر القديم، ولو حذفته بعدها ما يرجع
  if ((s.v || 0) < 3 && !products.some((p) => p.id === BUNDLE.id)) products.push(normProduct(BUNDLE));
  // ترحيل (مرة وحدة): نضيف تقييمات العملاء الافتراضية، ولو حذفتها كلها بعدها ما ترجع
  const reviews = (Array.isArray(s.reviews) ? s.reviews : (s.v || 0) < 4 ? SEED_REVIEWS.map((r) => ({ ...r })) : [])
    .map((r) => ({ ...r, gender: r.gender === "female" || r.gender === "male" ? r.gender : (SEED_REVIEWS.find((x) => x.id === r.id) || {}).gender || "male" }));
  return { v: 5, orders: s.orders || [], products, reviews, settings: normSettings(s.settings), stats: normStats(s.stats) };
};

let state = { v: 5, orders: [], products: SEED_PRODUCTS.map(normProduct), reviews: SEED_REVIEWS.map((r) => ({ ...r })), settings: normSettings(), stats: normStats() };

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
    state = { v: 5, orders: [], products: SEED_PRODUCTS.map(normProduct), reviews: SEED_REVIEWS.map((r) => ({ ...r })), settings: normSettings(), stats: normStats() };
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
// الخصم الفعّال الآن (نسبة مئوية). ينتهي تلقائياً بعد تاريخ النهاية إن وُجد
const activeDiscount = (p) => {
  const d = Number(p && p.discount) || 0;
  if (d <= 0) return 0;
  if (p.discountEnds && Date.now() >= Date.parse(p.discountEnds)) return 0;
  return Math.min(95, d);
};
// السعر الذي يدفعه العميل فعلياً (السيرفر هو اللي يحسبه دائماً)
const effectivePrice = (p) => Math.round(Number(p.price) * (1 - activeDiscount(p) / 100) * 100) / 100;
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
  for (const [k, max, label] of [["details", 1500, "الشرح"], ["delivery", 200, "مدة التسليم"], ["method", 300, "طريقة الاستلام"]]) {
    if (b[k] !== undefined) {
      const v = String(b[k]).trim();
      if (v.length > max) fail(label + " طويل (حد أقصى " + max + " حرف)");
      o[k] = v;
    }
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
  if (b.discount !== undefined) {
    const n = b.discount === "" || b.discount == null ? 0 : Number(b.discount);
    if (!Number.isFinite(n) || n < 0 || n > 95) fail("نسبة الخصم لازم تكون بين 0 و 95");
    o.discount = Math.round(n);
  }
  if (b.discountEnds !== undefined) {
    const v = String(b.discountEnds || "").trim();
    if (v && Number.isNaN(Date.parse(v))) fail("تاريخ نهاية الخصم غير صالح");
    o.discountEnds = v ? new Date(v).toISOString() : "";
  }
  if (b.active !== undefined) o.active = b.active === true || b.active === "true";
  if (b.soldOut !== undefined) o.soldOut = b.soldOut === true || b.soldOut === "true";
  if (b.featured !== undefined) o.featured = b.featured === true || b.featured === "true";
  for (const [k, max, label] of [["homeName", 80, "اسم بطاقة الرئيسية"], ["homeChip", 30, "تصنيف بطاقة الرئيسية"]]) {
    if (b[k] !== undefined) {
      const v = String(b[k]).trim();
      if (v.length > max) fail(label + " طويل (حد أقصى " + max + " حرف)");
      o[k] = v;
    }
  }
  if (b.homeIcon !== undefined) {
    if (!HOME_ICONS.includes(b.homeIcon)) fail("أيقونة البطاقة غير صالحة");
    o.homeIcon = b.homeIcon;
  }
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
    details: f.details || "",
    delivery: f.delivery !== undefined ? f.delivery : DELIVERY_DEFAULT,
    method: f.method !== undefined ? f.method : METHOD_DEFAULT,
    active: f.active !== false,
    soldOut: f.soldOut === true,
    featured: f.featured === true,
    homeName: f.homeName || "",
    homeChip: f.homeChip || "",
    homeIcon: f.homeIcon || "auto",
    homeImage: b.homeImage ? "/img/" + (await storeImage(b.homeImage)) : "",
    discount: f.discount || 0,
    discountEnds: f.discountEnds || "",
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
  const homeId = b.homeImage ? await storeImage(b.homeImage) : null;
  const oldImage = p.image, oldHome = p.homeImage;
  Object.assign(p, f);
  if (b.resetHomeImage === true) p.homeImage = "";
  if (homeId) p.homeImage = "/img/" + homeId;
  if (oldHome && oldHome !== p.homeImage) removeImage(oldHome);
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
  if (p.homeImage) removeImage(p.homeImage);
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

/* ---------- إعدادات المتجر ---------- */
const getSettings = () => ({ ...state.settings, sections: state.settings.sections || SECTION_DEFAULTS });
async function updateSettings(b) {
  const cur = state.settings, next = { colors: {}, texts: {}, logo: cur.logo, heroImage: cur.heroImage || "", bgImage: cur.bgImage || "", bgDim: cur.bgDim, shapes: b.shapes === undefined ? cur.shapes !== false : (b.shapes === true || b.shapes === "true"), showVisitors: b.showVisitors === undefined ? !!cur.showVisitors : (b.showVisitors === true || b.showVisitors === "true"), maintenance: b.maintenance === undefined ? !!cur.maintenance : (b.maintenance === true || b.maintenance === "true"), homeProducts: b.homeProducts === undefined ? cur.homeProducts !== false : (b.homeProducts === true || b.homeProducts === "true"), homeCount: clampHome(cur.homeCount), homeImages: b.homeImages === undefined ? !!cur.homeImages : (b.homeImages === true || b.homeImages === "true"), sections: null };
  if (b.homeCount !== undefined && b.homeCount !== "") {
    const n = Number(b.homeCount);
    if (!Number.isInteger(n) || n < 3 || n > 6) fail("عدد منتجات الرئيسية بين 3 و 6");
    next.homeCount = n;
  }
  const bc = b.colors || {}, bt = b.texts || {};
  for (const k of Object.keys(COLOR_DEFAULTS)) {
    const v = String(bc[k] ?? "").trim().toLowerCase();
    if (!v || v === COLOR_DEFAULTS[k]) continue;
    if (!/^#[0-9a-f]{6}$/.test(v)) fail("اللون غير صالح، استخدم صيغة مثل #c9a07a");
    next.colors[k] = v;
  }
  for (const [k, [def, max]] of Object.entries(TEXT_FIELDS)) {
    const v = String(bt[k] ?? "").trim();
    if (!v || v === def) continue;
    if (v.length > max) fail("النص طويل (حد أقصى " + max + " حرف)");
    next.texts[k] = v;
  }
  if (b.sections !== undefined) {
    if (!Array.isArray(b.sections)) fail("ترتيب الأقسام غير صالح");
    const seen = new Set(), list = [];
    for (const it of b.sections) {
      const d = SECTION_DEFAULTS.find((x) => x.id === (it && it.id));
      if (!d || seen.has(d.id)) continue;
      seen.add(d.id);
      const label = String(it.label ?? "").trim() || d.label, sub = String(it.sub ?? "").trim() || d.sub;
      if (label.length > 40) fail("اسم القسم طويل (حد أقصى 40 حرف)");
      if (sub.length > 60) fail("وصف القسم طويل (حد أقصى 60 حرف)");
      list.push({ id: d.id, label, sub });
    }
    for (const d of SECTION_DEFAULTS) if (!seen.has(d.id)) list.push({ ...d });
    if (JSON.stringify(list) !== JSON.stringify(SECTION_DEFAULTS)) next.sections = list;
  }
  const oldLogo = cur.logo;
  if (b.resetLogo === true) next.logo = "";
  if (b.logo) next.logo = "/img/" + (await storeImage(b.logo));
  const oldHero = cur.heroImage;
  if (b.resetHeroImage === true) next.heroImage = "";
  if (b.heroImage) next.heroImage = "/img/" + (await storeImage(b.heroImage));
  const oldBg = cur.bgImage;
  if (b.resetBgImage === true) next.bgImage = "";
  if (b.bgImage) next.bgImage = "/img/" + (await storeImage(b.bgImage));
  if (b.bgDim !== undefined && b.bgDim !== "") {
    const n = Number(b.bgDim);
    if (!Number.isFinite(n) || n < 0 || n > 90) fail("قوة التعتيم بين 0 و 90");
    next.bgDim = Math.round(n);
  }
  if (b.resetBgImage === true) next.bgDim = 45;
  if (oldBg && oldBg !== next.bgImage) removeImage(oldBg);
  if (oldLogo && oldLogo !== next.logo) removeImage(oldLogo);
  if (oldHero && oldHero !== next.heroImage) removeImage(oldHero);
  state.settings = next;
  save();
  return getSettings();
}

/* ---------- زوار الموقع ---------- */
let statsTimer = null;
function saveSoon() { // الزيارات كثيرة، فنحفظ كل 30 ثانية بدل كل زيارة
  if (statsTimer) return;
  statsTimer = setTimeout(() => { statsTimer = null; save(); }, 30000);
  statsTimer.unref();
}
function flush() { if (statsTimer) { clearTimeout(statsTimer); statsTimer = null; save(); } }
// lastDay: قيمة كوكي آخر زيارة ("" لو ما فيه). يرجع اليوم الجديد لو لازم يتحدث الكوكي.
function trackVisit(lastDay, countIt) {
  const today = dayKey(), st = state.stats;
  if (!countIt) return { day: lastDay || today, visitors: st.visitors };
  const d = (st.days[today] = st.days[today] || { v: 0, u: 0 });
  st.visits++; d.v++;
  if (!lastDay) st.visitors++;
  if (lastDay !== today) d.u++;
  const keep = dayKey(Date.now() - 60 * 86400 * 1000);
  for (const k of Object.keys(st.days)) if (k < keep) delete st.days[k];
  saveSoon();
  return { day: today, visitors: st.visitors };
}
function getStats() {
  const st = state.stats, t = st.days[dayKey()] || { v: 0, u: 0 };
  let week = 0;
  for (let i = 0; i < 7; i++) week += (st.days[dayKey(Date.now() - i * 86400000)] || { u: 0 }).u;
  const since = st.salesResetAt ? Date.parse(st.salesResetAt) : 0;
  const salesTotal = Math.round(state.orders.filter((o) => o.status !== "rejected" && Date.parse(o.createdAt) > since).reduce((s, o) => s + (Number(o.total) || 0), 0) * 100) / 100;
  return { visitors: st.visitors, visits: st.visits, todayVisitors: t.u, todayVisits: t.v, weekVisitors: week, salesTotal, salesSince: st.salesResetAt || "" };
}
// تصفير إجمالي المبيعات: ما يحذف الطلبات، بس يبدأ الحساب من الآن
function resetSales() { state.stats.salesResetAt = new Date().toISOString(); save(); return getStats(); }

/* ---------- تقييمات العملاء ---------- */
const getReviews = () => state.reviews;
const getActiveReviews = () => state.reviews.filter((r) => r.active);
function readReview(b, partial) {
  const o = {};
  if (!partial || b.name !== undefined) {
    const v = String(b.name ?? "").trim();
    if (!v || v.length > 40) fail("اسم العميل مطلوب (حد أقصى 40 حرف)");
    o.name = v;
  }
  if (!partial || b.text !== undefined) {
    const v = String(b.text ?? "").trim();
    if (v.length > 200) fail("نص التقييم حد أقصى 200 حرف");
    o.text = v;
  }
  if (!partial || b.gender !== undefined) o.gender = b.gender === "female" ? "female" : "male";
  if (!partial || b.stars !== undefined) {
    const n = Number(b.stars);
    if (!Number.isInteger(n) || n < 1 || n > 5) fail("عدد النجوم من 1 إلى 5");
    o.stars = n;
  }
  if (b.active !== undefined) o.active = b.active === true || b.active === "true";
  return o;
}
function createReview(b) {
  const f = readReview(b, false);
  const r = { id: "r-" + crypto.randomBytes(5).toString("hex"), ...f, active: f.active !== false, at: new Date().toISOString() };
  state.reviews.push(r);
  save();
  return r;
}
function updateReview(id, b) {
  const r = state.reviews.find((x) => x.id === id);
  if (!r) return null;
  Object.assign(r, readReview(b, true));
  save();
  return r;
}
function deleteReview(id) {
  const n = state.reviews.length;
  state.reviews = state.reviews.filter((x) => x.id !== id);
  if (state.reviews.length === n) return false;
  save();
  return true;
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
  activeDiscount, effectivePrice, getSettings, updateSettings, SETTINGS_DEFAULTS, trackVisit, getStats, resetSales, flush,
  getReviews, getActiveReviews, createReview, updateReview, deleteReview,
  createOrder, getOrder, listOrders, setStatus, setNotifyRef,
};
