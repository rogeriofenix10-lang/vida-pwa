import type { IntegrationCapability } from "./integration-manager";

export type PermissionMode = "analyze" | "modify" | "send" | "delete" | "share" | "organize";

export type IntegrationPermissionPolicy = {
  analyze: boolean;
  suggest: boolean;
  modify: boolean;
  send: boolean;
  delete: boolean;
  share: boolean;
  organize: boolean;
};

/**
 * IRIS safety baseline. Reading is allowed only after the user explicitly
 * connects a provider. Every state-changing operation remains approval-only.
 * There is intentionally no "always allow" mode in this baseline.
 */
export const DEFAULT_INTEGRATION_PERMISSION_POLICY: IntegrationPermissionPolicy = {
  analyze: true,
  suggest: true,
  modify: false,
  send: false,
  delete: false,
  share: false,
  organize: false,
};

export function permissionModeForAction(action: string, capability: IntegrationCapability): PermissionMode {
  const normalized = action.toLowerCase();
  if (/(delete|remove|trash|destroy|archive)/.test(normalized)) return "delete";
  if (/(share|permission|invite)/.test(normalized)) return "share";
  if (/(^|[._-])(send|publish|post|reply|message)([._-]|$)/.test(normalized) || capability === "communication:send") return "send";
  if (/(move|organize|rename|label|classify|folder)/.test(normalized)) return "organize";
  if (capability === "calendar:write" || capability === "external:write") return "modify";
  return "analyze";
}

export function isReadOnlyAction(action: string, capability: IntegrationCapability) {
  return permissionModeForAction(action, capability) === "analyze";
}

export function assertIntegrationPermission(
  action: string,
  capability: IntegrationCapability,
  opts: { connected: boolean; approvalGranted: boolean },
) {
  if (!opts.connected) throw new Error("INTEGRATION_NOT_CONNECTED");
  const mode = permissionModeForAction(action, capability);
  if (mode === "analyze") return;
  if (!opts.approvalGranted) throw new Error(`APPROVAL_REQUIRED:${mode}:${action}`);
}

export function connectorPermissionSummary() {
  return {
    ...DEFAULT_INTEGRATION_PERMISSION_POLICY,
    rule: "Analisar/sugerir somente quando solicitado; executar alterações somente após aprovação explícita.",
    criticalActionsAlwaysRequireApproval: true,
  } as const;
}
