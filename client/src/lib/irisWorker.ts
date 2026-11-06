const DEFAULT_WORKER_URL = "https://iris-gemini-proxy.rogeriofenix10.workers.dev";

export const IRIS_WORKER_URL = String(
  import.meta.env.VITE_IRIS_WORKER_URL ?? DEFAULT_WORKER_URL,
).replace(/\/$/, "");

type WorkerResponse = {
  text?: string;
  error?: string;
  details?: string;
  model?: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${IRIS_WORKER_URL}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    details?: string;
  };
  if (!response.ok) {
    throw new Error(data.error || data.details || `Worker HTTP ${response.status}`);
  }
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
  const response = await fetch(`${IRIS_WORKER_URL}/storage/upload`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-Iris-Filename": file.name,
      ...(id ? { "X-Iris-File-Id": id } : {}),
    },
    body: file,
  });
  const data = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    id?: string;
    key?: string;
    error?: string;
    details?: string;
  };
  if (!response.ok) {
    throw new Error(data.error || data.details || `Worker HTTP ${response.status}`);
  }
  return data as { ok: true; id: string; key: string; name: string; size: number };
}

export async function downloadIrisFile(id: string) {
  const response = await fetch(`${IRIS_WORKER_URL}/storage/file/${encodeURIComponent(id)}`, {
    credentials: "include",
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string; details?: string };
    throw new Error(data.error || data.details || `Worker HTTP ${response.status}`);
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

export async function gmailStatus() {
  return request<{ authorized: boolean }>("/gmail/status");
}

export async function gmailMessages() {
  return request<{ messages?: Array<{ id: string }>; resultSizeEstimate?: number }>(
    "/gmail/messages",
  );
}

export async function gmailMessage(id: string) {
  return request<GmailMessage>(`/gmail/message?id=${encodeURIComponent(id)}`);
}

export function gmailHeader(message: GmailMessage, name: string) {
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

export function gmailAuthUrl() {
  return `${IRIS_WORKER_URL}/oauth/start`;
}

export function googleAuthUrl(product: "drive" | "calendar") {
  return `${IRIS_WORKER_URL}/oauth/start?product=${product}`;
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
