import { and, eq } from "drizzle-orm";
import { randomBytes, createHash } from "node:crypto";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { integrations, integrationOAuthStates } from "../drizzle/schema";
import { acquireOAuthRefreshLock, releaseOAuthRefreshLock, waitForOAuthRefresh } from "./oauth-refresh-lock";
import { encryptSecret, decryptSecret } from "./secretBox";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPES = {
  calendar: ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly"],
  drive: ["https://www.googleapis.com/auth/drive.readonly"],
  gmail: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"],
} as const;

function env(name: string) { const value = process.env[name]; if (!value) throw new Error(`${name} não configurado`); return value; }
function pkceChallenge(verifier: string) { return createHash("sha256").update(verifier).digest("base64url"); }

export async function createGoogleOAuthUrl(db: MySql2Database<any>, userId: number, product: keyof typeof GOOGLE_SCOPES) {
  const clientId = env("GOOGLE_CLIENT_ID");
  const redirectUri = env("GOOGLE_OAUTH_REDIRECT_URI");
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  await db.insert(integrationOAuthStates).values({ userId, provider: `google:${product}`, state, codeVerifier: verifier, redirectUri, expiresAt: new Date(Date.now() + 10 * 60_000) });
  const url = new URL(GOOGLE_AUTH);
  url.searchParams.set("client_id", clientId); url.searchParams.set("redirect_uri", redirectUri); url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES[product].join(" ")); url.searchParams.set("access_type", "offline"); url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state); url.searchParams.set("code_challenge", pkceChallenge(verifier)); url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function finishGoogleOAuth(db: MySql2Database<any>, state: string, code: string) {
  const rows = await db.select().from(integrationOAuthStates).where(eq(integrationOAuthStates.state, state)).limit(1);
  const pending = rows[0];
  if (!pending || pending.expiresAt.getTime() < Date.now()) throw new Error("Estado OAuth inválido ou expirado");
  const product = pending.provider.split(":")[1] as keyof typeof GOOGLE_SCOPES;
  const clientId = env("GOOGLE_CLIENT_ID"); const clientSecret = env("GOOGLE_CLIENT_SECRET");
  const response = await fetch(GOOGLE_TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: pending.redirectUri, grant_type: "authorization_code", code_verifier: pending.codeVerifier }), signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`OAuth Google falhou (${response.status})`);
  const token = await response.json() as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string; token_type?: string };
  if (!token.access_token) throw new Error("Google não retornou access_token");
  const config = encryptSecret(JSON.stringify({ accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000, scope: token.scope }));
  const capabilities = product === "calendar" ? ["calendar:read", "calendar:write"] : product === "gmail" ? ["communication:send", "external:read"] : ["external:read"];
  await db.delete(integrations).where(and(eq(integrations.userId, pending.userId), eq(integrations.provider, `google:${product}`)));
  await db.insert(integrations).values({ userId: pending.userId, provider: `google:${product}`, label: `Google ${product}`, status: "active", encryptedConfig: config, capabilities: JSON.stringify(capabilities) });
  await db.delete(integrationOAuthStates).where(eq(integrationOAuthStates.id, pending.id));
  return { userId: pending.userId, provider: `google:${product}` };
}

export async function getGoogleToken(db: MySql2Database<any>, userId: number, product: keyof typeof GOOGLE_SCOPES) {
  const rows = await db.select().from(integrations).where(and(eq(integrations.userId, userId), eq(integrations.provider, `google:${product}`), eq(integrations.status, "active"))).limit(1);
  const row = rows[0]; if (!row) throw new Error(`Google ${product} não conectado`);
  const cfg = JSON.parse(decryptSecret(row.encryptedConfig)) as { accessToken: string; refreshToken?: string; expiresAt: number };
  if (cfg.expiresAt > Date.now() + 60_000) return cfg.accessToken;
  if (!cfg.refreshToken) throw new Error("Token Google expirado; reconecte a integração");
  const lockProvider = `google:${product}`;
  const acquired = await acquireOAuthRefreshLock(db, userId, lockProvider);
  if (!acquired) {
    await waitForOAuthRefresh(db, userId, lockProvider);
    const freshRows = await db.select().from(integrations).where(and(eq(integrations.userId, userId), eq(integrations.provider, lockProvider), eq(integrations.status, "active"))).limit(1);
    if (freshRows[0]) {
      const fresh = JSON.parse(decryptSecret(freshRows[0].encryptedConfig)) as { accessToken: string; expiresAt: number };
      if (fresh.expiresAt > Date.now() + 60_000) return fresh.accessToken;
    }
    throw new Error("Renovação OAuth concorrente não concluída a tempo");
  }
  try {
    const response = await fetch(GOOGLE_TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"), refresh_token: cfg.refreshToken, grant_type: "refresh_token" }), signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`Não foi possível renovar o token Google (${response.status})`);
    const next = await response.json() as { access_token: string; expires_in?: number };
    if (!next.access_token) throw new Error("Google não retornou access_token na renovação");
    const updated = encryptSecret(JSON.stringify({ ...cfg, accessToken: next.access_token, expiresAt: Date.now() + (next.expires_in ?? 3600) * 1000 }));
    await db.update(integrations).set({ encryptedConfig: updated, lastUsedAt: new Date() }).where(and(eq(integrations.id, row.id), eq(integrations.userId, userId)));
    return next.access_token;
  } finally {
    await releaseOAuthRefreshLock(db, userId, lockProvider);
  }
}
