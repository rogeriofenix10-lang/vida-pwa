import type { ConnectorContext } from "./connector-types";
import { getConnector } from "./connector-registry";
import { getIntegration, postIntegration, type IntegrationCapability } from "./integration-manager";
import type { ConnectorRuntime } from "./connector-contract";
import { actionAllowed } from "./connector-contract";
import { executeWithRuntime, type ConnectorResult } from "./integration-runtime";
import { integrationActionAudits } from "../drizzle/schema";
import { consumeIntegrationApproval } from "./integration-approval";
import { isReadOnlyAction } from "./integration-permissions";

export async function executeConnectorAction(
  ctx: ConnectorContext,
  provider: string,
  action: string,
  capability: IntegrationCapability,
  input: unknown,
  approvalId?: number,
) {
  const connector = getConnector(provider) as ConnectorRuntime | undefined;
  if (!connector) throw new Error(`Conector ${provider} não encontrado`);
  if (!actionAllowed(connector, action, capability)) throw new Error(`Ação ${action} não é permitida para ${provider} com ${capability}`);
  const definition = connector.actions?.find((item) => item.name === action);
  if (!definition) throw new Error(`Ação ${action} não registrada para ${provider}`);
  // Read-only operations are permitted only through an already connected integration.
  // Any state-changing operation must carry a one-time, server-side approval.
  const readOnly = isReadOnlyAction(action, capability);
  if (!readOnly) {
    if (!approvalId) throw new Error(`APPROVAL_REQUIRED:${provider}:${action}`);
    await consumeIntegrationApproval(ctx.db, ctx.userId, approvalId, provider, action, capability, input);
  } else {
    await getIntegration(ctx.db, ctx.userId, provider, capability);
  }

  const idempotencyKey = typeof (input as any)?.idempotencyKey === "string" ? (input as any).idempotencyKey : undefined;
  const audit = async (status: "requested" | "confirmed" | "succeeded" | "failed" | "replayed", extra: Record<string, unknown> = {}) => {
    try {
      await ctx.db.insert(integrationActionAudits).values({
        userId: ctx.userId, provider, action, capability, status,
        requestId: typeof extra.requestId === "string" ? extra.requestId : undefined,
        correlationId: typeof (input as any)?.correlationId === "string" ? (input as any).correlationId : undefined,
        idempotencyKey, errorCode: typeof extra.errorCode === "string" ? extra.errorCode.slice(0, 80) : undefined,
        metadata: JSON.stringify({ approvalId: approvalId ?? null, ...extra }),
      });
    } catch (error) {
      console.warn("[IntegrationAudit] failed", error);
    }
  };
  await audit(readOnly ? "requested" : "confirmed", { approvalId: approvalId ?? null });
  const runtime = await executeWithRuntime({
    provider,
    action,
    idempotencyKey,
    execute: async () => {
      if (connector.execute) return connector.execute(ctx, action, input);
      // Generic connector: the integration endpoint is the only execution surface.
      // The Agent Core remains unaware of provider-specific protocols.
      return postIntegration(ctx.db, ctx.userId, provider, capability, { action, input });
    },
  });
  if (!runtime.ok) {
    await audit("failed", { requestId: runtime.requestId, errorCode: runtime.error?.kind });
    throw new Error(`${runtime.error?.kind ?? "integration_error"}:${runtime.error?.message ?? "Falha no conector"}`);
  }
  await audit(runtime.replayed ? "replayed" : "succeeded", { requestId: runtime.requestId });
  return runtime as ConnectorResult;
}

export async function connectorHealth(ctx: ConnectorContext, provider: string) {
  const connector = getConnector(provider) as ConnectorRuntime | undefined;
  if (!connector) throw new Error(`Conector ${provider} não encontrado`);
  if (connector.health) return connector.health(ctx);
  const readCapability = connector.capabilities.includes("external:read") ? "external:read" : connector.capabilities.includes("calendar:read") ? "calendar:read" : connector.capabilities.includes("communication:send") ? "communication:send" : undefined;
  if (!readCapability) return { ok: true, detail: "Conector sem health remoto configurado" };
  await getIntegration(ctx.db, ctx.userId, provider, readCapability);
  return { ok: true, detail: "Conector configurado" };
}
