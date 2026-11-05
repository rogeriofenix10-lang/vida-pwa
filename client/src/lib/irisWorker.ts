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
