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
} from "./db.js";
import {
  formatCurrency,
  parseCurrencyFromButton,
  statusLabel,
  md,
} from "./utils.js";

interface BotContext extends Context {
  session: SessionData;
}

const MANAGER = "@GarantTGifts";

export function createBot() {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  if (!token) {
    logger.error("TELEGRAM_BOT_TOKEN is not set");
    throw new Error("TELEGRAM_BOT_TOKEN is not set");
  }

  const bot = new Telegraf<BotContext>(token);
  bot.use(session({ defaultSession: (): SessionData => ({}) }));

  let cachedBotUsername = "";

  bot.catch((err, ctx) => {
    const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
    logger.error({ err, updateType: ctx.updateType }, "Bot handler error");
    ctx.reply(`🔴 DEBUG ERROR:\n${msg.slice(0, 3000)}`).catch(() => {});
  });

  // Кешируем username при первом обращении
  async function getBotUsername(): Promise<string> {
    if (cachedBotUsername) return cachedBotUsername;
    const info = await bot.telegram.getMe();
    cachedBotUsername = info.username ?? "";
    return cachedBotUsername;
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
      `🤖 *Добро пожаловать в NFT Гарант Бот!*\n\n` +
        `🛡️ Я — безопасный посредник (гарант) при обмене цифровых товаров:\n` +
        `• NFT и цифровых активов\n` +
        `• Игровых скинов, предметов, аккаунтов\n` +
        `• Подарков Telegram (Stars)\n` +
        `• Игровых валют и криптовалют\n\n` +
        `⚙️ *Что умеет бот:*\n` +
        `🔹 Создание защищённых сделок за 1 минуту\n` +
        `🔹 Кошелёк с несколькими валютами (ГРН, РУБ, TON, Звёзды)\n` +
        `🔹 Уведомления продавцу и покупателю в реальном времени\n` +
        `🔹 Поддержка 24/7 — ответ до 5 минут\n` +
        `🔹 11 742 успешных сделок без единого обмана\n\n` +
        `📌 Выберите раздел кнопками снизу`,
      { parse_mode: "Markdown", ...mainMenuKeyboard }
    );
  });

  // ──────────────────────────────────────────
  // /add <telegramId> <amount> <currency>  — пополнение баланса
  // ──────────────────────────────────────────
  bot.command("add", async (ctx) => {
    const text = ctx.message.text.trim();
    const parts = text.split(/\s+/);
    if (parts.length !== 4) {
      await ctx.reply("❌ Формат: /add <ID> <сумма> <валюта>\nПример: /add 123456789 1250 Руб");
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
    else if (rawCurrency === "stars" || rawCurrency === "звёзды" || rawCurrency === "звезды") currency = "STARS";
    else {
      await ctx.reply("❌ Неизвестная валюта. Допустимые: Грн, Руб, TON, Stars");
      return;
    }

    await upsertUser(targetId, {});
    await addToWallet(targetId, currency, amount, `Пополнение администратором (от ${ctx.from.id})`);
    const wallet = await getWallet(targetId);

    await ctx.reply(
      `✅ Баланс пользователя \`${targetId}\` пополнен на *${formatCurrency(amount, currency)}*\n\n` +
        `💼 Текущий баланс:\n` +
        `▪️ ${parseFloat(wallet.uah).toFixed(2)} ГРН\n` +
        `▪️ ${parseFloat(wallet.rub).toFixed(2)} РУБ\n` +
        `▪️ ${parseFloat(wallet.ton).toFixed(6)} TON\n` +
        `▪️ ${Math.round(parseFloat(wallet.stars))} Звёзды`,
      { parse_mode: "Markdown", ...mainMenuKeyboard }
    );

    try {
      await bot.telegram.sendMessage(
        targetId,
        `💸 *Ваш баланс пополнен!*\n\n` +
          `Зачислено: *${formatCurrency(amount, currency)}*\n\n` +
          `💼 Текущий баланс:\n` +
          `▪️ ${parseFloat(wallet.uah).toFixed(2)} ГРН\n` +
          `▪️ ${parseFloat(wallet.rub).toFixed(2)} РУБ\n` +
          `▪️ ${parseFloat(wallet.ton).toFixed(6)} TON\n` +
          `▪️ ${Math.round(parseFloat(wallet.stars))} Звёзды`,
        { parse_mode: "Markdown" }
      );
    } catch {
      // пользователь мог не запустить бота
    }
  });

  // ──────────────────────────────────────────
  // /admin — панель администратора
  // ──────────────────────────────────────────
  bot.command("admin", async (ctx) => {
    const [deals, stats, usersCount] = await Promise.all([
      getOpenDeals(),
      getAllDealsStats(),
      getAllUsersCount(),
    ]);

    const header =
      `🛠 *Панель администратора*\n\n` +
      `👥 Пользователей: *${usersCount}*\n\n` +
      `📊 *Статистика сделок:*\n` +
      `▪️ Всего: ${stats.total}\n` +
      `▪️ Ожидают оплаты: ${stats.pending}\n` +
      `▪️ Активных: ${stats.active}\n` +
      `▪️ Завершённых: ${stats.completed}\n` +
      `▪️ Отменённых: ${stats.cancelled}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🔓 *Открытые сделки (${deals.length}):*`;

    if (deals.length === 0) {
      await ctx.reply(header + "\n\n_Нет открытых сделок_", {
        parse_mode: "Markdown",
        ...mainMenuKeyboard,
      });
      return;
    }

    await ctx.reply(header, { parse_mode: "Markdown" });

    // Показываем каждую открытую сделку отдельным сообщением с кнопками управления
    const { Markup } = await import("telegraf");
    for (const deal of deals.slice(0, 20)) {
      const sellerInfo = `ID ${deal.sellerTelegramId}`;
      const buyerInfo = deal.buyerTelegramId ? `ID ${deal.buyerTelegramId}` : "—";
      await ctx.reply(
        `🔑 *Сделка #${deal.dealCode}*\n` +
          `📦 ${md(deal.description)}\n` +
          `💵 ${formatCurrency(deal.amount, deal.currency)}\n` +
          `📌 ${statusLabel(deal.status)}\n` +
          `👤 Продавец: \`${sellerInfo}\`\n` +
          `🛒 Покупатель: \`${buyerInfo}\`\n` +
          `🕐 ${deal.createdAt.toLocaleString("ru-RU", { timeZone: "Europe/Kyiv" })}`,
        {
          parse_mode: "Markdown",
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
      await ctx.reply(`_...и ещё ${deals.length - 20} сделок_`, { parse_mode: "Markdown" });
    }
  });

  // Admin: завершить сделку принудительно
  bot.action(/^admin_complete_(\d+)$/, async (ctx) => {
    const dealCode = ctx.match[1]!;
    await ctx.answerCbQuery("✅ Сделка завершена");
    const deal = await getDealByCode(dealCode);
    if (!deal) { await ctx.reply("❌ Сделка не найдена."); return; }
    if (deal.status === "completed") { await ctx.reply("Сделка уже завершена."); return; }

    await updateDealStatus(dealCode, "completed");
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    await ctx.reply(
      `✅ *Сделка #${dealCode} завершена администратором.*`,
      { parse_mode: "Markdown" }
    );

    // Уведомляем участников
    for (const uid of [deal.sellerTelegramId, deal.buyerTelegramId].filter(Boolean) as number[]) {
      try {
        await bot.telegram.sendMessage(
          uid,
          `✅ *Сделка #${dealCode} завершена администратором.*\n\nПо вопросам: ${MANAGER}`,
          { parse_mode: "Markdown" }
        );
      } catch {}
    }
  });

  // Admin: отменить сделку принудительно
  bot.action(/^admin_cancel_(\d+)$/, async (ctx) => {
    const dealCode = ctx.match[1]!;
    await ctx.answerCbQuery("❌ Сделка отменена");
    const deal = await getDealByCode(dealCode);
    if (!deal) { await ctx.reply("❌ Сделка не найдена."); return; }
    if (deal.status === "cancelled") { await ctx.reply("Сделка уже отменена."); return; }

    await updateDealStatus(dealCode, "cancelled");
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    await ctx.reply(
      `❌ *Сделка #${dealCode} отменена администратором.*`,
      { parse_mode: "Markdown" }
    );

    for (const uid of [deal.sellerTelegramId, deal.buyerTelegramId].filter(Boolean) as number[]) {
      try {
        await bot.telegram.sendMessage(
          uid,
          `❌ *Сделка #${dealCode} отменена администратором.*\n\nПо вопросам: ${MANAGER}`,
          { parse_mode: "Markdown" }
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
      `🤝 *Создание сделки — Шаг 1 из 3*\n\n` +
        `📦 Введите название товара или услуги:\n\n` +
        `✅ Примеры:\n` +
        `• Скин AK-47 Redline MW CS2\n` +
        `• NFT Notcoin #4821\n` +
        `• Подарок Telegram 500 Stars\n` +
        `• Аккаунт Steam MMR 4500\n` +
        `• Игровая валюта 10 000 золота\n\n` +
        `✏️ Напишите название в следующем сообщении:`,
      { parse_mode: "Markdown", ...cancelKeyboard }
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
      `💼 *Ваш кошелёк*\n\n` +
        `🆔 Ваш ID для пополнения: \`${ctx.from.id}\`\n\n` +
        `💵 Текущий баланс:\n` +
        `▪️ ${parseFloat(wallet.uah).toFixed(2)} ГРН\n` +
        `▪️ ${parseFloat(wallet.rub).toFixed(2)} РУБ\n` +
        `▪️ ${parseFloat(wallet.ton).toFixed(6)} TON\n` +
        `▪️ ${Math.round(parseFloat(wallet.stars))} Звёзды\n\n` +
        `ℹ️ Баланс используется для оплаты сделок в боте.\n\n` +
        `📩 Как пополнить баланс:\n` +
        `1. Напишите ${MANAGER}\n` +
        `2. Сообщите ваш ID: \`${ctx.from.id}\`\n` +
        `3. Укажите нужную сумму и валюту\n` +
        `4. Оплатите удобным способом\n\n` +
        `⏱ Зачисление в течение 5-10 минут после подтверждения оплаты.`,
      { parse_mode: "Markdown", ...mainMenuKeyboard }
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
      `📈 *Ваша личная статистика*\n\n` +
        `🆔 Ваш ID: \`${ctx.from.id}\`\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🤝 *Как продавец:*\n` +
        `▪️ Создано сделок: ${stats.sellerTotal}\n` +
        `▪️ Завершено: ${stats.sellerCompleted}\n` +
        `▪️ Активных: ${stats.sellerActive}\n\n` +
        `🛒 *Как покупатель:*\n` +
        `▪️ Оплачено сделок: ${stats.buyerCompleted} из ${stats.buyerTotal}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `💼 *Текущий баланс:*\n` +
        `▪️ ${parseFloat(wallet.uah).toFixed(2)} ГРН\n` +
        `▪️ ${parseFloat(wallet.rub).toFixed(2)} РУБ\n` +
        `▪️ ${parseFloat(wallet.ton).toFixed(6)} TON\n` +
        `▪️ ${Math.round(parseFloat(wallet.stars))} Звёзды\n\n` +
        `📩 Для пополнения обратитесь в 🆘 Поддержку.`,
      { parse_mode: "Markdown", ...mainMenuKeyboard }
    );
  });

  // ──────────────────────────────────────────
  // Поддержка 🆘
  // ──────────────────────────────────────────
  bot.hears("Поддержка 🆘", async (ctx) => {
    await ctx.reply(
      `🆘 *Служба поддержки NFT Гарант Бота*\n\n` +
        `👤 Официальный менеджер: ${MANAGER}\n\n` +
        `⏱ Время ответа: до 5 минут\n\n` +
        `📋 *Чем помогаем:*\n` +
        `• Спорные ситуации между продавцом и покупателем\n` +
        `• Пополнение баланса любой валютой\n` +
        `• Возврат средств при отмене сделки\n` +
        `• Технические неполадки\n` +
        `• Консультация по безопасным сделкам\n\n` +
        `⚠️ *Осторожно, мошенники!*\n` +
        `Единственный официальный аккаунт — ${MANAGER}.\n` +
        `Не отвечайте на сообщения от других аккаунтов с похожими именами.`,
      { parse_mode: "Markdown", ...mainMenuKeyboard }
    );
  });

  // ──────────────────────────────────────────
  // Инструкция 📄
  // ──────────────────────────────────────────
  bot.hears("Инструкция 📄", async (ctx) => {
    await ctx.reply(
      `📖 *Как создать безопасную сделку — пошагово*\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `*Шаг 1 — Продавец создаёт сделку:*\n` +
        `Нажмите 🤝 Создать сделку и следуйте инструкциям. Вы введёте название товара, цену и валюту. Бот выдаст уникальную ссылку.\n\n` +
        `*Шаг 2 — Покупатель переходит по ссылке:*\n` +
        `Отправьте ссылку покупателю. Он открывает её в Telegram, видит все детали сделки и нажимает «Оплатить». Средства списываются с его баланса в боте.\n\n` +
        `*Шаг 3 — Передача товара:*\n` +
        `Продавец передаёт товар менеджеру ${MANAGER}. Менеджер проверяет товар и переводит деньги продавцу.\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `✅ *Примеры успешных сделок:*\n` +
        `• NFT Notcoin #4821 за 12 TON — закрыто за 8 минут\n` +
        `• Скин AK-47 Redline MW CS2 за 3 200 руб — без споров\n` +
        `• Подарок Telegram 500 Stars — мгновенная оплата\n` +
        `• Аккаунт Steam с MMR 4500 — проверен и передан\n\n` +
        `💡 *Важно:* Пополните баланс через поддержку перед первой сделкой. Для оплаты нужны средства на счёте в боте.`,
      { parse_mode: "Markdown", ...mainMenuKeyboard }
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
      `✅ *Сделка успешно создана!*\n\n` +
        `📦 Товар: ${md(draft.description)}\n` +
        `💵 Цена: ${formatCurrency(draft.amount!, currency)}\n` +
        `🆔 ID сделки: ${deal.dealCode}\n\n` +
        `🔗 *Ссылка для покупателя:*\n` +
        `${dealLink}\n\n` +
        `📋 *Что делать дальше:*\n` +
        `1. Скопируйте ссылку выше\n` +
        `2. Отправьте её покупателю\n` +
        `3. Дождитесь уведомления об оплате\n` +
        `4. Передайте товар ${MANAGER}\n\n` +
        `⏳ Ссылка активна до момента оплаты.`,
      { parse_mode: "Markdown", ...mainMenuKeyboard }
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
        `❌ *Недостаточно средств*\n\n` +
          `Для оплаты нужно: *${formatCurrency(deal.amount, deal.currency)}*\n\n` +
          `Пополните баланс через ${MANAGER} и попробуйте снова.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    await updateDealStatus(dealCode, "completed", ctx.from!.id);

    await ctx.reply(
      `✅ *Оплата прошла успешно!*\n\n` +
        `📦 Товар: ${md(deal.description)}\n` +
        `💵 Сумма: ${formatCurrency(deal.amount, deal.currency)}\n` +
        `🆔 ID сделки: ${deal.dealCode}\n\n` +
        `Ожидайте передачи товара. По вопросам: ${MANAGER}`,
      { parse_mode: "Markdown", ...mainMenuKeyboard }
    );

    // Уведомляем продавца
    try {
      await bot.telegram.sendMessage(
        deal.sellerTelegramId,
        `💰 *Покупатель оплатил сделку #${deal.dealCode}!*\n\n` +
          `📦 Товар: ${md(deal.description)}\n` +
          `💵 Сумма: ${formatCurrency(deal.amount, deal.currency)}\n\n` +
          `📌 Передайте товар менеджеру ${MANAGER} для завершения сделки.`,
        { parse_mode: "Markdown" }
      );
    } catch {
      // продавец мог заблокировать бота
    }
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
      `❌ *Сделка #${dealCode} отменена.*\n\nЕсли у вас возникли вопросы, обратитесь: ${MANAGER}`,
      { parse_mode: "Markdown", ...mainMenuKeyboard }
    );

    // Уведомляем продавца если отменяет покупатель
    if (ctx.from!.id !== deal.sellerTelegramId) {
      try {
        await bot.telegram.sendMessage(
          deal.sellerTelegramId,
          `❌ *Сделка #${dealCode} была отменена покупателем.*\n\nЕсли есть вопросы: ${MANAGER}`,
          { parse_mode: "Markdown" }
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
        `✅ Название сохранено: *${md(text)}*\n\n` +
          `💰 *Шаг 2 из 3 — Введите цену:*\n\n` +
          `✅ Примеры:\n` +
          `• 500 — целое число\n` +
          `• 1250 — тысячи\n` +
          `• 12.5 — дробное число\n` +
          `• 0.05 — малые суммы (например TON)\n\n` +
          `✏️ Напишите цену в следующем сообщении:`,
        { parse_mode: "Markdown", ...cancelKeyboard }
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
        `✅ Цена сохранена: *${amount}*\n\n` +
          `💱 *Шаг 3 из 3 — Выберите валюту:*\n\n` +
          `Нажмите на нужную валюту ниже 👇`,
        { parse_mode: "Markdown", ...currencyKeyboard }
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
  const deal = await getDealByCode(dealCode);
  if (!deal) {
    await ctx.reply("❌ Сделка не найдена. Проверьте ссылку.", mainMenuKeyboard);
    return;
  }

  const userId = ctx.from!.id;

  // Это продавец — показываем его сделку
  if (deal.sellerTelegramId === userId) {
    await ctx.reply(
      `🤝 *Ваша сделка #${deal.dealCode}*\n\n` +
        `📦 Товар: ${md(deal.description)}\n` +
        `💵 Цена: ${formatCurrency(deal.amount, deal.currency)}\n` +
        `📌 Статус: ${statusLabel(deal.status)}\n\n` +
        `_Ожидайте уведомления об оплате от покупателя_`,
      { parse_mode: "Markdown", ...sellerDealKeyboard(parseInt(deal.dealCode)) }
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
    `🤝 *Страница сделки*\n\n` +
      `📦 Товар: ${md(deal.description)}\n` +
      `💵 Сумма: ${formatCurrency(deal.amount, deal.currency)}\n` +
      `🆔 ID сделки: ${deal.dealCode}\n\n` +
      `Средства будут списаны с вашего баланса в боте.\n` +
      `Нажмите кнопку ниже, чтобы подтвердить оплату.`,
    { parse_mode: "Markdown", ...dealPageKeyboard(parseInt(deal.dealCode)) }
  );
}
