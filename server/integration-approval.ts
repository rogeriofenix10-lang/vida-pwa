import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { integrationActionApprovals, integrationActionAudits } from "../drizzle/schema";
import { assertIntegrationPermission, isReadOnlyAction } from "./integration-permissions";
import type { IntegrationCapability } from "./integration-manager";

export function hashApprovalPayload(input: unknown) {
  return createHash("sha256").update(JSON.stringify(input ?? null)).digest("hex");
}

export async function requestIntegrationApproval(
  db: MySql2Database<any>, userId: number, provider: string, action: string, capability: IntegrationCapability, input: unknown,
) {
  if (isReadOnlyAction(action, capability)) return { required: false as const };
  const payloadHash = hashApprovalPayload(input);
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  const inserted = await db.insert(integrationActionApprovals).values({ userId, provider, action, capability, payloadHash, status: "pending", expiresAt });
  const id = Number(inserted[0].insertId);
  await db.insert(integrationActionAudits).values({ userId, provider, action, capability, status: "requested", metadata: JSON.stringify({ approvalId: id, payloadHash }) });
  return { required: true as const, approvalId: id, expiresAt };
}

export async function consumeIntegrationApproval(
  db: MySql2Database<any>, userId: number, approvalId: number, provider: string, action: string, capability: IntegrationCapability, input: unknown,
) {
  const rows = await db.select().from(integrationActionApprovals).where(and(eq(integrationActionApprovals.id, approvalId), eq(integrationActionApprovals.userId, userId))).limit(1);
  const approval = rows[0];
  if (!approval) throw new Error("APPROVAL_NOT_FOUND");
  if (approval.provider !== provider || approval.action !== action || approval.capability !== capability) throw new Error("APPROVAL_MISMATCH");
  if (approval.payloadHash !== hashApprovalPayload(input)) throw new Error("APPROVAL_PAYLOAD_MISMATCH");
  if (approval.expiresAt.getTime() <= Date.now()) {
    await db.update(integrationActionApprovals).set({ status: "expired" }).where(and(eq(integrationActionApprovals.id, approvalId), eq(integrationActionApprovals.userId, userId), eq(integrationActionApprovals.status, "pending")));
    throw new Error("APPROVAL_EXPIRED");
  }
  if (approval.status !== "approved") throw new Error("APPROVAL_NOT_GRANTED");
  const consumed = await db.update(integrationActionApprovals).set({ status: "consumed", consumedAt: new Date() }).where(and(eq(integrationActionApprovals.id, approvalId), eq(integrationActionApprovals.userId, userId), eq(integrationActionApprovals.status, "approved")));
  if ((consumed as any).rowsAffected !== undefined && (consumed as any).rowsAffected !== 1) throw new Error("APPROVAL_REPLAY");
  assertIntegrationPermission(action, capability, { connected: true, approvalGranted: true });
  return approval;
}
