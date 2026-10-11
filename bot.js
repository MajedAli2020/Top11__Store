// بوت ديسكورد: يرسل إشعار الطلب الجديد ويدير أزرار القبول/التسليم/الرفض
const {
  Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require("discord.js");
const db = require("./db");

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

const money = (n) => `${n} ر.س`;

const DM_TEXT = {
  new: ["📥 استلمنا طلبك", "طلبك الآن **قيد المراجعة**. وصل إيصال التحويل للإدارة وراح نتأكد من التحويل ونكلمك."],
  accepted: ["✅ تم قبول طلبك", "راجعنا طلبك وتم **قبوله**، وجاري تجهيزه لك."],
  delivered: ["🎉 تم تسليم المنتج بنجاح", "تم **تسليم** طلبك. شكراً لثقتك بتوب ستور!"],
  rejected: ["❌ تم رفض طلبك", "تعذّر قبول طلبك. افتح تكت في السيرفر وتواصل مع الإدارة لمعرفة السبب."],
};

// رسالة خاصة للعميل عند كل تغيير حالة. ترجع true/false، أو null لو ما في عميل/البوت متوقف
async function notifyCustomer(order, adminMessage) {
  if (!ready || !order.customer || !DM_TEXT[order.status]) return null;
  const [title, baseDesc] = DM_TEXT[order.status];
  const extra = adminMessage ? String(adminMessage).trim().slice(0, 1500) : "";
  const desc = extra ? `${baseDesc}\n\n📩 **رسالة من الإدارة:**\n${extra}` : baseDesc;
  let ok = false;
  try {
    const user = await client.users.fetch(order.customer.id);
    await user.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(title)
          .setDescription(desc)
          .setColor(STATUS_COLOR[order.status] || STATUS_COLOR.new)
          .addFields(
            { name: "رقم الطلب", value: `\`${order.id}\``, inline: true },
            { name: "الإجمالي", value: money(order.total), inline: true },
            { name: "المنتجات", value: order.items.map((i) => `• ${i.name} × ${i.quantity}`).join("\n").slice(0, 1000) },
          )
          .setFooter({ text: "توب ستور" })
          .setTimestamp(),
      ],
    });
    ok = true;
  } catch (e) {
    console.warn(`[bot] تعذر إرسال رسالة خاصة للعميل (${order.customer.name}):`, e.message);
  }
  db.setLastDm(order.id, { status: order.status, ok, at: new Date().toISOString() });
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
          i.followUp({ content: "⚠️ تم تحديث الحالة، لكن ما قدرت أرسل رسالة خاصة للعميل (الخاص مغلق أو ما هو داخل السيرفر). أرسل له الرسالة في التكت.", ephemeral: true }).catch(() => {});
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
            .setLabel("رسالة للعميل (رابط النيترو)")
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder("الصق رابط النيترو أو أي ملاحظة، وتوصله في الخاص")
            .setRequired(false)
            .setMaxLength(1500),
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

module.exports = { notifyCustomer, isMember, startBot, notifyNewOrder, syncOrderMessage, isStaff, isOwner, botEnabled };
