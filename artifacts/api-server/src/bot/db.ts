import { eq, or, desc, inArray } from "drizzle-orm";
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
import { generateDealId } from "./utils.js";

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
    const fields: Partial<typeof usersTable.$inferInsert> = {};
    if (data.username !== undefined) fields.username = data.username;
    if (data.firstName !== undefined) fields.firstName = data.firstName;
    if (data.lastName !== undefined) fields.lastName = data.lastName;

    if (Object.keys(fields).length === 0) return existing[0]!;

    const [updated] = await db
      .update(usersTable)
      .set(fields)
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

export async function addToWallet(
  telegramId: number,
  currency: string,
  amount: number,
  description: string
): Promise<Wallet> {
  const wallet = await getWallet(telegramId);
  let updateData: Partial<typeof walletsTable.$inferInsert> = { updatedAt: new Date() };

  switch (currency) {
    case "UAH":
      updateData.uah = (parseFloat(wallet.uah) + amount).toFixed(4);
      break;
    case "RUB":
      updateData.rub = (parseFloat(wallet.rub) + amount).toFixed(4);
      break;
    case "TON":
      updateData.ton = (parseFloat(wallet.ton) + amount).toFixed(8);
      break;
    case "STARS":
      updateData.stars = (parseFloat(wallet.stars) + amount).toFixed(0);
      break;
  }

  const [updated] = await db
    .update(walletsTable)
    .set(updateData)
    .where(eq(walletsTable.telegramId, telegramId))
    .returning();

  await db.insert(walletTransactionsTable).values({
    telegramId,
    currency,
    amount: amount.toString(),
    type: "credit",
    description,
  });

  return updated!;
}

export async function deductFromWallet(
  telegramId: number,
  currency: string,
  amount: number,
  description: string
): Promise<{ success: boolean; wallet?: Wallet }> {
  const wallet = await getWallet(telegramId);
  let current = 0;
  let updateData: Partial<typeof walletsTable.$inferInsert> = { updatedAt: new Date() };

  switch (currency) {
    case "UAH": current = parseFloat(wallet.uah); break;
    case "RUB": current = parseFloat(wallet.rub); break;
    case "TON": current = parseFloat(wallet.ton); break;
    case "STARS": current = parseFloat(wallet.stars); break;
  }

  if (current < amount) return { success: false };

  switch (currency) {
    case "UAH": updateData.uah = (current - amount).toFixed(4); break;
    case "RUB": updateData.rub = (current - amount).toFixed(4); break;
    case "TON": updateData.ton = (current - amount).toFixed(8); break;
    case "STARS": updateData.stars = (current - amount).toFixed(0); break;
  }

  const [updated] = await db
    .update(walletsTable)
    .set(updateData)
    .where(eq(walletsTable.telegramId, telegramId))
    .returning();

  await db.insert(walletTransactionsTable).values({
    telegramId,
    currency,
    amount: (-amount).toString(),
    type: "debit",
    description,
  });

  return { success: true, wallet: updated! };
}

export async function createDeal(data: {
  sellerTelegramId: number;
  description: string;
  amount: string;
  currency: string;
}): Promise<Deal> {
  let dealId: number;
  let attempts = 0;
  while (true) {
    dealId = generateDealId();
    const existing = await db
      .select()
      .from(dealsTable)
      .where(eq(dealsTable.dealCode, dealId.toString()))
      .limit(1);
    if (existing.length === 0) break;
    if (++attempts > 10) throw new Error("Could not generate unique deal ID");
  }

  const [deal] = await db
    .insert(dealsTable)
    .values({
      dealCode: dealId!.toString(),
      sellerTelegramId: data.sellerTelegramId,
      description: data.description,
      amount: data.amount,
      currency: data.currency,
      status: "pending",
    })
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

export async function updateDealStatus(
  code: string,
  status: string,
  buyerTelegramId?: number
): Promise<Deal | null> {
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

  const asSeller = allDeals.filter((d) => d.sellerTelegramId === telegramId);
  const asBuyer = allDeals.filter((d) => d.buyerTelegramId === telegramId);

  return {
    sellerTotal: asSeller.length,
    sellerCompleted: asSeller.filter((d) => d.status === "completed").length,
    sellerActive: asSeller.filter((d) => d.status === "pending" || d.status === "active").length,
    buyerTotal: asBuyer.length,
    buyerCompleted: asBuyer.filter((d) => d.status === "completed").length,
  };
}

export async function getOpenDeals(): Promise<Deal[]> {
  return db
    .select()
    .from(dealsTable)
    .where(inArray(dealsTable.status, ["pending", "active"]))
    .orderBy(desc(dealsTable.createdAt));
}

export async function getAllDealsStats() {
  const all = await db.select().from(dealsTable);
  return {
    total: all.length,
    pending: all.filter((d) => d.status === "pending").length,
    active: all.filter((d) => d.status === "active").length,
    completed: all.filter((d) => d.status === "completed").length,
    cancelled: all.filter((d) => d.status === "cancelled").length,
  };
}

export async function getAllUsersCount(): Promise<number> {
  const users = await db.select().from(usersTable);
  return users.length;
}
