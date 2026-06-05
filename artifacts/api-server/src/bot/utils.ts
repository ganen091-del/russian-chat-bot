import { randomInt } from "crypto";

export function generateDealId(): number {
  return randomInt(100000, 999999);
}

export function formatCurrency(amount: string | number, currency: string): string {
  const num = parseFloat(String(amount));
  switch (currency) {
    case "UAH": return `${num.toFixed(2)} ГРН`;
    case "RUB": return `${num.toFixed(2)} РУБ`;
    case "TON": return `${num.toFixed(6)} TON`;
    case "STARS": return `${Math.round(num)} Stars`;
    default: return `${num} ${currency}`;
  }
}

export function currencyLabel(currency: string): string {
  switch (currency) {
    case "UAH": return "💵 ГРН";
    case "RUB": return "💴 РУБ";
    case "TON": return "💎 TON";
    case "STARS": return "⭐ Stars";
    default: return currency;
  }
}

export function parseCurrencyFromButton(text: string): string | null {
  if (text.includes("ГРН")) return "UAH";
  if (text.includes("РУБ")) return "RUB";
  if (text.includes("TON")) return "TON";
  if (text.includes("Stars")) return "STARS";
  return null;
}

export function statusLabel(status: string): string {
  switch (status) {
    case "pending": return "⏳ Ожидание оплаты";
    case "active": return "🔄 Активна";
    case "completed": return "✅ Завершена";
    case "cancelled": return "❌ Отменена";
    case "disputed": return "⚠️ Спор";
    default: return status;
  }
}

export function displayName(ctx: { from?: { first_name?: string; username?: string } }): string {
  if (!ctx.from) return "Пользователь";
  return ctx.from.first_name || ctx.from.username || "Пользователь";
}

export function currencySymbol(currency: string): string {
  switch (currency) {
    case "UAH": return "ГРН";
    case "RUB": return "РУБ";
    case "TON": return "TON";
    case "STARS": return "Stars";
    default: return currency;
  }
}

export function hasSufficientBalance(wallet: {
  uah: string; rub: string; ton: string; stars: string;
}, amount: string, currency: string): boolean {
  const num = parseFloat(amount);
  switch (currency) {
    case "UAH": return parseFloat(wallet.uah) >= num;
    case "RUB": return parseFloat(wallet.rub) >= num;
    case "TON": return parseFloat(wallet.ton) >= num;
    case "STARS": return parseFloat(wallet.stars) >= num;
    default: return false;
  }
}

export function md(text: string): string {
  return text.replace(/[_*`[]/g, (c) => `\\${c}`);
}
