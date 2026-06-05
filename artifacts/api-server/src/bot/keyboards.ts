import { Markup } from "telegraf";

export const mainMenuKeyboard = Markup.keyboard([
  ["Создать сделку 🤝"],
  ["Кошелек 💼", "Моя статистика 📈"],
  ["Поддержка 🆘"],
]).resize();

export const cancelKeyboard = Markup.keyboard([["❌ Отмена"]]).resize();

export const dealRoleKeyboard = Markup.keyboard([
  ["👤 Я продавец", "🛒 Я покупатель"],
  ["❌ Отмена"],
]).resize();

export const currencyKeyboard = Markup.keyboard([
  ["💵 ГРН", "💴 РУБ"],
  ["💎 TON", "⭐ Звёзды"],
  ["❌ Отмена"],
]).resize();

export const dealConfirmKeyboard = Markup.keyboard([
  ["✅ Подтвердить сделку"],
  ["❌ Отмена"],
]).resize();

export const dealActionKeyboard = (dealCode: string) =>
  Markup.inlineKeyboard([
    [Markup.button.callback("✅ Подтвердить получение", `confirm_deal_${dealCode}`)],
    [Markup.button.callback("❌ Отменить сделку", `cancel_deal_${dealCode}`)],
  ]);

export const walletKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback("💸 Пополнить", "wallet_deposit")],
  [Markup.button.callback("💳 Вывести", "wallet_withdraw")],
  [Markup.button.callback("📋 История", "wallet_history")],
]);
