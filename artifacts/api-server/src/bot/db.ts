import { eq, and, or, desc, count, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable,
  walletsTable,
  walletTransactionsTable,
  dealsTable,
  type User,
  type Wallet,
  type Deal,
} from "@workspace/db";

export async function upsertUser(telegramId: number, data: {
  username?: string;
  firstName?: string;
  lastName?: string;
}): Promise<User> {
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.telegramId, telegramId))
    .limit(1);

  if (existing.length > 0) {
    const [updated] = await db
      .update(usersTable)
      .set({ username: data.username, firstName: data.firstName, lastName: data.lastName })
      .where(eq(usersTable.telegramId, telegramId))
      .returning();
    return updated!;
  }

  const [created] = await db
    .insert(usersTable)
    .values({ telegramId, ...data })
    .returning();

  await db
    .insert(walletsTable)
    .values({ telegramId })
    .onConflictDoNothing();

  return created!;
}

export async function getWallet(telegramId: number): Promise<Wallet> {
  const existing = await db
    .select()
    .from(walletsTable)
    .where(eq(walletsTable.telegramId, telegramId))
    .limit(1);

  if (existing.length > 0) return existing[0]!;

  const [created] = await db
    .insert(walletsTable)
    .values({ telegramId })
    .returning();
  return created!;
}

export async function createDeal(data: {
  dealCode: string;
  sellerTelegramId: number;
  buyerTelegramId?: number;
  description: string;
  amount: string;
  currency: string;
}): Promise<Deal> {
  const [deal] = await db
    .insert(dealsTable)
    .values({ ...data, status: "pending" })
    .returning();
  return deal!;
}

export async function getDealByCode(code: string): Promise<Deal | null> {
  const [deal] = await db
    .select()
    .from(dealsTable)
    .where(eq(dealsTable.dealCode, code))
    .limit(1);
  return deal ?? null;
}

export async function updateDealStatus(code: string, status: string, buyerTelegramId?: number): Promise<Deal | null> {
  const updateData: Partial<typeof dealsTable.$inferInsert> = {
    status,
    updatedAt: new Date(),
  };
  if (status === "completed") updateData.completedAt = new Date();
  if (buyerTelegramId) updateData.buyerTelegramId = buyerTelegramId;

  const [deal] = await db
    .update(dealsTable)
    .set(updateData)
    .where(eq(dealsTable.dealCode, code))
    .returning();
  return deal ?? null;
}

export async function getUserDeals(telegramId: number): Promise<Deal[]> {
  return db
    .select()
    .from(dealsTable)
    .where(
      or(
        eq(dealsTable.sellerTelegramId, telegramId),
        eq(dealsTable.buyerTelegramId, telegramId)
      )
    )
    .orderBy(desc(dealsTable.createdAt));
}

export async function getUserStats(telegramId: number) {
  const allDeals = await db
    .select()
    .from(dealsTable)
    .where(
      or(
        eq(dealsTable.sellerTelegramId, telegramId),
        eq(dealsTable.buyerTelegramId, telegramId)
      )
    );

  const total = allDeals.length;
  const completed = allDeals.filter((d) => d.status === "completed").length;
  const active = allDeals.filter((d) => d.status === "pending" || d.status === "active").length;
  const cancelled = allDeals.filter((d) => d.status === "cancelled").length;

  return { total, completed, active, cancelled };
}

export async function getWalletHistory(telegramId: number) {
  return db
    .select()
    .from(walletTransactionsTable)
    .where(eq(walletTransactionsTable.telegramId, telegramId))
    .orderBy(desc(walletTransactionsTable.createdAt))
    .limit(10);
}
