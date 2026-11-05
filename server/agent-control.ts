import { and, eq, sql } from "drizzle-orm";
import { agentControlSettings, agentEvents, agentUsageDaily } from "../drizzle/schema";
import { randomUUID } from "node:crypto";
import type { MySql2Database } from "drizzle-orm/mysql2";

export async function getControlSettings(db: MySql2Database<any>, userId: number) {
  const rows = await db.select().from(agentControlSettings).where(eq(agentControlSettings.userId, userId)).limit(1);
  return rows[0] ?? { killSwitch: false, dailyRunLimit: 100, dailyHighRiskLimit: 10, maxWorkflowRuntimeSeconds: 120 };
}
export async function assertAgentMayRun(db: MySql2Database<any>, userId: number, highRisk = false) {
  const settings = await getControlSettings(db, userId);
  if (settings.killSwitch) throw new Error("IRIS está temporariamente bloqueada pelo kill switch");
  const date = new Date().toISOString().slice(0, 10);

  // Atomic quota reservation: the conditional UPDATE prevents concurrent requests
  // from both observing the same remaining quota.
  const updated = await db.update(agentUsageDaily).set({
    runs: sql`${agentUsageDaily.runs} + 1`,
    highRiskRuns: sql`${agentUsageDaily.highRiskRuns} + ${highRisk ? 1 : 0}`,
  }).where(and(
    eq(agentUsageDaily.userId, userId),
    eq(agentUsageDaily.usageDate, date),
    sql`${agentUsageDaily.runs} < ${settings.dailyRunLimit}`,
    highRisk ? sql`${agentUsageDaily.highRiskRuns} < ${settings.dailyHighRiskLimit}` : sql`1=1`,
  ));
  if (((updated as any).rowsAffected ?? 0) > 0) return;

  // No row yet: insert the first reservation. A concurrent insert can win the
  // race; in that case retry the atomic UPDATE once.
  try {
    await db.insert(agentUsageDaily).values({ userId, usageDate: date, runs: 1, highRiskRuns: highRisk ? 1 : 0 });
    return;
  } catch {
    const retry = await db.update(agentUsageDaily).set({
      runs: sql`${agentUsageDaily.runs} + 1`,
      highRiskRuns: sql`${agentUsageDaily.highRiskRuns} + ${highRisk ? 1 : 0}`,
    }).where(and(
      eq(agentUsageDaily.userId, userId),
      eq(agentUsageDaily.usageDate, date),
      sql`${agentUsageDaily.runs} < ${settings.dailyRunLimit}`,
      highRisk ? sql`${agentUsageDaily.highRiskRuns} < ${settings.dailyHighRiskLimit}` : sql`1=1`,
    ));
    if (((retry as any).rowsAffected ?? 0) > 0) return;
  }
  if (highRisk) throw new Error("Limite diário de ações de alto risco atingido");
  throw new Error("Limite diário de execuções atingido");
}

export async function recordAgentEvent(db: MySql2Database<any>, userId: number, eventType: string, metadata?: unknown, severity: "info"|"warning"|"error"|"critical" = "info", correlationId = randomUUID()) {
  await db.insert(agentEvents).values({ userId, eventType, severity, correlationId, metadata: metadata === undefined ? null : JSON.stringify(metadata) });
  return correlationId;
}
