import { and, eq } from "drizzle-orm";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { integrations } from "../drizzle/schema";
import { decryptSecret, encryptSecret } from "./secretBox";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { getConnector } from "./connector-registry";

export type IntegrationCapability = "calendar:read" | "calendar:write" | "communication:send" | "external:read" | "external:write";
export type IntegrationConfig = { endpoint: string; token?: string; headers?: Record<string, string> };

function isPrivateAddress(address: string) {
  const ip = isIP(address);
  return (ip === 4 && (/^10\./.test(address) || /^192\.168\./.test(address) || /^(172\.1[6-9]|172\.2[0-9]|172\.3[0-1])\./.test(address) || /^169\.254\./.test(address) || /^127\./.test(address)))
    || (ip === 6 && (address === "::1" || address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:") || address.startsWith("::ffff:127.")));
}

async function validateEndpoint(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("Integrações externas exigem HTTPS");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Endpoint externo inválido");
  if (isPrivateAddress(host)) throw new Error("Endpoint externo inválido");
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("Endpoint externo inválido");
  return url.toString();
}

function safeHeaders(headers: Record<string, string> | undefined) {
  if (!headers) return {};
  const allowed = new Set(["accept", "content-type", "authorization"]);
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (!(allowed.has(lower) || lower.startsWith("x-"))) throw new Error(`Header não permitido: ${name}`);
    if (!/^[\x20-\x7e]{0,2000}$/.test(value)) throw new Error(`Valor de header inválido: ${name}`);
    out[name] = value;
  }
  return out;
}

export async function connectIntegration(db: MySql2Database<any>, userId: number, input: { provider: string; label: string; capabilities: IntegrationCapability[]; config: IntegrationConfig }) {
  const connector = getConnector(input.provider);
  if (connector && input.capabilities.some((cap) => !connector.capabilities.includes(cap))) throw new Error(`O conector ${input.provider} não suporta uma das permissões solicitadas`);
  const config = { ...input.config, endpoint: await validateEndpoint(input.config.endpoint), headers: safeHeaders(input.config.headers) };
  const encryptedConfig = encryptSecret(JSON.stringify(config));
  await db.delete(integrations).where(and(eq(integrations.userId, userId), eq(integrations.provider, input.provider)));
  const inserted = await db.insert(integrations).values({ userId, provider: input.provider, label: input.label, capabilities: JSON.stringify(input.capabilities), encryptedConfig, status: "active" });
  return { id: Number(inserted[0].insertId), provider: input.provider, status: "active" as const };
}

export async function listUserIntegrations(db: MySql2Database<any>, userId: number) {
  const rows = await db.select({ id: integrations.id, provider: integrations.provider, label: integrations.label, status: integrations.status, capabilities: integrations.capabilities, lastUsedAt: integrations.lastUsedAt, createdAt: integrations.createdAt }).from(integrations).where(eq(integrations.userId, userId));
  return rows.map(row => ({ ...row, capabilities: safeJson(row.capabilities, []) }));
}

function safeJson(value: string, fallback: unknown) { try { return JSON.parse(value); } catch { return fallback; } }

export async function getIntegration(db: MySql2Database<any>, userId: number, provider: string, capability: IntegrationCapability) {
  const rows = await db.select().from(integrations).where(and(eq(integrations.userId, userId), eq(integrations.provider, provider), eq(integrations.status, "active"))).limit(1);
  const row = rows[0];
  if (!row) throw new Error(`Integração ${provider} não configurada`);
  const capabilities = safeJson(row.capabilities, []) as string[];
  if (!capabilities.includes(capability)) throw new Error(`A integração ${provider} não possui a permissão ${capability}`);
  return { row, config: JSON.parse(decryptSecret(row.encryptedConfig)) as IntegrationConfig };
}

export async function postIntegration(db: MySql2Database<any>, userId: number, provider: string, capability: IntegrationCapability, payload: unknown) {
  const { row, config } = await getIntegration(db, userId, provider, capability);
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}), ...(config.headers ?? {}) },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    await db.update(integrations).set({ status: "error" }).where(and(eq(integrations.id, row.id), eq(integrations.userId, userId)));
    throw new Error(`Integração ${provider} respondeu com HTTP ${response.status}`);
  }
  await db.update(integrations).set({ lastUsedAt: new Date(), status: "active" }).where(and(eq(integrations.id, row.id), eq(integrations.userId, userId)));
  let data: unknown = null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) data = await response.json();
  return { provider, status: response.status, data };
}
