import { desc, eq } from "drizzle-orm";
import { integrationJobs, integrationEvents, integrationActionAudits } from "../drizzle/schema";
import { connectorRuntimeStatus } from "./integration-runtime";
import { listConnectors } from "./connector-registry";

export async function getIntegrationHealth(db: any, userId?: number) {
  const connectors = listConnectors().map((connector: any) => ({
    provider: connector.id,
    capabilities: connector.capabilities,
    runtime: connectorRuntimeStatus(connector.id),
  }));
  const jobRows = await db.select({ status: integrationJobs.status }).from(integrationJobs).where(userId ? eq(integrationJobs.userId, userId) : undefined);
  const eventRows = await db.select({ status: integrationEvents.status }).from(integrationEvents).where(userId ? eq(integrationEvents.userId, userId) : undefined);
  const recentAudits = await db.select().from(integrationActionAudits).where(userId ? eq(integrationActionAudits.userId, userId) : undefined).orderBy(desc(integrationActionAudits.createdAt)).limit(20);
  const count = (rows: any[]) => rows.reduce((acc, row) => { acc[row.status] = (acc[row.status] ?? 0) + 1; return acc; }, {} as Record<string, number>);
  return { status: "ok" as const, generatedAt: new Date().toISOString(), connectors, jobs: count(jobRows), events: count(eventRows), recentAudits };
}
