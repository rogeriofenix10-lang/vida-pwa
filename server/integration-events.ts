import { createHash } from "node:crypto";
import { verifyWebhookHmacSha256 } from "./integration-auth.ts";

export type IntegrationEvent = { id: string; provider: string; type: string; receivedAt: number; payload: unknown };
const seen = new Map<string, number>();
const EVENT_DEDUPE_TTL_MS = Math.max(60_000, Number(process.env.IRIS_EVENT_DEDUPE_TTL_MS ?? 86_400_000));
const EVENT_DEDUPE_MAX = Math.max(100, Number(process.env.IRIS_EVENT_DEDUPE_MAX ?? 10_000));

function pruneSeen(now = Date.now()) {
  for (const [key, receivedAt] of seen) {
    if (now - receivedAt > EVENT_DEDUPE_TTL_MS) seen.delete(key);
  }
  while (seen.size > EVENT_DEDUPE_MAX) {
    const oldest = seen.keys().next().value as string | undefined;
    if (!oldest) break;
    seen.delete(oldest);
  }
}
const handlers = new Map<string, (event: IntegrationEvent) => Promise<void> | void>();

export function registerIntegrationEventHandler(provider: string, type: string, handler: (event: IntegrationEvent) => Promise<void> | void) {
  handlers.set(`${provider}:${type}`, handler);
}

export function eventFingerprint(provider: string, rawBody: string, eventId?: string) {
  return eventId ?? createHash("sha256").update(`${provider}:${rawBody}`).digest("hex");
}

export async function ingestIntegrationEvent(input: { provider: string; type: string; rawBody: string; eventId?: string; signature?: string; secret?: string; timestamp?: number }) {
  const now = Date.now();
  pruneSeen(now);
  const fingerprint = eventFingerprint(input.provider, input.rawBody, input.eventId);
  const previous = seen.get(fingerprint);
  if (previous !== undefined && now - previous <= EVENT_DEDUPE_TTL_MS) return { accepted: true, duplicate: true, id: fingerprint };
  if (input.secret && input.signature) {
    const ok = verifyWebhookHmacSha256(input.rawBody, input.signature, input.secret);
    if (!ok) throw new Error("WEBHOOK_SIGNATURE_INVALID");
  }
  const payload = JSON.parse(input.rawBody);
  const event: IntegrationEvent = { id: fingerprint, provider: input.provider, type: input.type, receivedAt: input.timestamp ?? now, payload };
  seen.set(fingerprint, now);
  pruneSeen(now);
  const handler = handlers.get(`${input.provider}:${input.type}`) ?? handlers.get(`${input.provider}:*`);
  if (handler) await handler(event);
  return { accepted: true, duplicate: false, id: fingerprint };
}

export function resetIntegrationEvents() { seen.clear(); handlers.clear(); }
