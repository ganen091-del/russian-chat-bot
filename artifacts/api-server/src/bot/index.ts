import { Telegraf, session } from "telegraf";
import type { Context } from "telegraf";
import type { SessionData } from "./session.js";
import { logger } from "../lib/logger.js";
import {
  mainMenuKeyboard,
  cancelKeyboard,
  dealRoleKeyboard,
  currencyKeyboard,
  dealConfirmKeyboard,
  dealActionKeyboard,
  walletKeyboard,
} from "./keyboards.js";
import {
  upsertUser,
  getWallet,
  createDeal,
  getDealByCode,
  updateDealStatus,
  getUserDeals,
  getUserStats,
  getWalletHistory,
} from "./db.js";
import {
  generateDealCode,
  formatCurrency,
  currencyLabel,
  parseCurrencyFromButton,
  statusLabel,
  displayName,
} from "./utils.js";

interface BotContext extends Context {
  session: SessionData;
}

const SUPPORT_USERNAME = "@nft_garant_support";
const TOTAL_DEALS_DISPLAY = "11 742";

export function createBot() {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  if (!token) {
    logger.error("TELEGRAM_BOT_TOKEN is not set");
    throw new Error("TELEGRAM_BOT_TOKEN is not set");
  }

  const bot = new Telegraf<BotContext>(token);

  bot.use(session({ defaultSession: (): SessionData => ({}) }));

  bot.start(async (ctx) => {
    await upsertUser(ctx.from.id, {
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
    });

    const startParam = ctx.startPayload;
    if (startParam && startParam.startsWith("deal_")) {
      const dealCode = startParam.replace("deal_", "");
      await handleJoinDeal(ctx, dealCode);
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
        `🔹 ${TOTAL_DEALS_DISPLAY} успешных сделок без единого обмана\n\n` +
        `📌 Выберите раздел кнопками снизу`,
      { parse_mode: "Markdown", ...mainMenuKeyboard }
    );
  });

  bot.hears("Создать сделку 🤝", async (ctx) => {
    ctx.session = { step: "deal_role", dealDraft: {} };
    await ctx.reply(
      `🤝 *Создание новой сделки*\n\nКем вы выступаете в сделке?`,
      { parse_mode: "Markdown", ...dealRoleKeyboard }
    );
  });

  bot.hears("Кошелек 💼", async (ctx) => {
    await upsertUser(ctx.from.id, {
      username: ctx.from.username,
      firstName: ctx.from.first_name,
    });
    const wallet = await getWallet(ctx.from.id);
    await ctx.reply(
      `💼 *Ваш кошелёк*\n\n` +
        `💵 ГРН: *${parseFloat(wallet.uah).toFixed(2)}*\n` +
        `💴 РУБ: *${parseFloat(wallet.rub).toFixed(2)}*\n` +
        `💎 TON: *${parseFloat(wallet.ton).toFixed(4)}*\n` +
        `⭐ Звёзды: *${Math.round(parseFloat(wallet.stars))}*\n\n` +
        `_Для пополнения или вывода используйте кнопки ниже_`,
      { parse_mode: "Markdown", ...walletKeyboard }
    );
  });

  bot.hears("Моя статистика 📈", async (ctx) => {
    await upsertUser(ctx.from.id, {
      username: ctx.from.username,
      firstName: ctx.from.first_name,
    });
    const stats = await getUserStats(ctx.from.id);
    const deals = await getUserDeals(ctx.from.id);

    const lastDeals = deals.slice(0, 3);
    let lastDealsText = "";
    if (lastDeals.length > 0) {
      lastDealsText = "\n\n📋 *Последние сделки:*\n";
      for (const d of lastDeals) {
        lastDealsText += `• #${d.dealCode} — ${formatCurrency(d.amount, d.currency)} — ${statusLabel(d.status)}\n`;
      }
    }

    await ctx.reply(
      `📈 *Ваша статистика*\n\n` +
        `👤 Имя: *${displayName(ctx)}*\n` +
        `🆔 ID: \`${ctx.from.id}\`\n\n` +
        `📊 *Сделки:*\n` +
        `• Всего: *${stats.total}*\n` +
        `• Завершённых: *${stats.completed}*\n` +
        `• Активных: *${stats.active}*\n` +
        `• Отменённых: *${stats.cancelled}*${lastDealsText}`,
      { parse_mode: "Markdown", ...mainMenuKeyboard }
    );
  });

  bot.hears("Поддержка 🆘", async (ctx) => {
    await ctx.reply(
      `🆘 *Служба поддержки*\n\n` +
        `Мы работаем 24/7 и отвечаем в течение 5 минут.\n\n` +
        `📨 Написать оператору: ${SUPPORT_USERNAME}\n\n` +
        `❓ *Частые вопросы:*\n` +
        `• Как создать сделку? → нажмите «Создать сделку 🤝»\n` +
        `• Как пригласить партнёра? → после создания сделки получите ссылку\n` +
        `• Сколько стоит гарант? → комиссия 1% от суммы\n` +
        `• Как вывести средства? → в разделе «Кошелек 💼»`,
      { parse_mode: "Markdown", ...mainMenuKeyboard }
    );
  });

  bot.hears("❌ Отмена", async (ctx) => {
    ctx.session = {};
    await ctx.reply("Действие отменено.", mainMenuKeyboard);
  });

  bot.hears(["👤 Я продавец", "🛒 Я покупатель"], async (ctx) => {
    if (ctx.session.step !== "deal_role") return;
    const isSeller = ctx.message.text.includes("продавец");
    ctx.session.dealDraft = {
      ...ctx.session.dealDraft,
      role: isSeller ? "seller" : "buyer",
    };
    ctx.session.step = "deal_description";
    await ctx.reply(
      `📝 *Описание сделки*\n\n` +
        `Что именно передаётся? Напишите краткое описание товара/услуги:\n\n` +
        `_Пример: NFT из коллекции BAYC #1234, скин AWP Dragon Lore FN, аккаунт Steam с играми_`,
      { parse_mode: "Markdown", ...cancelKeyboard }
    );
  });

  bot.hears(["💵 ГРН", "💴 РУБ", "💎 TON", "⭐ Звёзды"], async (ctx) => {
    if (ctx.session.step !== "deal_currency") return;
    const currency = parseCurrencyFromButton(ctx.message.text);
    if (!currency) return;
    ctx.session.dealDraft = { ...ctx.session.dealDraft, currency };
    ctx.session.step = "deal_confirm";

    const draft = ctx.session.dealDraft!;
    const commission = parseFloat(draft.amount!) * 0.01;
    const commissionText = formatCurrency(commission.toFixed(8), currency);

    await ctx.reply(
      `✅ *Подтвердите сделку*\n\n` +
        `📦 Товар: *${draft.description}*\n` +
        `💰 Сумма: *${formatCurrency(draft.amount!, currency)}*\n` +
        `🏷️ Роль: *${draft.role === "seller" ? "Продавец" : "Покупатель"}*\n` +
        `💳 Комиссия гаранта (1%): *${commissionText}*\n\n` +
        `Нажмите «Подтвердить сделку» для создания`,
      { parse_mode: "Markdown", ...dealConfirmKeyboard }
    );
  });

  bot.hears("✅ Подтвердить сделку", async (ctx) => {
    if (ctx.session.step !== "deal_confirm") return;
    const draft = ctx.session.dealDraft!;
    if (!draft.description || !draft.amount || !draft.currency) {
      await ctx.reply("Ошибка: данные сделки неполные. Начните заново.", mainMenuKeyboard);
      ctx.session = {};
      return;
    }

    const dealCode = generateDealCode();
    const isSeller = draft.role === "seller";

    await createDeal({
      dealCode,
      sellerTelegramId: isSeller ? ctx.from.id : 0,
      buyerTelegramId: isSeller ? undefined : ctx.from.id,
      description: draft.description,
      amount: draft.amount,
      currency: draft.currency,
    });

    ctx.session = {};

    const botInfo = await bot.telegram.getMe();
    const dealLink = `https://t.me/${botInfo.username}?start=deal_${dealCode}`;

    await ctx.reply(
      `🎉 *Сделка создана!*\n\n` +
        `🔑 Код сделки: \`${dealCode}\`\n` +
        `📦 Товар: *${draft.description}*\n` +
        `💰 Сумма: *${formatCurrency(draft.amount, draft.currency!)}*\n` +
        `📌 Статус: ⏳ Ожидание второй стороны\n\n` +
        `🔗 *Отправьте эту ссылку ${isSeller ? "покупателю" : "продавцу"}:*\n` +
        `${dealLink}\n\n` +
        `_Как только партнёр перейдёт по ссылке, вы оба получите уведомление_`,
      { parse_mode: "Markdown", ...mainMenuKeyboard }
    );
  });

  bot.action(/^confirm_deal_(.+)$/, async (ctx) => {
    const dealCode = ctx.match[1];
    await ctx.answerCbQuery();
    const deal = await getDealByCode(dealCode!);
    if (!deal) {
      await ctx.reply("❌ Сделка не найдена.");
      return;
    }
    if (deal.status !== "active") {
      await ctx.reply(`Сделка уже имеет статус: ${statusLabel(deal.status)}`);
      return;
    }

    await updateDealStatus(dealCode!, "completed");

    await ctx.reply(
      `✅ *Сделка #${dealCode} завершена!*\n\n` +
        `Спасибо за использование NFT Гарант Бот!\n` +
        `Средства будут зачислены на кошелёк в течение нескольких минут.`,
      { parse_mode: "Markdown", ...mainMenuKeyboard }
    );

    try {
      const otherId = ctx.from!.id === deal.sellerTelegramId
        ? deal.buyerTelegramId
        : deal.sellerTelegramId;
      if (otherId) {
        await bot.telegram.sendMessage(
          otherId,
          `✅ *Сделка #${dealCode} подтверждена!*\n\nВаш партнёр подтвердил получение товара. Сделка завершена успешно.`,
          { parse_mode: "Markdown" }
        );
      }
    } catch {}
  });

  bot.action(/^cancel_deal_(.+)$/, async (ctx) => {
    const dealCode = ctx.match[1];
    await ctx.answerCbQuery();
    const deal = await getDealByCode(dealCode!);
    if (!deal) {
      await ctx.reply("❌ Сделка не найдена.");
      return;
    }

    await updateDealStatus(dealCode!, "cancelled");
    await ctx.reply(
      `❌ *Сделка #${dealCode} отменена.*\n\nЕсли у вас возник спор, обратитесь в поддержку: ${SUPPORT_USERNAME}`,
      { parse_mode: "Markdown", ...mainMenuKeyboard }
    );
  });

  bot.action("wallet_deposit", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      `💸 *Пополнение кошелька*\n\n` +
        `Для пополнения обратитесь к оператору:\n${SUPPORT_USERNAME}\n\n` +
        `Укажите:\n` +
        `• Вашу валюту (ГРН/РУБ/TON/Звёзды)\n` +
        `• Сумму пополнения\n` +
        `• Ваш Telegram ID: \`${ctx.from?.id}\``,
      { parse_mode: "Markdown", ...mainMenuKeyboard }
    );
  });

  bot.action("wallet_withdraw", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      `💳 *Вывод средств*\n\n` +
        `Для вывода средств обратитесь к оператору:\n${SUPPORT_USERNAME}\n\n` +
        `Укажите:\n` +
        `• Валюту вывода\n` +
        `• Сумму\n` +
        `• Реквизиты\n` +
        `• Ваш Telegram ID: \`${ctx.from?.id}\``,
      { parse_mode: "Markdown", ...mainMenuKeyboard }
    );
  });

  bot.action("wallet_history", async (ctx) => {
    await ctx.answerCbQuery();
    const history = await getWalletHistory(ctx.from!.id);
    if (history.length === 0) {
      await ctx.reply("📋 История транзакций пуста.", mainMenuKeyboard);
      return;
    }
    let text = "📋 *История транзакций:*\n\n";
    for (const tx of history) {
      const sign = tx.type === "credit" ? "+" : "-";
      text += `${sign}${formatCurrency(tx.amount, tx.currency)} — ${tx.description ?? tx.type}\n`;
    }
    await ctx.reply(text, { parse_mode: "Markdown", ...mainMenuKeyboard });
  });

  bot.on("text", async (ctx) => {
    const step = ctx.session.step;
    const text = ctx.message.text;

    if (step === "deal_description") {
      if (text.length < 5) {
        await ctx.reply("Описание слишком короткое. Напишите подробнее:", cancelKeyboard);
        return;
      }
      ctx.session.dealDraft = { ...ctx.session.dealDraft, description: text };
      ctx.session.step = "deal_amount";
      await ctx.reply(
        `💰 *Сумма сделки*\n\nВведите сумму числом (например: \`500\`, \`0.5\`, \`1000\`):`,
        { parse_mode: "Markdown", ...cancelKeyboard }
      );
      return;
    }

    if (step === "deal_amount") {
      const amount = parseFloat(text.replace(",", "."));
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply("❌ Введите корректную сумму (только число):", cancelKeyboard);
        return;
      }
      ctx.session.dealDraft = { ...ctx.session.dealDraft, amount: amount.toString() };
      ctx.session.step = "deal_currency";
      await ctx.reply(
        `💱 *Выберите валюту сделки:*`,
        { parse_mode: "Markdown", ...currencyKeyboard }
      );
      return;
    }

    if (!step) {
      await ctx.reply(
        "Выберите действие из меню ниже 👇",
        mainMenuKeyboard
      );
    }
  });

  return bot;
}

async function handleJoinDeal(ctx: BotContext, dealCode: string) {
  const deal = await getDealByCode(dealCode);
  if (!deal) {
    await ctx.reply("❌ Сделка не найдена. Проверьте ссылку.", mainMenuKeyboard);
    return;
  }

  const userId = ctx.from!.id;
  const isSeller = deal.sellerTelegramId === userId;
  const isBuyer = deal.buyerTelegramId === userId;

  if (deal.status !== "pending" && !isSeller && !isBuyer) {
    await ctx.reply(`Сделка #${dealCode} уже ${statusLabel(deal.status).toLowerCase()}.`, mainMenuKeyboard);
    return;
  }

  if (isSeller || isBuyer) {
    await ctx.reply(
      `🤝 *Сделка #${dealCode}*\n\n` +
        `📦 Товар: *${deal.description}*\n` +
        `💰 Сумма: *${formatCurrency(deal.amount, deal.currency)}*\n` +
        `📌 Статус: ${statusLabel(deal.status)}`,
      { parse_mode: "Markdown", ...dealActionKeyboard(dealCode) }
    );
    return;
  }

  const isSellerdeal = deal.sellerTelegramId === 0;
  if (isSellerdeal) {
    await updateDealStatus(dealCode, "active", undefined);
  } else {
    await updateDealStatus(dealCode, "active", userId);
  }

  await ctx.reply(
    `✅ *Вы присоединились к сделке #${dealCode}!*\n\n` +
      `📦 Товар: *${deal.description}*\n` +
      `💰 Сумма: *${formatCurrency(deal.amount, deal.currency)}*\n\n` +
      `После передачи товара нажмите «Подтвердить получение»`,
    { parse_mode: "Markdown", ...dealActionKeyboard(dealCode) }
  );

  try {
    const notifyId = isSellerdeal ? deal.buyerTelegramId : deal.sellerTelegramId;
    if (notifyId) {
      await ctx.telegram.sendMessage(
        notifyId,
        `🔔 *Партнёр присоединился к сделке #${dealCode}!*\n\nСделка активна. Ожидайте передачи товара.`,
        { parse_mode: "Markdown" }
      );
    }
  } catch {}
}
