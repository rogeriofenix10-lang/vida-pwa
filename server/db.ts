import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, sessions, storageFiles } from "../drizzle/schema";
import { ENV } from './_core/env';
import type { MySql2Database } from "drizzle-orm/mysql2";
import { createCloudSqlPool } from "./cloud-sql";

let _db: any = null;
let _cloudSqlClose: (() => void) | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb(): Promise<MySql2Database<any> | null> {
  if (!_db) {
    try {
      const cloud = await createCloudSqlPool();
      if (cloud) {
        _db = drizzle(cloud.pool as any);
        _cloudSqlClose = cloud.close;
      } else if (process.env.DATABASE_URL) {
        _db = drizzle(process.env.DATABASE_URL);
      }
    } catch (error) {
      console.warn("[Database] Failed to initialize:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// TODO: add feature queries here as your schema grows.

export async function createSessionRecord(input: {
  userId: number;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string | null;
  ipAddress?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível");
  await db.insert(sessions).values(input);
}

export async function isSessionActive(tokenHash: string) {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ id: sessions.id, expiresAt: sessions.expiresAt, revokedAt: sessions.revokedAt })
    .from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1);
  const row = rows[0];
  return !!row && !row.revokedAt && row.expiresAt.getTime() > Date.now();
}

export async function touchSession(tokenHash: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(sessions).set({ lastUsedAt: new Date() }).where(eq(sessions.tokenHash, tokenHash));
}

export async function revokeSession(tokenHash: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, tokenHash));
}

export async function registerStorageFile(input: {
  userId: number;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível");
  await db.insert(storageFiles).values(input);
}

export async function getStorageFileOwner(storageKey: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({ userId: storageFiles.userId }).from(storageFiles).where(eq(storageFiles.storageKey, storageKey)).limit(1);
  return rows[0] ?? null;
}
