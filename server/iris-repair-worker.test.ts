import { afterEach, describe, expect, it, vi } from "vitest";
// The production Worker is JavaScript; exercise its fetch handler with hermetic bindings.
// @ts-expect-error JS module does not declare Worker types
import worker from "../worker/worker-iris-gmail.js";

const productionOrigin = "https://gentle-bread-2f69.pages.dev";
const testSecret = "fictional-only-test-password-not-a-real-secret";
const testClientId = "fictional-google-client-id.apps.test.invalid";
const testClientSecret = "fictional-google-client-secret";

afterEach(() => vi.unstubAllGlobals());

function memoryKV(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
    delete: vi.fn(async (key: string) => { values.delete(key); }),
  };
}

function fakeD1() {
  const bindings: unknown[][] = [];
  const prepare = vi.fn((sql: string) => ({
    bind: (...params: unknown[]) => {
      bindings.push(params);
      return {
        all: async () => ({ results: [] }),
        first: async () => null,
        run: async () => ({ success: true }),
      };
    },
  }));
  return { prepare, bindings, batch: vi.fn(async () => ({ success: true })) };
}

function authHeaders(token: string, extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${token}`, ...extra };
}

async function login(env: Record<string, unknown>, origin?: string) {
  const response = await worker.fetch(new Request("https://worker.test/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify({ password: testSecret }),
  }), env);
  const body = await response.json();
  return { response, body } as { response: Response; body: { token: string; expiresIn: number; expiresAt: string } };
}

describe("Iris Worker security repair", () => {
  it("issues an owner bearer token after a valid login", async () => {
    const { response, body } = await login({ IRIS_ACCESS_SECRET: testSecret });
    expect(response.status).toBe(200);
    expect(body.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(body.token).not.toContain(testSecret);
    expect(body.expiresIn).toBe(6 * 60 * 60);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("fails closed with 503 when the access secret is missing", async () => {
    const response = await worker.fetch(new Request("https://worker.test/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: testSecret }),
    }), {});
    expect(response.status).toBe(503);
  });

  it("rejects public D1 access, including X-Iris-User spoofing, without calling D1", async () => {
    const db = fakeD1();
    const response = await worker.fetch(new Request("https://worker.test/data/finances", {
      headers: { "X-Iris-User": "owner" },
    }), { IRIS_ACCESS_SECRET: testSecret, IRIS_DB: db });
    expect(response.status).toBe(401);
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it("does not allow X-Iris-User to override a valid bearer identity", async () => {
    const db = fakeD1();
    const { body } = await login({ IRIS_ACCESS_SECRET: testSecret });
    const response = await worker.fetch(new Request("https://worker.test/data/finances", {
      headers: authHeaders(body.token, { "X-Iris-User": "attacker" }),
    }), { IRIS_ACCESS_SECRET: testSecret, IRIS_DB: db });
    expect(response.status).toBe(401);
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it("uses only the authenticated token subject as D1 identity", async () => {
    const db = fakeD1();
    const { body } = await login({ IRIS_ACCESS_SECRET: testSecret });
    const response = await worker.fetch(new Request("https://worker.test/data/finances", {
      headers: authHeaders(body.token),
    }), { IRIS_ACCESS_SECRET: testSecret, IRIS_DB: db, IRIS_USER_ID: "spoofed-env-user" });
    expect(response.status).toBe(200);
    expect(db.bindings[0]).toEqual(["owner"]);
  });

  it("allows authenticated AI use and returns the exact production CORS origin", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Good morning." }] } }] }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { body } = await login({ IRIS_ACCESS_SECRET: testSecret }, productionOrigin);
    const response = await worker.fetch(new Request("https://worker.test/", {
      method: "POST",
      headers: { ...authHeaders(body.token), Origin: productionOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "translate", text: "Bom dia" }),
    }), { IRIS_ACCESS_SECRET: testSecret, GEMINI_API_KEY: "fictional-gemini-key" });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(productionOrigin);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).text).toBe("Good morning.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps stored-byte quota across months while reporting current-month operations", async () => {
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: () => ({
          first: async () => sql.includes("SUM(stored_bytes)")
            ? { stored_bytes: 12_345 }
            : { class_a: 2, class_b: 3 },
        }),
      })),
    };
    const env = { IRIS_ACCESS_SECRET: testSecret, IRIS_DB: db };
    const { body } = await login(env);
    const response = await worker.fetch(new Request("https://worker.test/storage/quota", {
      headers: authHeaders(body.token),
    }), env);
    expect(response.status).toBe(200);
    const quota = await response.json();
    expect(quota.usage).toEqual({ bytes: 12_345, classA: 2, classB: 3 });
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("SUM(stored_bytes)"));
  });

  it("serves CORS preflight and does not allow preview or unrelated origins", async () => {
    const preflight = await worker.fetch(new Request("https://worker.test/", {
      method: "OPTIONS", headers: { Origin: productionOrigin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" },
    }), {});
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(productionOrigin);
    expect(preflight.headers.get("access-control-allow-headers")).toContain("authorization");

    const preview = "https://pr-123.gentle-bread-2f69.pages.dev";
    const denied = await worker.fetch(new Request("https://worker.test/", { method: "OPTIONS", headers: { Origin: preview } }), {});
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();

    const configured = await worker.fetch(new Request("https://worker.test/", { method: "OPTIONS", headers: { Origin: "https://exactly-allowed.example" } }), { ALLOWED_ORIGIN: "https://exactly-allowed.example" });
    expect(configured.headers.get("access-control-allow-origin")).toBe("https://exactly-allowed.example");
    const unrelated = await worker.fetch(new Request("https://worker.test/", { method: "OPTIONS", headers: { Origin: "https://unrelated.example" } }), { ALLOWED_ORIGIN: "https://exactly-allowed.example" });
    expect(unrelated.headers.get("access-control-allow-origin")).toBeNull();
  });

  it.each(["PATCH", "DELETE"])("requires explicit confirmation for authenticated Calendar %s without calling Google", async method => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { body } = await login({ IRIS_ACCESS_SECRET: testSecret });
    const response = await worker.fetch(new Request("https://worker.test/google/calendar/events/event-42", {
      method,
      headers: { ...authHeaders(body.token), "Content-Type": "application/json" },
      ...(method === "PATCH" ? { body: JSON.stringify({ summary: "Teste" }) } : {}),
    }), { IRIS_ACCESS_SECRET: testSecret });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("CONFIRMATION_REQUIRED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects arbitrary Calendar fields and invalid time intervals before Google", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { body } = await login({ IRIS_ACCESS_SECRET: testSecret });
    const env = { IRIS_ACCESS_SECRET: testSecret };
    const arbitraryPatch = await worker.fetch(new Request("https://worker.test/google/calendar/events/event-42", {
      method: "PATCH",
      headers: { ...authHeaders(body.token, { "X-Iris-Confirm": "true" }), "Content-Type": "application/json" },
      body: JSON.stringify({ attendees: [{ email: "attacker@example.invalid" }] }),
    }), env);
    expect(arbitraryPatch.status).toBe(400);

    const invalidCreate = await worker.fetch(new Request("https://worker.test/google/calendar/events", {
      method: "POST",
      headers: { ...authHeaders(body.token, { "X-Iris-Confirm": "true" }), "Content-Type": "application/json" },
      body: JSON.stringify({ summary: "Teste", start: "2026-11-12T10:00:00-03:00", end: "2026-11-12T10:00:00-03:00" }),
    }), env);
    expect(invalidCreate.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("executes a confirmed Calendar edit only against the mocked Google path", async () => {
    const kv = memoryKV({
      "session:calendar": JSON.stringify({ access_token: "fictional-access-token", refresh_token: "fictional-refresh-token", expires_at: Date.now() + 3600000 }),
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "event-42", summary: "Atualizado" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const env = { IRIS_ACCESS_SECRET: testSecret, IRIS_GMAIL_OAUTH: kv };
    const { body } = await login(env);
    const response = await worker.fetch(new Request("https://worker.test/google/calendar/events/event-42", {
      method: "PATCH",
      headers: { ...authHeaders(body.token, { "X-Iris-Confirm": "true" }), "Content-Type": "application/json" },
      body: JSON.stringify({ summary: "Atualizado" }),
    }), env);
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://www.googleapis.com/calendar/v3/calendars/primary/events/event-42");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("PATCH");
  });

  it("requires auth for OAuth start and rejects invalid or replayed callback state", async () => {
    const kv = memoryKV();
    const env = { IRIS_ACCESS_SECRET: testSecret, GOOGLE_CLIENT_ID: testClientId, GOOGLE_CLIENT_SECRET: testClientSecret, IRIS_GMAIL_OAUTH: kv };
    const unauthenticated = await worker.fetch(new Request("https://worker.test/oauth/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product: "calendar" }) }), env);
    expect(unauthenticated.status).toBe(401);
    const getStart = await worker.fetch(new Request("https://worker.test/oauth/start"), env);
    expect(getStart.status).toBe(401);

    const { body } = await login(env);
    const start = await worker.fetch(new Request("https://worker.test/oauth/start", {
      method: "POST", headers: { ...authHeaders(body.token), "Content-Type": "application/json" }, body: JSON.stringify({ product: "calendar" }),
    }), env);
    expect(start.status).toBe(200);
    const authUrl = new URL((await start.json()).url);
    expect(authUrl.origin).toBe("https://accounts.google.com");
    expect(authUrl.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/calendar");
    const state = authUrl.searchParams.get("state")!;

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: "fictional-access-token", refresh_token: "fictional-refresh-token", expires_in: 3600 }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const invalid = await worker.fetch(new Request("https://worker.test/oauth/callback?state=not-a-signed-state&code=fictional-code"), env);
    expect(invalid.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();

    const first = await worker.fetch(new Request(`https://worker.test/oauth/callback?state=${encodeURIComponent(state)}&code=fictional-code`), env);
    expect(first.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(kv.values.has("session:calendar")).toBe(true);
    const replay = await worker.fetch(new Request(`https://worker.test/oauth/callback?state=${encodeURIComponent(state)}&code=fictional-code`), env);
    expect(replay.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized JSON and history before any Gemini request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { body } = await login({ IRIS_ACCESS_SECRET: testSecret });
    const oversizedLogin = await worker.fetch(new Request("https://worker.test/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json", "Content-Length": "5000" }, body: JSON.stringify({ password: testSecret }),
    }), { IRIS_ACCESS_SECRET: testSecret });
    expect(oversizedLogin.status).toBe(413);

    const history = ["a".repeat(9000), "b".repeat(9000), "c".repeat(7000)].map(text => ({ role: "user", text }));
    const response = await worker.fetch(new Request("https://worker.test/", {
      method: "POST", headers: { ...authHeaders(body.token), "Content-Type": "application/json" }, body: JSON.stringify({ messages: history }),
    }), { IRIS_ACCESS_SECRET: testSecret, GEMINI_API_KEY: "fictional-gemini-key" });
    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
