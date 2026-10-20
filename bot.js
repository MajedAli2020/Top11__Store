// بوت ديسكورد: يرسل إشعار الطلب الجديد ويدير أزرار القبول/التسليم/الرفض
const {
  Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require("discord.js");
const db = require("./db");
const { buildInvoice } = require("./invoice");

const { DISCORD_TOKEN, GUILD_ID, STAFF_ROLE_ID, NOTIFY_CHANNEL_ID, OWNER_ID } = process.env;

const STATUS_LABEL = { new: "🆕 جديد", accepted: "✅ مقبول", delivered: "📦 تم التسليم", rejected: "❌ مرفوض" };
const STATUS_COLOR = { new: 0xc9a07a, accepted: 0x72c7a0, delivered: 0x4f9d7c, rejected: 0xc0504d };

let client = null;
let ready = false;
const staffCache = new Map(); // userId -> { ok, at }

const botEnabled = () => ready;

// المالك = الآيدي اللي في OWNER_ID بملف .env (هو الوحيد اللي يتحكم بالمنتجات والأسعار)
const isOwner = (userId) => !!OWNER_ID && String(userId) === String(OWNER_ID);

async function isStaff(userId) {
  if (isOwner(userId)) return true;
  if (!ready) return false;
  const hit = staffCache.get(userId);
  if (hit && Date.now() - hit.at < 30_000) return hit.ok;
  let ok = false;
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch({ user: userId, force: true });
    ok = member.roles.cache.has(STAFF_ROLE_ID);
  } catch (e) {
    ok = false;
  }
  staffCache.set(userId, { ok, at: Date.now() });
  return ok;
}

const memberCache = new Map(); // userId -> { ok, at }
// هل العميل داخل السيرفر؟ (null = البوت غير جاهز)
async function isMember(userId) {
  if (!ready) return null;
  const hit = memberCache.get(userId);
  if (hit && Date.now() - hit.at < 30_000) return hit.ok;
  let ok = false;
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.members.fetch({ user: userId, force: true });
    ok = true;
  } catch (e) {
    ok = false;
  }
  memberCache.set(userId, { ok, at: Date.now() });
  return ok;
}

const money = (n) => `${Math.round(Number(n) * 100) / 100} ر.س`;

const DM_TEXT = {
  new: ["📥 استلمنا طلبك", "طلبك الآن **قيد المراجعة**. وصل إيصال التحويل للإدارة وراح نتأكد من التحويل ونكلمك."],
  accepted: ["✅ تم قبول طلبك", "راجعنا طلبك وتم **قبوله**، وجاري تجهيزه لك."],
  delivered: ["🎉 تم تسليم المنتج بنجاح", "تم **تسليم** طلبك. شكراً لثقتك بتوب ستور!"],
  rejected: ["❌ تم رفض طلبك", "تعذّر قبول طلبك. افتح تكت في السيرفر وتواصل مع الإدارة لمعرفة السبب."],
};

// تنبيه يلحق رسالة تسليم النيترو تلقائياً
const NITRO_NOTICE = [
  "**تنبيه قبل أخذ النيترو لحفظ حقوقك:**",
  "",
  "**1- يجب تشغيل تصويرك أثناء أخذك للنيترو.**",
  "**2- بعد ما تدخل النيترو توجه للإعدادات ثم (Reveal) لإظهار إيميلك.**",
  "**3- احفظ التصوير، وفي حال انسحب منك النيترو توجه للمتجر وافتح تكت استفسار وأرفق تصويرك وانتظر التعويض ❤️**",
].join("\n");

const GIFT_DEFAULT = "🎁 لقد وصلت لك هدية من توب ستور!\nاستلمها من الرابط:\n";

// نجيب آيدي مستلم النيترو: من الآيدي المحفوظ، أو نبحث باليوزر داخل السيرفر
async function resolveRecipientId(order) {
  if (order.nitroId) return order.nitroId;
  const m = /^@(.+)$/.exec(order.nitroUser || "");
  if (!m || !ready) return null;
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const found = await guild.members.search({ query: m[1].toLowerCase().slice(0, 32), limit: 10 });
    const hit = found.find((x) => x.user.username.toLowerCase() === m[1].toLowerCase());
    return hit ? hit.user.id : null;
  } catch (e) {
    return null;
  }
}

// نخلي النص عريض (**) ونترك الروابط عادية بدون أي تنسيق عشان تبقى واضحة
function boldExceptLinks(text) {
  return String(text)
    .split("\n")
    .map((line) =>
      line
        .split(/(https?:\/\/\S+)/)
        .map((seg, i) => (i % 2 === 1 || !seg.trim() ? seg : seg.replace(/^(\s*)(.*?)(\s*)$/, (m, a, c, d) => `${a}**${c.replace(/\*\*/g, "")}**${d}`)))
        .join(""),
    )
    .join("\n");
}

// رسالة خاصة للعميل عند كل تغيير حالة. ترجع true/false، أو null لو ما في عميل/البوت متوقف
// adminMessage (عند تسليم النيترو): نرسلها كما هي (نص عادي، الرابط واضح بدون أي تنسيق) لمستلم النيترو.
// لو المستلم شخص ثاني غير العميل، العميل يوصله إشعار التسليم العادي بدون الرابط.
async function notifyCustomer(order, adminMessage) {
  if (!ready || !order.customer || !DM_TEXT[order.status]) return null;
  const extra = adminMessage ? String(adminMessage).trim().slice(0, 1900) : "";
  let giftOk = true;
  const customerMsg = ""; // الرابط ما يروح إلا لمستلم النيترو، ولا نحوّله لأي شخص ثاني
  if (extra && order.status === "delivered") {
    const rid = await resolveRecipientId(order);
    if (!rid) {
      giftOk = false; // ما لقينا المستلم (اليوزر مو داخل السيرفر)
    } else {
      try {
        const u = await client.users.fetch(rid);
        // النص عريض، الرابط واضح، وآخر شي منشن للمستلم
        await u.send({ content: `${boldExceptLinks(extra)}\n\n${NITRO_NOTICE}\n<@${rid}>`.slice(0, 2000), allowedMentions: { users: [String(rid)] } });
      } catch (e) {
        giftOk = false; // الخاص مغلق عند المستلم
        console.warn(`[bot] تعذر إرسال الهدية للمستلم (${rid}):`, e.message);
      }
    }
  }
  const [title, baseDesc] = DM_TEXT[order.status];
  const desc = customerMsg ? `${baseDesc}\n\n📩 **رسالة من الإدارة:**\n${customerMsg}` : baseDesc;
  let ok = false;
  // فاتورة بصورة تنرسل مع رسالة التسليم (لو فشل رسمها نكمل بدونها)
  let invoiceFile = null;
  const invCfg = db.getInvoice();
  if (order.status === "delivered" && invCfg.enabled) {
    try {
      const buf = await buildInvoice(order, { settings: invCfg, deliveredAt: new Date().toISOString() });
      invoiceFile = new AttachmentBuilder(buf, { name: `invoice-${order.id}.png` });
    } catch (e) {
      console.warn("[bot] تعذر إنشاء الفاتورة:", e.message);
    }
  }
  try {
    const user = await client.users.fetch(order.customer.id);
    await user.send({
      ...(invoiceFile ? { files: [invoiceFile] } : {}),
      embeds: [
        (() => {
          const emb = new EmbedBuilder()
          .setTitle(title)
          .setDescription(desc)
          .setColor(STATUS_COLOR[order.status] || STATUS_COLOR.new)
          .addFields(
            { name: "رقم الطلب", value: `\`${order.id}\``, inline: true },
            { name: "الإجمالي", value: money(order.total), inline: true },
            { name: "المنتجات", value: order.items.map((i) => `• ${i.name} × ${i.quantity}`).join("\n").slice(0, 1000) },
          )
          .setFooter({ text: "توب ستور" })
          .setTimestamp();
          if (invoiceFile) emb.setImage(`attachment://invoice-${order.id}.png`);
          return emb;
        })(),
      ],
    });
    ok = true;
  } catch (e) {
    console.warn(`[bot] تعذر إرسال رسالة خاصة للعميل (${order.customer.name}):`, e.message);
  }
  ok = ok && giftOk;
  db.setLastDm(order.id, { status: order.status, ok, at: new Date().toISOString() });
  return ok;
}

// فاتورة مرفوضة يرسلها الأدمن يدوياً للعميل في الخاص (مع سبب الرفض لو انكتب). ترجع true/false، أو null لو ما في عميل/البوت متوقف
async function sendRejectedInvoice(order) {
  if (!ready || !order.customer) return null;
  const ri = order.rejectInvoice || {};
  let ok = false;
  try {
    const buf = await buildInvoice(order, { settings: db.getInvoice(), variant: "rejected", reason: ri.reason, at: ri.at });
    const file = new AttachmentBuilder(buf, { name: `invoice-${order.id}.png` });
    const emb = new EmbedBuilder()
      .setTitle("📄 فاتورة طلبك المرفوض")
      .setDescription(ri.reason ? `تعذّر قبول طلبك.\n\n**السبب:** ${ri.reason}\n\nلو تعتقد أن الرفض خطأ، افتح تكت في السيرفر وأرفق رقم الطلب.` : "تعذّر قبول طلبك. لو تعتقد أن الرفض خطأ، افتح تكت في السيرفر وأرفق رقم الطلب.")
      .setColor(STATUS_COLOR.rejected)
      .addFields({ name: "رقم الطلب", value: `\`${order.id}\``, inline: true }, { name: "الإجمالي", value: money(order.total), inline: true })
      .setImage(`attachment://invoice-${order.id}.png`)
      .setFooter({ text: "توب ستور" })
      .setTimestamp();
    const user = await client.users.fetch(order.customer.id);
    await user.send({ files: [file], embeds: [emb] });
    ok = true;
  } catch (e) {
    console.warn(`[bot] تعذر إرسال الفاتورة المرفوضة (${order.customer.name}):`, e.message);
  }
  db.setLastDm(order.id, { status: "rejected", ok, at: new Date().toISOString() });
  return ok;
}

function buildEmbed(o) {
  const e = new EmbedBuilder()
    .setTitle(`طلب ${o.id}`)
    .setColor(STATUS_COLOR[o.status] || STATUS_COLOR.new)
    .addFields(
      { name: "المنتجات", value: o.items.map((i) => `• ${i.name} × ${i.quantity} — ${money(i.price * i.quantity)}`).join("\n").slice(0, 1000) },
      { name: "الإجمالي", value: money(o.total), inline: true },
      { name: "اسم المحوّل", value: o.transferor.slice(0, 100), inline: true },
      { name: "الحالة", value: STATUS_LABEL[o.status], inline: true },
    )
    .setTimestamp(new Date(o.createdAt));
  if (o.customer) e.addFields({ name: "العميل", value: `<@${o.customer.id}> (${o.customer.name})`.slice(0, 200) });
  if (o.receipt) e.addFields({ name: "الإيصال", value: "📎 مرفق أسفل الرسالة — تأكد من التحويل قبل القبول" }).setImage(`attachment://${o.receipt.name}`);
  if (o.serverLink) e.addFields({ name: "رابط السيرفر", value: o.serverLink.slice(0, 200) });
  if (o.nitroUser) e.addFields({ name: "مستلم النيترو", value: (o.nitroId ? `<@${o.nitroId}>\n` : "") + o.nitroUser.slice(0, 100) });
  const last = o.history[o.history.length - 1];
  if (last && last.status !== "new") e.setFooter({ text: `آخر تحديث بواسطة: ${last.by}` });
  return e;
}

function buildButtons(o) {
  const btn = (action, label, style) =>
    new ButtonBuilder().setCustomId(`order:${o.id}:${action}`).setLabel(label).setStyle(style);
  const row = new ActionRowBuilder();
  if (o.status === "new") row.addComponents(btn("accepted", "قبول", ButtonStyle.Success), btn("rejected", "رفض", ButtonStyle.Danger));
  else if (o.status === "accepted") row.addComponents(btn("delivered", "تم التسليم", ButtonStyle.Primary), btn("rejected", "رفض", ButtonStyle.Danger));
  else return [];
  return [row];
}

// يرسل إشعار الطلب مع صورة الإيصال لروم الإدارة. يرجع { channelId, messageId } أو null لو فشل
async function notifyNewOrder(order, receipt) {
  if (!ready) return null;
  try {
    const channel = await client.channels.fetch(NOTIFY_CHANNEL_ID);
    const msg = await channel.send({
      content: `<@&${STAFF_ROLE_ID}> 🔔 وصل طلب جديد`,
      embeds: [buildEmbed(order)],
      components: buildButtons(order),
      files: receipt ? [new AttachmentBuilder(receipt.buf, { name: receipt.name })] : [],
      allowedMentions: { roles: [STAFF_ROLE_ID] },
    });
    return { channelId: channel.id, messageId: msg.id };
  } catch (e) {
    console.error("[bot] فشل إرسال إشعار الطلب:", e.message);
    return null;
  }
}

// يُستدعى لما تتغير الحالة من لوحة الموقع
async function syncOrderMessage(order) {
  if (!ready || !order.notify) return;
  try {
    const channel = await client.channels.fetch(order.notify.channelId);
    const msg = await channel.messages.fetch(order.notify.messageId);
    await msg.edit({ embeds: [buildEmbed(order)], components: buildButtons(order) });
  } catch (e) {
    console.error("[bot] فشل تحديث رسالة الطلب:", e.message);
  }
}

function startBot() {
  if (!DISCORD_TOKEN || !GUILD_ID || !STAFF_ROLE_ID || !NOTIFY_CHANNEL_ID) {
    console.warn("[bot] إعدادات ديسكورد ناقصة في .env — البوت متوقف، والمتجر يشتغل بدون إشعارات.");
    return Promise.resolve();
  }
  client = new Client({ intents: [GatewayIntentBits.Guilds] });

  const hasNitro = (o) => o.items.some((x) => x.id === "nitro");

  client.on("interactionCreate", async (i) => {
    // نافذة رسالة التسليم (للنيترو): نكتب رابط النيترو وترسل للعميل في الخاص
    if (i.isModalSubmit() && i.customId.startsWith("deliver:")) {
      const id = i.customId.split(":")[1];
      if (!(await isStaff(i.user.id))) return i.reply({ content: "ما عندك صلاحية لهذا الإجراء.", ephemeral: true });
      const msg = i.fields.getTextInputValue("msg");
      const prev = (db.getOrder(id) || {}).status;
      const order = db.setStatus(id, "delivered", `${i.user.username} (Discord)`);
      if (!order) return i.reply({ content: "الطلب غير موجود.", ephemeral: true });
      if (i.isFromMessage()) await i.update({ embeds: [buildEmbed(order)], components: buildButtons(order) });
      else await i.reply({ content: "تم التسليم.", ephemeral: true });
      if (prev !== order.status) {
        const sent = await notifyCustomer(order, msg);
        if (sent === false) {
          i.followUp({ content: "⚠️ تعذر إرسال الهدية لمستلم النيترو (الخاص مغلق عنده أو اليوزر مو داخل السيرفر). ما انرسل الرابط لأي شخص ثاني.", ephemeral: true }).catch(() => {});
        }
      }
      return;
    }
    if (!i.isButton() || !i.customId.startsWith("order:")) return;
    const [, id, action] = i.customId.split(":");
    if (!(await isStaff(i.user.id))) {
      return i.reply({ content: "ما عندك صلاحية لهذا الزر.", ephemeral: true });
    }
    const cur = db.getOrder(id);
    if (!cur) return i.reply({ content: "الطلب غير موجود.", ephemeral: true });
    // تسليم طلب فيه نيترو: نفتح نافذة تكتب فيها رسالة/رابط النيترو قبل ما تتأكد الحالة
    if (action === "delivered" && cur.status !== "delivered" && hasNitro(cur)) {
      const modal = new ModalBuilder().setCustomId(`deliver:${id}`).setTitle("تسليم النيترو");
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("msg")
            .setLabel("رسالة لمستلم النيترو (الرابط في آخرها)")
            .setStyle(TextInputStyle.Paragraph)
            .setValue(GIFT_DEFAULT)
            .setRequired(false)
            .setMaxLength(1200),
        ),
      );
      return i.showModal(modal);
    }
    const prev = cur.status;
    const order = db.setStatus(id, action, `${i.user.username} (Discord)`);
    await i.update({ embeds: [buildEmbed(order)], components: buildButtons(order) });
    if (prev !== order.status) {
      const sent = await notifyCustomer(order);
      if (sent === false) {
        i.followUp({ content: "⚠️ تم تحديث الحالة، لكن ما قدرت أرسل رسالة خاصة للعميل (الخاص مغلق أو ما هو داخل السيرفر). كلّمه في التكت.", ephemeral: true }).catch(() => {});
      }
    }
  });

  client.on("error", (e) => console.error("[bot] خطأ:", e.message));

  return new Promise((resolve) => {
      client.once("clientReady", () => {
      ready = true;
      console.log(`[bot] متصل باسم ${client.user.tag}`);
      resolve();
    });
    client.login(DISCORD_TOKEN).catch((e) => {
      console.error("[bot] فشل تسجيل الدخول (تأكد من التوكن):", e.message);
      resolve();
    });
  });
}

module.exports = { GIFT_DEFAULT, notifyCustomer, sendRejectedInvoice, isMember, startBot, notifyNewOrder, syncOrderMessage, isStaff, isOwner, botEnabled };
