import { and, eq, lte, or, isNull } from "drizzle-orm";
import { integrationJobs } from "../drizzle/schema";
import { executeConnectorAction } from "./connector-actions";
import type { ConnectorContext } from "./connector-types";
import { createIdempotencyKey } from "./integration-runtime";
import { createPubSubRuntime } from "./pubsub-runtime";

export async function enqueueIntegrationJob(db: any, input: { userId: number; provider: string; action: string; capability: string; input: unknown; approvalId?: number; idempotencyKey?: string; correlationId?: string; maxAttempts?: number; availableAt?: Date }) {
  const idempotencyKey = input.idempotencyKey ?? createIdempotencyKey({ userId: input.userId, provider: input.provider, action: input.action, input: input.input });
  await db.insert(integrationJobs).values({ userId: input.userId, provider: input.provider, action: input.action, payload: JSON.stringify({ capability: input.capability, input: input.input, approvalId: input.approvalId }), idempotencyKey, correlationId: input.correlationId, maxAttempts: input.maxAttempts ?? 5, availableAt: input.availableAt ?? new Date() }).onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });
  if (process.env.IRIS_JOB_TOPIC) {
    try {
      const bus = await createPubSubRuntime();
      await bus?.publish(process.env.IRIS_JOB_TOPIC, { type: "integration.job.ready", idempotencyKey }, { provider: input.provider });
    } catch (error) {
      console.warn("[IntegrationQueue] Pub/Sub wake-up failed; DB polling remains authoritative", error);
    }
  }
  return { idempotencyKey };
}

export async function claimNextIntegrationJob(db: any, leaseMs = 60_000) {
  const now = new Date();
  const candidates = await db.select().from(integrationJobs).where(and(eq(integrationJobs.status, "pending"), lte(integrationJobs.availableAt, now), or(isNull(integrationJobs.lockedUntil), lte(integrationJobs.lockedUntil, now)))).orderBy(integrationJobs.availableAt).limit(1);
  const job = candidates[0];
  if (!job) return null;
  const lockedUntil = new Date(Date.now() + leaseMs);
  const updated = await db.update(integrationJobs).set({ status: "running", lockedUntil, attempts: job.attempts + 1, updatedAt: now }).where(and(eq(integrationJobs.id, job.id), eq(integrationJobs.status, "pending"), or(isNull(integrationJobs.lockedUntil), lte(integrationJobs.lockedUntil, now))));
  if ((updated as any).affectedRows !== undefined && (updated as any).affectedRows !== 1) return null;
  return { ...job, status: "running", lockedUntil, attempts: job.attempts + 1 };
}

export async function processNextIntegrationJob(db: any) {
  const job = await claimNextIntegrationJob(db);
  if (!job) return { processed: false as const };
  const parsed = JSON.parse(job.payload) as { capability: any; input: any; approvalId?: number };
  try {
    const result = await executeConnectorAction({ db, userId: job.userId } as ConnectorContext, job.provider, job.action, parsed.capability, parsed.input, parsed.approvalId);
    await db.update(integrationJobs).set({ status: "succeeded", result: JSON.stringify(result), lockedUntil: null, updatedAt: new Date() }).where(eq(integrationJobs.id, job.id));
    return { processed: true as const, success: true as const, jobId: job.id, result };
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 80) : "integration_error";
    const dead = job.attempts >= job.maxAttempts;
    await db.update(integrationJobs).set({ status: dead ? "dead" : "pending", errorCode: code, lockedUntil: null, availableAt: new Date(Date.now() + Math.min(60_000, 1000 * 2 ** Math.max(0, job.attempts - 1))), updatedAt: new Date() }).where(eq(integrationJobs.id, job.id));
    return { processed: true as const, success: false as const, jobId: job.id, errorCode: code, dead };
  }
}
