/**
 * IRIS Local Lab: deterministic, in-memory integration simulator.
 * It never calls external providers and never persists secrets.
 * Intended for local/Cloud Shell development while Billing is disabled.
 */

export type LabProvider = "google:gmail" | "google:calendar" | "google:drive";

export type LabMessage = {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  unread: boolean;
};

export type LabEvent = {
  id: string;
  summary: string;
  start: string;
  end: string;
};

export type LabFile = {
  id: string;
  name: string;
  mimeType: string;
};

export type LabState = {
  messages: LabMessage[];
  events: LabEvent[];
  files: LabFile[];
  sentMessages: Array<{ id: string; to: string; subject: string; body: string }>;
  createdEvents: LabEvent[];
  runs: number;
};

export type LabRunInput = {
  provider: LabProvider;
  action: string;
  input?: Record<string, unknown>;
  confirmed?: boolean;
};

export type LabRunResult = {
  ok: true;
  simulated: true;
  provider: LabProvider;
  action: string;
  data: unknown;
};

const initialState = (): LabState => ({
  messages: [
    { id: "msg-1", from: "cliente@exemplo.com", subject: "Pedido de reposição", snippet: "Podemos confirmar a reposição para esta semana?", unread: true },
    { id: "msg-2", from: "financeiro@exemplo.com", subject: "Relatório mensal", snippet: "O relatório mensal está disponível para revisão.", unread: false },
  ],
  events: [
    { id: "evt-1", summary: "Reunião comercial", start: "2030-01-15T09:00:00-03:00", end: "2030-01-15T10:00:00-03:00" },
  ],
  files: [
    { id: "file-1", name: "Relatório Comercial.pdf", mimeType: "application/pdf" },
    { id: "file-2", name: "Tabela de Clientes.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  ],
  sentMessages: [],
  createdEvents: [],
  runs: 0,
});

let state = initialState();

export function resetLocalLab() {
  state = initialState();
}

export function getLocalLabStatus() {
  return {
    enabled: process.env.NODE_ENV !== "production" && process.env.IRIS_LOCAL_LAB !== "false",
    mode: "offline-simulator" as const,
    externalCalls: 0,
    runs: state.runs,
    counts: {
      messages: state.messages.length,
      events: state.events.length + state.createdEvents.length,
      files: state.files.length,
      sentMessages: state.sentMessages.length,
    },
  };
}

function requiredText(input: Record<string, unknown> | undefined, field: string) {
  const value = String(input?.[field] ?? "").trim();
  if (!value) throw new Error(`Campo obrigatório: ${field}`);
  return value;
}

export async function runLocalLab(input: LabRunInput): Promise<LabRunResult> {
  if (process.env.NODE_ENV === "production") throw new Error("IRIS Local Lab desabilitado em produção");
  if (process.env.IRIS_LOCAL_LAB === "false") throw new Error("IRIS Local Lab desabilitado");

  state.runs += 1;
  const payload = input.input ?? {};

  if (input.provider === "google:gmail" && input.action === "messages.list") {
    const query = String(payload.query ?? "").trim().toLowerCase();
    const messages = query
      ? state.messages.filter((m) => `${m.from} ${m.subject} ${m.snippet}`.toLowerCase().includes(query))
      : state.messages;
    return { ok: true, simulated: true, provider: input.provider, action: input.action, data: { messages, resultSizeEstimate: messages.length } };
  }

  if (input.provider === "google:gmail" && input.action === "messages.send") {
    if (!input.confirmed) throw new Error("CONFIRMATION_REQUIRED:google:gmail:messages.send");
    const to = requiredText(payload, "to");
    const subject = requiredText(payload, "subject");
    const body = requiredText(payload, "body");
    const id = `sent-${state.sentMessages.length + 1}`;
    state.sentMessages.push({ id, to, subject, body });
    return { ok: true, simulated: true, provider: input.provider, action: input.action, data: { id, simulatedDelivery: true } };
  }

  if (input.provider === "google:calendar" && input.action === "events.list") {
    return { ok: true, simulated: true, provider: input.provider, action: input.action, data: { items: [...state.events, ...state.createdEvents] } };
  }

  if (input.provider === "google:calendar" && input.action === "events.create") {
    if (!input.confirmed) throw new Error("CONFIRMATION_REQUIRED:google:calendar:events.create");
    const summary = requiredText(payload, "summary");
    const start = requiredText(payload, "start");
    const end = requiredText(payload, "end");
    const event = { id: `evt-local-${state.createdEvents.length + 1}`, summary, start, end };
    state.createdEvents.push(event);
    return { ok: true, simulated: true, provider: input.provider, action: input.action, data: event };
  }

  if (input.provider === "google:drive" && input.action === "files.search") {
    const query = String(payload.query ?? "").trim().toLowerCase();
    const files = query ? state.files.filter((f) => f.name.toLowerCase().includes(query)) : state.files;
    return { ok: true, simulated: true, provider: input.provider, action: input.action, data: { files } };
  }

  throw new Error(`Cenário local não suportado: ${input.provider}:${input.action}`);
}
