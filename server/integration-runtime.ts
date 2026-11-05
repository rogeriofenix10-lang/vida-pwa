import { createHash, randomUUID } from "node:crypto";

export type RuntimeErrorKind = "auth_required" | "rate_limited" | "retryable" | "confirmation_required" | "permanent";

export class ConnectorRuntimeError extends Error {
  readonly kind: RuntimeErrorKind;
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly provider: string;
  constructor(message: string, opts: { kind: RuntimeErrorKind; provider: string; status?: number; retryAfterMs?: number }) {
    super(message);
    this.name = "ConnectorRuntimeError";
    this.kind = opts.kind;
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs;
    this.provider = opts.provider;
  }
}

export type ConnectorResult<T = unknown> = {
  ok: boolean;
  provider: string;
  action: string;
  requestId: string;
  attempts: number;
  durationMs: number;
  data?: T;
  error?: { kind: RuntimeErrorKind; message: string; status?: number };
  replayed?: boolean;
};

type CircuitState = { failures: number; openedAt?: number; halfOpenInFlight: boolean };
type Bucket = { tokens: number; updatedAt: number };

const circuits = new Map<string, CircuitState>();
const buckets = new Map<string, Bucket>();
const idempotency = new Map<string, ConnectorResult<any>>();

function classifyError(provider: string, error: unknown): ConnectorRuntimeError {
  if (error instanceof ConnectorRuntimeError) return error;
  const status = typeof (error as any)?.status === "number" ? (error as any).status : undefined;
  if (status === 401 || status === 403) return new ConnectorRuntimeError("Autorização necessária", { kind: "auth_required", provider, status });
  if (status === 408 || status === 425 || status === 429 || (status !== undefined && status >= 500)) {
    const retryAfterMs = Number((error as any)?.retryAfterMs) || undefined;
    return new ConnectorRuntimeError("Falha temporária do conector", { kind: status === 429 ? "rate_limited" : "retryable", provider, status, retryAfterMs });
  }
  return new ConnectorRuntimeError(error instanceof Error ? error.message : "Falha desconhecida", { kind: "permanent", provider, status });
}

function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }
function backoff(attempt: number, baseMs: number, capMs: number, jitterMs: number) {
  const exponential = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return exponential + Math.floor(Math.random() * Math.max(1, jitterMs));
}

function allowRate(provider: string, perSecond: number) {
  const now = Date.now();
  const bucket = buckets.get(provider) ?? { tokens: perSecond, updatedAt: now };
  bucket.tokens = Math.min(perSecond, bucket.tokens + ((now - bucket.updatedAt) / 1000) * perSecond);
  bucket.updatedAt = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  buckets.set(provider, bucket);
  return true;
}

function circuitFor(provider: string) { return circuits.get(provider) ?? { failures: 0, halfOpenInFlight: false }; }

export function connectorRuntimeStatus(provider: string) {
  const c = circuitFor(provider);
  return { provider, circuit: c.openedAt ? "open" : "closed", failures: c.failures, rateBucket: buckets.get(provider) ?? null, idempotencyEntries: [...idempotency.keys()].filter(k => k.startsWith(`${provider}:`)).length };
}

export function resetConnectorRuntimeState() { circuits.clear(); buckets.clear(); idempotency.clear(); }

export async function executeWithRuntime<T>(opts: {
  provider: string;
  action: string;
  idempotencyKey?: string;
  maxAttempts?: number;
  ratePerSecond?: number;
  circuitFailureThreshold?: number;
  circuitCooldownMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  jitterMs?: number;
  execute: () => Promise<T>;
}): Promise<ConnectorResult<T>> {
  const requestId = randomUUID();
  const started = Date.now();
  const key = opts.idempotencyKey ? `${opts.provider}:${opts.idempotencyKey}` : undefined;
  if (key && idempotency.has(key)) return { ...idempotency.get(key)!, requestId, replayed: true } as ConnectorResult<T>;

  const maxAttempts = Math.max(1, Math.min(opts.maxAttempts ?? 3, 8));
  const threshold = Math.max(1, opts.circuitFailureThreshold ?? 5);
  const cooldown = opts.circuitCooldownMs ?? 30_000;
  const c = circuitFor(opts.provider);
  if (c.openedAt && Date.now() - c.openedAt < cooldown) {
    throw new ConnectorRuntimeError("Circuit breaker aberto", { kind: "retryable", provider: opts.provider });
  }
  if (c.openedAt) { c.openedAt = undefined; c.halfOpenInFlight = true; }

  let lastError: ConnectorRuntimeError | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (!(allowRate(opts.provider, opts.ratePerSecond ?? 5))) await sleep(200);
    try {
      const data = await opts.execute();
      c.failures = 0; c.openedAt = undefined; c.halfOpenInFlight = false; circuits.set(opts.provider, c);
      const result: ConnectorResult<T> = { ok: true, provider: opts.provider, action: opts.action, requestId, attempts: attempt, durationMs: Date.now() - started, data };
      if (key) idempotency.set(key, result);
      return result;
    } catch (raw) {
      const error = classifyError(opts.provider, raw); lastError = error;
      if (error.kind === "auth_required" || error.kind === "confirmation_required" || error.kind === "permanent") break;
      if (attempt < maxAttempts) await sleep(error.retryAfterMs ?? backoff(attempt, opts.baseBackoffMs ?? 250, opts.maxBackoffMs ?? 4000, opts.jitterMs ?? 100));
    }
  }
  c.failures += 1;
  if (c.failures >= threshold) { c.openedAt = Date.now(); }
  c.halfOpenInFlight = false; circuits.set(opts.provider, c);
  const failureResult: ConnectorResult<T> = { ok: false, provider: opts.provider, action: opts.action, requestId, attempts: maxAttempts, durationMs: Date.now() - started, error: { kind: lastError?.kind ?? "permanent", message: lastError?.message ?? "Falha", status: lastError?.status } };
  if (key && failureResult.error?.kind === "permanent") idempotency.set(key, failureResult);
  return failureResult;
}

export function createIdempotencyKey(parts: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(parts, Object.keys(parts).sort())).digest("hex");
}
