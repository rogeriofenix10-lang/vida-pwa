import { createHmac, timingSafeEqual } from "node:crypto";

export type TokenSet = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  refreshExpiresAt?: number;
  tokenType?: string;
  scope?: string;
  providerAccountId?: string;
};

export function isTokenUsable(token: TokenSet, skewMs = 60_000) {
  return Boolean(token.accessToken && (!token.expiresAt || token.expiresAt > Date.now() + skewMs));
}

export function tokenNeedsRefresh(token: TokenSet, skewMs = 60_000) {
  return Boolean(token.refreshToken && token.expiresAt && token.expiresAt <= Date.now() + skewMs);
}

export function normalizeScopes(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[\s,]+/);
  return [...new Set(raw.map((s) => s.trim()).filter(Boolean))].sort();
}

export function verifyWebhookHmacSha256(rawBody: string | Buffer, signature: string, secret: string) {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const supplied = signature.replace(/^sha256=/i, "").trim().toLowerCase();
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(supplied, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function redactTokenSet(token: TokenSet) {
  return {
    ...token,
    accessToken: token.accessToken ? "[REDACTED]" : token.accessToken,
    refreshToken: token.refreshToken ? "[REDACTED]" : token.refreshToken,
  };
}
