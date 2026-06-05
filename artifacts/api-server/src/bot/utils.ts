import { randomBytes } from "crypto";

export function generateDealCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

export function formatCurrency(amount: string | number, currency: string): string {
  const num = parseFloat(String(amount));
  switch (currency) {
    case "UAH": return `${num.toFixed(2)} ГРН`;
    case "RUB": return `${num.toFixed(2)} РУБ`;
    case "TON": return `${num.toFixed(4)} TON`;
    case "STARS": return `${Math.round(num)} ⭐`;
    default: return `${num} ${currency}`;
  }
}

export function currencyLabel(currency: string): string {
  switch (currency) {
    case "UAH": return "💵 ГРН";
    case "RUB": return "💴 РУБ";
    case "TON": return "💎 TON";
    case "STARS": return "⭐ Звёзды";
    default: return currency;
  }
}

export function parseCurrencyFromButton(text: string): string | null {
  if (text.includes("ГРН")) return "UAH";
  if (text.includes("РУБ")) return "RUB";
  if (text.includes("TON")) return "TON";
  if (text.includes("Звёзд")) return "STARS";
  return null;
}

export function statusLabel(status: string): string {
  switch (status) {
    case "pending": return "⏳ Ожидание";
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
