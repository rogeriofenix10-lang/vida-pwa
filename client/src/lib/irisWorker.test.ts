import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const persisted = vi.hoisted(() => ({
  snapshot: {
    credential: null as null | { deviceId: string; refreshToken: string; expiresAt: number; name: string },
    generation: 0,
  },
  failCommit: false,
}));

vi.mock("./irisDeviceStore", () => {
  const same = (left: typeof persisted.snapshot.credential, right: typeof persisted.snapshot.credential) =>
    left === null || right === null
      ? left === right
      : left.deviceId === right.deviceId && left.refreshToken === right.refreshToken && left.expiresAt === right.expiresAt;
  return {
    readIrisDeviceAuthSnapshot: vi.fn(async () => structuredClone(persisted.snapshot)),
    commitIrisDeviceCredential: vi.fn(async (credential: NonNullable<typeof persisted.snapshot.credential>, expected: typeof persisted.snapshot) => {
      if (persisted.failCommit) throw new DOMException("full", "QuotaExceededError");
      if (expected.generation !== persisted.snapshot.generation || !same(expected.credential, persisted.snapshot.credential)) return false;
      persisted.snapshot = { credential: structuredClone(credential), generation: persisted.snapshot.generation };
      return true;
    }),
    clearIrisDeviceCredentialAndAdvanceGeneration: vi.fn(async () => {
      const credential = structuredClone(persisted.snapshot.credential);
      persisted.snapshot = { credential: null, generation: persisted.snapshot.generation + 1 };
      return { credential, generation: persisted.snapshot.generation };
    }),
    deleteIrisDeviceCredentialIfCurrent: vi.fn(async (expected: NonNullable<typeof persisted.snapshot.credential>) => {
      if (!same(expected, persisted.snapshot.credential)) return false;
      persisted.snapshot = { credential: null, generation: persisted.snapshot.generation + 1 };
      return true;
    }),
    clearIrisDeviceCredentialIfCurrent: vi.fn(async (expected: NonNullable<typeof persisted.snapshot.credential>) => {
      if (!same(expected, persisted.snapshot.credential)) return false;
      persisted.snapshot = { credential: null, generation: persisted.snapshot.generation + 1 };
      return true;
    }),
  };
});

const MASTER_PASSWORD = "master-password-not-for-storage";
const ACCESS_TOKEN = "access-token-1";
const NEXT_ACCESS_TOKEN = "access-token-2";
const DEVICE_ID = "device-123";
const INITIAL_REFRESH_TOKEN = "refresh-token-initial";
const ROTATED_REFRESH_TOKEN = "refresh-token-rotated";
const REMEMBER_DAYS = 90;
const ACCESS_HOURS = 6;
const STORAGE = new Map<string, string>();
let worker: typeof import("./irisWorker");

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function authReply(token: string, refreshToken: string, name = "Este dispositivo") {
  return {
    ok: true,
    token,
    expiresIn: ACCESS_HOURS * 60 * 60,
    expiresAt: new Date(Date.now() + ACCESS_HOURS * 60 * 60 * 1000).toISOString(),
    device: {
      id: DEVICE_ID,
      refreshToken,
      expiresAt: new Date(Date.now() + REMEMBER_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      name,
    },
  };
}

function setupBrowser() {
  const localStorage = {
    getItem: (key: string) => STORAGE.get(key) ?? null,
    setItem: (key: string, value: string) => { STORAGE.set(key, String(value)); },
    removeItem: (key: string) => { STORAGE.delete(key); },
    clear: () => STORAGE.clear(),
  };
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("window", { localStorage, dispatchEvent: vi.fn() });
  vi.stubGlobal("navigator", { userAgent: "Chrome/130", platform: "Linux" });
}

async function importWorker() {
  vi.resetModules();
  worker = await import("./irisWorker");
  return worker;
}

beforeEach(async () => {
  vi.useFakeTimers();
  STORAGE.clear();
  STORAGE.set("iris.mode", "connected");
  STORAGE.set("iris.remoteOptIn", "1");
  persisted.snapshot = { credential: null, generation: 0 };
  persisted.failCommit = false;
  setupBrowser();
  await importWorker();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Iris Worker device authentication", () => {
  it("remembers credentials without storing the master password and restores after reopening the module", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/login")) return jsonResponse(authReply(ACCESS_TOKEN, INITIAL_REFRESH_TOKEN));
      if (url.endsWith("/auth/refresh")) return jsonResponse(authReply(NEXT_ACCESS_TOKEN, ROTATED_REFRESH_TOKEN));
      if (url.endsWith("/data/settings")) return jsonResponse({ items: [] });
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    const login = await worker.unlockIrisAccess(MASTER_PASSWORD);
    expect(login).toEqual({ ok: true, remembered: true });
    expect(worker.isIrisAccessUnlocked()).toBe(true);
    expect(persisted.snapshot.credential).toMatchObject({
      deviceId: DEVICE_ID,
      refreshToken: INITIAL_REFRESH_TOKEN,
    });
    expect(JSON.stringify(persisted.snapshot)).not.toContain(MASTER_PASSWORD);
    expect([...STORAGE.values()].join(" ")).not.toContain(MASTER_PASSWORD);

    const loginBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(loginBody).toMatchObject({ password: MASTER_PASSWORD, rememberDevice: true });
    expect(typeof loginBody.deviceName).toBe("string");
    expect(loginBody.deviceName.length).toBeLessThanOrEqual(100);

    await importWorker();
    expect(worker.isIrisAccessUnlocked()).toBe(false);
    expect(await worker.restoreIrisAccess()).toEqual({ restored: true });
    expect(worker.isIrisAccessUnlocked()).toBe(true);
    expect(persisted.snapshot.credential?.refreshToken).toBe(ROTATED_REFRESH_TOKEN);
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/auth/refresh"))).toBe(true);

    await worker.loadIrisData("settings");
    const dataCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith("/data/settings"));
    expect(new Headers(dataCall?.[1]?.headers).get("Authorization")).toBe(`Bearer ${NEXT_ACCESS_TOKEN}`);
  });

  it("automatically renews the short session at expiry without asking for the master again", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      jsonResponse(String(input).endsWith("/auth/login")
        ? authReply(ACCESS_TOKEN, INITIAL_REFRESH_TOKEN)
        : authReply(NEXT_ACCESS_TOKEN, ROTATED_REFRESH_TOKEN)),
    );
    vi.stubGlobal("fetch", fetchMock);
    await worker.unlockIrisAccess(MASTER_PASSWORD);
    await vi.advanceTimersByTimeAsync(ACCESS_HOURS * 60 * 60 * 1000);
    expect(worker.isIrisAccessUnlocked()).toBe(true);
    expect(persisted.snapshot.credential?.refreshToken).toBe(ROTATED_REFRESH_TOKEN);
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/auth/login"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/auth/refresh"))).toHaveLength(1);
  });

  it("keeps the remembered device when Google authorization is missing", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/auth/login")) return jsonResponse(authReply(ACCESS_TOKEN, INITIAL_REFRESH_TOKEN));
      return jsonResponse({ error: "Google Calendar não autorizado. Abra POST /oauth/start." }, 401);
    });
    vi.stubGlobal("fetch", fetchMock);
    await worker.unlockIrisAccess(MASTER_PASSWORD);
    await expect(worker.googleCalendarEvents()).rejects.toThrow("Google Calendar não autorizado");
    expect(worker.isIrisAccessUnlocked()).toBe(true);
    expect(persisted.snapshot.credential?.refreshToken).toBe(INITIAL_REFRESH_TOKEN);
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/auth/refresh"))).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/auth/device/revoke"))).toHaveLength(0);
  });

  it("removes an invalid or revoked refresh credential", async () => {
    persisted.snapshot.credential = {
      deviceId: DEVICE_ID,
      refreshToken: INITIAL_REFRESH_TOKEN,
      expiresAt: Date.now() + 60_000,
      name: "Este dispositivo",
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "revoked" }, 401)));

    const restoring = worker.restoreIrisAccess();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await restoring).toEqual({ restored: false });
    expect(persisted.snapshot.credential).toBeNull();
    expect(worker.isIrisAccessUnlocked()).toBe(false);
  });

  it("preserves the saved credential when refresh fails from a network error", async () => {
    const credential = {
      deviceId: DEVICE_ID,
      refreshToken: INITIAL_REFRESH_TOKEN,
      expiresAt: Date.now() + 60_000,
      name: "Este dispositivo",
    };
    persisted.snapshot.credential = credential;
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));

    expect(await worker.restoreIrisAccess()).toEqual({ restored: false });
    expect(persisted.snapshot.credential).toEqual(credential);
    expect(worker.isIrisAccessUnlocked()).toBe(false);
  });

  it("does not fetch or restore in Demo mode", async () => {
    STORAGE.set("iris.mode", "demo");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await worker.restoreIrisAccess()).toEqual({ restored: false });
    await expect(worker.unlockIrisAccess(MASTER_PASSWORD)).rejects.toThrow("Demonstração");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(persisted.snapshot.credential).toBeNull();
  });

  it("does not resurrect a device when Protect races a refresh", async () => {
    const credential = {
      deviceId: DEVICE_ID,
      refreshToken: INITIAL_REFRESH_TOKEN,
      expiresAt: Date.now() + 60_000,
      name: "Este dispositivo",
    };
    persisted.snapshot.credential = credential;
    let startRefresh!: () => void;
    let resolveRefresh!: (response: Response) => void;
    const refreshStarted = new Promise<void>((resolve) => { startRefresh = resolve; });
    const refreshResponse = new Promise<Response>((resolve) => { resolveRefresh = resolve; });
    const revokeBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/refresh")) {
        startRefresh();
        return refreshResponse;
      }
      if (url.endsWith("/auth/device/revoke")) {
        revokeBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    const restoring = worker.restoreIrisAccess();
    await refreshStarted;
    const protecting = worker.lockIrisAccess();
    resolveRefresh(jsonResponse(authReply(NEXT_ACCESS_TOKEN, ROTATED_REFRESH_TOKEN)));
    const [restoreResult, protectResult] = await Promise.all([restoring, protecting]);

    expect(restoreResult).toEqual({ restored: false });
    expect(protectResult.storageCleared).toBe(true);
    expect(persisted.snapshot.credential).toBeNull();
    expect(worker.isIrisAccessUnlocked()).toBe(false);
    expect(revokeBodies.some((body) => body.deviceId === DEVICE_ID && body.refreshToken === ROTATED_REFRESH_TOKEN)).toBe(true);
  });

  it("revokes the newly created device if IndexedDB commit fails and does not claim it was remembered", async () => {
    persisted.failCommit = true;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/login")) return jsonResponse(authReply(ACCESS_TOKEN, INITIAL_REFRESH_TOKEN));
      if (url.endsWith("/auth/device/revoke")) return jsonResponse({ ok: true });
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(worker.unlockIrisAccess(MASTER_PASSWORD)).rejects.toThrow("dispositivo criado foi revogado");
    expect(worker.isIrisAccessUnlocked()).toBe(false);
    expect(persisted.snapshot.credential).toBeNull();
    const revoke = fetchMock.mock.calls.find(([input]) => String(input).endsWith("/auth/device/revoke"));
    expect(JSON.parse(String(revoke?.[1]?.body))).toEqual({ deviceId: DEVICE_ID, refreshToken: INITIAL_REFRESH_TOKEN });
  });

  it("rereads the latest IndexedDB refresh token and retries a single rotation conflict", async () => {
    persisted.snapshot.credential = {
      deviceId: DEVICE_ID,
      refreshToken: INITIAL_REFRESH_TOKEN,
      expiresAt: Date.now() + 60_000,
      name: "Este dispositivo",
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).endsWith("/auth/refresh")) return jsonResponse({ ok: true });
      const body = JSON.parse(String(init?.body)) as { refreshToken: string };
      if (body.refreshToken === INITIAL_REFRESH_TOKEN) {
        // Simulate another tab winning the rotation before this tab observes its 401.
        persisted.snapshot.credential = {
          ...persisted.snapshot.credential!,
          refreshToken: ROTATED_REFRESH_TOKEN,
        };
        return jsonResponse({ error: "refresh conflict" }, 401);
      }
      return jsonResponse(authReply(NEXT_ACCESS_TOKEN, "refresh-token-final"));
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await worker.restoreIrisAccess()).toEqual({ restored: true });
    const refreshBodies = fetchMock.mock.calls
      .filter(([input]) => String(input).endsWith("/auth/refresh"))
      .map(([, init]) => JSON.parse(String(init?.body)) as { refreshToken: string });
    expect(refreshBodies.map((body) => body.refreshToken)).toEqual([
      INITIAL_REFRESH_TOKEN,
      ROTATED_REFRESH_TOKEN,
    ]);
    expect(persisted.snapshot.credential?.refreshToken).toBe("refresh-token-final");
  });

  it("waits for a winning tab to commit a rotation when Web Locks are unavailable", async () => {
    persisted.snapshot.credential = {
      deviceId: DEVICE_ID, refreshToken: INITIAL_REFRESH_TOKEN,
      expiresAt: Date.now() + 60_000, name: "Este dispositivo",
    };
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { refreshToken: string };
      if (body.refreshToken === INITIAL_REFRESH_TOKEN) {
        setTimeout(() => {
          persisted.snapshot.credential = { ...persisted.snapshot.credential!, refreshToken: ROTATED_REFRESH_TOKEN };
        }, 100);
        return jsonResponse({ error: "refresh conflict" }, 401);
      }
      return jsonResponse(authReply(NEXT_ACCESS_TOKEN, "refresh-after-winner"));
    }));
    const restoring = worker.restoreIrisAccess();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await restoring).toEqual({ restored: true });
    expect(persisted.snapshot.credential?.refreshToken).toBe("refresh-after-winner");
  });

  it("reports an unconfirmed revoke if the store write fails and the Worker cannot revoke", async () => {
    persisted.failCommit = true;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/auth/login")) return jsonResponse(authReply(ACCESS_TOKEN, INITIAL_REFRESH_TOKEN));
      if (String(input).endsWith("/auth/device/revoke")) return jsonResponse({ error: "offline" }, 503);
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(worker.unlockIrisAccess(MASTER_PASSWORD)).rejects.toThrow("não confirmou a revogação");
    expect(worker.isIrisAccessUnlocked()).toBe(false);
    expect(persisted.snapshot.credential).toBeNull();
  });

  it("validates recovery master login without opt-in, memory token, or device storage", async () => {
    STORAGE.set("iris.mode", "demo");
    STORAGE.delete("iris.remoteOptIn");
    const fetchMock = vi.fn(async () => jsonResponse({
      ok: true,
      token: ACCESS_TOKEN,
      expiresAt: new Date(Date.now() + ACCESS_HOURS * 60 * 60 * 1000).toISOString(),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(worker.verifyIrisMasterForRecovery(MASTER_PASSWORD)).resolves.toBeUndefined();
    const loginBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(loginBody).toEqual({ password: MASTER_PASSWORD, rememberDevice: false });
    expect(worker.isIrisAccessUnlocked()).toBe(false);
    expect(persisted.snapshot).toEqual({ credential: null, generation: 0 });
  });
});
