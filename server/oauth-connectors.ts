import { and, eq } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { integrationOAuthStates, integrations } from "../drizzle/schema";
import { decryptSecret, encryptSecret } from "./secretBox";

export type OAuthConnector = "x" | "tiktok" | "meta";
export type MetaProduct = "whatsapp" | "instagram" | "facebook";

type OAuthConfig = {
  authorize: string;
  token: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  scopes: string[];
  pkce: boolean;
};

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} não configurado`);
  return value;
}

function optionalEnv(name: string, fallback: string) { return process.env[name] || fallback; }
function challenge(verifier: string) { return createHash("sha256").update(verifier).digest("base64url"); }

function configFor(provider: OAuthConnector, metaProduct?: MetaProduct): OAuthConfig {
  if (provider === "x") return {
    authorize: "https://x.com/i/oauth2/authorize",
    token: "https://api.x.com/2/oauth2/token",
    clientIdEnv: "X_CLIENT_ID",
    clientSecretEnv: "X_CLIENT_SECRET",
    scopes: (process.env.X_OAUTH_SCOPES || "tweet.read users.read offline.access").split(/\s+/).filter(Boolean),
    pkce: true,
  };
  if (provider === "tiktok") return {
    authorize: "https://www.tiktok.com/v2/auth/authorize/",
    token: "https://open.tiktokapis.com/v2/oauth/token/",
    clientIdEnv: "TIKTOK_CLIENT_KEY",
    clientSecretEnv: "TIKTOK_CLIENT_SECRET",
    scopes: (process.env.TIKTOK_OAUTH_SCOPES || "user.info.basic video.list").split(/\s+/).filter(Boolean),
    pkce: false,
  };
  const scopesByProduct: Record<MetaProduct, string[]> = {
    whatsapp: (process.env.META_WHATSAPP_SCOPES || "whatsapp_business_management whatsapp_business_messaging").split(/\s+/),
    instagram: (process.env.META_INSTAGRAM_SCOPES || "instagram_basic instagram_content_publish pages_show_list pages_read_engagement").split(/\s+/),
    facebook: (process.env.META_FACEBOOK_SCOPES || "pages_show_list pages_read_engagement pages_manage_posts").split(/\s+/),
  };
  const version = optionalEnv("META_GRAPH_VERSION", "v23.0");
  return {
    authorize: `https://www.facebook.com/${version}/dialog/oauth`,
    token: `https://graph.facebook.com/${version}/oauth/access_token`,
    clientIdEnv: "META_APP_ID",
    clientSecretEnv: "META_APP_SECRET",
    scopes: scopesByProduct[metaProduct || "facebook"].filter(Boolean),
    pkce: false,
  };
}

function providerKey(provider: OAuthConnector, product?: MetaProduct) { return product ? `${provider}:${product}` : provider; }

export async function createConnectorOAuthUrl(
  db: MySql2Database<any>, userId: number, provider: OAuthConnector, metaProduct?: MetaProduct,
) {
  if (provider === "meta" && !metaProduct) throw new Error("Produto Meta obrigatório");
  const cfg = configFor(provider, metaProduct);
  const clientId = requiredEnv(cfg.clientIdEnv);
  const redirectUri = requiredEnv(provider === "meta" ? "META_OAUTH_REDIRECT_URI" : `${provider.toUpperCase()}_OAUTH_REDIRECT_URI`);
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const key = providerKey(provider, metaProduct);
  await db.insert(integrationOAuthStates).values({
    userId, provider: key, state, codeVerifier: verifier, redirectUri,
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });
  const url = new URL(cfg.authorize);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", cfg.scopes.join(" "));
  url.searchParams.set("state", state);
  if (provider === "x") {
    url.searchParams.set("code_challenge", challenge(verifier));
    url.searchParams.set("code_challenge_method", "S256");
  }
  if (provider === "tiktok") url.searchParams.set("client_key", clientId);
  return url.toString();
}

async function exchange(cfg: OAuthConfig, provider: OAuthConnector, pending: any, code: string) {
  const clientId = requiredEnv(cfg.clientIdEnv);
  const clientSecret = requiredEnv(cfg.clientSecretEnv);
  const body: Record<string, string> = {
    code, client_id: clientId, client_secret: clientSecret,
    redirect_uri: pending.redirectUri, grant_type: "authorization_code",
  };
  if (provider === "x") body.code_verifier = pending.codeVerifier;
  if (provider === "tiktok") {
    delete body.client_id;
    body.client_key = clientId;
  }
  const response = await fetch(cfg.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body), signal: AbortSignal.timeout(12_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`${provider} OAuth falhou (${response.status})`);
  let token: any;
  try { token = JSON.parse(raw); } catch { throw new Error(`${provider} retornou token inválido`); }
  const accessToken = token.access_token || token.data?.access_token;
  if (!accessToken) throw new Error(`${provider} não retornou access_token`);
  return {
    accessToken,
    refreshToken: token.refresh_token || token.data?.refresh_token,
    expiresAt: Date.now() + Number(token.expires_in || token.data?.expires_in || 3600) * 1000,
    refreshExpiresAt: token.refresh_expires_in ? Date.now() + Number(token.refresh_expires_in) * 1000 : undefined,
    tokenType: token.token_type || "Bearer",
    scope: token.scope || token.data?.scope,
    providerAccountId: token.open_id || token.data?.open_id,
  };
}

function capabilitiesFor(key: string) {
  if (key === "x") return ["external:read", "communication:send"];
  if (key === "tiktok") return ["external:read", "communication:send"];
  if (key === "meta:whatsapp") return ["external:read", "communication:send"];
  return ["external:read", "communication:send"];
}

export async function finishConnectorOAuth(db: MySql2Database<any>, state: string, code: string) {
  const rows = await db.select().from(integrationOAuthStates).where(eq(integrationOAuthStates.state, state)).limit(1);
  const pending = rows[0];
  if (!pending || pending.expiresAt.getTime() < Date.now()) throw new Error("Estado OAuth inválido ou expirado");
  if (!pending.provider.startsWith("x") && !pending.provider.startsWith("tiktok") && !pending.provider.startsWith("meta:")) throw new Error("Provedor OAuth inválido");
  const [provider, metaProduct] = pending.provider.split(":") as [OAuthConnector, MetaProduct | undefined];
  const cfg = configFor(provider, metaProduct);
  const token = await exchange(cfg, provider, pending, code);
  const capabilities = capabilitiesFor(pending.provider);
  const encryptedConfig = encryptSecret(JSON.stringify({ ...token, metaProduct }));
  await db.delete(integrations).where(and(eq(integrations.userId, pending.userId), eq(integrations.provider, pending.provider)));
  await db.insert(integrations).values({
    userId: pending.userId, provider: pending.provider, label: metaProduct ? `Meta ${metaProduct}` : provider === "x" ? "X" : "TikTok",
    status: "active", encryptedConfig, capabilities: JSON.stringify(capabilities),
  });
  await db.delete(integrationOAuthStates).where(and(eq(integrationOAuthStates.id, pending.id), eq(integrationOAuthStates.state, state)));
  return { userId: pending.userId, provider: pending.provider };
}

export async function getConnectorAccessToken(db: MySql2Database<any>, userId: number, provider: string) {
  const rows = await db.select().from(integrations).where(and(eq(integrations.userId, userId), eq(integrations.provider, provider), eq(integrations.status, "active"))).limit(1);
  const row = rows[0]; if (!row) throw new Error(`Integração ${provider} não conectada`);
  const cfg = JSON.parse(decryptSecret(row.encryptedConfig)) as { accessToken: string; refreshToken?: string; expiresAt?: number; metaProduct?: MetaProduct };
  if (!cfg.expiresAt || cfg.expiresAt > Date.now() + 60_000) return { token: cfg.accessToken, config: cfg, row };
  if (!cfg.refreshToken) throw new Error(`Token ${provider} expirado; reconecte a integração`);
  const [base] = provider.split(":");
  const oauthProvider = base as OAuthConnector;
  const product = provider.startsWith("meta:") ? provider.split(":")[1] as MetaProduct : undefined;
  const oauth = configFor(oauthProvider, product);
  const body = new URLSearchParams({
    ...(oauthProvider === "tiktok" ? { client_key: requiredEnv(oauth.clientIdEnv) } : { client_id: requiredEnv(oauth.clientIdEnv) }),
    client_secret: requiredEnv(oauth.clientSecretEnv), refresh_token: cfg.refreshToken, grant_type: "refresh_token",
  });
  const response = await fetch(oauth.token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Não foi possível renovar o token ${provider}`);
  const next = await response.json() as { access_token?: string; expires_in?: number };
  if (!next.access_token) throw new Error(`Renovação do token ${provider} inválida`);
  const updated = encryptSecret(JSON.stringify({ ...cfg, accessToken: next.access_token, expiresAt: Date.now() + Number(next.expires_in || 3600) * 1000 }));
  await db.update(integrations).set({ encryptedConfig: updated, lastUsedAt: new Date() }).where(and(eq(integrations.id, row.id), eq(integrations.userId, userId)));
  return { token: next.access_token, config: { ...cfg, accessToken: next.access_token }, row };
}
