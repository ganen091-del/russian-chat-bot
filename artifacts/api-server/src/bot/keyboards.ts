import { Markup } from "telegraf";

export const mainMenuKeyboard = Markup.keyboard([
  ["Создать сделку 🤝"],
  ["Кошелек 💼", "Моя статистика 📈"],
  ["Поддержка 🆘", "Инструкция 📄"],
]).resize();

export const cancelKeyboard = Markup.keyboard([["❌ Отмена"]]).resize();

export const currencyKeyboard = Markup.keyboard([
  ["⭐ Stars", "💎 TON"],
  ["💴 РУБ", "💵 ГРН"],
  ["❌ Отмена"],
]).resize();

export const dealPageKeyboard = (dealId: number) =>
  Markup.inlineKeyboard([
    [Markup.button.callback("💳 Оплатить сделку", `pay_deal_${dealId}`)],
    [Markup.button.callback("❌ Отмена", `cancel_deal_${dealId}`)],
  ]);

export const sellerDealKeyboard = (dealId: number) =>
  Markup.inlineKeyboard([
    [Markup.button.callback("❌ Отменить сделку", `cancel_deal_${dealId}`)],
  ]);
