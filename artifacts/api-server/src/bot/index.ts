import { Telegraf, session } from "telegraf";
import type { Context } from "telegraf";
import type { SessionData } from "./session.js";
import { logger } from "../lib/logger.js";
import {
  mainMenuKeyboard,
  cancelKeyboard,
  currencyKeyboard,
  dealPageKeyboard,
  sellerDealKeyboard,
} from "./keyboards.js";
import {
  upsertUser,
  getWallet,
  addToWallet,
  deductFromWallet,
  createDeal,
  getDealByCode,
  updateDealStatus,
  getUserStats,
  getOpenDeals,
  getAllDealsStats,
  getAllUsersCount,
  ensureSuperAdmin,
  isAdmin,
  isSuperAdmin,
  getAdmins,
  getAdminIds,
  addAdmin,
  removeAdmin,
} from "./db.js";
import {
  formatCurrency,
  parseCurrencyFromButton,
  statusLabel,
  esc,
} from "./utils.js";

interface BotContext extends Context {
  session: SessionData;
}

const MANAGER = "@GarantTGifts";
const H = "HTML" as const;

export function createBot() {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  if (!token) {
    logger.error("TELEGRAM_BOT_TOKEN is not set");
    throw new Error("TELEGRAM_BOT_TOKEN is not set");
  }

  const bot = new Telegraf<BotContext>(token);
  bot.use(session({ defaultSession: (): SessionData => ({}) }));

  let cachedBotUsername = "";

  // ── Инициализация суперадмина ────────────────────────────────
  const superAdminId = process.env["SUPER_ADMIN_ID"]
    ? parseInt(process.env["SUPER_ADMIN_ID"])
    : null;
  if (superAdminId && !isNaN(superAdminId)) {
    ensureSuperAdmin(superAdminId).catch((err) =>
      logger.error({ err }, "Failed to ensure super admin")
    );
  }

  // ── Глобальный перехватчик ошибок ────────────────────────────
  bot.catch((err, ctx) => {
    logger.error({ err, updateType: ctx.updateType }, "Bot handler error");
    ctx
      .reply("⚠️ Произошла внутренняя ошибка. Попробуйте ещё раз или обратитесь в поддержку.")
      .catch(() => {});
  });

  async function getBotUsername(): Promise<string> {
    if (cachedBotUsername) return cachedBotUsername;
    const info = await bot.telegram.getMe();
    cachedBotUsername = info.username ?? "";
    return cachedBotUsername;
  }

  // Отправляет уведомление всем админам
  async function notifyAdmins(text: string): Promise<void> {
    const adminIds = await getAdminIds();
    await Promise.allSettled(
      adminIds.map((id) =>
        bot.telegram.sendMessage(id, text, { parse_mode: H })
      )
    );
  }

  // ──────────────────────────────────────────
  // /start
  // ──────────────────────────────────────────
  bot.start(async (ctx) => {
    await upsertUser(ctx.from.id, {
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
    });

    const startParam = ctx.startPayload;
    if (startParam && startParam.startsWith("deal-")) {
      const dealCode = startParam.replace("deal-", "");
      await handleDealPage(ctx, dealCode);
      return;
    }

    await ctx.reply(
      `🤖 <b>Добро пожаловать в NFT Гарант Бот!</b>\n\n` +
        `🛡️ Я — безопасный посредник (гарант) при обмене цифровых товаров:\n` +
        `• NFT и цифровых активов\n` +
        `• Игровых скинов, предметов, аккаунтов\n` +
        `• Подарков Telegram (Stars)\n` +
        `• Игровых валют и криптовалют\n\n` +
        `⚙️ <b>Что умеет бот:</b>\n` +
        `🔹 Создание защищённых сделок за 1 минуту\n` +
        `🔹 Кошелёк с несколькими валютами (ГРН, РУБ, TON, Звёзды)\n` +
        `🔹 Уведомления продавцу и покупателю в реальном времени\n` +
        `🔹 Поддержка 24/7 — ответ до 5 минут\n` +
        `🔹 11 742 успешных сделок без единого обмана\n\n` +
        `📌 Выберите раздел кнопками снизу`,
      { parse_mode: H, ...mainMenuKeyboard }
    );
  });

  // ──────────────────────────────────────────
  // /add <telegramId> <amount> <currency>
  // ──────────────────────────────────────────
  bot.command("add", async (ctx) => {
    if (!(await isAdmin(ctx.from.id))) {
      await ctx.reply("❌ Нет доступа.");
      return;
    }

    const text = ctx.message.text.trim();
    const parts = text.split(/\s+/);
    if (parts.length !== 4) {
      await ctx.reply(
        "❌ Формат: /add &lt;ID&gt; &lt;сумма&gt; &lt;валюта&gt;\nПример: /add 123456789 1250 Руб",
        { parse_mode: H }
      );
      return;
    }

    const targetId = parseInt(parts[1]!);
    const amount = parseFloat(parts[2]!.replace(",", "."));
    const rawCurrency = parts[3]!.toLowerCase();

    if (isNaN(targetId) || isNaN(amount) || amount <= 0) {
      await ctx.reply("❌ Некорректный ID или сумма.");
      return;
    }

    let currency: string;
    if (rawCurrency === "грн" || rawCurrency === "uah") currency = "UAH";
    else if (rawCurrency === "руб" || rawCurrency === "rub") currency = "RUB";
    else if (rawCurrency === "ton") currency = "TON";
    else if (rawCurrency === "stars" || rawCurrency === "звёзды" || rawCurrency === "звезды")
      currency = "STARS";
    else {
      await ctx.reply("❌ Неизвестная валюта. Допустимые: Грн, Руб, TON, Stars");
      return;
    }

    await upsertUser(targetId, {});
    await addToWallet(
      targetId,
      currency,
      amount,
      `Пополнение администратором (от ${ctx.from.id})`
    );
    const wallet = await getWallet(targetId);

    await ctx.reply(
      `✅ Баланс пользователя <code>${targetId}</code> пополнен на <b>${esc(formatCurrency(amount, currency))}</b>\n\n` +
        `💼 Текущий баланс:\n` +
        `▪️ ${parseFloat(wallet.uah).toFixed(2)} ГРН\n` +
        `▪️ ${parseFloat(wallet.rub).toFixed(2)} РУБ\n` +
        `▪️ ${parseFloat(wallet.ton).toFixed(6)} TON\n` +
        `▪️ ${Math.round(parseFloat(wallet.stars))} Звёзды`,
      { parse_mode: H, ...mainMenuKeyboard }
    );

    try {
      await bot.telegram.sendMessage(
        targetId,
        `💸 <b>Ваш баланс пополнен!</b>\n\n` +
          `Зачислено: <b>${esc(formatCurrency(amount, currency))}</b>\n\n` +
          `💼 Текущий баланс:\n` +
          `▪️ ${parseFloat(wallet.uah).toFixed(2)} ГРН\n` +
          `▪️ ${parseFloat(wallet.rub).toFixed(2)} РУБ\n` +
          `▪️ ${parseFloat(wallet.ton).toFixed(6)} TON\n` +
          `▪️ ${Math.round(parseFloat(wallet.stars))} Звёзды`,
        { parse_mode: H }
      );
    } catch {
      // пользователь мог не запустить бота
    }
  });

  // ──────────────────────────────────────────
  // /admin — панель администратора
  // ──────────────────────────────────────────
  bot.command("admin", async (ctx) => {
    if (!(await isAdmin(ctx.from.id))) {
      await ctx.reply("❌ Нет доступа.");
      return;
    }
    await sendAdminPanel(ctx);
  });

  async function sendAdminPanel(ctx: BotContext) {
    const superAdmin = await isSuperAdmin(ctx.from!.id);
    const [deals, stats, usersCount] = await Promise.all([
      getOpenDeals(),
      getAllDealsStats(),
      getAllUsersCount(),
    ]);

    const roleLabel = superAdmin ? "⭐ Суперадмин" : "🔑 Админ";

    const header =
      `🛠 <b>Панель администратора</b> — ${roleLabel}\n\n` +
      `👥 Пользователей: <b>${usersCount}</b>\n\n` +
      `📊 <b>Статистика сделок:</b>\n` +
      `▪️ Всего: ${stats.total}\n` +
      `▪️ Ожидают оплаты: ${stats.pending}\n` +
      `▪️ Активных: ${stats.active}\n` +
      `▪️ Завершённых: ${stats.completed}\n` +
      `▪️ Отменённых: ${stats.cancelled}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🔓 <b>Открытые сделки (${deals.length}):</b>`;

    if (deals.length === 0) {
      const extra = superAdmin
        ? `\n\n<b>Управление админами:</b>\n` +
          `/addadmin &lt;telegram_id&gt; — добавить админа\n` +
          `/removeadmin &lt;telegram_id&gt; — удалить админа\n` +
          `/admins — список всех админов`
        : "";
      await ctx.reply(header + "\n\n<i>Нет открытых сделок</i>" + extra, {
        parse_mode: H,
        ...mainMenuKeyboard,
      });
      return;
    }

    await ctx.reply(header, { parse_mode: H });

    const { Markup } = await import("telegraf");
    for (const deal of deals.slice(0, 20)) {
      const sellerInfo = `ID ${deal.sellerTelegramId}`;
      const buyerInfo = deal.buyerTelegramId ? `ID ${deal.buyerTelegramId}` : "—";
      await ctx.reply(
        `🔑 <b>Сделка #${deal.dealCode}</b>\n` +
          `📦 ${esc(deal.description)}\n` +
          `💵 ${esc(formatCurrency(deal.amount, deal.currency))}\n` +
          `📌 ${esc(statusLabel(deal.status))}\n` +
          `👤 Продавец: <code>${sellerInfo}</code>\n` +
          `🛒 Покупатель: <code>${buyerInfo}</code>\n` +
          `🕐 ${deal.createdAt.toLocaleString("ru-RU", { timeZone: "Europe/Kyiv" })}`,
        {
          parse_mode: H,
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback("✅ Завершить", `admin_complete_${deal.dealCode}`),
              Markup.button.callback("❌ Отменить", `admin_cancel_${deal.dealCode}`),
            ],
          ]),
        }
      );
    }

    if (deals.length > 20) {
      await ctx.reply(`<i>...и ещё ${deals.length - 20} сделок</i>`, { parse_mode: H });
    }

    if (superAdmin) {
      await ctx.reply(
        `👥 <b>Управление админами:</b>\n` +
          `/addadmin &lt;telegram_id&gt; — добавить обычного админа\n` +
          `/addadmin &lt;telegram_id&gt; superadmin — добавить суперадмина\n` +
          `/removeadmin &lt;telegram_id&gt; — удалить админа\n` +
          `/admins — список всех админов`,
        { parse_mode: H }
      );
    }
  }

  // ──────────────────────────────────────────
  // /admins — список всех администраторов
  // ──────────────────────────────────────────
  bot.command("admins", async (ctx) => {
    if (!(await isAdmin(ctx.from.id))) {
      await ctx.reply("❌ Нет доступа.");
      return;
    }

    const admins = await getAdmins();
    if (admins.length === 0) {
      await ctx.reply("👥 Список администраторов пуст.");
      return;
    }

    const lines = admins.map((a, i) => {
      const roleIcon = a.role === "superadmin" ? "⭐" : "🔑";
      const addedBy = a.addedByTelegramId ? ` (добавлен: <code>${a.addedByTelegramId}</code>)` : "";
      return `${i + 1}. ${roleIcon} <code>${a.telegramId}</code>${addedBy}`;
    });

    await ctx.reply(
      `👥 <b>Администраторы бота (${admins.length}):</b>\n\n` + lines.join("\n"),
      { parse_mode: H }
    );
  });

  // ──────────────────────────────────────────
  // /addadmin <telegram_id> [admin|superadmin]
  // ──────────────────────────────────────────
  bot.command("addadmin", async (ctx) => {
    if (!(await isSuperAdmin(ctx.from.id))) {
      await ctx.reply("❌ Только суперадмин может добавлять администраторов.");
      return;
    }

    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 2) {
      await ctx.reply(
        "❌ Формат: /addadmin &lt;telegram_id&gt; [admin|superadmin]\nПример: /addadmin 123456789",
        { parse_mode: H }
      );
      return;
    }

    const targetId = parseInt(parts[1]!);
    if (isNaN(targetId)) {
      await ctx.reply("❌ Некорректный Telegram ID.");
      return;
    }

    const roleRaw = parts[2]?.toLowerCase();
    const role: "admin" | "superadmin" =
      roleRaw === "superadmin" ? "superadmin" : "admin";

    if (targetId === ctx.from.id && role !== "superadmin") {
      await ctx.reply("ℹ️ Вы уже являетесь суперадмином.");
      return;
    }

    await addAdmin(targetId, role, ctx.from.id);
    const roleLabel = role === "superadmin" ? "⭐ Суперадмин" : "🔑 Админ";

    await ctx.reply(
      `✅ Пользователь <code>${targetId}</code> добавлен как ${roleLabel}.`,
      { parse_mode: H }
    );

    try {
      await bot.telegram.sendMessage(
        targetId,
        `🎉 <b>Вам выданы права администратора!</b>\n\nРоль: ${roleLabel}\n\nИспользуйте /admin для доступа к панели управления.`,
        { parse_mode: H }
      );
    } catch {
      // пользователь мог не запустить бота
    }
  });

  // ──────────────────────────────────────────
  // /removeadmin <telegram_id>
  // ──────────────────────────────────────────
  bot.command("removeadmin", async (ctx) => {
    if (!(await isSuperAdmin(ctx.from.id))) {
      await ctx.reply("❌ Только суперадмин может удалять администраторов.");
      return;
    }

    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 2) {
      await ctx.reply(
        "❌ Формат: /removeadmin &lt;telegram_id&gt;\nПример: /removeadmin 123456789",
        { parse_mode: H }
      );
      return;
    }

    const targetId = parseInt(parts[1]!);
    if (isNaN(targetId)) {
      await ctx.reply("❌ Некорректный Telegram ID.");
      return;
    }

    if (targetId === ctx.from.id) {
      await ctx.reply("❌ Нельзя удалить самого себя из списка администраторов.");
      return;
    }

    const removed = await removeAdmin(targetId);
    if (!removed) {
      await ctx.reply(`❌ Пользователь <code>${targetId}</code> не найден в списке админов.`, {
        parse_mode: H,
      });
      return;
    }

    await ctx.reply(
      `✅ Пользователь <code>${targetId}</code> удалён из администраторов.`,
      { parse_mode: H }
    );

    try {
      await bot.telegram.sendMessage(
        targetId,
        `⚠️ Ваши права администратора были отозваны.`,
        { parse_mode: H }
      );
    } catch {
      // пользователь мог заблокировать бота
    }
  });

  // ──────────────────────────────────────────
  // Admin: завершить сделку принудительно
  // ──────────────────────────────────────────
  bot.action(/^admin_complete_(\d+)$/, async (ctx) => {
    if (!(await isAdmin(ctx.from!.id))) {
      await ctx.answerCbQuery("❌ Нет доступа");
      return;
    }
    const dealCode = ctx.match[1]!;
    await ctx.answerCbQuery("✅ Сделка завершена");
    const deal = await getDealByCode(dealCode);
    if (!deal) { await ctx.reply("❌ Сделка не найдена."); return; }
    if (deal.status === "completed") { await ctx.reply("Сделка уже завершена."); return; }

    await updateDealStatus(dealCode, "completed");
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    await ctx.reply(
      `✅ <b>Сделка #${dealCode} завершена администратором.</b>`,
      { parse_mode: H }
    );

    for (const uid of [deal.sellerTelegramId, deal.buyerTelegramId].filter(Boolean) as number[]) {
      try {
        await bot.telegram.sendMessage(
          uid,
          `✅ <b>Сделка #${dealCode} завершена администратором.</b>\n\nПо вопросам: ${MANAGER}`,
          { parse_mode: H }
        );
      } catch {}
    }
  });

  // ──────────────────────────────────────────
  // Admin: отменить сделку принудительно
  // ──────────────────────────────────────────
  bot.action(/^admin_cancel_(\d+)$/, async (ctx) => {
    if (!(await isAdmin(ctx.from!.id))) {
      await ctx.answerCbQuery("❌ Нет доступа");
      return;
    }
    const dealCode = ctx.match[1]!;
    await ctx.answerCbQuery("❌ Сделка отменена");
    const deal = await getDealByCode(dealCode);
    if (!deal) { await ctx.reply("❌ Сделка не найдена."); return; }
    if (deal.status === "cancelled") { await ctx.reply("Сделка уже отменена."); return; }

    await updateDealStatus(dealCode, "cancelled");
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    await ctx.reply(
      `❌ <b>Сделка #${dealCode} отменена администратором.</b>`,
      { parse_mode: H }
    );

    for (const uid of [deal.sellerTelegramId, deal.buyerTelegramId].filter(Boolean) as number[]) {
      try {
        await bot.telegram.sendMessage(
          uid,
          `❌ <b>Сделка #${dealCode} отменена администратором.</b>\n\nПо вопросам: ${MANAGER}`,
          { parse_mode: H }
        );
      } catch {}
    }
  });

  // ──────────────────────────────────────────
  // Создать сделку 🤝 — Шаг 1
  // ──────────────────────────────────────────
  bot.hears("Создать сделку 🤝", async (ctx) => {
    await upsertUser(ctx.from.id, {
      username: ctx.from.username,
      firstName: ctx.from.first_name,
    });
    ctx.session = { step: "deal_description", dealDraft: {} };
    await ctx.reply(
      `🤝 <b>Создание сделки — Шаг 1 из 3</b>\n\n` +
        `📦 Введите название товара или услуги:\n\n` +
        `✅ Примеры:\n` +
        `• Скин AK-47 Redline MW CS2\n` +
        `• NFT Notcoin #4821\n` +
        `• Подарок Telegram 500 Stars\n` +
        `• Аккаунт Steam MMR 4500\n` +
        `• Игровая валюта 10 000 золота\n\n` +
        `✏️ Напишите название в следующем сообщении:`,
      { parse_mode: H, ...cancelKeyboard }
    );
  });

  // ──────────────────────────────────────────
  // Кошелек 💼
  // ──────────────────────────────────────────
  bot.hears("Кошелек 💼", async (ctx) => {
    await upsertUser(ctx.from.id, {
      username: ctx.from.username,
      firstName: ctx.from.first_name,
    });
    const wallet = await getWallet(ctx.from.id);
    await ctx.reply(
      `💼 <b>Ваш кошелёк</b>\n\n` +
        `🆔 Ваш ID для пополнения: <code>${ctx.from.id}</code>\n\n` +
        `💵 Текущий баланс:\n` +
        `▪️ ${parseFloat(wallet.uah).toFixed(2)} ГРН\n` +
        `▪️ ${parseFloat(wallet.rub).toFixed(2)} РУБ\n` +
        `▪️ ${parseFloat(wallet.ton).toFixed(6)} TON\n` +
        `▪️ ${Math.round(parseFloat(wallet.stars))} Звёзды\n\n` +
        `ℹ️ Баланс используется для оплаты сделок в боте.\n\n` +
        `📩 Как пополнить баланс:\n` +
        `1. Напишите ${MANAGER}\n` +
        `2. Сообщите ваш ID: <code>${ctx.from.id}</code>\n` +
        `3. Укажите нужную сумму и валюту\n` +
        `4. Оплатите удобным способом\n\n` +
        `⏱ Зачисление в течение 5-10 минут после подтверждения оплаты.`,
      { parse_mode: H, ...mainMenuKeyboard }
    );
  });

  // ──────────────────────────────────────────
  // Моя статистика 📈
  // ──────────────────────────────────────────
  bot.hears("Моя статистика 📈", async (ctx) => {
    await upsertUser(ctx.from.id, {
      username: ctx.from.username,
      firstName: ctx.from.first_name,
    });
    const [stats, wallet] = await Promise.all([
      getUserStats(ctx.from.id),
      getWallet(ctx.from.id),
    ]);

    await ctx.reply(
      `📈 <b>Ваша личная статистика</b>\n\n` +
        `🆔 Ваш ID: <code>${ctx.from.id}</code>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🤝 <b>Как продавец:</b>\n` +
        `▪️ Создано сделок: ${stats.sellerTotal}\n` +
        `▪️ Завершено: ${stats.sellerCompleted}\n` +
        `▪️ Активных: ${stats.sellerActive}\n\n` +
        `🛒 <b>Как покупатель:</b>\n` +
        `▪️ Оплачено сделок: ${stats.buyerCompleted} из ${stats.buyerTotal}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `💼 <b>Текущий баланс:</b>\n` +
        `▪️ ${parseFloat(wallet.uah).toFixed(2)} ГРН\n` +
        `▪️ ${parseFloat(wallet.rub).toFixed(2)} РУБ\n` +
        `▪️ ${parseFloat(wallet.ton).toFixed(6)} TON\n` +
        `▪️ ${Math.round(parseFloat(wallet.stars))} Звёзды\n\n` +
        `📩 Для пополнения обратитесь в 🆘 Поддержку.`,
      { parse_mode: H, ...mainMenuKeyboard }
    );
  });

  // ──────────────────────────────────────────
  // Поддержка 🆘
  // ──────────────────────────────────────────
  bot.hears("Поддержка 🆘", async (ctx) => {
    await ctx.reply(
      `🆘 <b>Служба поддержки NFT Гарант Бота</b>\n\n` +
        `👤 Официальный менеджер: ${MANAGER}\n\n` +
        `⏱ Время ответа: до 5 минут\n\n` +
        `📋 <b>Чем помогаем:</b>\n` +
        `• Спорные ситуации между продавцом и покупателем\n` +
        `• Пополнение баланса любой валютой\n` +
        `• Возврат средств при отмене сделки\n` +
        `• Технические неполадки\n` +
        `• Консультация по безопасным сделкам\n\n` +
        `⚠️ <b>Осторожно, мошенники!</b>\n` +
        `Единственный официальный аккаунт — ${MANAGER}.\n` +
        `Не отвечайте на сообщения от других аккаунтов с похожими именами.`,
      { parse_mode: H, ...mainMenuKeyboard }
    );
  });

  // ──────────────────────────────────────────
  // Инструкция 📄
  // ──────────────────────────────────────────
  bot.hears("Инструкция 📄", async (ctx) => {
    await ctx.reply(
      `📖 <b>Как создать безопасную сделку — пошагово</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `<b>Шаг 1 — Продавец создаёт сделку:</b>\n` +
        `Нажмите 🤝 Создать сделку и следуйте инструкциям. Вы введёте название товара, цену и валюту. Бот выдаст уникальную ссылку.\n\n` +
        `<b>Шаг 2 — Покупатель переходит по ссылке:</b>\n` +
        `Отправьте ссылку покупателю. Он открывает её в Telegram, видит все детали сделки и нажимает «Оплатить». Средства списываются с его баланса в боте.\n\n` +
        `<b>Шаг 3 — Передача товара:</b>\n` +
        `Продавец передаёт товар менеджеру ${MANAGER}. Менеджер проверяет товар и переводит деньги продавцу.\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `✅ <b>Примеры успешных сделок:</b>\n` +
        `• NFT Notcoin #4821 за 12 TON — закрыто за 8 минут\n` +
        `• Скин AK-47 Redline MW CS2 за 3 200 руб — без споров\n` +
        `• Подарок Telegram 500 Stars — мгновенная оплата\n` +
        `• Аккаунт Steam с MMR 4500 — проверен и передан\n\n` +
        `💡 <b>Важно:</b> Пополните баланс через поддержку перед первой сделкой. Для оплаты нужны средства на счёте в боте.`,
      { parse_mode: H, ...mainMenuKeyboard }
    );
  });

  // ──────────────────────────────────────────
  // ❌ Отмена
  // ──────────────────────────────────────────
  bot.hears("❌ Отмена", async (ctx) => {
    ctx.session = {};
    await ctx.reply("Действие отменено.", mainMenuKeyboard);
  });

  // ──────────────────────────────────────────
  // Выбор валюты — Шаг 3
  // ──────────────────────────────────────────
  bot.hears(["⭐ Stars", "💎 TON", "💴 РУБ", "💵 ГРН"], async (ctx) => {
    if (ctx.session.step !== "deal_currency") return;
    const currency = parseCurrencyFromButton(ctx.message.text);
    if (!currency) return;

    const draft = ctx.session.dealDraft;
    if (!draft?.description || !draft?.amount) {
      ctx.session = {};
      await ctx.reply("❌ Данные сделки утеряны. Начните создание заново.", mainMenuKeyboard);
      return;
    }

    const deal = await createDeal({
      sellerTelegramId: ctx.from.id,
      description: draft.description,
      amount: draft.amount,
      currency,
    });

    ctx.session = {};

    const botUsername = await getBotUsername();
    const dealLink = `https://t.me/${botUsername}?start=deal-${deal.dealCode}`;

    await ctx.reply(
      `✅ <b>Сделка успешно создана!</b>\n\n` +
        `📦 Товар: ${esc(draft.description)}\n` +
        `💵 Цена: ${esc(formatCurrency(draft.amount, currency))}\n` +
        `🆔 ID сделки: ${deal.dealCode}\n\n` +
        `🔗 <b>Ссылка для покупателя:</b>\n` +
        `${dealLink}\n\n` +
        `📋 <b>Что делать дальше:</b>\n` +
        `1. Скопируйте ссылку выше\n` +
        `2. Отправьте её покупателю\n` +
        `3. Дождитесь уведомления об оплате\n` +
        `4. Передайте товар ${MANAGER}\n\n` +
        `⏳ Ссылка активна до момента оплаты.`,
      { parse_mode: H, ...mainMenuKeyboard }
    );

    // Уведомляем всех админов о новой сделке
    await notifyAdmins(
      `📝 <b>Новая сделка создана!</b>\n\n` +
        `🆔 #${deal.dealCode}\n` +
        `📦 ${esc(deal.description)}\n` +
        `💵 ${esc(formatCurrency(deal.amount, deal.currency))}\n` +
        `👤 Продавец: <code>${ctx.from.id}</code>`
    );
  });

  // ──────────────────────────────────────────
  // Callback: Оплатить сделку
  // ──────────────────────────────────────────
  bot.action(/^pay_deal_(\d+)$/, async (ctx) => {
    const dealCode = ctx.match[1]!;
    await ctx.answerCbQuery();

    const deal = await getDealByCode(dealCode);
    if (!deal) {
      await ctx.reply("❌ Сделка не найдена.");
      return;
    }
    if (deal.status !== "pending") {
      await ctx.reply(`Сделка уже имеет статус: ${statusLabel(deal.status)}`);
      return;
    }
    if (deal.sellerTelegramId === ctx.from!.id) {
      await ctx.reply("❌ Вы не можете оплатить собственную сделку.");
      return;
    }

    const amount = parseFloat(deal.amount);
    const result = await deductFromWallet(
      ctx.from!.id,
      deal.currency,
      amount,
      `Оплата сделки #${deal.dealCode} — ${deal.description}`
    );

    if (!result.success) {
      await ctx.reply(
        `❌ <b>Недостаточно средств</b>\n\n` +
          `Для оплаты нужно: <b>${esc(formatCurrency(deal.amount, deal.currency))}</b>\n\n` +
          `Пополните баланс через ${MANAGER} и попробуйте снова.`,
        { parse_mode: H }
      );
      return;
    }

    await updateDealStatus(dealCode, "completed", ctx.from!.id);

    await ctx.reply(
      `✅ <b>Оплата прошла успешно!</b>\n\n` +
        `📦 Товар: ${esc(deal.description)}\n` +
        `💵 Сумма: ${esc(formatCurrency(deal.amount, deal.currency))}\n` +
        `🆔 ID сделки: ${deal.dealCode}\n\n` +
        `Ожидайте передачи товара. По вопросам: ${MANAGER}`,
      { parse_mode: H, ...mainMenuKeyboard }
    );

    // Уведомляем продавца
    try {
      await bot.telegram.sendMessage(
        deal.sellerTelegramId,
        `💰 <b>Покупатель оплатил сделку #${deal.dealCode}!</b>\n\n` +
          `📦 Товар: ${esc(deal.description)}\n` +
          `💵 Сумма: ${esc(formatCurrency(deal.amount, deal.currency))}\n\n` +
          `📌 Передайте товар менеджеру ${MANAGER} для завершения сделки.`,
        { parse_mode: H }
      );
    } catch {
      // продавец мог заблокировать бота
    }

    // Уведомляем всех админов об оплате
    await notifyAdmins(
      `💰 <b>Сделка оплачена!</b>\n\n` +
        `🆔 #${deal.dealCode}\n` +
        `📦 ${esc(deal.description)}\n` +
        `💵 ${esc(formatCurrency(deal.amount, deal.currency))}\n` +
        `👤 Продавец: <code>${deal.sellerTelegramId}</code>\n` +
        `🛒 Покупатель: <code>${ctx.from!.id}</code>\n\n` +
        `⚡ Требуется передача товара через ${MANAGER}`
    );
  });

  // ──────────────────────────────────────────
  // Callback: Отменить сделку
  // ──────────────────────────────────────────
  bot.action(/^cancel_deal_(\d+)$/, async (ctx) => {
    const dealCode = ctx.match[1]!;
    await ctx.answerCbQuery();

    const deal = await getDealByCode(dealCode);
    if (!deal) {
      await ctx.reply("❌ Сделка не найдена.");
      return;
    }
    if (deal.status === "completed" || deal.status === "cancelled") {
      await ctx.reply(`Сделка уже ${statusLabel(deal.status).toLowerCase()}.`);
      return;
    }

    await updateDealStatus(dealCode, "cancelled");

    await ctx.reply(
      `❌ <b>Сделка #${dealCode} отменена.</b>\n\nЕсли у вас возникли вопросы, обратитесь: ${MANAGER}`,
      { parse_mode: H, ...mainMenuKeyboard }
    );

    if (ctx.from!.id !== deal.sellerTelegramId) {
      try {
        await bot.telegram.sendMessage(
          deal.sellerTelegramId,
          `❌ <b>Сделка #${dealCode} была отменена покупателем.</b>\n\nЕсли есть вопросы: ${MANAGER}`,
          { parse_mode: H }
        );
      } catch {}
    }
  });

  // ──────────────────────────────────────────
  // Текстовые сообщения — шаги создания сделки
  // ──────────────────────────────────────────
  bot.on("text", async (ctx) => {
    const step = ctx.session.step;
    const text = ctx.message.text;

    if (step === "deal_description") {
      if (text.length < 3) {
        await ctx.reply("❌ Название слишком короткое. Напишите подробнее:", cancelKeyboard);
        return;
      }
      ctx.session.dealDraft = { description: text };
      ctx.session.step = "deal_amount";
      await ctx.reply(
        `✅ Название сохранено: <b>${esc(text)}</b>\n\n` +
          `💰 <b>Шаг 2 из 3 — Введите цену:</b>\n\n` +
          `✅ Примеры:\n` +
          `• 500 — целое число\n` +
          `• 1250 — тысячи\n` +
          `• 12.5 — дробное число\n` +
          `• 0.05 — малые суммы (например TON)\n\n` +
          `✏️ Напишите цену в следующем сообщении:`,
        { parse_mode: H, ...cancelKeyboard }
      );
      return;
    }

    if (step === "deal_amount") {
      const amount = parseFloat(text.replace(",", "."));
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply("❌ Введите корректную цену (только число):", cancelKeyboard);
        return;
      }
      ctx.session.dealDraft = { ...ctx.session.dealDraft, amount: amount.toString() };
      ctx.session.step = "deal_currency";
      await ctx.reply(
        `✅ Цена сохранена: <b>${amount}</b>\n\n` +
          `💱 <b>Шаг 3 из 3 — Выберите валюту:</b>\n\n` +
          `Нажмите на нужную валюту ниже 👇`,
        { parse_mode: H, ...currencyKeyboard }
      );
      return;
    }

    if (!step) {
      await ctx.reply("Выберите действие из меню ниже 👇", mainMenuKeyboard);
    }
  });

  return bot;
}

// ──────────────────────────────────────────
// Страница сделки для покупателя
// ──────────────────────────────────────────
async function handleDealPage(ctx: BotContext, dealCode: string) {
  const { mainMenuKeyboard, dealPageKeyboard, sellerDealKeyboard } = await import(
    "./keyboards.js"
  );
  const { getDealByCode } = await import("./db.js");
  const { formatCurrency, statusLabel, esc } = await import("./utils.js");

  const MANAGER = "@GarantTGifts";
  const deal = await getDealByCode(dealCode);
  if (!deal) {
    await ctx.reply("❌ Сделка не найдена. Проверьте ссылку.", mainMenuKeyboard);
    return;
  }

  const userId = ctx.from!.id;

  if (deal.sellerTelegramId === userId) {
    await ctx.reply(
      `🤝 <b>Ваша сделка #${deal.dealCode}</b>\n\n` +
        `📦 Товар: ${esc(deal.description)}\n` +
        `💵 Цена: ${esc(formatCurrency(deal.amount, deal.currency))}\n` +
        `📌 Статус: ${esc(statusLabel(deal.status))}\n\n` +
        `<i>Ожидайте уведомления об оплате от покупателя</i>`,
      { parse_mode: "HTML", ...sellerDealKeyboard(parseInt(deal.dealCode)) }
    );
    return;
  }

  if (deal.status !== "pending") {
    await ctx.reply(
      `Сделка #${deal.dealCode} уже ${statusLabel(deal.status).toLowerCase()}.`,
      mainMenuKeyboard
    );
    return;
  }

  await ctx.reply(
    `🤝 <b>Страница сделки</b>\n\n` +
      `📦 Товар: ${esc(deal.description)}\n` +
      `💵 Сумма: ${esc(formatCurrency(deal.amount, deal.currency))}\n` +
      `🆔 ID сделки: ${deal.dealCode}\n\n` +
      `Средства будут списаны с вашего баланса в боте.\n` +
      `Нажмите кнопку ниже, чтобы подтвердить оплату.`,
    { parse_mode: "HTML", ...dealPageKeyboard(parseInt(deal.dealCode)) }
  );
}
