import { pgTable, bigint, text, timestamp } from "drizzle-orm/pg-core";

export const adminsTable = pgTable("admins", {
  telegramId: bigint("telegram_id", { mode: "number" }).primaryKey(),
  role: text("role").notNull().default("admin"),
  addedByTelegramId: bigint("added_by_telegram_id", { mode: "number" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Admin = typeof adminsTable.$inferSelect;
