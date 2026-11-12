const DATABASE_NAME = "iris-device-auth";
const DATABASE_VERSION = 1;
const OBJECT_STORE_NAME = "credentials";
const CURRENT_CREDENTIAL_KEY = "current";
const CONTROL_KEY = "control";

export type IrisDeviceCredential = {
  deviceId: string;
  refreshToken: string;
  expiresAt: number;
  name: string;
};

export type IrisDeviceAuthSnapshot = {
  credential: IrisDeviceCredential | null;
  generation: number;
};

type CredentialRecord = IrisDeviceCredential & { key: typeof CURRENT_CREDENTIAL_KEY };
type ControlRecord = { key: typeof CONTROL_KEY; generation: number };

type StoreErrorCode = "unavailable" | "blocked" | "quota" | "read" | "write";

export class IrisDeviceStoreError extends Error {
  readonly code: StoreErrorCode;

  constructor(code: StoreErrorCode, message: string) {
    super(message);
    this.name = "IrisDeviceStoreError";
    this.code = code;
  }
}

function storeError(code: StoreErrorCode, cause?: unknown): IrisDeviceStoreError {
  if (cause instanceof IrisDeviceStoreError) return cause;
  const name = cause instanceof DOMException ? cause.name : "";
  if (name === "QuotaExceededError") {
    return new IrisDeviceStoreError(
      "quota",
      "O armazenamento do navegador está sem espaço; não foi possível salvar a credencial deste dispositivo.",
    );
  }
  if (code === "blocked") {
    return new IrisDeviceStoreError(
      "blocked",
      "O armazenamento seguro deste dispositivo está bloqueado por outra conexão do navegador.",
    );
  }
  if (code === "unavailable") {
    return new IrisDeviceStoreError(
      "unavailable",
      "O armazenamento seguro deste dispositivo não está disponível neste navegador.",
    );
  }
  return new IrisDeviceStoreError(
    code,
    code === "read"
      ? "Não foi possível ler a credencial segura deste dispositivo."
      : "Não foi possível atualizar a credencial segura deste dispositivo.",
  );
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(storeError("unavailable"));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (error) {
      reject(storeError("unavailable", error));
      return;
    }

    const fail = (error: unknown, code: StoreErrorCode = "read") => {
      if (settled) return;
      settled = true;
      reject(storeError(code, error));
    };

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(OBJECT_STORE_NAME)) {
        database.createObjectStore(OBJECT_STORE_NAME, { keyPath: "key" });
      }
    };
    request.onblocked = () => fail(undefined, "blocked");
    request.onerror = () => fail(request.error, "read");
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(storeError("write", transaction.error));
    transaction.onerror = () => {
      // onabort supplies the final error and keeps quota failures distinguishable.
    };
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function validCredential(value: unknown): IrisDeviceCredential | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<CredentialRecord>;
  if (
    record.key !== CURRENT_CREDENTIAL_KEY ||
    typeof record.deviceId !== "string" ||
    !record.deviceId ||
    typeof record.refreshToken !== "string" ||
    !record.refreshToken ||
    typeof record.expiresAt !== "number" ||
    !Number.isFinite(record.expiresAt) ||
    typeof record.name !== "string"
  ) {
    return null;
  }
  return {
    deviceId: record.deviceId,
    refreshToken: record.refreshToken,
    expiresAt: record.expiresAt,
    name: record.name,
  };
}

function generationFrom(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const generation = (value as Partial<ControlRecord>).generation;
  return typeof generation === "number" && Number.isSafeInteger(generation) && generation >= 0
    ? generation
    : 0;
}

function sameCredential(
  left: IrisDeviceCredential | null,
  right: IrisDeviceCredential | null,
): boolean {
  return left === null || right === null
    ? left === right
    : left.deviceId === right.deviceId &&
        left.refreshToken === right.refreshToken &&
        left.expiresAt === right.expiresAt;
}

async function readRecords(
  database: IDBDatabase,
  mode: IDBTransactionMode,
): Promise<{ credential: IrisDeviceCredential | null; generation: number; store: IDBObjectStore; transaction: IDBTransaction; done: Promise<void> }> {
  const transaction = database.transaction(OBJECT_STORE_NAME, mode);
  const done = transactionCompletion(transaction);
  const store = transaction.objectStore(OBJECT_STORE_NAME);
  try {
    const [credentialValue, controlValue] = await Promise.all([
      requestResult(store.get(CURRENT_CREDENTIAL_KEY)),
      requestResult(store.get(CONTROL_KEY)),
    ]);
    return {
      credential: validCredential(credentialValue),
      generation: generationFrom(controlValue),
      store,
      transaction,
      done,
    };
  } catch (error) {
    await done.catch(() => undefined);
    throw storeError("read", error);
  }
}

export async function readIrisDeviceAuthSnapshot(): Promise<IrisDeviceAuthSnapshot> {
  const database = await openDatabase();
  try {
    const result = await readRecords(database, "readonly");
    await result.done;
    return { credential: result.credential, generation: result.generation };
  } catch (error) {
    throw storeError("read", error);
  } finally {
    database.close();
  }
}

/** Atomically write only if neither Protect/Demo nor another refresh changed the snapshot. */
export async function commitIrisDeviceCredential(
  credential: IrisDeviceCredential,
  expected: IrisDeviceAuthSnapshot,
): Promise<boolean> {
  const database = await openDatabase();
  try {
    const result = await readRecords(database, "readwrite");
    if (
      result.generation !== expected.generation ||
      !sameCredential(result.credential, expected.credential)
    ) {
      result.transaction.abort();
      await result.done.catch(() => undefined);
      return false;
    }
    result.store.put({ ...credential, key: CURRENT_CREDENTIAL_KEY } satisfies CredentialRecord);
    await result.done;
    return true;
  } catch (error) {
    throw storeError("write", error);
  } finally {
    database.close();
  }
}

/** Clear the credential and advance a durable fence in one committed transaction. */
export async function clearIrisDeviceCredentialAndAdvanceGeneration(): Promise<{
  credential: IrisDeviceCredential | null;
  generation: number;
}> {
  const database = await openDatabase();
  try {
    const result = await readRecords(database, "readwrite");
    const nextGeneration = result.generation + 1;
    if (!Number.isSafeInteger(nextGeneration)) {
      result.transaction.abort();
      await result.done.catch(() => undefined);
      throw storeError("write");
    }
    result.store.delete(CURRENT_CREDENTIAL_KEY);
    result.store.put({ key: CONTROL_KEY, generation: nextGeneration } satisfies ControlRecord);
    await result.done;
    return { credential: result.credential, generation: nextGeneration };
  } catch (error) {
    throw storeError("write", error);
  } finally {
    database.close();
  }
}

/** Remove only the credential that failed refresh, without deleting a newer rotation. */
export async function deleteIrisDeviceCredentialIfCurrent(
  expected: IrisDeviceCredential,
): Promise<boolean> {
  const database = await openDatabase();
  try {
    const result = await readRecords(database, "readwrite");
    if (!sameCredential(result.credential, expected)) {
      result.transaction.abort();
      await result.done.catch(() => undefined);
      return false;
    }
    const nextGeneration = result.generation + 1;
    result.store.delete(CURRENT_CREDENTIAL_KEY);
    result.store.put({ key: CONTROL_KEY, generation: nextGeneration } satisfies ControlRecord);
    await result.done;
    return true;
  } catch (error) {
    throw storeError("write", error);
  } finally {
    database.close();
  }
}

/** Clear the locally remembered device after an authenticated server-side revocation. */
export async function clearIrisDeviceCredentialIfCurrent(
  expected: IrisDeviceCredential,
): Promise<boolean> {
  return deleteIrisDeviceCredentialIfCurrent(expected);
}
