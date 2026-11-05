import { sql } from "drizzle-orm";

/** DB-backed single-flight lock. The unique (userId, provider) key prevents refresh stampedes. */
export async function acquireOAuthRefreshLock(db: any, userId: number, provider: string, leaseMs = 15_000) {
  const until = new Date(Date.now() + leaseMs);
  try {
    const result: any = await db.execute(sql`
      INSERT INTO oauthRefreshLocks (userId, provider, lockedUntil)
      VALUES (${userId}, ${provider}, ${until})
      ON DUPLICATE KEY UPDATE
        lockedUntil = IF(lockedUntil < NOW(), VALUES(lockedUntil), lockedUntil)
    `);
    const affected = result?.[0]?.affectedRows ?? result?.affectedRows;
    if (affected === 1 || affected === 2) return true;
    const rows: any = await db.execute(sql`
      SELECT lockedUntil FROM oauthRefreshLocks
      WHERE userId = ${userId} AND provider = ${provider}
      LIMIT 1
    `);
    return !!rows?.[0]?.[0] && new Date(rows[0][0].lockedUntil).getTime() <= Date.now() + 5;
  } catch (error) {
    console.warn("[OAuthLock] acquire failed", error);
    return false;
  }
}

export async function releaseOAuthRefreshLock(db: any, userId: number, provider: string) {
  await db.execute(sql`
    DELETE FROM oauthRefreshLocks WHERE userId = ${userId} AND provider = ${provider}
  `);
}

export async function waitForOAuthRefresh(db: any, userId: number, provider: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows: any = await db.execute(sql`
      SELECT lockedUntil FROM oauthRefreshLocks
      WHERE userId = ${userId} AND provider = ${provider}
      LIMIT 1
    `);
    if (!rows?.[0]?.[0] || new Date(rows[0][0].lockedUntil).getTime() <= Date.now()) return;
    await new Promise(r => setTimeout(r, 150));
  }
}
