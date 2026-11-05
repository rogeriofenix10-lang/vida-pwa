import type { ConnectorContext, ConnectorAdapter } from "./connector-types";
import type { IntegrationCapability } from "./integration-manager";

export type ConnectorAction = {
  name: string;
  capability: IntegrationCapability;
  risk: "low" | "medium" | "high";
  confirmationRequired: boolean;
};

export type ConnectorRuntime = ConnectorAdapter & {
  actions?: ConnectorAction[];
  health?: (ctx: ConnectorContext) => Promise<{ ok: boolean; detail?: string }>;
};

export function actionAllowed(connector: ConnectorRuntime, action: string, capability: string) {
  const definition = connector.actions?.find((item) => item.name === action);
  return Boolean(definition && definition.capability === capability && connector.capabilities.includes(capability));
}
