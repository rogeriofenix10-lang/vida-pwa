import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearIrisDeviceCredentialAndAdvanceGeneration,
  commitIrisDeviceCredential,
  readIrisDeviceAuthSnapshot,
} from "./irisDeviceStore";

function fakeIndexedDb(options: { failPut?: DOMException; blocked?: boolean } = {}) {
  const records = new Map<string, unknown>();
  const database = {
    objectStoreNames: { contains: () => true },
    createObjectStore: vi.fn(),
    close: vi.fn(),
    onversionchange: null as (() => void) | null,
    transaction: () => {
      const transaction: {
        oncomplete: (() => void) | null;
        onabort: (() => void) | null;
        onerror: (() => void) | null;
        error: DOMException | null;
        objectStore: () => {
          get: (key: string) => IDBRequest<unknown>;
          put: (value: { key: string }) => IDBRequest<IDBValidKey>;
          delete: (key: string) => IDBRequest<undefined>;
        };
        abort: () => void;
      } = {
        oncomplete: null,
        onabort: null,
        onerror: null,
        error: null,
        objectStore: () => store,
        abort: () => {
          queueMicrotask(() => transaction.onabort?.());
        },
      };
      let completionScheduled = false;
      const scheduleComplete = () => {
        if (completionScheduled) return;
        completionScheduled = true;
        setTimeout(() => transaction.oncomplete?.(), 0);
      };
      const store = {
        get: (key: string) => {
          const request = { onsuccess: null as (() => void) | null, onerror: null as (() => void) | null, result: undefined as unknown };
          queueMicrotask(() => {
            request.result = records.get(key);
            request.onsuccess?.();
            scheduleComplete();
          });
          return request as unknown as IDBRequest<unknown>;
        },
        put: (value: { key: string }) => {
          const request = { onsuccess: null as (() => void) | null, onerror: null as (() => void) | null, result: value.key };
          if (options.failPut) {
            transaction.error = options.failPut;
            throw options.failPut;
          }
          records.set(value.key, structuredClone(value));
          queueMicrotask(() => request.onsuccess?.());
          scheduleComplete();
          return request as unknown as IDBRequest<IDBValidKey>;
        },
        delete: (key: string) => {
          records.delete(key);
          const request = { onsuccess: null as (() => void) | null, onerror: null as (() => void) | null, result: undefined };
          queueMicrotask(() => request.onsuccess?.());
          scheduleComplete();
          return request as unknown as IDBRequest<undefined>;
        },
      };
      return transaction as unknown as IDBTransaction;
    },
  } as unknown as IDBDatabase;
  const factory = {
    open: () => {
      const request: Record<string, unknown> = {};
      queueMicrotask(() => {
        if (options.blocked) {
          (request.onblocked as (() => void) | null)?.();
          return;
        }
        request.result = database;
        (request.onupgradeneeded as (() => void) | null)?.();
        (request.onsuccess as (() => void) | null)?.();
      });
      return request as unknown as IDBOpenDBRequest;
    },
  };
  return { factory, records };
}

afterEach(() => vi.unstubAllGlobals());

describe("separate Iris device credential store", () => {
  it("commits only against the read snapshot and advances a durable clear fence", async () => {
    const { factory, records } = fakeIndexedDb();
    vi.stubGlobal("indexedDB", factory);
    const firstSnapshot = await readIrisDeviceAuthSnapshot();
    const credential = {
      deviceId: "device-1",
      refreshToken: "refresh-secret",
      expiresAt: Date.now() + 60_000,
      name: "Este dispositivo",
    };

    expect(await commitIrisDeviceCredential(credential, firstSnapshot)).toBe(true);
    expect(records.get("current")).toMatchObject({ deviceId: "device-1", refreshToken: "refresh-secret" });
    expect(records.get("current")).not.toHaveProperty("password");
    expect(await commitIrisDeviceCredential(credential, firstSnapshot)).toBe(false);

    const cleared = await clearIrisDeviceCredentialAndAdvanceGeneration();
    expect(cleared.credential?.deviceId).toBe("device-1");
    expect(cleared.generation).toBe(1);
    expect(records.has("current")).toBe(false);
    expect((await readIrisDeviceAuthSnapshot()).generation).toBe(1);
  });

  it("reports blocked IndexedDB rather than claiming the device was remembered", async () => {
    vi.stubGlobal("indexedDB", fakeIndexedDb({ blocked: true }).factory);
    await expect(readIrisDeviceAuthSnapshot()).rejects.toMatchObject({ code: "blocked" });
  });

  it("reports quota failures with a storage-specific code", async () => {
    vi.stubGlobal("indexedDB", fakeIndexedDb({
      failPut: new DOMException("full", "QuotaExceededError"),
    }).factory);
    const snapshot = await readIrisDeviceAuthSnapshot();
    await expect(commitIrisDeviceCredential({
      deviceId: "device-1",
      refreshToken: "refresh-secret",
      expiresAt: Date.now() + 60_000,
      name: "Este dispositivo",
    }, snapshot)).rejects.toMatchObject({ code: "quota" });
  });

  it("reports unavailable IndexedDB in privacy-restricted browser contexts", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(readIrisDeviceAuthSnapshot()).rejects.toMatchObject({ code: "unavailable" });
  });
});
