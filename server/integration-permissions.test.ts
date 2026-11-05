import { describe, expect, it } from "vitest";
import { assertIntegrationPermission, connectorPermissionSummary, isReadOnlyAction, permissionModeForAction } from "./integration-permissions";

describe("IRIS integration permission baseline", () => {
  it("allows analysis but keeps every mutation approval-only", () => {
    expect(isReadOnlyAction("messages.list", "external:read")).toBe(true);
    expect(permissionModeForAction("messages.send", "communication:send")).toBe("send");
    expect(permissionModeForAction("files.delete", "external:write")).toBe("delete");
    expect(permissionModeForAction("files.move", "external:write")).toBe("organize");
    expect(permissionModeForAction("files.share", "external:write")).toBe("share");
    expect(() => assertIntegrationPermission("messages.send", "communication:send", { connected: true, approvalGranted: false })).toThrow("APPROVAL_REQUIRED:send:messages.send");
  });

  it("has no global always-allow mutation switch", () => {
    const policy = connectorPermissionSummary();
    expect(policy.analyze).toBe(true);
    expect(policy.suggest).toBe(true);
    expect(policy.modify).toBe(false);
    expect(policy.send).toBe(false);
    expect(policy.delete).toBe(false);
    expect(policy.share).toBe(false);
    expect(policy.organize).toBe(false);
    expect(policy.criticalActionsAlwaysRequireApproval).toBe(true);
  });
});
