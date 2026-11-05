const buckets = new Map<number, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;
const REDIS_URL = process.env.RATE_LIMIT_REDIS_URL?.trim();
const REDIS_TOKEN = process.env.RATE_LIMIT_REDIS_TOKEN?.trim();
const publicBuckets = new Map<string, { count: number; resetAt: number }>();
const PUBLIC_WINDOW_MS = 60_000;
const PUBLIC_MAX_REQUESTS = 12;

async function redisRateLimit(userId: number) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  const key = `iris:ai:rate:${userId}:${Math.floor(Date.now() / WINDOW_MS)}`;
  const response = await fetch(`${REDIS_URL.replace(/\/$/, "")}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify([["INCR", key], ["EXPIRE", key, 60]]),
  });
  if (!response.ok) throw new Error("Serviço de limite de uso indisponível");
  const payload = await response.json() as Array<{ result?: number }>;
  const count = Number(payload?.[0]?.result ?? 0);
  if (count > MAX_REQUESTS) throw new Error("Limite de uso da IA atingido. Aguarde um minuto e tente novamente.");
  return true;
}

export async function assertAiRateLimit(userId: number) {
  const distributed = await redisRateLimit(userId);
  if (distributed !== null) return;

  const now = Date.now();
  const current = buckets.get(userId);
  if (!current || current.resetAt <= now) {
    buckets.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  if (current.count >= MAX_REQUESTS) throw new Error("Limite de uso da IA atingido. Aguarde um minuto e tente novamente.");
  current.count += 1;
  if (buckets.size > 10_000) {
    for (const [id, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(id);
  }
}


/** Small unauthenticated rate limit used only by the on-demand interpreter demo. */
export function assertPublicInterpreterRateLimit(key: string) {
  const now = Date.now();
  const current = publicBuckets.get(key);
  if (!current || current.resetAt <= now) {
    publicBuckets.set(key, { count: 1, resetAt: now + PUBLIC_WINDOW_MS });
    return;
  }
  if (current.count >= PUBLIC_MAX_REQUESTS) {
    throw new Error("Limite do intérprete atingido. Aguarde um minuto e tente novamente.");
  }
  current.count += 1;
  if (publicBuckets.size > 10_000) {
    for (const [bucketKey, bucket] of publicBuckets) {
      if (bucket.resetAt <= now) publicBuckets.delete(bucketKey);
    }
  }
}
