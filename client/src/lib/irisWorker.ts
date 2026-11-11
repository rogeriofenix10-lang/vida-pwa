const DEFAULT_WORKER_URL = "https://iris-gemini-proxy.rogeriofenix10.workers.dev";
const MAX_REMOTE_PASSWORD_LENGTH = 256;
const ACCESS_CHANGED_EVENT = "iris-access-changed";
const REMOTE_OPT_IN_KEY = "iris.remoteOptIn";

export const IRIS_WORKER_URL = String(
  import.meta.env.VITE_IRIS_WORKER_URL ?? DEFAULT_WORKER_URL,
).replace(/\/$/, "");

let workerBearerToken: string | null = null;
let workerTokenExpiresAt: number | null = null;

type WorkerResponse = {
  text?: string;
  error?: string;
  details?: string;
  model?: string;
};

function dispatchAccessChanged() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(ACCESS_CHANGED_EVENT));
}

export function isIrisRemoteModeEnabled() {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem("iris.mode") === "connected" &&
      localStorage.getItem(REMOTE_OPT_IN_KEY) === "1";
  } catch {
    return false;
  }
}

export function isIrisAccessUnlocked() {
  if (!workerBearerToken) return false;
  if (workerTokenExpiresAt !== null && Date.now() >= workerTokenExpiresAt) {
    lockIrisAccess();
    return false;
  }
  return true;
}

export function lockIrisAccess() {
  workerBearerToken = null;
  workerTokenExpiresAt = null;
  dispatchAccessChanged();
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

export async function unlockIrisAccess(password: string) {
  if (!isIrisRemoteModeEnabled()) {
    throw new Error(
      "O modo Demonstração está ativo e não envia dados. Ative os serviços remotos nas Configurações antes de desbloquear.",
    );
  }
  if (
    typeof password !== "string" ||
    password.length === 0 ||
    password.length > MAX_REMOTE_PASSWORD_LENGTH
  ) {
    throw new Error("Informe uma credencial válida com até 256 caracteres.");
  }

  let response: Response;
  try {
    response = await fetch(`${IRIS_WORKER_URL}/auth/login`, {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password }),
    });
  } catch {
    throw new Error("Não foi possível validar o acesso remoto agora.");
  }

  const data = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    token?: string;
    expiresAt?: string | number;
  };
  const expiresAt = parseExpiry(data.expiresAt);
  if (
    !response.ok ||
    data.ok !== true ||
    typeof data.token !== "string" ||
    !data.token ||
    expiresAt === null ||
    expiresAt <= Date.now()
  ) {
    // Não exibir mensagens do Worker aqui: elas podem ecoar a credencial.
    throw new Error(
      response.status === 401 || response.status === 403
        ? "A credencial não foi aceita. Confira e tente novamente."
        : "Não foi possível validar o acesso remoto agora.",
    );
  }

  workerBearerToken = data.token;
  workerTokenExpiresAt = expiresAt;
  dispatchAccessChanged();
  return { ok: true as const };
}

function requireBearerToken() {
  if (!isIrisRemoteModeEnabled()) {
    throw new Error(
      "O modo Demonstração está ativo; nenhum dado foi enviado. Ative os serviços remotos nas Configurações para continuar.",
    );
  }
  if (!isIrisAccessUnlocked()) {
    throw new Error(
      "Serviços remotos bloqueados. Desbloqueie os serviços conectados e tente novamente.",
    );
  }
  return workerBearerToken as string;
}

function responseError(status: number, data: { error?: string; details?: string }) {
  if (status === 401) {
    lockIrisAccess();
    return new Error(
      "O acesso remoto expirou ou foi recusado. Desbloqueie os serviços conectados e tente novamente.",
    );
  }
  return new Error(data.error || data.details || `Worker HTTP ${status}`);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = requireBearerToken();
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (init?.body && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${IRIS_WORKER_URL}${path}`, {
    ...init,
    credentials: "omit",
    headers,
  });
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    details?: string;
  };
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
  const token = requireBearerToken();
  const headers = new Headers({
    "Content-Type": file.type || "application/octet-stream",
    "X-Iris-Filename": file.name,
    ...(id ? { "X-Iris-File-Id": id } : {}),
    Authorization: `Bearer ${token}`,
  });
  const response = await fetch(`${IRIS_WORKER_URL}/storage/upload`, {
    method: "POST",
    credentials: "omit",
    headers,
    body: file,
  });
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
  const token = requireBearerToken();
  const response = await fetch(`${IRIS_WORKER_URL}/storage/file/${encodeURIComponent(id)}`, {
    credentials: "omit",
    headers: {
      Accept: "application/octet-stream",
      Authorization: `Bearer ${token}`,
    },
  });
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
