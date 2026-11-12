import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLocalPinKeys,
  forgetLocalUnlock,
  getLocalLockState,
  hashPin,
  IRIS_LOCAL_UNLOCKED_KEY,
  IRIS_PIN_HASH_KEY,
  IRIS_TRUSTED_PIN_HASH_KEY,
  recoverLocalPinWithMaster,
  safeReadLocalStorage,
  safeReadSessionStorage,
  saveLocalPinHash,
  verifyLocalPin,
} from "./irisLocalLock";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
}

let localStorageMock: MemoryStorage;
let sessionStorageMock: MemoryStorage;

beforeEach(() => {
  localStorageMock = new MemoryStorage();
  sessionStorageMock = new MemoryStorage();
  vi.stubGlobal("window", {
    localStorage: localStorageMock,
    sessionStorage: sessionStorageMock,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("irisLocalLock", () => {
  it("never trusts a wrong PIN", async () => {
    const configuredHash = await hashPin("4826");
    localStorageMock.setItem(IRIS_PIN_HASH_KEY, configuredHash);
    expect(getLocalLockState().locked).toBe(true);

    const result = await verifyLocalPin("4827", true);

    expect(result.verified).toBe(false);
    expect(localStorageMock.getItem(IRIS_TRUSTED_PIN_HASH_KEY)).toBeNull();
    expect(sessionStorageMock.getItem(IRIS_LOCAL_UNLOCKED_KEY)).toBeNull();
    expect(getLocalLockState().locked).toBe(true);
  });

  it("fails closed when browser storage access throws", () => {
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("storage denied");
      },
      get sessionStorage() {
        throw new Error("storage denied");
      },
    });

    expect(getLocalLockState()).toEqual({
      locked: true,
      storageUnavailable: true,
    });
  });

  it("remembers the matching PIN hash across a cleared browser session", async () => {
    const configuredHash = await hashPin("7391");
    localStorageMock.setItem(IRIS_PIN_HASH_KEY, configuredHash);

    const result = await verifyLocalPin("7391", true);
    expect(result.verified).toBe(true);
    expect(result.preferenceSaved).toBe(true);
    expect(localStorageMock.getItem(IRIS_TRUSTED_PIN_HASH_KEY)).toBe(
      configuredHash,
    );
    expect(localStorageMock.getItem(IRIS_TRUSTED_PIN_HASH_KEY)).not.toBe(
      "7391",
    );

    sessionStorageMock.clear();
    expect(getLocalLockState()).toEqual({
      locked: false,
      storageUnavailable: false,
    });
  });

  it("replaces old browser trust with the new PIN hash when Settings changes the PIN", async () => {
    const oldHash = await hashPin("1234");
    const newHash = await hashPin("5678");
    localStorageMock.setItem(IRIS_PIN_HASH_KEY, oldHash);
    localStorageMock.setItem(IRIS_TRUSTED_PIN_HASH_KEY, oldHash);
    sessionStorageMock.removeItem(IRIS_LOCAL_UNLOCKED_KEY);

    const result = saveLocalPinHash(newHash);

    expect(result).toEqual({ saved: true, remembered: true });
    expect(safeReadLocalStorage(IRIS_PIN_HASH_KEY).value).toBe(newHash);
    expect(safeReadLocalStorage(IRIS_TRUSTED_PIN_HASH_KEY).value).toBe(newHash);
    expect(safeReadLocalStorage(IRIS_TRUSTED_PIN_HASH_KEY).value).not.toBe(
      oldHash,
    );
    sessionStorageMock.clear();
    expect(getLocalLockState().locked).toBe(false);
  });

  it("forgets local trust and unlock but preserves the configured PIN", async () => {
    const pinHash = await hashPin("2468");
    localStorageMock.setItem(IRIS_PIN_HASH_KEY, pinHash);
    localStorageMock.setItem(IRIS_TRUSTED_PIN_HASH_KEY, pinHash);
    sessionStorageMock.setItem(IRIS_LOCAL_UNLOCKED_KEY, "1");

    expect(forgetLocalUnlock()).toBe(true);
    expect(localStorageMock.getItem(IRIS_PIN_HASH_KEY)).toBe(pinHash);
    expect(localStorageMock.getItem(IRIS_TRUSTED_PIN_HASH_KEY)).toBeNull();
    expect(sessionStorageMock.getItem(IRIS_LOCAL_UNLOCKED_KEY)).toBeNull();
    expect(getLocalLockState().locked).toBe(true);
  });

  it("removes only the three PIN keys and leaves unrelated local and session data intact", () => {
    localStorageMock.setItem(IRIS_PIN_HASH_KEY, "pin-hash");
    localStorageMock.setItem(IRIS_TRUSTED_PIN_HASH_KEY, "trusted-hash");
    localStorageMock.setItem("iris.documents", "document-data");
    localStorageMock.setItem("other-app-setting", "keep-me");
    sessionStorageMock.setItem(IRIS_LOCAL_UNLOCKED_KEY, "1");
    sessionStorageMock.setItem("other-session-value", "keep-session");

    expect(clearLocalPinKeys()).toBe(true);
    expect(localStorageMock.getItem(IRIS_PIN_HASH_KEY)).toBeNull();
    expect(localStorageMock.getItem(IRIS_TRUSTED_PIN_HASH_KEY)).toBeNull();
    expect(sessionStorageMock.getItem(IRIS_LOCAL_UNLOCKED_KEY)).toBeNull();
    expect(localStorageMock.getItem("iris.documents")).toBe("document-data");
    expect(localStorageMock.getItem("other-app-setting")).toBe("keep-me");
    expect(sessionStorageMock.getItem("other-session-value")).toBe(
      "keep-session",
    );
  });

  it("does not remove PIN keys when master-password recovery validation rejects", async () => {
    const pinHash = await hashPin("8642");
    localStorageMock.setItem(IRIS_PIN_HASH_KEY, pinHash);
    localStorageMock.setItem(IRIS_TRUSTED_PIN_HASH_KEY, pinHash);
    sessionStorageMock.setItem(IRIS_LOCAL_UNLOCKED_KEY, "1");
    const verifier = vi.fn(async (_password: string) => {
      throw new Error("falha de rede");
    });

    await expect(
      recoverLocalPinWithMaster("senha mestre", verifier),
    ).rejects.toThrow("falha de rede");

    expect(verifier).toHaveBeenCalledWith("senha mestre");
    expect(localStorageMock.getItem(IRIS_PIN_HASH_KEY)).toBe(pinHash);
    expect(localStorageMock.getItem(IRIS_TRUSTED_PIN_HASH_KEY)).toBe(pinHash);
    expect(sessionStorageMock.getItem(IRIS_LOCAL_UNLOCKED_KEY)).toBe("1");
  });

  it("clears the three PIN keys only after master-password recovery validation resolves", async () => {
    const pinHash = await hashPin("9753");
    localStorageMock.setItem(IRIS_PIN_HASH_KEY, pinHash);
    localStorageMock.setItem(IRIS_TRUSTED_PIN_HASH_KEY, pinHash);
    localStorageMock.setItem("iris.catalog", "catalog-data");
    sessionStorageMock.setItem(IRIS_LOCAL_UNLOCKED_KEY, "1");
    const verifier = vi.fn(async (_password: string) => undefined);

    await recoverLocalPinWithMaster("senha mestra válida", verifier);

    expect(verifier).toHaveBeenCalledWith("senha mestra válida");
    expect(safeReadLocalStorage(IRIS_PIN_HASH_KEY).value).toBeNull();
    expect(safeReadLocalStorage(IRIS_TRUSTED_PIN_HASH_KEY).value).toBeNull();
    expect(safeReadSessionStorage(IRIS_LOCAL_UNLOCKED_KEY).value).toBeNull();
    expect(localStorageMock.getItem("iris.catalog")).toBe("catalog-data");
  });
});
