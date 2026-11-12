import {
  clearIrisDeviceCredentialAndAdvanceGeneration,
  clearIrisDeviceCredentialIfCurrent,
  commitIrisDeviceCredential,
  deleteIrisDeviceCredentialIfCurrent,
  readIrisDeviceAuthSnapshot,
  type IrisDeviceAuthSnapshot,
  type IrisDeviceCredential,
} from "./irisDeviceStore";

const DEFAULT_WORKER_URL = "https://iris-gemini-proxy.rogeriofenix10.workers.dev";
const MAX_REMOTE_PASSWORD_LENGTH = 256;
const MAX_DEVICE_NAME_LENGTH = 100;
const ACCESS_CHANGED_EVENT = "iris-access-changed";
const DEVICE_STATUS_EVENT = "iris-device-auth-status";
const REMOTE_OPT_IN_KEY = "iris.remoteOptIn";
const REFRESH_LOCK_NAME = "iris-device-refresh";

export const IRIS_WORKER_URL = String(
  import.meta.env.VITE_IRIS_WORKER_URL ?? DEFAULT_WORKER_URL,
).replace(/\/$/, "");

let workerBearerToken: string | null = null;
let workerTokenExpiresAt: number | null = null;
let localGeneration = 0;
let accessExpiryTimer: ReturnType<typeof setTimeout> | undefined;
let fallbackLockTail: Promise<void> = Promise.resolve();
let fallbackRefreshPromise: Promise<string | null> | null = null;
type AsyncWebLockManager = {
  request<T>(name: string, callback: (lock: Lock | null) => Promise<T>): Promise<T>;
};

type WorkerResponse = {
  text?: string;
  error?: string;
  details?: string;
  model?: string;
};

type AuthDeviceResponse = {
  id?: string;
  refreshToken?: string;
  expiresAt?: string | number;
  name?: string;
};

type AuthResponse = {
  ok?: boolean;
  token?: string;
  expiresAt?: string | number;
  expiresIn?: number;
  device?: AuthDeviceResponse;
  error?: string;
  details?: string;
};

export type IrisRemoteDevice = {
  id: string;
  name: string;
  createdAt: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
};

export type IrisLockResult = {
  storageCleared: boolean;
  revokeAttempted: boolean;
  revoked: boolean;
  error?: string;
};

function dispatchAccessChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(ACCESS_CHANGED_EVENT));
}

function notifyDeviceStatus(message: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(DEVICE_STATUS_EVENT, { detail: message }));
  }
}

function clearMemoryAccess(announce = true) {
  workerBearerToken = null;
  workerTokenExpiresAt = null;
  if (accessExpiryTimer !== undefined) {
    clearTimeout(accessExpiryTimer);
    accessExpiryTimer = undefined;
  }
  if (announce) dispatchAccessChanged();
}

function parseExpiry(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value))
    return value < 1_000_000_000_000 ? value * 1000 : value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isIrisRemoteModeEnabled() {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem("iris.mode") === "connected" &&
      localStorage.getItem(REMOTE_OPT_IN_KEY) === "1";
  } catch {
    return false;
  }
}

export { isIrisRemoteModeEnabled };

function setMemoryAccess(token: string, expiresAt: number, expectedGeneration: number) {
  if (expectedGeneration !== localGeneration || !isIrisRemoteModeEnabled()) return false;
  workerBearerToken = token;
  workerTokenExpiresAt = expiresAt;
  if (accessExpiryTimer !== undefined) clearTimeout(accessExpiryTimer);
  const delay = Math.max(0, Math.min(expiresAt - Date.now(), 2_147_000_000));
  accessExpiryTimer = setTimeout(() => {
    if (workerBearerToken === token && workerTokenExpiresAt === expiresAt) {
      // Access tokens expire from memory only; the separate refresh credential remains persisted.
      clearMemoryAccess();
      void restoreIrisAccess();
    }
  }, delay);
  dispatchAccessChanged();
  return true;
}

export function isIrisAccessUnlocked() {
  if (!isIrisRemoteModeEnabled()) {
    if (workerBearerToken) clearMemoryAccess();
    return false;
  }
  if (!workerBearerToken) return false;
  if (workerTokenExpiresAt !== null && Date.now() >= workerTokenExpiresAt) {
    clearMemoryAccess();
    return false;
  }
  return true;
}

function navigatorLocks(): AsyncWebLockManager | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as unknown as { locks?: AsyncWebLockManager }).locks;
}

function withFallbackMutex<T>(operation: () => Promise<T>): Promise<T> {
  const run = fallbackLockTail.then(operation, operation);
  fallbackLockTail = run.then(() => undefined, () => undefined);
  return run;
}

function withDeviceLock<T>(operation: () => Promise<T>): Promise<T> {
  const locks = navigatorLocks();
  return locks
    ? locks.request<T>(REFRESH_LOCK_NAME, () => operation())
    : withFallbackMutex(operation);
}

function coordinateRefresh(operation: () => Promise<string | null>): Promise<string | null> {
  const locks = navigatorLocks();
  if (locks) return locks.request<string | null>(REFRESH_LOCK_NAME, () => operation());
  if (fallbackRefreshPromise) return fallbackRefreshPromise;
  fallbackRefreshPromise = withFallbackMutex(operation).finally(() => {
    fallbackRefreshPromise = null;
  });
  return fallbackRefreshPromise;
}

function currentGenerationIs(expected: number) {
  return localGeneration === expected && isIrisRemoteModeEnabled();
}

function sameRefreshCredential(
  left: IrisDeviceCredential | null,
  right: IrisDeviceCredential | null,
) {
  return Boolean(
    left && right && left.deviceId === right.deviceId && left.refreshToken === right.refreshToken,
  );
}

function storeErrorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : "O armazenamento seguro deste dispositivo não está disponível.";
}

async function authPost(path: string, body: unknown) {
  let response: Response;
  try {
    response = await fetch(`${IRIS_WORKER_URL}${path}`, {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Não foi possível acessar a autenticação remota agora.");
  }
  const data = (await response.json().catch(() => ({}))) as AuthResponse;
  return { response, data };
}

async function revokeWithRefresh(credential: IrisDeviceCredential) {
  const { response, data } = await authPost("/auth/device/revoke", {
    deviceId: credential.deviceId,
    refreshToken: credential.refreshToken,
  });
  return response.ok && data.ok === true;
}

function validAccessResponse(data: AuthResponse) {
  const expiresAt = parseExpiry(data.expiresAt);
  return data.ok === true && typeof data.token === "string" && data.token.length > 0 &&
    expiresAt !== null && expiresAt > Date.now()
    ? expiresAt
    : null;
}

function validDeviceResponse(device: AuthDeviceResponse | undefined): IrisDeviceCredential | null {
  const expiresAt = parseExpiry(device?.expiresAt);
  if (
    typeof device?.id !== "string" || !device.id ||
    typeof device.refreshToken !== "string" || !device.refreshToken ||
    expiresAt === null || expiresAt <= Date.now()
  ) return null;
  return {
    deviceId: device.id,
    refreshToken: device.refreshToken,
    expiresAt,
    name: typeof device.name === "string" ? device.name : "Este navegador",
  };
}

function loginFailureMessage(status: number) {
  return status === 401 || status === 403
    ? "A senha master não foi aceita. Confira e tente novamente."
    : "Não foi possível validar o acesso remoto agora.";
}

function currentDeviceName() {
  if (typeof navigator === "undefined") return "Navegador atual";
  const agent = navigator.userAgent;
  const browser = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox" :
    /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "Navegador";
  const platform = navigator.platform ? ` em ${navigator.platform}` : "";
  return `Este dispositivo · ${browser}${platform}`.slice(0, MAX_DEVICE_NAME_LENGTH);
}

export async function unlockIrisAccess(
  password: string,
  rememberDevice = true,
): Promise<{ ok: true; remembered: boolean; warning?: string }> {
  if (!isIrisRemoteModeEnabled()) {
    throw new Error("O modo Demonstração está ativo e não envia dados. Ative os serviços remotos nas Configurações antes de desbloquear.");
  }
  if (typeof password !== "string" || password.length === 0 || password.length > MAX_REMOTE_PASSWORD_LENGTH) {
    throw new Error("Informe uma senha master válida com até 256 caracteres.");
  }

  let expectedGeneration = localGeneration;
  let expectedSnapshot: IrisDeviceAuthSnapshot | null = null;
  if (rememberDevice) {
    try {
      expectedSnapshot = await readIrisDeviceAuthSnapshot();
    } catch (error) {
      throw new Error(storeErrorText(error));
    }
    if (!currentGenerationIs(expectedGeneration)) {
      throw new Error("O acesso foi cancelado porque o modo remoto mudou.");
    }
  } else {
    const lockResult = await lockIrisAccess();
    if (!lockResult.storageCleared || (lockResult.revokeAttempted && !lockResult.revoked)) {
      throw new Error(lockResult.error ?? "Não foi possível remover a lembrança anterior deste dispositivo.");
    }
    expectedGeneration = localGeneration;
  }

  const { response, data } = await authPost("/auth/login", {
    password,
    rememberDevice,
    ...(rememberDevice ? { deviceName: currentDeviceName() } : {}),
  });
  const accessExpiry = validAccessResponse(data);
  if (!response.ok || accessExpiry === null) throw new Error(loginFailureMessage(response.status));

  if (!rememberDevice && data.device) {
    const accidentalDevice = validDeviceResponse(data.device);
    if (accidentalDevice) {
      let revoked = false;
      try { revoked = await revokeWithRefresh(accidentalDevice); } catch { /* report below */ }
      throw new Error(revoked
        ? "O Worker criou uma sessão lembrável apesar da opção desativada; ela foi revogada. Tente novamente."
        : "O Worker criou uma sessão lembrável apesar da opção desativada e não confirmou a revogação. Remova-a no painel de dispositivos.");
    }
  }

  const deviceCredential = rememberDevice ? validDeviceResponse(data.device) : null;
  if (rememberDevice && deviceCredential && expectedSnapshot) {
    if (!currentGenerationIs(expectedGeneration)) {
      let revoked = false;
      try { revoked = await revokeWithRefresh(deviceCredential); } catch { /* report below */ }
      throw new Error(revoked
        ? "O acesso foi cancelado e o novo dispositivo foi revogado."
        : "O acesso foi cancelado, mas o Worker não confirmou a revogação do novo dispositivo.");
    }

    try {
      const committed = await commitIrisDeviceCredential(deviceCredential, expectedSnapshot);
      if (!committed) {
        let revoked = false;
        try { revoked = await revokeWithRefresh(deviceCredential); } catch { /* report below */ }
        throw new Error(revoked
          ? "O modo foi protegido durante o login; o novo dispositivo foi revogado e não será lembrado."
          : "O modo foi protegido durante o login; a credencial não foi salva e a revogação do novo dispositivo não foi confirmada.");
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("O modo foi protegido")) throw error;
      let revoked = false;
      try { revoked = await revokeWithRefresh(deviceCredential); } catch { /* report below */ }
      throw new Error(revoked
        ? `A senha foi aceita, mas o armazenamento seguro falhou; o dispositivo criado foi revogado. ${storeErrorText(error)}`
        : `A senha foi aceita, mas o armazenamento seguro falhou e o Worker não confirmou a revogação do dispositivo criado. Remova-o em outro dispositivo quando estiver online. ${storeErrorText(error)}`);
    }

    const applied = await withDeviceLock(async () => {
      if (!currentGenerationIs(expectedGeneration)) return false;
      let latest: IrisDeviceAuthSnapshot;
      try { latest = await readIrisDeviceAuthSnapshot(); } catch { return false; }
      if (latest.generation !== expectedSnapshot?.generation || !sameRefreshCredential(latest.credential, deviceCredential)) return false;
      return setMemoryAccess(data.token!, accessExpiry, expectedGeneration);
    });
    if (!applied) {
      let revoked = false;
      try { revoked = await revokeWithRefresh(deviceCredential); } catch { /* report below */ }
      await clearIrisDeviceCredentialIfCurrent(deviceCredential).catch(() => false);
      throw new Error(revoked
        ? "O dispositivo foi protegido durante o login e sua credencial não será mantida."
        : "O dispositivo foi protegido durante o login; o Worker não confirmou a revogação da credencial recém-criada.");
    }
    const previousCredential = expectedSnapshot.credential;
    if (previousCredential && previousCredential.deviceId !== deviceCredential.deviceId) {
      let warning: string | undefined;
      try {
        if (!await revokeWithRefresh(previousCredential)) {
          warning = "O novo dispositivo foi lembrado, mas o Worker não confirmou a revogação da sessão anterior deste navegador.";
        }
      } catch {
        warning = "O novo dispositivo foi lembrado, mas não foi possível contatar o Worker para confirmar a revogação da sessão anterior.";
      }
      if (warning) {
        notifyDeviceStatus(warning);
        return { ok: true, remembered: true, warning };
      }
    }
    return { ok: true, remembered: true };
  }

  // A legacy Worker may omit `device`; its bearer remains memory-only and is never called remembered.
  if (!currentGenerationIs(expectedGeneration)) throw new Error("O acesso foi cancelado porque o modo remoto mudou.");
  const applied = await withDeviceLock(async () => {
    if (!currentGenerationIs(expectedGeneration)) return false;
    return setMemoryAccess(data.token!, accessExpiry, expectedGeneration);
  });
  if (!applied) throw new Error("O acesso foi cancelado porque o modo remoto mudou.");
  return { ok: true, remembered: false };
}

async function performRefresh(
  snapshot: IrisDeviceAuthSnapshot,
  expectedGeneration: number,
  retriesRemaining: number,
): Promise<string | null> {
  const credential = snapshot.credential;
  if (!credential || !currentGenerationIs(expectedGeneration)) return null;
  if (credential.expiresAt <= Date.now()) {
    const deleted = await deleteIrisDeviceCredentialIfCurrent(credential).catch(() => false);
    clearMemoryAccess();
    notifyDeviceStatus(deleted
      ? "A lembrança deste dispositivo expirou após inatividade e foi removida; desbloqueie novamente com a senha master."
      : "A lembrança deste dispositivo expirou, mas sua remoção não foi confirmada. Use Proteger em Configurações; não limpe os dados do site, pois há documentos locais.");
    return null;
  }

  const { response, data } = await authPost("/auth/refresh", {
    deviceId: credential.deviceId,
    refreshToken: credential.refreshToken,
  });

  if (response.status === 401) {
    let latest = await readIrisDeviceAuthSnapshot();
    // Older browsers lack cross-tab Web Locks. Give the winning tab time to commit
    // its rotated credential before treating a CAS conflict as a revoked device.
    if (!navigatorLocks()) {
      for (let attempt = 0; attempt < 5 && latest.generation === snapshot.generation &&
        sameRefreshCredential(latest.credential, credential); attempt++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 200));
        latest = await readIrisDeviceAuthSnapshot();
        if (!currentGenerationIs(expectedGeneration)) return null;
      }
    }
    if (latest.generation !== snapshot.generation) return null;
    if (retriesRemaining > 0 && latest.credential &&
      latest.credential.deviceId === credential.deviceId &&
      latest.credential.refreshToken !== credential.refreshToken) {
      return performRefresh(latest, expectedGeneration, retriesRemaining - 1);
    }
    const deleted = await deleteIrisDeviceCredentialIfCurrent(credential).catch(() => false);
    clearMemoryAccess();
    notifyDeviceStatus(deleted
      ? "O Worker recusou a credencial deste dispositivo; ela foi removida do armazenamento local. Desbloqueie novamente com a senha master."
      : "O Worker recusou a credencial e sua remoção não foi confirmada. Use Proteger ou Remover dispositivo em Configurações quando estiver online; preserve os dados do site.");
    return null;
  }
  if (!response.ok) {
    throw new Error("Não foi possível renovar o acesso remoto agora; a credencial salva foi preservada para nova tentativa.");
  }

  const accessExpiry = validAccessResponse(data);
  const nextCredential = validDeviceResponse(data.device);
  if (accessExpiry === null || !nextCredential || nextCredential.deviceId !== credential.deviceId) {
    throw new Error("O Worker retornou uma resposta de renovação inválida; a credencial salva foi preservada.");
  }
  if (!currentGenerationIs(expectedGeneration)) {
    try { await revokeWithRefresh(nextCredential); } catch {
      notifyDeviceStatus("O modo foi protegido durante a renovação; não foi possível confirmar a revogação no Worker.");
    }
    return null;
  }

  let committed: boolean;
  try {
    committed = await commitIrisDeviceCredential(nextCredential, snapshot);
  } catch (error) {
    let revoked = false;
    try { revoked = await revokeWithRefresh(nextCredential); } catch { /* report below */ }
    await deleteIrisDeviceCredentialIfCurrent(credential).catch(() => false);
    clearMemoryAccess();
    throw new Error(revoked
      ? `A renovação foi cancelada porque não foi possível salvar a nova credencial; o dispositivo foi revogado. ${storeErrorText(error)}`
      : `A renovação foi cancelada porque não foi possível salvar a nova credencial e o Worker não confirmou a revogação. ${storeErrorText(error)}`);
  }

  if (!committed) {
    const latest = await readIrisDeviceAuthSnapshot();
    if (latest.generation !== snapshot.generation || !currentGenerationIs(expectedGeneration)) {
      try { await revokeWithRefresh(nextCredential); } catch {
        notifyDeviceStatus("O modo foi protegido durante a renovação; não foi possível confirmar a revogação no Worker.");
      }
      return null;
    }
    if (retriesRemaining > 0 && latest.credential &&
      latest.credential.deviceId === credential.deviceId &&
      latest.credential.refreshToken !== credential.refreshToken) {
      return performRefresh(latest, expectedGeneration, retriesRemaining - 1);
    }
    throw new Error("A credencial mudou em outra aba; tente novamente para renovar o acesso.");
  }

  if (!setMemoryAccess(data.token!, accessExpiry, expectedGeneration)) {
    try { await revokeWithRefresh(nextCredential); } catch {
      notifyDeviceStatus("O modo foi protegido durante a renovação; não foi possível confirmar a revogação no Worker.");
    }
    return null;
  }
  return data.token!;
}

async function refreshFromStoredDevice(expectedGeneration: number): Promise<string | null> {
  if (!isIrisRemoteModeEnabled() || expectedGeneration !== localGeneration) return null;
  return coordinateRefresh(async () => {
    if (!currentGenerationIs(expectedGeneration)) return null;
    const snapshot = await readIrisDeviceAuthSnapshot();
    if (!snapshot.credential) return null;
    return performRefresh(snapshot, expectedGeneration, 1);
  });
}

export async function restoreIrisAccess(): Promise<{ restored: boolean }> {
  if (!isIrisRemoteModeEnabled()) return { restored: false };
  if (isIrisAccessUnlocked()) return { restored: true };
  const expectedGeneration = localGeneration;
  try {
    const token = await refreshFromStoredDevice(expectedGeneration);
    if (!token) return { restored: false };
    notifyDeviceStatus("A sessão remota foi restaurada após validar a credencial deste dispositivo.");
    return { restored: true };
  } catch (error) {
    if (currentGenerationIs(expectedGeneration)) {
      notifyDeviceStatus(error instanceof Error
        ? error.message
        : "Não foi possível restaurar agora; a credencial salva foi preservada quando possível.");
    }
    return { restored: false };
  }
}

export async function isIrisDeviceRemembered(): Promise<boolean> {
  try {
    const snapshot = await readIrisDeviceAuthSnapshot();
    return Boolean(snapshot.credential && snapshot.credential.expiresAt > Date.now());
  } catch (error) {
    notifyDeviceStatus(storeErrorText(error));
    return false;
  }
}

export async function lockIrisAccess(): Promise<IrisLockResult> {
  localGeneration += 1;
  clearMemoryAccess();
  let credential: IrisDeviceCredential | null = null;
  let storageCleared = false;
  let error: string | undefined;
  try {
    const result = await withDeviceLock(() => clearIrisDeviceCredentialAndAdvanceGeneration());
    credential = result.credential;
    storageCleared = true;
  } catch (storeFailure) {
    error = storeErrorText(storeFailure);
    notifyDeviceStatus(error);
    try { credential = (await readIrisDeviceAuthSnapshot()).credential; } catch { /* unavailable */ }
  }

  let revoked = false;
  let revokeAttempted = false;
  if (credential) {
    revokeAttempted = true;
    try {
      revoked = await revokeWithRefresh(credential);
      if (!revoked) error = "O Worker não confirmou a revogação deste dispositivo.";
    } catch {
      error = "Não foi possível contatar o Worker para confirmar a revogação deste dispositivo.";
    }
  }
  const result: IrisLockResult = {
    storageCleared,
    revokeAttempted,
    revoked,
    ...(error ? { error } : {}),
  };
  dispatchAccessChanged();
  if (error) notifyDeviceStatus(error);
  return result;
}

export async function listIrisDevices(): Promise<IrisRemoteDevice[]> {
  const data = await request<{ devices?: unknown[] }>("/auth/devices");
  if (!Array.isArray(data.devices)) return [];
  return data.devices.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const device = value as Record<string, unknown>;
    if (typeof device.id !== "string" || typeof device.name !== "string") return [];
    return [{
      id: device.id,
      name: device.name,
      createdAt: typeof device.createdAt === "string" ? device.createdAt : null,
      lastUsedAt: typeof device.lastUsedAt === "string" ? device.lastUsedAt : null,
      expiresAt: typeof device.expiresAt === "string" ? device.expiresAt : null,
    }];
  });
}

export async function revokeIrisDevice(deviceId: string): Promise<void> {
  if (!deviceId) throw new Error("Selecione um dispositivo válido para remover.");
  await request<{ ok?: boolean }>(`/auth/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" });
  try {
    const snapshot = await readIrisDeviceAuthSnapshot();
    if (snapshot.credential?.deviceId === deviceId) {
      localGeneration += 1;
      clearMemoryAccess();
      const removed = await clearIrisDeviceCredentialIfCurrent(snapshot.credential);
      if (!removed) {
        throw new Error("O Worker removeu o dispositivo, mas o IndexedDB não confirmou a limpeza local.");
      }
      notifyDeviceStatus("Este dispositivo foi removido e o acesso local foi protegido.");
    }
  } catch (error) {
    const message = `O Worker removeu o dispositivo, mas não foi possível confirmar a limpeza da cópia local: ${storeErrorText(error)}`;
    notifyDeviceStatus(message);
    throw new Error(message);
  }
}

/** Recovery-only validation: no opt-in/mode check, token memory, or local persistence. */
export async function verifyIrisMasterForRecovery(password: string): Promise<void> {
  if (typeof password !== "string" || password.length === 0 || password.length > MAX_REMOTE_PASSWORD_LENGTH) {
    throw new Error("Informe uma senha master válida com até 256 caracteres.");
  }
  const { response, data } = await authPost("/auth/login", { password, rememberDevice: false });
  if (!response.ok || validAccessResponse(data) === null) throw new Error(loginFailureMessage(response.status));
}

async function requireBearerToken() {
  if (!isIrisRemoteModeEnabled()) {
    throw new Error("O modo Demonstração está ativo; nenhum dado foi enviado. Ative os serviços remotos nas Configurações para continuar.");
  }
  if (isIrisAccessUnlocked()) return workerBearerToken as string;
  const expectedGeneration = localGeneration;
  const token = await refreshFromStoredDevice(expectedGeneration);
  if (token && isIrisAccessUnlocked()) return token;
  throw new Error("Serviços remotos bloqueados. Desbloqueie com a senha master e tente novamente.");
}

function isIrisAuthenticationRejection(data: { error?: string; details?: string }) {
  return /^(?:Autenticação necessária\.|Token ausente, inválido ou expirado\.|X-Iris-User não é aceito\.)$/.test(data.error ?? "");
}

function responseError(status: number, data: { error?: string; details?: string }) {
  if (status === 401 && isIrisAuthenticationRejection(data)) {
    clearMemoryAccess();
    return new Error("O acesso remoto expirou ou foi recusado. Desbloqueie os serviços conectados e tente novamente.");
  }
  return new Error(data.error || data.details || `Worker HTTP ${status}`);
}

async function fetchBearerRequest(path: string, init: RequestInit, token: string) {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${IRIS_WORKER_URL}${path}`, { ...init, credentials: "omit", headers });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await requireBearerToken();
  let response = await fetchBearerRequest(path, init, token);
  const firstFailure = response.status === 401
    ? (await response.clone().json().catch(() => ({}))) as { error?: string; details?: string }
    : null;
  if (response.status === 401 && firstFailure && isIrisAuthenticationRejection(firstFailure)) {
    const refreshed = await refreshFromStoredDevice(localGeneration);
    if (refreshed && refreshed !== token && isIrisRemoteModeEnabled()) {
      response = await fetchBearerRequest(path, init, refreshed);
      if (response.status === 401) {
        const failure = (await response.json().catch(() => ({}))) as { error?: string; details?: string };
        if (isIrisAuthenticationRejection(failure)) await lockIrisAccess();
        throw responseError(response.status, failure);
      }
    }
  }
  const data = (await response.json().catch(() => ({}))) as T & { error?: string; details?: string };
  if (!response.ok) throw responseError(response.status, data);
  return data;
}

export function askIrisWorker(message: string, messages?: Array<{ role: string; text: string }>) {
  return request<WorkerResponse>("/", {
    method: "POST",
    body: JSON.stringify({
      message,
      messages: messages?.slice(-20),
    }),
  });
}

export type IrisAdvancedMode = "vision" | "translate" | "compare" | "spreadsheet" | "document";

export async function askIrisAdvanced(input: {
  mode: IrisAdvancedMode;
  text?: string;
  imageBase64?: string;
  mimeType?: string;
}) {
  return request<WorkerResponse & { mode: IrisAdvancedMode }>("/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export type IrisDataKind =
  | "settings"
  | "radar"
  | "finances"
  | "documents"
  | "conversations"
  | "memories"
  | "tasks"
  | "business";

export type IrisDataRow = Record<string, unknown> & { id?: string };

export async function loadIrisData(kind: IrisDataKind) {
  return request<{ items: IrisDataRow[] }>(`/data/${kind}`);
}

export async function saveIrisData(kind: Exclude<IrisDataKind, "conversations">, value: IrisDataRow) {
  return request<{ ok: boolean; id: string }>(`/data/${kind}`, {
    method: "POST",
    body: JSON.stringify(value),
  });
}

export type IrisStorageQuota = {
  ok: boolean;
  period: string;
  limits: { bytes: number; classA: number; classB: number };
  usage: { bytes: number; classA: number; classB: number };
  percent: { storage: number; classA: number; classB: number };
  guardPercent: number;
  blocked: boolean;
  warning: string | null;
};

export function storageQuota() {
  return request<IrisStorageQuota>("/storage/quota");
}

export async function uploadIrisFile(file: File, id?: string) {
  const token = await requireBearerToken();
  const headers = new Headers({
    "Content-Type": file.type || "application/octet-stream",
    "X-Iris-Filename": file.name,
    ...(id ? { "X-Iris-File-Id": id } : {}),
    Authorization: `Bearer ${token}`,
  });
  let response = await fetch(`${IRIS_WORKER_URL}/storage/upload`, {
    method: "POST",
    credentials: "omit",
    headers,
    body: file,
  });
  if (response.status === 401) {
    const refreshed = await refreshFromStoredDevice(localGeneration);
    if (refreshed && refreshed !== token) {
      headers.set("Authorization", `Bearer ${refreshed}`);
      response = await fetch(`${IRIS_WORKER_URL}/storage/upload`, {
        method: "POST",
        credentials: "omit",
        headers,
        body: file,
      });
    }
  }
  const data = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    id?: string;
    key?: string;
    error?: string;
    details?: string;
  };
  if (!response.ok) throw responseError(response.status, data);
  return data as { ok: true; id: string; key: string; name: string; size: number };
}

export async function downloadIrisFile(id: string) {
  const token = await requireBearerToken();
  let response = await fetch(`${IRIS_WORKER_URL}/storage/file/${encodeURIComponent(id)}`, {
    credentials: "omit",
    headers: {
      Accept: "application/octet-stream",
      Authorization: `Bearer ${token}`,
    },
  });
  if (response.status === 401) {
    const refreshed = await refreshFromStoredDevice(localGeneration);
    if (refreshed && refreshed !== token) {
      response = await fetch(`${IRIS_WORKER_URL}/storage/file/${encodeURIComponent(id)}`, {
        credentials: "omit",
        headers: { Accept: "application/octet-stream", Authorization: `Bearer ${refreshed}` },
      });
    }
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string; details?: string };
    throw responseError(response.status, data);
  }
  return response.blob();
}

export type GmailHeader = { name?: string; value?: string };
export type GmailMessage = {
  id: string;
  threadId?: string;
  snippet?: string;
  payload?: { headers?: GmailHeader[]; parts?: unknown[]; body?: { data?: string } };
};
export type GmailSummary = Omit<GmailMessage, "payload"> & {
  subject?: string;
  from?: string;
  payload?: { headers?: GmailHeader[] };
};

export async function gmailStatus() {
  return request<{ authorized: boolean }>("/gmail/status");
}

export async function gmailMessages() {
  return request<{
    messages?: GmailSummary[];
    resultSizeEstimate?: number;
  }>("/gmail/messages");
}

export async function gmailMessage(id: string) {
  return request<GmailMessage>(`/gmail/message?id=${encodeURIComponent(id)}`);
}

export function gmailHeader(message: GmailMessage | GmailSummary, name: string) {
  return message.payload?.headers?.find(
    (header) => header.name?.toLowerCase() === name.toLowerCase(),
  )?.value?.trim() || "Não informado";
}

function decodeBase64Url(value: string) {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized + "===".slice((normalized.length + 3) % 4));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

export function gmailBody(message: GmailMessage) {
  const body = message.payload?.body?.data;
  if (body) return decodeBase64Url(body);
  return message.snippet || "O e-mail não possui conteúdo textual disponível para leitura.";
}

export async function startGoogleOAuth(product: "gmail" | "drive" | "calendar") {
  const result = await request<{ url: string }>("/oauth/start", {
    method: "POST",
    body: JSON.stringify({ product }),
  });
  let target: URL;
  try {
    target = new URL(result.url);
  } catch {
    throw new Error("O serviço retornou um endereço de autorização inválido.");
  }
  if (target.protocol !== "https:" || target.hostname !== "accounts.google.com")
    throw new Error("O serviço retornou um endereço de autorização inválido.");
  window.location.assign(target.href);
}

export function googleDriveStatus() {
  return request<{ authorized: boolean }>("/google/drive/status");
}

export type GoogleDriveFile = {
  id: string;
  name: string;
  mimeType?: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
  parents?: string[];
  trashed?: boolean;
};

export function googleDriveFiles(query = "") {
  return request<{ files?: GoogleDriveFile[] }>(`/google/drive/files?q=${encodeURIComponent(query)}`);
}

export function googleDriveCreateFolder(name: string, confirm = false) {
  return request<GoogleDriveFile>("/google/drive/folders", {
    method: "POST",
    headers: { "X-Iris-Confirm": String(confirm) },
    body: JSON.stringify({ name }),
  });
}

export function googleDriveRename(id: string, name: string, confirm = false) {
  return request<GoogleDriveFile>(`/google/drive/files/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "X-Iris-Confirm": String(confirm) },
    body: JSON.stringify({ name }),
  });
}

export function googleDriveCopy(id: string, name: string, confirm = false) {
  return request<GoogleDriveFile>(`/google/drive/files/${encodeURIComponent(id)}/copy`, {
    method: "POST",
    headers: { "X-Iris-Confirm": String(confirm) },
    body: JSON.stringify({ name }),
  });
}

export function googleCalendarStatus() {
  return request<{ authorized: boolean }>("/google/calendar/status");
}

export type GoogleCalendarEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  recurrence?: string[];
};

export function googleCalendarEvents(timeMin?: string, timeMax?: string) {
  const params = new URLSearchParams();
  if (timeMin) params.set("timeMin", timeMin);
  if (timeMax) params.set("timeMax", timeMax);
  return request<{ items?: GoogleCalendarEvent[] }>(`/google/calendar/events?${params.toString()}`);
}

export function googleCalendarCreate(event: Record<string, unknown>, confirm = false) {
  return request<GoogleCalendarEvent>("/google/calendar/events", {
    method: "POST",
    headers: { "X-Iris-Confirm": String(confirm) },
    body: JSON.stringify(event),
  });
}

export function googleCalendarUpdate(id: string, event: Record<string, unknown>, confirm = false) {
  return request<GoogleCalendarEvent>(`/google/calendar/events/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "X-Iris-Confirm": String(confirm) },
    body: JSON.stringify(event),
  });
}

export function googleCalendarDelete(id: string, confirm = false) {
  return request<{ ok?: boolean }>(`/google/calendar/events/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "X-Iris-Confirm": String(confirm) },
  });
}
