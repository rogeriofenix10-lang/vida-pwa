import type { MySql2Database } from "drizzle-orm/mysql2";
import type { IntegrationCapability } from "./integration-manager";

export type ConnectorAuth = "oauth2" | "api_key" | "webhook" | "none";
export type ConnectorCategory = "communication" | "social" | "navigation" | "travel" | "google" | "productivity" | "commerce" | "other";

export type ConnectorContext = { db: MySql2Database<any>; userId: number };

export type ConnectorDefinition = {
  id: string;
  name: string;
  category: ConnectorCategory;
  auth: ConnectorAuth;
  capabilities: IntegrationCapability[];
  official: boolean;
  enabledByDefault?: boolean;
  description: string;
  supports: string[];
};

export type ConnectorAdapter = ConnectorDefinition & {
  connect?: (ctx: ConnectorContext, config: unknown) => Promise<unknown>;
  disconnect?: (ctx: ConnectorContext) => Promise<void>;
  execute?: (ctx: ConnectorContext, action: string, input: unknown) => Promise<unknown>;
};
