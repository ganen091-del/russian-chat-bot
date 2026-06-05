import { pgTable, serial, bigint, numeric, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const walletsTable = pgTable("wallets", {
  id: serial("id").primaryKey(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull().unique(),
  uah: numeric("uah", { precision: 18, scale: 4 }).notNull().default("0"),
  rub: numeric("rub", { precision: 18, scale: 4 }).notNull().default("0"),
  ton: numeric("ton", { precision: 18, scale: 8 }).notNull().default("0"),
  stars: numeric("stars", { precision: 18, scale: 0 }).notNull().default("0"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const walletTransactionsTable = pgTable("wallet_transactions", {
  id: serial("id").primaryKey(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
  currency: text("currency").notNull(),
  amount: numeric("amount", { precision: 18, scale: 8 }).notNull(),
  type: text("type").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertWalletSchema = createInsertSchema(walletsTable).omit({ id: true });
export type InsertWallet = z.infer<typeof insertWalletSchema>;
export type Wallet = typeof walletsTable.$inferSelect;
