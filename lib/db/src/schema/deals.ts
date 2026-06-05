import { pgTable, serial, bigint, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dealsTable = pgTable("deals", {
  id: serial("id").primaryKey(),
  dealCode: text("deal_code").notNull().unique(),
  sellerTelegramId: bigint("seller_telegram_id", { mode: "number" }).notNull(),
  buyerTelegramId: bigint("buyer_telegram_id", { mode: "number" }),
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 18, scale: 8 }).notNull(),
  currency: text("currency").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertDealSchema = createInsertSchema(dealsTable).omit({ id: true });
export type InsertDeal = z.infer<typeof insertDealSchema>;
export type Deal = typeof dealsTable.$inferSelect;
