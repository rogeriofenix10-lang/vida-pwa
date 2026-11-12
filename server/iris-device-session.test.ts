import { describe, expect, it, vi } from "vitest";
// @ts-expect-error The production Worker is JavaScript and accepts Cloudflare bindings.
import worker from "../worker/worker-iris-gmail.js";

const testSecret = "fictional-only-test-password-not-a-real-secret";
const allowedOrigin = "https://gentle-bread-2f69.pages.dev";
const foreignOrigin = "https://not-allowed.example";
const SIX_HOURS = 6 * 60 * 60;
const NINETY_DAYS = 90 * 24 * 60 * 60;

type DeviceRow = {
  id: string;
  user_id: string;
  refresh_hash: string;
  secret_version: string;
  name: string;
  created_at: number;
  last_used_at: number;
  expires_at: number;
  revoked_at: number | null;
};

class FakeD1 {
  readonly rows = new Map<string, DeviceRow>();
  readonly calls: Array<{ sql: string; params: unknown[] }> = [];
  readonly prepare = vi.fn((sql: string) => {
    const db = this;
    let params: unknown[] = [];
    return {
      bind(...values: unknown[]) {
        params = values;
        return {
          first: async () => db.first(sql, params),
          all: async () => db.all(sql, params),
          run: async () => db.run(sql, params),
        };
      },
    };
  });
  fail = false;
  refreshCasAttempts = 0;
  refreshCasWins = 0;

  private ensureAvailable() {
    if (this.fail) throw new Error("hermetic D1 failure; must not escape");
  }

  private first(sql: string, params: unknown[]) {
    this.ensureAvailable();
    this.calls.push({ sql, params: [...params] });
    if (sql.includes("SELECT name FROM iris_device_sessions")) {
      const [id, userId, refreshHash, secretVersion, now] = params as [string, string, string, string, number];
      const row = this.rows.get(id);
      return row && row.user_id === userId && row.refresh_hash === refreshHash && row.secret_version === secretVersion && row.revoked_at === null && row.expires_at > now
        ? { name: row.name }
        : null;
    }
    return null;
  }

  private all(sql: string, params: unknown[]) {
    this.ensureAvailable();
    this.calls.push({ sql, params: [...params] });
    if (!sql.includes("SELECT id,name,created_at,last_used_at,expires_at FROM iris_device_sessions")) return { results: [] };
    const [userId, secretVersion, now] = params as [string, string, number];
    const results = [...this.rows.values()]
      .filter(row => row.user_id === userId && row.secret_version === secretVersion && row.revoked_at === null && row.expires_at > now)
      .sort((a, b) => b.last_used_at - a.last_used_at)
      .map(({ id, name, created_at, last_used_at, expires_at }) => ({ id, name, created_at, last_used_at, expires_at }));
    return { results };
  }

  private run(sql: string, params: unknown[]) {
    this.ensureAvailable();
    this.calls.push({ sql, params: [...params] });
    if (sql.startsWith("INSERT INTO iris_device_sessions")) {
      const [id, user_id, refresh_hash, secret_version, name, created_at, last_used_at, expires_at] = params as [string, string, string, string, string, number, number, number];
      if (this.rows.has(id)) return { success: true, meta: { changes: 0 } };
      this.rows.set(id, { id, user_id, refresh_hash, secret_version, name, created_at, last_used_at, expires_at, revoked_at: null });
      return { success: true, meta: { changes: 1 } };
    }
    if (!sql.startsWith("UPDATE iris_device_sessions SET")) return { success: true, meta: { changes: 0 } };
    if (sql.includes("SET refresh_hash=?")) {
      this.refreshCasAttempts++;
      const [nextHash, lastUsedAt, expiresAt, id, userId, oldHash, secretVersion, now] = params as [string, number, number, string, string, string, string, number];
      const row = this.rows.get(id);
      if (!row || row.user_id !== userId || row.refresh_hash !== oldHash || row.secret_version !== secretVersion || row.revoked_at !== null || row.expires_at <= now) return { success: true, meta: { changes: 0 } };
      row.refresh_hash = nextHash;
      row.last_used_at = lastUsedAt;
      row.expires_at = expiresAt;
      this.refreshCasWins++;
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("SET last_used_at=?")) {
      const [lastUsedAt, expiresAt, id, userId, secretVersion, now] = params as [number, number, string, string, string, number];
      const row = this.rows.get(id);
      if (!row || row.user_id !== userId || row.secret_version !== secretVersion || row.revoked_at !== null || row.expires_at <= now) return { success: true, meta: { changes: 0 } };
      row.last_used_at = lastUsedAt;
      row.expires_at = expiresAt;
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("SET revoked_at=?")) {
      const [revokedAt, id, userId, refreshHash] = params as [number, string, string, string?];
      const row = this.rows.get(id);
      const expectsRefresh = sql.includes("refresh_hash=?");
      if (!row || row.user_id !== userId || row.revoked_at !== null || (expectsRefresh && row.refresh_hash !== refreshHash)) return { success: true, meta: { changes: 0 } };
      row.revoked_at = revokedAt;
      return { success: true, meta: { changes: 1 } };
    }
    return { success: true, meta: { changes: 0 } };
  }
}

function bodyRequest(path: string, method: string, body: unknown, options: { token?: string; origin?: string } = {}) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (options.token) headers.set("Authorization", `Bearer ${options.token}`);
  if (options.origin) headers.set("Origin", options.origin);
  return new Request(`https://worker.test${path}`, { method, headers, body: JSON.stringify(body) });
}

async function login(env: Record<string, unknown>, rememberDevice = true, deviceName = "MacBook de teste", origin = allowedOrigin) {
  const body: Record<string, unknown> = { password: testSecret };
  if (rememberDevice) Object.assign(body, { rememberDevice: true, deviceName });
  const response = await worker.fetch(bodyRequest("/auth/login", "POST", body, { origin }), env);
  return { response, body: await response.json() as any };
}

async function refresh(env: Record<string, unknown>, device: { id: string; refreshToken: string }, origin = allowedOrigin) {
  const response = await worker.fetch(bodyRequest("/auth/refresh", "POST", { deviceId: device.id, refreshToken: device.refreshToken }, { origin }), env);
  return { response, body: await response.json() as any };
}

async function protectedRead(env: Record<string, unknown>, token: string, path = "/data/finances", origin?: string) {
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  if (origin) headers.set("Origin", origin);
  const response = await worker.fetch(new Request(`https://worker.test${path}`, { headers }), env);
  return { response, body: await response.json() as any };
}

describe("Worker device sessions (hermetic D1)", () => {
  it("pairs a remembered device without persisting either the master password or raw refresh token", async () => {
    const db = new FakeD1();
    const env = { IRIS_ACCESS_SECRET: testSecret, IRIS_DB: db };
    const { response, body } = await login(env);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({ ok: true, tokenType: "Bearer", expiresIn: SIX_HOURS });
    expect(body.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(body.device).toMatchObject({ name: "MacBook de teste" });
    expect(body.device.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body.device.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Math.round(Date.parse(body.device.expiresAt) / 1000) - Math.floor(Date.now() / 1000)).toBeGreaterThanOrEqual(NINETY_DAYS - 2);
    const row = db.rows.get(body.device.id)!;
    expect(row.user_id).toBe("owner");
    expect(row.refresh_hash).not.toBe(body.device.refreshToken);
    expect(row.refresh_hash).not.toContain(testSecret);
    expect(row.secret_version).not.toContain(testSecret);
    expect(JSON.stringify(row)).not.toContain(body.device.refreshToken);
    expect(JSON.stringify(row)).not.toContain(testSecret);
    const claims = JSON.parse(Buffer.from(body.token.split(".")[1], "base64url").toString("utf8"));
    expect(claims.deviceId).toBe(body.device.id);
  });

  it("rejects remember-device login when D1 is missing instead of silently downgrading", async () => {
    const { response, body } = await login({ IRIS_ACCESS_SECRET: testSecret });
    expect(response.status).toBe(503);
    expect(body.device).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(testSecret);
  });

  it("rotates refresh tokens and returns a fresh six-hour access token", async () => {
    const db = new FakeD1();
    const env = { IRIS_ACCESS_SECRET: testSecret, IRIS_DB: db };
    const initial = await login(env);
    const oldHash = db.rows.get(initial.body.device.id)!.refresh_hash;
    const rotated = await refresh(env, initial.body.device);
    expect(rotated.response.status).toBe(200);
    expect(rotated.body).toMatchObject({ ok: true, tokenType: "Bearer", expiresIn: SIX_HOURS });
    expect(rotated.body.token).not.toBe(initial.body.token);
    expect(rotated.body.device.id).toBe(initial.body.device.id);
    expect(rotated.body.device.refreshToken).not.toBe(initial.body.device.refreshToken);
    expect(db.rows.get(initial.body.device.id)!.refresh_hash).not.toBe(oldHash);
    expect(db.rows.get(initial.body.device.id)!.refresh_hash).not.toBe(rotated.body.device.refreshToken);
    expect(db.rows.get(initial.body.device.id)!.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000) + NINETY_DAYS - 2);
  });

  it("rejects replay without revoking the winning rotated token", async () => {
    const db = new FakeD1();
    const env = { IRIS_ACCESS_SECRET: testSecret, IRIS_DB: db };
    const initial = await login(env);
    const rotated = await refresh(env, initial.body.device);
    expect(rotated.response.status).toBe(200);
    const replay = await refresh(env, initial.body.device);
    expect(replay.response.status).toBe(401);
    expect(db.rows.get(initial.body.device.id)!.revoked_at).toBeNull();
    expect((await refresh(env, rotated.body.device)).response.status).toBe(200);
  });

  it("uses a conditional compare-and-swap so concurrent refresh requests have exactly one winner", async () => {
    const db = new FakeD1();
    const env = { IRIS_ACCESS_SECRET: testSecret, IRIS_DB: db };
    const initial = await login(env);
    const results = await Promise.all([refresh(env, initial.body.device), refresh(env, initial.body.device)]);
    expect(results.map(result => result.response.status).sort()).toEqual([200, 401]);
    expect(db.refreshCasAttempts).toBe(2);
    expect(db.refreshCasWins).toBe(1);
    expect(db.rows.get(initial.body.device.id)!.revoked_at).toBeNull();
    const winner = results.find(result => result.response.status === 200)!;
    expect((await refresh(env, winner.body.device)).response.status).toBe(200);
  });

  it("rejects expired device rows for both refresh and bearer access", async () => {
    const db = new FakeD1();
    const env = { IRIS_ACCESS_SECRET: testSecret, IRIS_DB: db };
    const initial = await login(env);
    db.rows.get(initial.body.device.id)!.expires_at = Math.floor(Date.now() / 1000) - 1;
    expect((await refresh(env, initial.body.device)).response.status).toBe(401);
    expect((await protectedRead(env, initial.body.token)).response.status).toBe(401);
  });

  it("invalidates refresh and access after master-secret rotation and checks device state on each D1 read", async () => {
    const db = new FakeD1();
    const env = { IRIS_ACCESS_SECRET: testSecret, IRIS_DB: db };
    const initial = await login(env);
    const read = await protectedRead(env, initial.body.token);
    expect(read.response.status).toBe(200);
    expect(db.calls.some(call => call.sql.includes("SET last_used_at=?") && call.params.includes(initial.body.device.id))).toBe(true);
    expect(db.calls.some(call => call.sql.includes("SELECT * FROM iris_finances") && call.params[0] === "owner")).toBe(true);
    const changedSecret = { IRIS_ACCESS_SECRET: `${testSecret}-rotated`, IRIS_DB: db };
    expect((await refresh(changedSecret, initial.body.device)).response.status).toBe(401);
    expect((await protectedRead(changedSecret, initial.body.token)).response.status).toBe(401);
  });

  it("keeps legacy password-only sessions at six hours without requiring D1", async () => {
    const { response, body } = await login({ IRIS_ACCESS_SECRET: testSecret }, false);
    expect(response.status).toBe(200);
    expect(body.expiresIn).toBe(SIX_HOURS);
    expect(body.device).toBeUndefined();
    const read = await protectedRead({ IRIS_ACCESS_SECRET: testSecret, IRIS_DB: new FakeD1() }, body.token);
    expect(read.response.status).toBe(200);
  });

  it("lists only safe active-device fields and permits owner revocation without cross-device invalidation", async () => {
    const db = new FakeD1();
    const env = { IRIS_ACCESS_SECRET: testSecret, IRIS_DB: db };
    const first = await login(env, true, "Laptop");
    const second = await login(env, true, "Telefone");
    const listing = await protectedRead(env, first.body.token, "/auth/devices");
    expect(listing.response.status).toBe(200);
    expect(listing.body.devices).toHaveLength(2);
    expect(listing.body.devices).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.body.device.id, name: "Laptop" }),
      expect.objectContaining({ id: second.body.device.id, name: "Telefone" }),
    ]));
    expect(JSON.stringify(listing.body)).not.toMatch(/refresh|secret_version|hash/i);
    expect(JSON.stringify(listing.body)).not.toContain(first.body.device.refreshToken);
    const removed = await worker.fetch(new Request(`https://worker.test/auth/devices/${second.body.device.id}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${first.body.token}` },
    }), env);
    expect(removed.status).toBe(200);
    expect((await protectedRead(env, second.body.token)).response.status).toBe(401);
    expect((await protectedRead(env, first.body.token)).response.status).toBe(200);
    expect((await refresh(env, second.body.device)).response.status).toBe(401);
  });

  it("allows cancellation using only the correct current refresh token", async () => {
    const db = new FakeD1();
    const env = { IRIS_ACCESS_SECRET: testSecret, IRIS_DB: db };
    const initial = await login(env);
    const wrong = await worker.fetch(bodyRequest("/auth/device/revoke", "POST", { deviceId: initial.body.device.id, refreshToken: "A".repeat(43) } ), env);
    expect(wrong.status).toBe(401);
    expect(db.rows.get(initial.body.device.id)!.revoked_at).toBeNull();
    const revoked = await worker.fetch(bodyRequest("/auth/device/revoke", "POST", { deviceId: initial.body.device.id, refreshToken: initial.body.device.refreshToken }), env);
    expect(revoked.status).toBe(200);
    expect((await protectedRead(env, initial.body.token)).response.status).toBe(401);
  });

  it("does not let a user revoke another user’s device by id", async () => {
    const db = new FakeD1();
    const env = { IRIS_ACCESS_SECRET: testSecret, IRIS_DB: db };
    const legacy = await login(env, false);
    const other: DeviceRow = {
      id: "other-user-device", user_id: "not-owner", refresh_hash: "fictional-hash", secret_version: "fictional-version",
      name: "Other", created_at: 1, last_used_at: 1, expires_at: Math.floor(Date.now() / 1000) + NINETY_DAYS, revoked_at: null,
    };
    db.rows.set(other.id, other);
    const response = await worker.fetch(new Request(`https://worker.test/auth/devices/${other.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${legacy.body.token}` } }), env);
    expect(response.status).toBe(404);
    expect(other.revoked_at).toBeNull();
  });

  it("returns 503 on D1 exceptions for remembering, refresh, revoke, authenticated use, and listing", async () => {
    const db = new FakeD1();
    const env = { IRIS_ACCESS_SECRET: testSecret, IRIS_DB: db };
    const initial = await login(env);
    db.fail = true;
    const freshLogin = await login(env);
    expect(freshLogin.response.status).toBe(503);
    expect((await refresh(env, initial.body.device)).response.status).toBe(503);
    expect((await worker.fetch(bodyRequest("/auth/device/revoke", "POST", { deviceId: initial.body.device.id, refreshToken: initial.body.device.refreshToken }), env)).status).toBe(503);
    expect((await protectedRead(env, initial.body.token)).response.status).toBe(503);
    expect((await protectedRead(env, initial.body.token, "/auth/devices")).response.status).toBe(503);
    expect(JSON.stringify(freshLogin.body)).not.toContain(testSecret);
  });

  it("fails closed on missing D1 for public refresh and revoke endpoints", async () => {
    const env = { IRIS_ACCESS_SECRET: testSecret };
    const candidate = { deviceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", refreshToken: "A".repeat(43) };
    expect((await worker.fetch(bodyRequest("/auth/refresh", "POST", candidate), env)).status).toBe(503);
    expect((await worker.fetch(bodyRequest("/auth/device/revoke", "POST", candidate), env)).status).toBe(503);
  });

  it("rejects foreign origins on every new auth route, even when CORS alone would not protect it", async () => {
    const db = new FakeD1();
    const env = { IRIS_ACCESS_SECRET: testSecret, IRIS_DB: db };
    const candidates = [
      bodyRequest("/auth/login", "POST", { password: testSecret }, { origin: foreignOrigin }),
      bodyRequest("/auth/refresh", "POST", { deviceId: "id", refreshToken: "A".repeat(43) }, { origin: foreignOrigin }),
      bodyRequest("/auth/device/revoke", "POST", { deviceId: "id", refreshToken: "A".repeat(43) }, { origin: foreignOrigin }),
      new Request("https://worker.test/auth/devices", { headers: { Origin: foreignOrigin } }),
      new Request("https://worker.test/auth/devices/device-id", { method: "DELETE", headers: { Origin: foreignOrigin } }),
    ];
    for (const request of candidates) expect((await worker.fetch(request, env)).status).toBe(403);
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it("bounds device names and refresh-token inputs", async () => {
    const db = new FakeD1();
    const env = { IRIS_ACCESS_SECRET: testSecret, IRIS_DB: db };
    expect((await login(env, true, "n".repeat(101))).response.status).toBe(400);
    const invalid = await worker.fetch(bodyRequest("/auth/refresh", "POST", { deviceId: "valid-id", refreshToken: "too-long" }), env);
    expect(invalid.status).toBe(400);
    expect(db.rows.size).toBe(0);
  });
});
