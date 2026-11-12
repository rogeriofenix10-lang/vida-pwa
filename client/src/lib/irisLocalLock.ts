export const IRIS_PIN_HASH_KEY = "iris.pinHash";
export const IRIS_TRUSTED_PIN_HASH_KEY = "iris.trustedPinHash";
export const IRIS_LOCAL_UNLOCKED_KEY = "iris.unlocked";

export type SafeStorageRead = {
  available: boolean;
  value: string | null;
};

export type LocalLockState = {
  locked: boolean;
  storageUnavailable: boolean;
};

export type LocalPinVerification = {
  verified: boolean;
  preferenceSaved: boolean;
  sessionSaved: boolean;
};

export type LocalPinSaveResult = {
  saved: boolean;
  remembered: boolean;
};

type StorageKind = "local" | "session";

function getStorage(kind: StorageKind): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function safeRead(kind: StorageKind, key: string): SafeStorageRead {
  const storage = getStorage(kind);
  if (!storage) return { available: false, value: null };
  try {
    return { available: true, value: storage.getItem(key) };
  } catch {
    return { available: false, value: null };
  }
}

function safeWrite(kind: StorageKind, key: string, value: string): boolean {
  const storage = getStorage(kind);
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemove(kind: StorageKind, key: string): boolean {
  const storage = getStorage(kind);
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function safeReadLocalStorage(key: string): SafeStorageRead {
  return safeRead("local", key);
}

export function safeWriteLocalStorage(key: string, value: string): boolean {
  return safeWrite("local", key, value);
}

export function safeRemoveLocalStorage(key: string): boolean {
  return safeRemove("local", key);
}

export function safeReadSessionStorage(key: string): SafeStorageRead {
  return safeRead("session", key);
}

export function safeWriteSessionStorage(key: string, value: string): boolean {
  return safeWrite("session", key, value);
}

export function safeRemoveSessionStorage(key: string): boolean {
  return safeRemove("session", key);
}

export async function hashPin(pin: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(pin),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function getLocalPinHash(): string | null {
  const result = safeReadLocalStorage(IRIS_PIN_HASH_KEY);
  return result.available ? result.value : null;
}

export function getLocalLockState(): LocalLockState {
  const pinHash = safeReadLocalStorage(IRIS_PIN_HASH_KEY);
  if (!pinHash.available) return { locked: true, storageUnavailable: true };
  if (!pinHash.value) return { locked: false, storageUnavailable: false };

  const sessionUnlock = safeReadSessionStorage(IRIS_LOCAL_UNLOCKED_KEY);
  if (sessionUnlock.available && sessionUnlock.value === "1") {
    return { locked: false, storageUnavailable: false };
  }

  const trustedPinHash = safeReadLocalStorage(IRIS_TRUSTED_PIN_HASH_KEY);
  if (trustedPinHash.available && trustedPinHash.value === pinHash.value) {
    return { locked: false, storageUnavailable: false };
  }

  return {
    locked: true,
    storageUnavailable: !sessionUnlock.available && !trustedPinHash.available,
  };
}

/**
 * A trusted browser is recognized only when the stored marker exactly matches
 * the current PIN hash. Existing PIN hashes are never trusted automatically.
 */
export async function verifyLocalPin(
  pin: string,
  rememberThisBrowser: boolean,
): Promise<LocalPinVerification> {
  const storedHash = safeReadLocalStorage(IRIS_PIN_HASH_KEY);
  if (!storedHash.available || !storedHash.value) {
    return { verified: false, preferenceSaved: false, sessionSaved: false };
  }

  const enteredHash = await hashPin(pin);
  if (enteredHash !== storedHash.value) {
    return { verified: false, preferenceSaved: false, sessionSaved: false };
  }

  // Persist the hash only after the entered PIN has matched iris.pinHash.
  const preferenceSaved = rememberThisBrowser
    ? safeWriteLocalStorage(IRIS_TRUSTED_PIN_HASH_KEY, storedHash.value)
    : safeRemoveLocalStorage(IRIS_TRUSTED_PIN_HASH_KEY);
  const sessionSaved = preferenceSaved && safeWriteSessionStorage(IRIS_LOCAL_UNLOCKED_KEY, "1");
  return { verified: true, preferenceSaved, sessionSaved };
}

/**
 * Settings calls this only after the user has reached the authenticated local
 * application. Replacing the hash invalidates the old trusted marker, then
 * remembers the new hash (never the PIN text) on this browser.
 */
export function saveLocalPinHash(newPinHash: string): LocalPinSaveResult {
  if (!/^[a-f0-9]{64}$/i.test(newPinHash)) {
    return { saved: false, remembered: false };
  }

  safeRemoveLocalStorage(IRIS_TRUSTED_PIN_HASH_KEY);
  const saved = safeWriteLocalStorage(IRIS_PIN_HASH_KEY, newPinHash);
  if (!saved) return { saved: false, remembered: false };

  const remembered = safeWriteLocalStorage(
    IRIS_TRUSTED_PIN_HASH_KEY,
    newPinHash,
  );
  safeWriteSessionStorage(IRIS_LOCAL_UNLOCKED_KEY, "1");
  return { saved: true, remembered };
}

/** Removes only the three local-PIN keys. It does not touch app data or IndexedDB. */
export function clearLocalPinKeys(): boolean {
  const sessionRemoved = safeRemoveSessionStorage(IRIS_LOCAL_UNLOCKED_KEY);
  const trustRemoved = safeRemoveLocalStorage(IRIS_TRUSTED_PIN_HASH_KEY);
  const pinRemoved = safeRemoveLocalStorage(IRIS_PIN_HASH_KEY);
  return sessionRemoved && trustRemoved && pinRemoved;
}

/** Forget the browser's remembered trust and current-session unlock, but keep the PIN. */
export function forgetLocalUnlock(): boolean {
  const trustRemoved = safeRemoveLocalStorage(IRIS_TRUSTED_PIN_HASH_KEY);
  const sessionRemoved = safeRemoveSessionStorage(IRIS_LOCAL_UNLOCKED_KEY);
  return trustRemoved && sessionRemoved;
}

/**
 * Recovery is intentionally fail-closed: no PIN keys are removed unless the
 * supplied remote verifier resolves successfully.
 */
export async function recoverLocalPinWithMaster(
  password: string,
  verifyMaster: (password: string) => Promise<void>,
): Promise<void> {
  if (!password) throw new Error("Informe a senha mestra para continuar.");
  await verifyMaster(password);
  if (!clearLocalPinKeys()) {
    throw new Error(
      "A senha foi validada, mas não foi possível remover a proteção local neste navegador.",
    );
  }
}
