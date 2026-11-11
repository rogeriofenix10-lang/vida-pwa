import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import {
  completeRadarItem,
  editRadarItem,
  snoozeRadarItem,
} from "@shared/vidaRadar";
import {
  analyzeCommand,
  interpretOperationalCommand,
  type IrisState,
  IrisCognitiveEngine,
} from "@shared/irisCognitive";
import { useIrisVoice } from "@/hooks/useIrisVoice";
import { useTheme } from "@/contexts/ThemeContext";
import { IRIS_STATIC_MODE } from "@/lib/irisRuntime";
import {
  askIrisWorker,
  askIrisAdvanced,
  gmailBody,
  gmailHeader,
  gmailMessage,
  gmailMessages,
  gmailStatus,
  isIrisAccessUnlocked,
  isIrisRemoteModeEnabled,
  googleCalendarDelete,
  googleCalendarEvents,
  googleCalendarStatus,
  googleCalendarUpdate,
  loadIrisData,
  saveIrisData,
  startGoogleOAuth,
  type GmailSummary,
  type GoogleCalendarEvent,
} from "@/lib/irisWorker";
import { downloadBlob, readLocal } from "@/lib/irisLocalStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowRight,
  Bell,
  Check,
  ChevronRight,
  Download,
  FileText,
  Calendar,
  Layers,
  Loader2,
  Mic,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  SlidersHorizontal,
  Sun,
  Moon,
  Radio,
  Hourglass,
  Activity,
  Languages,
  X,
  UserRound,
  ExternalLink,
  RefreshCw,
  MessageCircle,
  BarChart3,
  Wrench,
  CheckCircle2,
  HeartPulse,
  Menu,
  WalletCards,
} from "lucide-react";
import IrisOcularEye from "./IrisOcularEye";
import IrisHealthCenter from "./IrisHealthCenter";
import "./command-center-54.css";

export type Priority =
  "urgente" | "importante" | "atencao" | "normal" | "informacao";
export type RadarStatus = "pending" | "in_progress" | "completed";
export type RadarCategory =
  | "Todas Categorias"
  | "Finanças"
  | "Trabalho"
  | "Saúde"
  | "Pessoal"
  | "Compras"
  | "Geral";
export type ActiveModalView =
  | null
  | "assistente"
  | "radar"
  | "agenda"
  | "arquivos"
  | "analises"
  | "ferramentas"
  | "nova-tarefa"
  | "saude";

export type RadarItem = {
  id: number;
  label: string;
  detail: string;
  date: string;
  priority: Priority;
  action: string;
  confirmationToken?: string;
  proposalId?: number;
  dueAt?: string | null;
  reminderAt?: string | null;
  timezone?: string;
  riskLevel?: "low" | "medium" | "high";
  status?: RadarStatus;
  category?: RadarCategory;
  confidence?: number;
  tools?: Array<{ name: string; description: string; scope: string }>;
};

type ChatMessage = {
  role: "assistant" | "user";
  text: string;
  attachments?: Array<{ name: string; type: string }>;
  oauthAction?: "gmail" | "drive" | "calendar";
};

type AttachmentMimeType =
  "application/pdf" | "image/png" | "image/jpeg" | "image/webp" | "text/plain";
type ChatAttachment = {
  name: string;
  mimeType: AttachmentMimeType;
  dataUrl: string;
  kind: "image_url" | "file_url";
};
type AiProvider = "manus" | "chatgpt" | "gemini" | "kimi";

type GoogleCalendarDate = NonNullable<GoogleCalendarEvent["start"]> & {
  timeZone?: string;
};
type CalendarEditDraft = {
  summary: string;
  description: string;
  location: string;
  allDay: boolean;
  start: string;
  end: string;
};
type AnalysisFinanceRow = {
  id: string;
  type: "income" | "expense";
  description: string;
  amount: number;
  status: "open" | "paid" | "overdue";
  dueAt: string;
  category: string;
};
type AnalysisDocumentRow = { id: string; name: string };

const recordValue = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function normalizeFinanceRow(value: unknown, index: number): AnalysisFinanceRow | null {
  const row = recordValue(value);
  if (!row) return null;
  const rawAmount = row.amount ?? (row.amount_cents != null
    ? Number(row.amount_cents) / 100
    : Number.NaN);
  const amount = Number(rawAmount);
  if (!Number.isFinite(amount)) return null;
  const status = String(row.status ?? "open");
  return {
    id: String(row.id ?? `sem-id-${index}`),
    type: String(row.type) === "income" ? "income" : "expense",
    description: String(row.description ?? "Lançamento sem descrição"),
    amount: Math.abs(amount),
    status: status === "paid" || status === "overdue" ? status : "open",
    dueAt: String(row.dueAt ?? row.due_at ?? ""),
    category: String(row.category ?? "Outros").trim() || "Outros",
  };
}

function normalizeDocumentRow(value: unknown, index: number): AnalysisDocumentRow | null {
  const row = recordValue(value);
  if (!row) return null;
  return {
    id: String(row.id ?? `sem-id-${index}`),
    name: String(row.name ?? row.originalName ?? "Documento sem nome"),
  };
}

function mergeById<T extends { id: string }>(primary: T[], secondary: T[]): T[] {
  const rows = new Map<string, T>();
  for (const row of primary) rows.set(row.id, row);
  for (const row of secondary) if (!rows.has(row.id)) rows.set(row.id, row);
  return [...rows.values()];
}

function normalizeGmailText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function selectGmailMessage(messages: GmailSummary[], command: string) {
  const normalized = normalizeGmailText(command);
  const ordinal = normalized.match(/\b(?:mensagem|e-?mail)\s*(?:n(?:umero)?\s*)?(\d{1,2})\b/) ??
    normalized.match(/#(\d{1,2})\b/);
  const wordOrdinal = normalized.match(/\b(primeir[oa]|segund[oa]|terceir[oa]|ultimo|mais recente|mais novo)\b/)?.[1];
  const ordinalIndex = ordinal
    ? Number(ordinal[1]) - 1
    : wordOrdinal
      ? ({ primeira: 0, primeiro: 0, segunda: 1, segundo: 1, terceira: 2, terceiro: 2, ultimo: 0, "mais recente": 0, "mais novo": 0 } as Record<string, number>)[wordOrdinal]
      : undefined;
  if (ordinalIndex !== undefined) {
    const target = messages[ordinalIndex];
    return { target, matches: target ? [target] : [], identified: true };
  }

  const quoted = command.match(/[\"“]([^\"”]+)[\"”]/)?.[1];
  const subjectSelector = normalized.match(/\b(?:com assunto|assunto(?: do e-?mail)?|sobre)\s+(.+)$/)?.[1];
  const senderSelector = normalized.match(/\b(?:remetente|de|do|da)\s+(.+)$/)?.[1];
  const selector = normalizeGmailText(quoted ?? subjectSelector ?? senderSelector ?? "")
    .replace(/\b(?:por favor|para mim|o e-?mail|e-?mail|mensagem|gmail)\b/g, " ")
    .replace(/^[\s:,-]+|[\s?!.]+$/g, "")
    .trim();
  if (!selector) return { target: undefined, matches: [], identified: false };

  const matches = messages.filter((message) => {
    const metadata = [
      message.subject ?? gmailHeader(message, "Subject"),
      message.from ?? gmailHeader(message, "From"),
      message.snippet ?? "",
    ].map(normalizeGmailText);
    return metadata.some((value) => value.includes(selector));
  });
  return {
    target: matches.length === 1 ? matches[0] : undefined,
    matches,
    identified: true,
  };
}

function calendarDateTimeInputValue(date?: GoogleCalendarDate): string {
  if (!date?.dateTime) return "";
  const timeZone = date.timeZone ?? (date.dateTime.endsWith("Z") ? "UTC" : undefined);
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(date.dateTime));
      const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      if (values.year && values.month && values.day && values.hour && values.minute)
        return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
    } catch {
      // Use the source's own wall time below if its timezone cannot be formatted.
    }
  }
  const wallTime = date.dateTime.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
  if (wallTime) return wallTime[1];
  const parsed = new Date(date.dateTime);
  if (Number.isNaN(parsed.getTime())) return "";
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

function dateTimeLocalToIsoInZone(value: string, timeZone: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) throw new Error("Informe uma data e hora válidas.");
  const [, year, month, day, hour, minute] = match;
  const desiredWallTime = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  let utcTime = desiredWallTime;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(utcTime)).map((part) => [part.type, part.value]));
    const displayedWallTime = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute),
    );
    const difference = displayedWallTime - utcTime;
    if (difference === 0) break;
    utcTime = desiredWallTime - difference;
  }
  const check = Object.fromEntries(formatter.formatToParts(new Date(utcTime)).map((part) => [part.type, part.value]));
  if (`${check.year}-${check.month}-${check.day}T${check.hour}:${check.minute}` !== value)
    throw new Error("Esse horário não existe no fuso selecionado devido à mudança de horário local.");
  return new Date(utcTime).toISOString();
}

function buildCalendarDateTime(value: string, original?: GoogleCalendarDate): GoogleCalendarDate {
  const timeZone = original?.timeZone ?? (original?.dateTime?.endsWith("Z") ? "UTC" : undefined);
  if (timeZone) return { dateTime: dateTimeLocalToIsoInZone(value, timeZone), timeZone };
  const originalOffset = original?.dateTime?.match(/([+-]\d{2}:\d{2})$/)?.[1];
  if (originalOffset) return { dateTime: `${value}:00${originalOffset}` };
  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return {
    dateTime: dateTimeLocalToIsoInZone(value, browserTimeZone),
    timeZone: browserTimeZone,
  };
}

function calendarDateForDisplay(date?: GoogleCalendarDate): string {
  if (date?.date) {
    const parsed = new Date(`${date.date}T12:00:00`);
    return Number.isNaN(parsed.getTime()) ? date.date : parsed.toLocaleDateString("pt-BR");
  }
  if (!date?.dateTime) return "Data não informada";
  const parsed = new Date(date.dateTime);
  if (Number.isNaN(parsed.getTime())) return date.dateTime;
  const timeZone = date.timeZone ?? (date.dateTime.endsWith("Z") ? "UTC" : undefined);
  try {
    return parsed.toLocaleString("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      ...(timeZone ? { timeZone } : {}),
    });
  } catch {
    return parsed.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  }
}

function formatBrl(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const initialItems: RadarItem[] = [
  {
    id: 1,
    label: "Seguro do carro",
    detail: "vence em 12 dias",
    date: "12 dias",
    priority: "importante",
    action: "Revisar seguro",
    status: "pending",
    category: "Finanças",
  },
  {
    id: 2,
    label: "Conta de internet",
    detail: "vence amanhã · R$ 129,90",
    date: "amanhã",
    priority: "urgente",
    action: "Lembrar amanhã",
    status: "pending",
    category: "Finanças",
  },
  {
    id: 3,
    label: "Documentos pessoais",
    detail: "tudo em dia",
    date: "em dia",
    priority: "normal",
    action: "Ver documentos",
    status: "completed",
    category: "Pessoal",
  },
  {
    id: 4,
    label: "Oportunidade de economia",
    detail: "assinatura pouco utilizada",
    date: "sugestão",
    priority: "informacao",
    action: "Analisar",
    status: "in_progress",
    category: "Finanças",
  },
];

const priorityLabels: Record<Priority, string> = {
  urgente: "URGENTE",
  importante: "IMPORTANTE",
  atencao: "ATENÇÃO",
  normal: "TUDO CERTO",
  informacao: "OPORTUNIDADE",
};

const onboardingSteps = [
  {
    title: "Bem-vindo à Iris IA",
    body: "Como você prefere ser chamado? Vamos organizar seu Command Center.",
    icon: Sparkles,
  },
  {
    title: "O que você quer organizar?",
    body: "Escolha seu foco inicial para o Radar pessoal.",
    icon: Layers,
  },
  {
    title: "Faça sua primeira ação",
    body: "Diga ou digite algo como ‘minha conta vence dia 10’ e a Iris cuidará de tudo.",
    icon: MessageCircle,
  },
];

export default function CommandCenter54() {
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();
  const [remoteAccessReady, setRemoteAccessReady] = useState(
    () => isIrisRemoteModeEnabled() && isIrisAccessUnlocked(),
  );
  const [activeView, setActiveView] = useState<ActiveModalView>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [step, setStep] = useState(0);
  const [focus, setFocus] = useState("Tarefas e lembretes");
  const [demoName, setDemoName] = useState("");
  const [items, setItems] = useState<RadarItem[]>(initialItems);
  const [radarFallback, setRadarFallback] = useState(false);
  const [commandText, setCommandText] = useState("");
  const [radarSearch, setRadarSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | RadarStatus>("all");
  const [categoryFilter, setCategoryFilter] =
    useState<RadarCategory>("Todas Categorias");
  const [chat, setChat] = useState<ChatMessage[]>(() => {
    try {
      const stored = localStorage.getItem("iris-chat-history");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const staleFallback = /não tenho acesso direto|nunca\*\* execut|ações externas.*sem a sua autorização/i;
          const migrated = parsed.filter(
            (message): message is ChatMessage =>
              message && typeof message.text === "string" && !staleFallback.test(message.text),
          );
          if (migrated.length > 0) return migrated;
        }
      }
    } catch {}
    return [
      {
        role: "assistant",
        text: "Olá. Sou a Iris IA. As consultas remotas só ficam disponíveis após ativar os serviços e desbloquear. Documentos, finanças e catálogo locais continuam funcionando; alterações externas sempre exigem sua confirmação.",
      },
    ];
  });
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [irisState, setIrisState] = useState<IrisState>("idle");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [pendingSuggestion, setPendingSuggestion] = useState<RadarItem | null>(
    null,
  );
  const [conversationId, setConversationId] = useState<number | undefined>();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [newTaskInput, setNewTaskInput] = useState("");
  const [calendarEvents, setCalendarEvents] = useState<GoogleCalendarEvent[]>([]);
  const [calendarMessage, setCalendarMessage] = useState("Carregando agenda autorizada…");
  const [calendarError, setCalendarError] = useState("");
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarActionBusyId, setCalendarActionBusyId] = useState<string | null>(null);
  const [editingCalendarEventId, setEditingCalendarEventId] = useState<string | null>(null);
  const [calendarDraft, setCalendarDraft] = useState<CalendarEditDraft | null>(null);
  const [analysisRows, setAnalysisRows] = useState<{
    finances: AnalysisFinanceRow[] | null;
    documents: AnalysisDocumentRow[] | null;
  }>({ finances: null, documents: null });
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [analysisSources, setAnalysisSources] = useState({
    finances: "Aguardando atualização",
    documents: "Aguardando atualização",
  });
  const [analysisReport, setAnalysisReport] = useState<string | null>(null);
  const analysisLocalErrorsRef = useRef<string[]>([]);
  const radarRetryAfterUnlockRef = useRef(false);
  const calendarRetryAfterUnlockRef = useRef(false);
  const analysisRetryAfterUnlockRef = useRef({ finances: false, documents: false });
  const lastVoiceCommandRef = useRef({ text: "", at: 0 });
  const lastVoiceErrorRef = useRef({ text: "", at: 0 });
  const chatFeedRef = useRef<HTMLDivElement | null>(null);
  const chatPinnedToBottomRef = useRef(true);
  const { theme, toggleTheme } = useTheme();

  const refreshCalendar = async () => {
    setCalendarLoading(true);
    setCalendarError("");
    setCalendarMessage("Carregando agenda autorizada…");
    try {
      const result = await googleCalendarEvents(new Date().toISOString());
      const events = result.items ?? [];
      calendarRetryAfterUnlockRef.current = false;
      setCalendarEvents(events);
      setCalendarMessage(events.length
        ? "Agenda sincronizada com o Google Calendar."
        : "Nenhum compromisso futuro encontrado.");
      return true;
    } catch (error) {
      calendarRetryAfterUnlockRef.current = true;
      setCalendarMessage("Não foi possível carregar a agenda.");
      setCalendarError(error instanceof Error
        ? error.message
        : "Google Calendar não autorizado ou indisponível.");
      return false;
    } finally {
      setCalendarLoading(false);
    }
  };

  const refreshAnalysisData = async () => {
    setAnalysisLoading(true);
    setAnalysisError("");
    const [localFinancesResult, remoteFinancesResult, localDocumentsResult, remoteDocumentsResult] =
      await Promise.allSettled([
        "indexedDB" in window
          ? readLocal<unknown[]>("irisFinances", [])
          : Promise.reject(new Error("IndexedDB não disponível")),
        loadIrisData("finances"),
        "indexedDB" in window
          ? readLocal<unknown[]>("irisDocuments", [])
          : Promise.reject(new Error("IndexedDB não disponível")),
        loadIrisData("documents"),
      ]);
    analysisRetryAfterUnlockRef.current = {
      finances: remoteFinancesResult.status === "rejected",
      documents: remoteDocumentsResult.status === "rejected",
    };

    const localFinances = localFinancesResult.status === "fulfilled"
      ? localFinancesResult.value.map(normalizeFinanceRow).filter((row): row is AnalysisFinanceRow => row !== null)
      : null;
    const remoteFinances = remoteFinancesResult.status === "fulfilled"
      ? remoteFinancesResult.value.items
          .map((row, index) => {
            const payload = recordValue(row.payload) ?? {};
            return normalizeFinanceRow({ ...payload, ...row }, index);
          })
          .filter((row): row is AnalysisFinanceRow => row !== null)
      : null;
    const localDocuments = localDocumentsResult.status === "fulfilled"
      ? localDocumentsResult.value.map(normalizeDocumentRow).filter((row): row is AnalysisDocumentRow => row !== null)
      : null;
    const remoteDocuments = remoteDocumentsResult.status === "fulfilled"
      ? remoteDocumentsResult.value.items
          .map((row, index) => {
            const payload = recordValue(row.payload) ?? {};
            return normalizeDocumentRow({ ...payload, ...row }, index);
          })
          .filter((row): row is AnalysisDocumentRow => row !== null)
      : null;

    setAnalysisRows({
      finances: localFinances !== null || remoteFinances !== null
        ? mergeById(localFinances ?? [], remoteFinances ?? [])
        : null,
      documents: localDocuments !== null || remoteDocuments !== null
        ? mergeById(localDocuments ?? [], remoteDocuments ?? [])
        : null,
    });
    const sourceLabel = (local: boolean, remote: boolean) => local
      ? remote ? "dispositivo local + D1 (prioridade local)" : "dispositivo local; D1 indisponível"
      : remote ? "D1 como fallback; leitura local indisponível" : "indisponível";
    setAnalysisSources({
      finances: sourceLabel(localFinances !== null, remoteFinances !== null),
      documents: sourceLabel(localDocuments !== null, remoteDocuments !== null),
    });

    const failures: string[] = [];
    analysisLocalErrorsRef.current = [];
    if (localFinancesResult.status === "rejected") {
      analysisLocalErrorsRef.current.push("Finanças locais indisponíveis");
      failures.push("Finanças locais indisponíveis");
    }
    if (remoteFinancesResult.status === "rejected")
      failures.push("D1 de finanças indisponível; dados locais mantidos");
    if (localDocumentsResult.status === "rejected") {
      analysisLocalErrorsRef.current.push("Documentos locais indisponíveis");
      failures.push("Documentos locais indisponíveis");
    }
    if (remoteDocumentsResult.status === "rejected")
      failures.push("D1 de documentos indisponível; dados locais mantidos");
    setAnalysisError(failures.join(". "));
    setAnalysisLoading(false);
  };

  const retryFailedAnalysisReads = async () => {
    const retry = { ...analysisRetryAfterUnlockRef.current };
    if ((!retry.finances && !retry.documents) || !isIrisRemoteModeEnabled() || !isIrisAccessUnlocked()) return;
    setAnalysisLoading(true);
    const [financesResult, documentsResult] = await Promise.all([
      retry.finances
        ? loadIrisData("finances").then(
            (value) => ({ status: "fulfilled" as const, value }),
            (reason) => ({ status: "rejected" as const, reason }),
          )
        : Promise.resolve(null),
      retry.documents
        ? loadIrisData("documents").then(
            (value) => ({ status: "fulfilled" as const, value }),
            (reason) => ({ status: "rejected" as const, reason }),
          )
        : Promise.resolve(null),
    ]);

    const remoteFinances = financesResult?.status === "fulfilled"
      ? financesResult.value.items
          .map((row, index) => normalizeFinanceRow({ ...(recordValue(row.payload) ?? {}), ...row }, index))
          .filter((row): row is AnalysisFinanceRow => row !== null)
      : null;
    const remoteDocuments = documentsResult?.status === "fulfilled"
      ? documentsResult.value.items
          .map((row, index) => normalizeDocumentRow({ ...(recordValue(row.payload) ?? {}), ...row }, index))
          .filter((row): row is AnalysisDocumentRow => row !== null)
      : null;

    setAnalysisRows((current) => ({
      finances: remoteFinances === null ? current.finances : mergeById(current.finances ?? [], remoteFinances),
      documents: remoteDocuments === null ? current.documents : mergeById(current.documents ?? [], remoteDocuments),
    }));
    setAnalysisSources((current) => ({
      finances: remoteFinances === null
        ? current.finances
        : current.finances.includes("dispositivo local")
          ? "dispositivo local + D1 (prioridade local)"
          : "D1 como fallback; leitura local indisponível",
      documents: remoteDocuments === null
        ? current.documents
        : current.documents.includes("dispositivo local")
          ? "dispositivo local + D1 (prioridade local)"
          : "D1 como fallback; leitura local indisponível",
    }));

    const failures: string[] = [...analysisLocalErrorsRef.current];
    if (retry.finances && financesResult?.status === "rejected") failures.push("D1 de finanças indisponível; dados locais mantidos");
    if (retry.documents && documentsResult?.status === "rejected") failures.push("D1 de documentos indisponível; dados locais mantidos");
    analysisRetryAfterUnlockRef.current = {
      finances: retry.finances && financesResult?.status === "rejected",
      documents: retry.documents && documentsResult?.status === "rejected",
    };
    setAnalysisError(failures.join(". "));
    setAnalysisLoading(false);
  };

  const beginCalendarEdit = (event: GoogleCalendarEvent) => {
    const allDay = Boolean(event.start?.date);
    const eventStart = event.start as GoogleCalendarDate | undefined;
    const eventEnd = event.end as GoogleCalendarDate | undefined;
    const eventTimeZone = eventStart?.timeZone ?? eventEnd?.timeZone;
    setCalendarError("");
    setCalendarDraft({
      summary: event.summary ?? "",
      description: event.description ?? "",
      location: event.location ?? "",
      allDay,
      start: allDay
        ? event.start?.date ?? ""
        : calendarDateTimeInputValue(eventStart ? { ...eventStart, timeZone: eventStart.timeZone ?? eventTimeZone } : undefined),
      end: allDay
        ? event.end?.date ?? ""
        : calendarDateTimeInputValue(eventEnd ? { ...eventEnd, timeZone: eventEnd.timeZone ?? eventTimeZone } : undefined),
    });
    setEditingCalendarEventId(event.id);
  };

  const changeCalendarAllDay = (allDay: boolean) => {
    setCalendarDraft((current) => {
      if (!current) return current;
      const dateOnly = (value: string) => value.split("T")[0] ?? "";
      const withTime = (value: string, time: string) => value.includes("T")
        ? value
        : value ? `${value}T${time}` : "";
      return {
        ...current,
        allDay,
        start: allDay ? dateOnly(current.start) : withTime(current.start, "09:00"),
        end: allDay ? dateOnly(current.end) : withTime(current.end, "10:00"),
      };
    });
  };

  const saveCalendarEdit = async () => {
    if (!calendarDraft || !editingCalendarEventId) return;
    const event = calendarEvents.find((candidate) => candidate.id === editingCalendarEventId);
    if (!event) return;
    const summary = calendarDraft.summary.trim();
    if (!summary || !calendarDraft.start || !calendarDraft.end) {
      setCalendarError("Informe o título, a data/hora inicial e a data/hora final.");
      return;
    }
    if (calendarDraft.end < calendarDraft.start) {
      setCalendarError("A data/hora final precisa ser posterior à inicial.");
      return;
    }

    let start: GoogleCalendarDate;
    let end: GoogleCalendarDate;
    const eventStart = event.start as GoogleCalendarDate | undefined;
    const eventEnd = event.end as GoogleCalendarDate | undefined;
    const eventTimeZone = eventStart?.timeZone ?? eventEnd?.timeZone;
    try {
      start = calendarDraft.allDay
        ? { date: calendarDraft.start }
        : buildCalendarDateTime(calendarDraft.start, eventStart ? { ...eventStart, timeZone: eventStart.timeZone ?? eventTimeZone } : undefined);
      end = calendarDraft.allDay
        ? { date: calendarDraft.end }
        : buildCalendarDateTime(calendarDraft.end, eventEnd ? { ...eventEnd, timeZone: eventEnd.timeZone ?? eventTimeZone } : undefined);
    } catch (error) {
      setCalendarError(error instanceof Error ? error.message : "Não foi possível converter a data no fuso original.");
      return;
    }

    const payload = {
      summary,
      description: calendarDraft.description.trim(),
      location: calendarDraft.location.trim(),
      start,
      end,
    };
    const displayedDate = calendarDraft.allDay
      ? `${calendarDraft.start} até ${calendarDraft.end} (dia inteiro)`
      : `${calendarDraft.start.replace("T", " ")} até ${calendarDraft.end.replace("T", " ")}`;
    if (!window.confirm(
      `Confirmar atualização deste evento no Google Calendar?\n\nTítulo: ${summary}\nData: ${displayedDate}\n\nO Calendar receberá PATCH somente após esta confirmação.`,
    )) return;

    setCalendarActionBusyId(event.id);
    setCalendarError("");
    try {
      const updated = await googleCalendarUpdate(event.id, payload, true);
      setCalendarEvents((current) => current.map((candidate) =>
        candidate.id === event.id ? updated : candidate,
      ));
      setEditingCalendarEventId(null);
      setCalendarDraft(null);
      setCalendarMessage("Evento atualizado no Google Calendar.");
      await refreshCalendar();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Falha ao atualizar o evento.";
      setCalendarMessage("A agenda não foi alterada.");
      setCalendarError(`${detail} Aniversários e eventos fromGmail podem ser somente leitura; nenhuma alteração local foi aplicada.`);
    } finally {
      setCalendarActionBusyId(null);
    }
  };

  const deleteCalendarEvent = async (event: GoogleCalendarEvent) => {
    const title = event.summary?.trim() || "Compromisso sem título";
    const start = calendarDateForDisplay(event.start as GoogleCalendarDate | undefined);
    const end = calendarDateForDisplay(event.end as GoogleCalendarDate | undefined);
    if (!window.confirm(
      `Confirmar exclusão deste evento do Google Calendar?\n\nTítulo: ${title}\nData: ${start}${end !== "Data não informada" ? ` até ${end}` : ""}\n\nA exclusão só será solicitada após esta confirmação.`,
    )) return;

    setCalendarActionBusyId(event.id);
    setCalendarError("");
    try {
      await googleCalendarDelete(event.id, true);
      setCalendarEvents((current) => current.filter((candidate) => candidate.id !== event.id));
      setEditingCalendarEventId(null);
      setCalendarDraft(null);
      setCalendarMessage("Evento excluído do Google Calendar.");
      await refreshCalendar();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Falha ao excluir o evento.";
      setCalendarMessage("A agenda não foi alterada.");
      setCalendarError(`${detail} Aniversários e eventos fromGmail podem ser somente leitura; nada foi removido da lista.`);
    } finally {
      setCalendarActionBusyId(null);
    }
  };

  const generateLocalAnalysisReport = () => {
    const finances = analysisRows.finances;
    const documents = analysisRows.documents;
    const income = finances?.filter((row) => row.type === "income").reduce((sum, row) => sum + row.amount, 0) ?? null;
    const expenses = finances?.filter((row) => row.type === "expense").reduce((sum, row) => sum + row.amount, 0) ?? null;
    const categories = new Map<string, { income: number; expense: number }>();
    for (const row of finances ?? []) {
      const totals = categories.get(row.category) ?? { income: 0, expense: 0 };
      totals[row.type] += row.amount;
      categories.set(row.category, totals);
    }
    const today = new Date().toISOString().slice(0, 10);
    const openEntries = finances?.filter((row) => row.status !== "paid") ?? null;
    const overdueEntries = finances?.filter((row) =>
      row.status === "overdue" || (row.status === "open" && row.dueAt && row.dueAt < today),
    ) ?? null;
    const radarPending = items.filter((item) => item.status !== "completed").length;
    const lines = [
      "IRIS — RESUMO LOCAL VERIFICÁVEL",
      `Gerado em: ${new Date().toLocaleString("pt-BR")}`,
      "Este relatório foi calculado neste dispositivo a partir dos lançamentos disponíveis; nenhuma informação pessoal foi enviada à IA.",
      `Fonte de finanças: ${analysisSources.finances}.`,
      `Fonte de documentos: ${analysisSources.documents}.`,
      "",
      `Lançamentos financeiros: ${finances === null ? "indisponível" : finances.length}`,
      `Renda/receitas: ${income === null ? "indisponível" : formatBrl(income)}`,
      `Despesas: ${expenses === null ? "indisponível" : formatBrl(expenses)}`,
      `Pendências financeiras em aberto: ${openEntries === null ? "indisponível" : openEntries.length}`,
      `Pendências financeiras vencidas: ${overdueEntries === null ? "indisponível" : overdueEntries.length}`,
      `Documentos: ${documents === null ? "indisponível" : documents.length}`,
      `Pendências exibidas no Radar: ${radarPending} (lista atual; pode incluir exemplos no modo de demonstração).`,
      "",
      "Somas por categoria:",
      ...(finances === null
        ? ["- Indisponíveis: a fonte de lançamentos não pôde ser lida."]
        : categories.size
          ? [...categories.entries()]
              .sort(([left], [right]) => left.localeCompare(right, "pt-BR"))
              .map(([category, totals]) => `- ${category}: receitas ${formatBrl(totals.income)}; despesas ${formatBrl(totals.expense)}; total ${formatBrl(totals.income + totals.expense)}.`)
          : ["- Nenhum lançamento financeiro disponível para somar."]),
      "",
      "Nota: é um resumo determinístico dos registros carregados, não uma análise completa por IA.",
    ];
    setAnalysisReport(lines.join("\n"));
  };

  useEffect(() => {
    try {
      localStorage.setItem(
        "iris-chat-history",
        JSON.stringify(chat.slice(-30)),
      );
    } catch {}
  }, [chat]);

  useEffect(() => {
    if (!chatPinnedToBottomRef.current || !chatFeedRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      chatFeedRef.current?.scrollTo({
        top: chatFeedRef.current.scrollHeight,
        behavior: "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [chat, isProcessing]);

  const refreshRadar = async () => {
    try {
      const { items: rows } = await loadIrisData("radar");
      radarRetryAfterUnlockRef.current = false;
      if (!rows.length) return;
      const remoteItems: RadarItem[] = rows.map((row, index) => ({
        id: Number(row.id) || Date.now() + index,
        label: String(row.label ?? ""),
        detail: String(row.detail ?? ""),
        date: row.due_at ? new Date(String(row.due_at)).toLocaleDateString("pt-BR") : "em dia",
        priority: "normal",
        action: "Continuar acompanhamento",
        dueAt: row.due_at ? String(row.due_at) : null,
        status: row.status === "completed" ? "completed" : "pending",
        category: (String(row.category ?? "Geral") as RadarCategory),
      }));
      setItems(remoteItems);
      setRadarFallback(false);
    } catch {
      radarRetryAfterUnlockRef.current = true;
      // O modo local continua disponível quando o Worker está bloqueado ou indisponível.
    }
  };

  useEffect(() => {
    void refreshRadar();
  }, []);

  useEffect(() => {
    if (activeView === "agenda") void refreshCalendar();
    if (activeView === "analises") {
      setAnalysisReport(null);
      void refreshAnalysisData();
    }
  }, [activeView]);

  useEffect(() => {
    const onRemoteAccessChanged = () => {
      const ready = isIrisRemoteModeEnabled() && isIrisAccessUnlocked();
      setRemoteAccessReady(ready);
      if (!ready) return;
      if (radarRetryAfterUnlockRef.current) {
        radarRetryAfterUnlockRef.current = false;
        void refreshRadar();
      }
      if (activeView === "agenda" && calendarRetryAfterUnlockRef.current) {
        calendarRetryAfterUnlockRef.current = false;
        void refreshCalendar();
      }
      if (activeView === "analises" && (analysisRetryAfterUnlockRef.current.finances || analysisRetryAfterUnlockRef.current.documents)) {
        void retryFailedAnalysisReads();
      }
    };
    window.addEventListener("iris-access-changed", onRemoteAccessChanged);
    window.addEventListener("iris-mode-changed", onRemoteAccessChanged);
    return () => {
      window.removeEventListener("iris-access-changed", onRemoteAccessChanged);
      window.removeEventListener("iris-mode-changed", onRemoteAccessChanged);
    };
  }, [activeView]);

  const [aiProvider, setAiProvider] = useState<AiProvider>(() => {
    try {
      const saved = localStorage.getItem("vida-ai-provider");
      return saved === "chatgpt" || saved === "gemini" || saved === "kimi"
        ? saved
        : "manus";
    } catch {
      return "manus";
    }
  });

  const profile = trpc.profile.me.useQuery(undefined, {
    enabled: isAuthenticated && remoteAccessReady,
    retry: false,
  });
  const preference = trpc.ai.preference.useQuery(undefined, {
    enabled: isAuthenticated && remoteAccessReady,
    retry: false,
  });
  const radarQuery = trpc.radar.list.useQuery(undefined, {
    enabled: isAuthenticated && remoteAccessReady,
    retry: false,
  });
  const savePreference = trpc.ai.setPreference.useMutation();
  const updateRadar = trpc.radar.update.useMutation();
  const updateRadarStatus = trpc.radar.updateStatus.useMutation();
  const confirmRadar = trpc.radar.confirmAction.useMutation();
  const deleteRadar = trpc.radar.delete.useMutation();
  const utils = trpc.useUtils();
  const suggest = trpc.ai.suggest.useMutation();
  const uploadAttachment = trpc.ai.upload.useMutation();
  const voiceProfile = trpc.voice.getProfile.useQuery(undefined, {
    enabled: isAuthenticated && remoteAccessReady,
    retry: false,
  });
  const updateVoiceProfile = trpc.voice.updateProfile.useMutation();
  const userFiles = trpc.documents.list.useQuery(undefined, {
    enabled: isAuthenticated && remoteAccessReady,
    retry: false,
  });
  const costStatus = trpc.control.costStatus.useQuery(undefined, {
    enabled: isAuthenticated && remoteAccessReady,
    retry: false,
  });

  useEffect(() => {
    if (preference.data?.provider) setAiProvider(preference.data.provider);
  }, [preference.data?.provider]);

  useEffect(() => {
    const onAuthConfigMissing = () => {
      const message =
        "O acesso completo da Iris requer configuração de autenticação. O modo demonstração continua disponível.";
      setChat((current) => [...current, { role: "assistant", text: message }]);
    };
    window.addEventListener("iris:auth-config-missing", onAuthConfigMissing);
    return () =>
      window.removeEventListener(
        "iris:auth-config-missing",
        onAuthConfigMissing,
      );
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !remoteAccessReady) {
      setRadarFallback(false);
      return;
    }
    if (radarQuery.data) {
      setRadarFallback(false);
      setItems(
        radarQuery.data.map((item) => ({
          id: item.id,
          label: item.label,
          detail: item.detail,
          date: String(item.dateLabel ?? ""),
          priority: item.priority as Priority,
          action: item.action,
          dueAt: item.dueAt ? new Date(item.dueAt).toISOString() : null,
          reminderAt: item.reminderAt
            ? new Date(item.reminderAt).toISOString()
            : null,
          timezone: item.timezone ?? undefined,
          status: item.status === "completed" ? "completed" : "pending",
          category: "Geral",
        })),
      );
      return;
    }
    if (radarQuery.isError) {
      setRadarFallback(true);
      setItems(initialItems);
    }
  }, [isAuthenticated, remoteAccessReady, radarQuery.data, radarQuery.isError]);

  useEffect(() => {
    if (!isAuthenticated || !remoteAccessReady || !radarQuery.isLoading) return;
    const timer = window.setTimeout(() => {
      if (!radarQuery.data) {
        setRadarFallback(true);
        setItems(initialItems);
      }
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [isAuthenticated, remoteAccessReady, radarQuery.isLoading, radarQuery.data]);

  const categoryFor = (item: RadarItem): RadarCategory => {
    if (item.category && item.category !== "Todas Categorias")
      return item.category;
    const text = `${item.label} ${item.detail}`.toLowerCase();
    if (/(conta|seguro|assinatura|pagamento|dinheiro|finance)/.test(text))
      return "Finanças";
    if (/(trabalho|cliente|reunião|projeto)/.test(text)) return "Trabalho";
    if (/(saúde|médico|consulta|exame)/.test(text)) return "Saúde";
    if (/(documento|família|pessoal)/.test(text)) return "Pessoal";
    if (/(comprar|compra|passagem)/.test(text)) return "Compras";
    return "Geral";
  };

  const visibleItems = useMemo(() => {
    return items.filter((item) => {
      const matchesQuery = `${item.label} ${item.detail} ${item.action}`
        .toLowerCase()
        .includes(radarSearch.toLowerCase());
      const matchesStatus =
        statusFilter === "all" || (item.status ?? "pending") === statusFilter;
      const matchesCategory =
        categoryFilter === "Todas Categorias" ||
        categoryFor(item) === categoryFilter;
      return matchesQuery && matchesStatus && matchesCategory;
    });
  }, [items, radarSearch, statusFilter, categoryFilter]);

  const radarStats = useMemo(() => {
    return {
      total: items.length,
      pending: items.filter((item) => (item.status ?? "pending") === "pending")
        .length,
      inProgress: items.filter((item) => item.status === "in_progress").length,
      completed: items.filter((item) => item.status === "completed").length,
    };
  }, [items]);

  const runDemoCommand = (text: string): RadarItem | null => {
    const normalized = text.toLowerCase().trim();
    const isReminder =
      /(vence|vencimento|pagar|lembrete|lembrar|dia \d{1,2}|amanhã|amanha|tarefa|comprar)/i.test(
        normalized,
      );

    const labelMatch = normalized.match(
      /(?:minha|meu|a|o)\s+(.+?)(?:\s+vence|\s+vencimento|\s+dia\s+\d|\s+amanh|$)/i,
    );
    const rawLabel = labelMatch?.[1]?.trim() || text.trim();
    const label = rawLabel
      .replace(/\s+/g, " ")
      .replace(/^./, (c) => c.toUpperCase());
    const dayMatch = normalized.match(/\bdia\s+(\d{1,2})\b/);
    const hasTomorrow = /\bamanh[ãa]\b/.test(normalized);
    const now = new Date();
    const due = new Date(now);
    if (hasTomorrow) due.setDate(now.getDate() + 1);
    else if (dayMatch) {
      const day = Number(dayMatch[1]);
      due.setDate(1);
      due.setDate(day);
      if (due < new Date(now.getFullYear(), now.getMonth(), now.getDate()))
        due.setMonth(due.getMonth() + 1);
    } else due.setDate(now.getDate() + 1);

    const dateLabel = hasTomorrow
      ? "amanhã"
      : due.toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        });
    const priority: Priority =
      hasTomorrow ||
      Boolean(dayMatch && due.getTime() - now.getTime() < 3 * 86400000)
        ? "urgente"
        : "importante";
    const amountMatch = text.match(/R\$\s*([\d.,]+)/i);
    const detail =
      label.toLowerCase().includes("conta de internet") && dayMatch
        ? `Conta de internet com vencimento no dia ${dayMatch[1]}${amountMatch ? ` · R$ ${amountMatch[1]}` : ""}`
        : `Vencimento em ${dateLabel}${amountMatch ? ` · R$ ${amountMatch[1]}` : ""}`;

    return {
      id: Date.now(),
      label,
      detail,
      date: dateLabel,
      priority,
      action: hasTomorrow ? "Lembrar amanhã" : "Acompanhar vencimento",
      dueAt: due.toISOString(),
      reminderAt: due.toISOString(),
      timezone: "America/Sao_Paulo",
      status: "pending",
      category: "Finanças",
    };
  };

  const [voiceActive, setVoiceActive] = useState(() => {
    try {
      return localStorage.getItem("iris-voice-enabled") === "true";
    } catch {
      return false;
    }
  });

  const voiceEnabled =
    voiceActive || (isAuthenticated && voiceProfile.data?.enabled === true);

  const voice = useIrisVoice({
    enabled: voiceEnabled,
    wakeWord: voiceProfile.data?.wakeWord ?? "iris",
    language: voiceProfile.data?.language ?? "pt-BR",
    onWake: () => setIsListening(true),
    onTranscript: (text, isFinal) => {
      setCommandText(text);
      if (isFinal) {
        setIsListening(false);
      }
    },
    onCommand: (command) => {
      const normalized = command.toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
      if (isProcessing && !/^(pare|parar|silêncio|silencio|cancele)\b/i.test(normalized)) return;
      const now = Date.now();
      if (lastVoiceCommandRef.current.text === normalized && now - lastVoiceCommandRef.current.at < 2500) return;
      lastVoiceCommandRef.current = { text: normalized, at: now };
      setIsListening(false);
      setCommandText(command);
      void sendMessage(command);
    },
    onError: (err) => {
      const now = Date.now();
      if (lastVoiceErrorRef.current.text === err && now - lastVoiceErrorRef.current.at < 5000) return;
      lastVoiceErrorRef.current = { text: err, at: now };
      setIsListening(false);
      setChat((current) => [...current, { role: "assistant", text: err }]);
    },
  });

  const toggleVoice = async () => {
    if (!voice.supported) {
      setChat((current) => [
        ...current,
        {
          role: "assistant",
          text: "O reconhecimento de voz não é suportado pelo seu navegador atual. Recomendamos o uso do Google Chrome, Microsoft Edge ou navegadores baseados em Chromium com suporte à Web Speech API.",
        },
      ]);
      return;
    }

    if (
      voice.status === "listening" ||
      voice.status === "conversation" ||
      voice.status === "wake" ||
      isListening
    ) {
      voice.stop();
      setIsListening(false);
      setVoiceActive(false);
      try {
        localStorage.setItem("iris-voice-enabled", "false");
      } catch {}
      if (isAuthenticated && remoteAccessReady) {
        updateVoiceProfile.mutate({
          enabled: false,
          wakeWord: voiceProfile.data?.wakeWord ?? "iris",
          language: voiceProfile.data?.language ?? "pt-BR",
          voiceIdentityEnabled: voiceProfile.data?.voiceIdentityEnabled ?? true,
          unknownVoicePolicy:
            voiceProfile.data?.unknownVoicePolicy ?? "deny_sensitive",
          trustedDeviceRequired:
            voiceProfile.data?.trustedDeviceRequired ?? true,
        });
      }
      return;
    }

    // Iniciar captura direta de voz
    setVoiceActive(true);
    setIsListening(true);
    try {
      localStorage.setItem("iris-voice-enabled", "true");
    } catch {}

    const started = voice.start(true);
    if (!started && voice.status === "permission") {
      setIsListening(false);
      setChat((current) => [
        ...current,
        {
          role: "assistant",
          text: "Permissão de acesso ao microfone negada ou bloqueada no navegador. Habilite o microfone nas permissões da página para falar com a Iris.",
        },
      ]);
    }

    if (isAuthenticated && remoteAccessReady) {
      updateVoiceProfile.mutate({
        enabled: true,
        wakeWord: voiceProfile.data?.wakeWord ?? "iris",
        language: voiceProfile.data?.language ?? "pt-BR",
        voiceIdentityEnabled: voiceProfile.data?.voiceIdentityEnabled ?? true,
        unknownVoicePolicy:
          voiceProfile.data?.unknownVoicePolicy ?? "deny_sensitive",
        trustedDeviceRequired: voiceProfile.data?.trustedDeviceRequired ?? true,
      });
    }
  };

  const cancelSuggestion = () => {
    if (!pendingSuggestion) return;
    const itemLabel = pendingSuggestion.label;
    setPendingSuggestion(null);
    setIrisState("idle");
    const cancelMsg = `Ação “${itemLabel}” foi cancelada por você. Nenhuma alteração foi realizada.`;
    setChat((current) => [...current, { role: "assistant", text: cancelMsg }]);
    if (voiceEnabled) voice.speak(cancelMsg);
  };

  const confirmSuggestion = async () => {
    if (!pendingSuggestion) return;
    setIrisState("executing");
    setIsExecuting(true);
    try {
      if (
        isAuthenticated &&
        remoteAccessReady &&
        pendingSuggestion.proposalId &&
        pendingSuggestion.confirmationToken
      ) {
        await confirmRadar.mutateAsync({
          proposalId: pendingSuggestion.proposalId,
        });
        await utils.radar.list.invalidate();
      } else {
        // Modo demonstração ou local seguro
        if (
          pendingSuggestion.action === "Confirmar exclusão" &&
          pendingSuggestion.id
        ) {
          setItems((current) =>
            current.filter((it) => it.id !== pendingSuggestion.id),
          );
        } else if (
          pendingSuggestion.action === "Marcar como concluído" &&
          pendingSuggestion.id
        ) {
          setItems((current) =>
            completeRadarItem(current, pendingSuggestion.id),
          );
        } else {
          setItems((current) => [
            pendingSuggestion,
            ...current.filter(
              (item) =>
                item.label.toLowerCase() !==
                pendingSuggestion.label.toLowerCase(),
            ),
          ]);
        }
      }
      const label = pendingSuggestion.label;
      setPendingSuggestion(null);
      setIrisState("completed");
      const confirmMsg = `Pronto! Ação “${label}” foi autorizada e executada com sucesso.`;
      setChat((current) => [
        ...current,
        { role: "assistant", text: confirmMsg },
      ]);
      if (voiceEnabled) voice.speak(confirmMsg);
      setTimeout(() => setIrisState("idle"), 1500);
    } catch (error) {
      setIrisState("error");
      const errorMsg =
        error instanceof Error
          ? error.message
          : "Não consegui autorizar e executar a proposta.";
      setChat((current) => [...current, { role: "assistant", text: errorMsg }]);
      if (voiceEnabled) voice.speak(errorMsg);
      setTimeout(() => setIrisState("idle"), 2500);
    } finally {
      setIsExecuting(false);
    }
  };

  const sendStaticWorkerMessage = async (text: string) => {
    setIrisState("analyzing");
    setIsProcessing(true);
    const normalized = text.toLowerCase().trim();
    try {
      if (/^(pare|parar|pare de ler|silêncio|silencio|cancele)$/i.test(normalized)) {
        voice.stop();
        window.speechSynthesis?.cancel();
        setIsListening(false);
        const reply = "Parei a leitura imediatamente.";
        setChat((current) => [...current, { role: "assistant", text: reply }]);
        setIrisState("idle");
        return;
      }

      const isGmailCommand = /(e-?mail|gmail|mensage(m|ns)|remetente|título|titulo)/i.test(text);
      if (isGmailCommand) {
        if (!isIrisRemoteModeEnabled()) {
          const reply = "O modo Demonstração está ativo. Nenhuma consulta Gmail foi enviada; ative o acesso remoto e desbloqueie os serviços para continuar.";
          setChat((current) => [...current, { role: "assistant", text: reply }]);
          if (voiceEnabled) voice.speak(reply);
          return;
        }
        if (!isIrisAccessUnlocked()) {
          const reply = "Os serviços remotos estão bloqueados. Desbloqueie o acesso e repita o pedido; nenhuma leitura Gmail foi feita.";
          setChat((current) => [...current, { role: "assistant", text: reply }]);
          if (voiceEnabled) voice.speak(reply);
          return;
        }
        const status = await gmailStatus();
        if (!status.authorized) {
          const reply = "O Gmail ainda não está conectado. Você pode iniciar a autorização somente leitura usando o botão abaixo.";
          setChat((current) => [...current, { role: "assistant", text: reply, oauthAction: "gmail" }]);
          if (voiceEnabled) voice.speak(reply);
          return;
        }
        const listing = await gmailMessages();
        const messages = (listing.messages ?? []).slice(0, 20);
        const isCountRequest = /quantos|quantas|quantidade|número|numero/i.test(text);
        if (isCountRequest) {
          const count = listing.resultSizeEstimate ?? messages.length;
          const reply = `O Gmail estima ${count} e-mails. A consulta exibiu metadados de até ${messages.length} mensagens; nenhum corpo foi carregado.`;
          setChat((current) => [...current, { role: "assistant", text: reply }]);
          if (voiceEnabled) voice.speak(reply);
          return;
        }

        const formatSummary = (message: GmailSummary, index: number) => {
          const subject = (message.subject || gmailHeader(message, "Subject")).replace(/\s+/g, " ");
          const from = (message.from || gmailHeader(message, "From")).replace(/\s+/g, " ");
          const snippet = message.snippet?.replace(/\s+/g, " ").trim();
          return `${index + 1}. ${subject} — ${from}${snippet ? `\n   ${snippet.slice(0, 180)}${snippet.length > 180 ? "…" : ""}` : ""}`;
        };
        const isReadRequest = /\b(leia|ler|leitura|conteúdo|conteudo|corpo|texto completo)\b/i.test(text);
        if (isReadRequest) {
          const selection = selectGmailMessage(messages, text);
          if (!selection.target) {
            const candidates = selection.matches.length ? selection.matches : messages;
            const explanation = selection.matches.length > 1
              ? "Encontrei mais de uma mensagem correspondente. Indique um único número da lista para ler."
              : selection.identified
                ? "Não encontrei uma mensagem única com esse identificador. Escolha uma das mensagens abaixo."
                : "Para ler uma mensagem, indique o assunto/remetente ou um número desta lista. Nenhum corpo foi carregado.";
            const reply = `${explanation}${candidates.length ? `\n${candidates.slice(0, 10).map(formatSummary).join("\n")}` : "\nNão há mensagens disponíveis na consulta atual."}`;
            setChat((current) => [...current, { role: "assistant", text: reply }]);
            if (voiceEnabled) voice.speak(reply);
            return;
          }
          const target = await gmailMessage(selection.target.id);
          const reply = `Assunto: ${gmailHeader(target, "Subject")}\nRemetente: ${gmailHeader(target, "From")}\n\n${gmailBody(target)}`;
          setChat((current) => [...current, { role: "assistant", text: reply }]);
          if (voiceEnabled) voice.speak(reply);
          return;
        }

        const reply = messages.length
          ? `Metadados das mensagens Gmail mais recentes (até ${messages.length}; sem carregar corpos):\n${messages.map(formatSummary).join("\n")}`
          : "Não encontrei e-mails na consulta atual.";
        setChat((current) => [...current, { role: "assistant", text: reply }]);
        if (voiceEnabled) voice.speak(reply);
        return;
      }

      const isCalendarCommand = /(calendário|calendario|agenda|calendar|compromisso|evento)/i.test(text);
      if (isCalendarCommand) {
        const status = await googleCalendarStatus();
        if (!status.authorized) {
          const reply = "O Google Calendar ainda não está autorizado. Abra Conexões e autorize o Calendar antes de consultar a agenda.";
          setChat((current) => [...current, { role: "assistant", text: reply }]);
          if (voiceEnabled) voice.speak(reply);
          return;
        }
        const calendar = await googleCalendarEvents(new Date().toISOString());
        const events = (calendar.items ?? []).slice(0, 10);
        const reply = events.length
          ? `Aqui estão os próximos compromissos da sua agenda:\n${events.map((event, index) => {
              const date = event.start?.dateTime
                ? new Date(event.start.dateTime).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
                : event.start?.date
                  ? new Date(`${event.start.date}T00:00:00`).toLocaleDateString("pt-BR")
                  : "horário não informado";
              return `${index + 1}. ${event.summary || "Sem título"} — ${date}${event.location ? ` — ${event.location}` : ""}`;
            }).join("\n")}`
          : "Não encontrei compromissos futuros na sua agenda autorizada.";
        setChat((current) => [...current, { role: "assistant", text: reply }]);
        if (voiceEnabled) voice.speak(reply);
        setIrisState("completed");
        return;
      }

      const result = await askIrisWorker(text);
      const reply = result.text || "Não recebi uma resposta do Worker.";
      setChat((current) => [...current, { role: "assistant", text: reply }]);
      if (voiceEnabled) voice.speak(reply);
      setIrisState("completed");
    } catch (error) {
      const reply = error instanceof Error
        ? `Não consegui concluir a operação conectada: ${error.message}`
        : "Não consegui concluir a operação conectada.";
      setChat((current) => [...current, { role: "assistant", text: reply }]);
      if (voiceEnabled) voice.speak(reply);
      setIrisState("error");
    } finally {
      setIsProcessing(false);
      window.setTimeout(() => setIrisState("idle"), 1500);
    }
  };

  const connectChatGoogle = async (product: "gmail" | "drive" | "calendar") => {
    if (!isIrisRemoteModeEnabled() || !isIrisAccessUnlocked()) {
      setChat((current) => [...current, {
        role: "assistant",
        text: "Desbloqueie o acesso remoto antes de iniciar a autorização Google. Nenhuma solicitação foi enviada.",
      }]);
      return;
    }
    try {
      await startGoogleOAuth(product);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Não foi possível iniciar a autorização Google.";
      setChat((current) => [...current, { role: "assistant", text: detail }]);
    }
  };

  const sendMessage = async (preset?: string) => {
    const text = (preset ?? commandText).trim();
    if (!text && attachments.length === 0) return;
    const selectedAttachments = attachments;
    setCommandText("");
    setAttachments([]);
    setChat((current) => [
      ...current,
      {
        role: "user",
        text: text || "Analisei os anexos enviados.",
        attachments: selectedAttachments.map((att) => ({
          name: att.name,
          type: att.mimeType,
        })),
      },
    ]);

    // Ao enviar comando, abre automaticamente a visualização do Assistente para leitura
    setActiveView("assistente");

    if (!isIrisRemoteModeEnabled() || !isIrisAccessUnlocked()) {
      const isLocalReminder = /(vence|vencimento|pagar|lembrete|lembrar|dia \d{1,2}|amanhã|amanha|tarefa|comprar)/i.test(text);
      const localTask = !selectedAttachments.length && isLocalReminder
        ? runDemoCommand(text)
        : null;
      if (localTask) setItems((current) => [localTask, ...current]);
      const remoteBlocked = isIrisRemoteModeEnabled();
      const reply = `${remoteBlocked ? "Serviços remotos bloqueados" : "Modo Demonstração"}: nenhum texto${selectedAttachments.length ? " ou imagem" : ""} foi enviado. ${localTask ? "O lembrete foi mantido somente neste dispositivo." : remoteBlocked ? "Desbloqueie e repita a ação quando quiser." : "Os recursos locais continuam disponíveis."}`;
      setChat((current) => [...current, { role: "assistant", text: reply }]);
      setIrisState("idle");
      return;
    }

    if (IRIS_STATIC_MODE) {
      const imageAttachment = selectedAttachments.find((att) => att.kind === "image_url");
      if (imageAttachment) {
        try {
          const result = await askIrisAdvanced({ mode: "vision", text, imageBase64: imageAttachment.dataUrl, mimeType: imageAttachment.mimeType });
          const reply = result.text || "Não consegui interpretar a imagem.";
          setChat((current) => [...current, { role: "assistant", text: reply }]);
          if (voiceEnabled) voice.speak(reply);
        } catch (error) {
          const reply = error instanceof Error ? `Não consegui analisar a imagem: ${error.message}` : "Não consegui analisar a imagem.";
          setChat((current) => [...current, { role: "assistant", text: reply }]);
          if (voiceEnabled) voice.speak(reply);
        }
        return;
      }
      await sendStaticWorkerMessage(text);
      return;
    }

    // 1. Receber comando do usuário e iniciar análise cognitiva
    setIrisState("analyzing");
    setIsProcessing(true);

    try {
      // 2. Interpretar intenção e gerar plano de execução operacional
      const operationalPlan = interpretOperationalCommand(text, {
        items,
        isAuthenticated,
      });

      // Se for comando ambíguo ou faltarem parâmetros essenciais, solicita esclarecimento
      if (operationalPlan.isAmbiguous) {
        const reply =
          operationalPlan.clarificationPrompt ||
          "Por favor, forneça mais informações para que eu possa estruturar essa ação com segurança.";
        setChat((current) => [...current, { role: "assistant", text: reply }]);
        if (voiceEnabled) voice.speak(reply);
        setIrisState("idle");
        return;
      }

      const cognitiveAnalysis = analyzeCommand(text, {
        items,
        isAuthenticated,
      });

      // Modo demonstração (sem autenticação)
      if (!isAuthenticated && text) {
        // 5. Se for apenas consulta/análise: responder diretamente
        if (!operationalPlan.requiresAuthorization) {
          const reply =
            operationalPlan.directResponse ||
            cognitiveAnalysis.directResponse ||
            `Comando recebido: “${text}”. No modo demonstração, o status e as consultas são mantidos nesta sessão.`;
          setChat((current) => [
            ...current,
            { role: "assistant", text: reply },
          ]);
          if (voiceEnabled) voice.speak(reply);
          setIrisState("completed");
          setTimeout(() => setIrisState("idle"), 1200);
          return;
        }

        // 6. Se envolver alteração, exclusão, envio, compartilhamento ou organização: exigir autorização explícita
        const proposal = operationalPlan.proposal || cognitiveAnalysis.proposal;
        const demoItem: RadarItem = {
          id: proposal?.targetId ?? Date.now(),
          label: proposal?.label || text,
          detail: proposal?.detail || "Ação proposta pela Iris IA",
          date: proposal?.date || "amanhã",
          priority: (proposal?.priority || "importante") as Priority,
          action: proposal?.action || "Acompanhar no Radar",
          riskLevel: operationalPlan.riskLevel,
          confidence: 0.95,
          status: "pending",
          category: (proposal?.category as RadarCategory) || "Geral",
          dueAt: proposal?.dueAt ?? null,
          reminderAt: proposal?.reminderAt ?? null,
          confirmationToken: "demo-token-" + Date.now(),
        };

        setPendingSuggestion(demoItem);
        setIrisState("awaiting_authorization");
        const explain = `Entendi seu pedido. Trata-se de uma ação de ${operationalPlan.actionType} (risco ${operationalPlan.riskLevel === "high" ? "alto" : operationalPlan.riskLevel === "medium" ? "médio" : "baixo"}). Conforme a regra de segurança da IRIS, confirme a autorização abaixo para prosseguir.`;
        setChat((current) => [
          ...current,
          { role: "assistant", text: explain },
        ]);
        if (voiceEnabled) voice.speak(explain);
        return;
      }

      // Provedores externos exigem consentimento prévio
      if (
        aiProvider !== "manus" &&
        !(
          profile.data?.externalAiConsent === true ||
          localStorage.getItem("iris-external-ai-consent") === "true"
        )
      ) {
        const reply =
          "Antes de usar uma IA externa, ative sua autorização em Perfil e preferências.";
        setChat((current) => [...current, { role: "assistant", text: reply }]);
        if (voiceEnabled) voice.speak(reply);
        setIrisState("idle");
        return;
      }

      const uploaded = isAuthenticated
        ? await Promise.all(
            selectedAttachments.map(async (att) => {
              const [, encoded = ""] = att.dataUrl.split(",");
              return uploadAttachment.mutateAsync({
                fileName: att.name,
                mimeType: att.mimeType,
                data: encoded,
              });
            }),
          )
        : [];

      const requestAttachments = selectedAttachments.map((att, index) => {
        const safeUrl =
          aiProvider === "gemini"
            ? att.dataUrl
            : (uploaded[index]?.url ?? att.dataUrl);
        return att.kind === "image_url"
          ? { type: "image_url" as const, url: safeUrl, mimeType: att.mimeType }
          : { type: "file_url" as const, url: safeUrl, mimeType: att.mimeType };
      });

      const result = await suggest.mutateAsync({
        message: text || "Analise os anexos enviados.",
        conversationId,
        model: aiProvider,
        attachments: requestAttachments,
      });

      if (result.conversationId) setConversationId(result.conversationId);
      setChat((current) => [
        ...current,
        { role: "assistant", text: result.reply },
      ]);
      if (voiceEnabled) voice.speak(result.reply);

      // 6. Se envolver sugestão com alteração/execução: exigir autorização explícita
      if (result.suggestion) {
        const suggestion = result.suggestion;
        setPendingSuggestion({
          ...suggestion,
          id: suggestion.proposalId ?? Date.now(),
        } as RadarItem);
        setIrisState("awaiting_authorization");
      } else {
        setIrisState("completed");
        setTimeout(() => setIrisState("idle"), 1500);
      }
    } catch (error) {
      setIrisState("error");
      const message =
        error instanceof Error
          ? error.message
          : "Não foi possível obter resposta da Iris IA.";
      setChat((current) => [...current, { role: "assistant", text: message }]);
      if (voiceEnabled) voice.speak(message);
      setTimeout(() => setIrisState("idle"), 2500);
    } finally {
      setIsProcessing(false);
    }
  };

  const completeItem = async (id: number) => {
    if (!isAuthenticated) {
      setItems((current) =>
        current.map((item) =>
          item.id === id ? { ...item, status: "completed" } : item,
        ),
      );
      setChat((current) => [
        ...current,
        { role: "assistant", text: "Concluído em modo demonstração." },
      ]);
      return;
    }
    setItems((current) => completeRadarItem(current, id));
    await updateRadarStatus.mutateAsync({ id, status: "completed" });
    await utils.radar.list.invalidate();
  };

  const snoozeItem = async (id: number) => {
    const item = items.find((candidate) => candidate.id === id);
    if (!item) return;
    const next = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    if (!isAuthenticated) {
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === id
            ? {
                ...candidate,
                date: "amanhã",
                detail: `${candidate.detail.replace(/ · adiado$/, "")} · adiado`,
                dueAt: next,
                reminderAt: next,
              }
            : candidate,
        ),
      );
      setChat((current) => [
        ...current,
        { role: "assistant", text: `Adiei “${item.label}” para amanhã.` },
      ]);
      return;
    }
    await updateRadarStatus.mutateAsync({
      id,
      status: "snoozed",
      dateLabel: "amanhã",
      detail: `${item.detail.replace(/ · adiado$/, "")} · adiado`,
      dueAt: next,
      reminderAt: next,
    });
    await utils.radar.list.invalidate();
  };

  const removeItem = async (id: number) => {
    if (!window.confirm("Excluir este item do Radar?")) return;
    if (!isAuthenticated) {
      setItems((current) => current.filter((item) => item.id !== id));
      return;
    }
    await deleteRadar.mutateAsync({ id });
    await utils.radar.list.invalidate();
  };

  const startEdit = (item: RadarItem) => {
    setEditingId(item.id);
    setEditText(`${item.label} — ${item.detail}`);
  };

  const saveEdit = () => {
    if (!editingId || !editText.trim()) return;
    setItems((current) => editRadarItem(current, editingId, editText));
    if (isAuthenticated) {
      const [label, detail = ""] = editText.split(" — ");
      const current = items.find((item) => item.id === editingId);
      void updateRadar
        .mutateAsync({
          id: editingId,
          label: label.trim(),
          detail: detail.trim() || "Atualizado pela Iris IA",
          dateLabel: current?.date ?? "atualizado",
          priority: current?.priority ?? "normal",
          action: current?.action ?? "Continuar acompanhamento",
          dueAt: current?.dueAt ?? null,
          reminderAt: current?.reminderAt ?? null,
          timezone: current?.timezone ?? "America/Sao_Paulo",
        })
        .then(() => utils.radar.list.invalidate());
    }
    setEditingId(null);
  };

  const handleCreateTask = () => {
    if (!newTaskInput.trim()) return;
    const item = runDemoCommand(newTaskInput);
    if (item) {
      setItems((curr) => [item, ...curr]);
      void saveIrisData("radar", {
        id: String(item.id),
        label: item.label,
        detail: item.detail,
        status: item.status ?? "pending",
        category: item.category ?? "Geral",
        due_at: item.dueAt ?? null,
        payload: { priority: item.priority, action: item.action },
      }).catch(() => undefined);
    } else {
      const manualItem: RadarItem = {
        id: Date.now(),
        label: newTaskInput.trim(),
        detail: "Adicionada manualmente no Command Center",
        date: "hoje",
        priority: "importante",
        action: "Resolver",
        status: "pending",
        category: "Geral",
      };
      setItems((curr) => [manualItem, ...curr]);
      void saveIrisData("radar", {
        id: String(manualItem.id),
        label: manualItem.label,
        detail: manualItem.detail,
        status: manualItem.status ?? "pending",
        category: manualItem.category ?? "Geral",
        payload: { priority: manualItem.priority, action: manualItem.action },
      }).catch(() => undefined);
    }
    setNewTaskInput("");
    setActiveView("radar");
  };

  const focusInput = () => {
    const input = document.getElementById(
      "iris-command-input",
    ) as HTMLInputElement | null;
    if (input) {
      input.focus();
    }
  };

  return (
    <div className="iris54-root">
      <div
        className="iris54-floating-brand"
        onClick={() => setActiveView(null)}
        title="Início Iris"
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") setActiveView(null);
        }}
      >
        <IrisOcularEye
          className="iris54-brand-eye-real"
          onClick={() => setActiveView(null)}
        />
        <div className="iris54-brand-text">
          <strong>Iris</strong>
        </div>
      </div>

      {/* --------------------------------------------------------------------
          CONTAINER PRINCIPAL — EXPERIÊNCIA ÚNICA COMMAND CENTER (TELA INTEIRA)
          -------------------------------------------------------------------- */}
      <main className="iris54-main-container">
        <section className="iris54-hero">
          <IrisOcularEye className="iris54-central-eye" onClick={focusInput} />
          <h1 className="iris54-tagline">Sua vida, organizada pela Iris IA</h1>

          {/* BARRA DE COMANDO CENTRAL */}
          <div className="iris54-command-bar">
            {/* BOTÃO DE VOZ / MICROFONE */}
            <button
              type="button"
              className={`iris54-cmd-mic ${isListening || voice.isListening ? "listening" : ""}`}
              onClick={() => void toggleVoice()}
              title={
                !voice.supported
                  ? "Reconhecimento de voz não suportado neste navegador"
                  : isListening || voice.isListening
                    ? "Parar captura de voz"
                    : "Falar com a Iris (Microfone)"
              }
              aria-label="Ativar voz"
            >
              <Mic size={22} />
            </button>

            {/* INPUT CENTRAL */}
            <input
              id="iris-command-input"
              className="iris54-cmd-input"
              value={commandText}
              onChange={(e) => setCommandText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void sendMessage();
              }}
              placeholder="Digite ou fale o que você precisa..."
              autoComplete="off"
            />

            {/* BOTÃO DE ENVIO */}
            <button
              type="button"
              className="iris54-cmd-send"
              onClick={() => void sendMessage()}
              disabled={
                suggest.isPending ||
                isProcessing ||
                irisState === "analyzing" ||
                irisState === "executing"
              }
              aria-label="Enviar comando"
            >
              {suggest.isPending ||
              isProcessing ||
              irisState === "analyzing" ||
              irisState === "executing" ? (
                <Loader2 className="animate-spin" size={20} />
              ) : (
                <ArrowRight size={22} />
              )}
            </button>
          </div>

          {/* NAVEGAÇÃO INFERIOR / BOTÕES PRINCIPAIS */}
          <nav className="iris54-quick-nav">
            <button
              type="button"
              className="iris54-quick-btn"
              onClick={() => {
                void sendMessage("Quais sugestões você tem para mim hoje?");
              }}
            >
              <span className="icon">
                <Sparkles size={17} />
              </span>
              Sugestões
            </button>

            <button
              type="button"
              className="iris54-quick-btn"
              onClick={() => navigate("/financas")}
            >
              <span className="icon">
                <WalletCards size={17} />
              </span>
              Finanças
            </button>

            <button
              type="button"
              className="iris54-quick-btn"
              onClick={() => setActiveView("agenda")}
            >
              <span className="icon">
                <Calendar size={17} />
              </span>
              Agenda
            </button>

            <button
              type="button"
              className="iris54-quick-btn"
              onClick={() => setActiveView("arquivos")}
            >
              <span className="icon">
                <FileText size={17} />
              </span>
              Arquivos
            </button>

            <button
              type="button"
              className="iris54-quick-btn"
              onClick={() => setActiveView("analises")}
            >
              <span className="icon">
                <BarChart3 size={17} />
              </span>
              Análises
            </button>

            <button
              type="button"
              className="iris54-quick-btn"
              onClick={() => setActiveView("ferramentas")}
            >
              <span className="icon">
                <Wrench size={17} />
              </span>
              Ferramentas
            </button>

            <button
              type="button"
              className={`iris54-quick-btn ${menuOpen ? "active" : ""}`}
              onClick={() => setMenuOpen((value) => !value)}
              aria-expanded={menuOpen}
              aria-controls="iris54-module-menu"
            >
              <span className="icon">
                <Menu size={17} />
              </span>
              Menu
            </button>
          </nav>
          {menuOpen && (
            <div
              id="iris54-module-menu"
              className="iris54-module-menu"
              role="menu"
            >
              <Link href="/documentos" onClick={() => setMenuOpen(false)}>
                Arquivo Inteligente
              </Link>
              <Link href="/catalogo" onClick={() => setMenuOpen(false)}>
                Catálogo
              </Link>
              <Link href="/comercial" onClick={() => setMenuOpen(false)}>
                Comercial
              </Link>
              <Link href="/offline" onClick={() => setMenuOpen(false)}>
                Offline
              </Link>
              <Link href="/midia" onClick={() => setMenuOpen(false)}>
                Mídia
              </Link>
              <Link href="/seguranca" onClick={() => setMenuOpen(false)}>
                Segurança
              </Link>
              <Link href="/diagnostico" onClick={() => setMenuOpen(false)}>
                Diagnóstico
              </Link>
              <Link href="/configuracoes" onClick={() => setMenuOpen(false)}>
                Configurações
              </Link>
            </div>
          )}
        </section>
      </main>

      {/* --------------------------------------------------------------------
          MODAL/OVERLAY DINÂMICO PARA AS FUNÇÕES (ACESSÍVEIS PELOS BOTÕES)
          -------------------------------------------------------------------- */}
      {activeView && (
        <div
          className="iris54-view-overlay"
          onClick={() => setActiveView(null)}
        >
          <div
            className="iris54-view-container"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 1. MÓDULO: ASSISTENTE / CONVERSA */}
            {activeView === "assistente" && (
              <>
                <div className="iris54-view-header">
                  <div>
                    <span className="iris54-kicker">CONVERSA &amp; AÇÕES</span>
                    <h2>
                      <Sparkles size={20} color="#22d3ee" /> Assistente Iris
                    </h2>
                    <p>
                      Converse com a Iris IA em linguagem natural para organizar
                      sua vida.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="iris54-close-btn"
                    onClick={() => setActiveView(null)}
                    aria-label="Fechar"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div
                  ref={chatFeedRef}
                  className="iris54-chat-feed"
                  onScroll={(event) => {
                    const feed = event.currentTarget;
                    chatPinnedToBottomRef.current =
                      feed.scrollHeight - feed.scrollTop - feed.clientHeight < 72;
                  }}
                >
                  {chat.map((message, idx) => (
                    <div
                      className={`iris54-chat-bubble ${message.role}`}
                      key={`${message.role}-${idx}`}
                    >
                      <div className="iris54-chat-avatar">
                        {message.role === "assistant" ? (
                          <Sparkles size={14} />
                        ) : (
                          (profile.data?.name || "R").slice(0, 1)
                        )}
                      </div>
                      <div className="iris54-chat-text">{message.text}</div>
                      {message.role === "assistant" && message.oauthAction && (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={!remoteAccessReady}
                          onClick={() => void connectChatGoogle(message.oauthAction!)}
                        >
                          Conectar {message.oauthAction === "gmail" ? "Gmail" : message.oauthAction === "drive" ? "Google Drive" : "Google Calendar"}
                          <ExternalLink size={15} />
                        </Button>
                      )}
                    </div>
                  ))}
                  {(suggest.isPending ||
                    isProcessing ||
                    irisState === "analyzing" ||
                    irisState === "executing") && (
                    <div className="iris54-chat-bubble assistant">
                      <div className="iris54-chat-avatar">
                        <Sparkles size={14} />
                      </div>
                      <div className="iris54-typing-indicator">
                        <span />
                        <span />
                        <span />
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                  <Input
                    placeholder="Responda ou faça uma pergunta à Iris..."
                    value={commandText}
                    onChange={(e) => setCommandText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void sendMessage();
                    }}
                    style={{
                      background: "#060b16",
                      borderColor: "var(--iris-border)",
                      color: "#fff",
                    }}
                  />
                  <Button
                    onClick={() => void sendMessage()}
                    disabled={
                      suggest.isPending ||
                      isProcessing ||
                      irisState === "analyzing" ||
                      irisState === "executing"
                    }
                    style={{ background: "var(--iris-blue)", color: "#fff" }}
                  >
                    {suggest.isPending ||
                    isProcessing ||
                    irisState === "analyzing" ||
                    irisState === "executing"
                      ? "Processando…"
                      : "Enviar"}
                  </Button>
                </div>
              </>
            )}

            {/* 2. MÓDULO: RADAR DE TAREFAS */}
            {activeView === "radar" && (
              <>
                <div className="iris54-view-header">
                  <div>
                    <span className="iris54-kicker">SUA ATENÇÃO · RADAR</span>
                    <h2>
                      <Layers size={20} color="#38bdf8" /> Radar do Iris
                    </h2>
                    <p>
                      O que merece sua atenção agora, organizado em tempo real.
                    </p>
                  </div>
                  <div
                    style={{ display: "flex", gap: 8, alignItems: "center" }}
                  >
                    <button
                      type="button"
                      className="iris54-top-btn primary"
                      onClick={() => setActiveView("nova-tarefa")}
                    >
                      <Plus size={15} /> + Nova Tarefa
                    </button>
                    <button
                      type="button"
                      className="iris54-close-btn"
                      onClick={() => setActiveView(null)}
                      aria-label="Fechar"
                    >
                      <X size={18} />
                    </button>
                  </div>
                </div>

                {/* ESTATÍSTICAS */}
                <div className="iris54-stats-grid">
                  <div className="iris54-stat-card">
                    <strong>{radarStats.total}</strong>
                    <span>Total no Radar</span>
                  </div>
                  <div className="iris54-stat-card">
                    <strong style={{ color: "var(--iris-yellow)" }}>
                      {radarStats.pending}
                    </strong>
                    <span>Pendentes</span>
                  </div>
                  <div className="iris54-stat-card">
                    <strong style={{ color: "var(--iris-cyan)" }}>
                      {radarStats.inProgress}
                    </strong>
                    <span>Em Andamento</span>
                  </div>
                  <div className="iris54-stat-card">
                    <strong style={{ color: "var(--iris-green)" }}>
                      {radarStats.completed}
                    </strong>
                    <span>Concluídas</span>
                  </div>
                </div>

                {/* FILTROS E BUSCA */}
                <div className="iris54-toolbar">
                  <div className="iris54-search-row">
                    <div className="iris54-search-box">
                      <Search size={18} />
                      <input
                        value={radarSearch}
                        onChange={(e) => setRadarSearch(e.target.value)}
                        placeholder="Buscar tarefas por título ou descrição..."
                      />
                    </div>
                  </div>

                  <div className="iris54-filter-pills">
                    {(
                      [
                        ["all", "Todas"],
                        ["pending", "Pendentes"],
                        ["in_progress", "Em Andamento"],
                        ["completed", "Concluídas"],
                      ] as const
                    ).map(([val, label]) => (
                      <button
                        key={val}
                        type="button"
                        className={`iris54-filter-btn ${statusFilter === val ? "active" : ""}`}
                        onClick={() => setStatusFilter(val)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="iris54-filter-pills">
                    {(
                      [
                        "Todas Categorias",
                        "Finanças",
                        "Trabalho",
                        "Saúde",
                        "Pessoal",
                        "Compras",
                        "Geral",
                      ] as RadarCategory[]
                    ).map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        className={`iris54-filter-btn ${categoryFilter === cat ? "active" : ""}`}
                        onClick={() => setCategoryFilter(cat)}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                {/* CARDS DE TAREFAS */}
                <div className="iris54-task-grid">
                  {visibleItems.map((item) => (
                    <article
                      className={`iris54-task-card priority-${item.priority}`}
                      key={item.id}
                    >
                      <div className="iris54-task-header">
                        <span className="iris54-priority-badge">
                          {priorityLabels[item.priority] || "IMPORTANTE"}
                        </span>
                        <span className="iris54-task-date">{item.date}</span>
                      </div>
                      <h3>{item.label}</h3>
                      <p>{item.detail}</p>
                      <div className="iris54-task-divider" />
                      <div className="iris54-task-actions">
                        <button
                          type="button"
                          className="iris54-task-action-btn done"
                          onClick={() => completeItem(item.id)}
                        >
                          <Check size={14} /> Concluir
                        </button>
                        <button
                          type="button"
                          className="iris54-task-action-btn snooze"
                          onClick={() => snoozeItem(item.id)}
                        >
                          <Bell size={14} /> Adiar
                        </button>
                        <button
                          type="button"
                          className="iris54-task-action-btn"
                          onClick={() => startEdit(item)}
                        >
                          <Pencil size={14} /> Editar
                        </button>
                        <button
                          type="button"
                          className="iris54-task-action-btn delete"
                          onClick={() => void removeItem(item.id)}
                        >
                          <X size={14} /> Excluir
                        </button>
                      </div>
                    </article>
                  ))}
                </div>

                {visibleItems.length === 0 && (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "40px 20px",
                      color: "var(--iris-muted)",
                    }}
                  >
                    <Sparkles
                      size={26}
                      style={{ margin: "0 auto 10px", opacity: 0.6 }}
                    />
                    <p>Nenhuma tarefa encontrada com o filtro selecionado.</p>
                  </div>
                )}
              </>
            )}

            {/* 3. MÓDULO: NOVA TAREFA RÁPIDA */}
            {activeView === "nova-tarefa" && (
              <>
                <div className="iris54-view-header">
                  <div>
                    <span className="iris54-kicker">ADICIONAR</span>
                    <h2>
                      <Plus size={20} color="#38bdf8" /> Nova Tarefa
                    </h2>
                    <p>
                      Digite a tarefa em linguagem natural ou adicione
                      diretamente ao Radar.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="iris54-close-btn"
                    onClick={() => setActiveView(null)}
                    aria-label="Fechar"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div
                  style={{ display: "flex", flexDirection: "column", gap: 14 }}
                >
                  <Input
                    placeholder="Ex.: Conta de luz vence dia 15 · R$ 140,00"
                    value={newTaskInput}
                    onChange={(e) => setNewTaskInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateTask();
                    }}
                    autoFocus
                    style={{
                      background: "#060b16",
                      borderColor: "var(--iris-border)",
                      color: "#fff",
                      height: 50,
                    }}
                  />

                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      justifyContent: "flex-end",
                    }}
                  >
                    <Button
                      variant="outline"
                      onClick={() => setActiveView(null)}
                    >
                      Cancelar
                    </Button>
                    <Button
                      onClick={handleCreateTask}
                      style={{ background: "var(--iris-blue)", color: "#fff" }}
                    >
                      Salvar no Radar
                    </Button>
                  </div>
                </div>
              </>
            )}

            {/* 4. MÓDULO: AGENDA */}
            {activeView === "agenda" && (
              <>
                <div className="iris54-view-header">
                  <div>
                    <span className="iris54-kicker">
                      CALENDÁRIO &amp; PRAZOS
                    </span>
                    <h2>
                      <Calendar size={20} color="#38bdf8" /> Agenda Inteligente
                    </h2>
                    <p>
                      Compromissos, vencimentos e prazos organizados pela Iris
                      IA.
                    </p>
                  </div>
                  <div className="iris54-calendar-header-actions">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void refreshCalendar()}
                      disabled={calendarLoading || calendarActionBusyId !== null}
                      aria-label="Atualizar agenda"
                    >
                      <RefreshCw size={15} className={calendarLoading ? "animate-spin" : ""} />
                      Atualizar
                    </Button>
                    <button
                      type="button"
                      className="iris54-close-btn"
                      onClick={() => setActiveView(null)}
                      aria-label="Fechar"
                    >
                      <X size={18} />
                    </button>
                  </div>
                </div>

                {calendarMessage && <p className="iris54-source-message" role="status">{calendarMessage}</p>}
                {calendarError && <p className="iris54-source-error" role="alert">{calendarError}</p>}
                <div className="iris54-feature-grid">
                  {calendarEvents.length ? calendarEvents.slice(0, 12).map((event) => (
                    <article className="iris54-feature-card iris54-calendar-event-card" key={event.id}>
                      <span className="iris54-priority-badge" style={{ background: "rgba(59, 130, 246, 0.2)", color: "#93c5fd" }}>CALENDAR</span>
                      {editingCalendarEventId === event.id && calendarDraft ? (
                        <div className="iris54-calendar-edit-form">
                          <label className="iris54-calendar-field">
                            Título
                            <input
                              value={calendarDraft.summary}
                              onChange={(e) => setCalendarDraft((current) => current ? { ...current, summary: e.target.value } : current)}
                              autoComplete="off"
                            />
                          </label>
                          <label className="iris54-calendar-field">
                            Descrição
                            <textarea
                              rows={3}
                              value={calendarDraft.description}
                              onChange={(e) => setCalendarDraft((current) => current ? { ...current, description: e.target.value } : current)}
                            />
                          </label>
                          <label className="iris54-calendar-field">
                            Local
                            <input
                              value={calendarDraft.location}
                              onChange={(e) => setCalendarDraft((current) => current ? { ...current, location: e.target.value } : current)}
                              autoComplete="off"
                            />
                          </label>
                          <label className="iris54-calendar-all-day">
                            <input
                              type="checkbox"
                              checked={calendarDraft.allDay}
                              onChange={(e) => changeCalendarAllDay(e.target.checked)}
                            />
                            Evento de dia inteiro
                          </label>
                          <div className="iris54-calendar-date-fields">
                            <label className="iris54-calendar-field">
                              Início
                              <input
                                type={calendarDraft.allDay ? "date" : "datetime-local"}
                                value={calendarDraft.start}
                                onChange={(e) => setCalendarDraft((current) => current ? { ...current, start: e.target.value } : current)}
                              />
                            </label>
                            <label className="iris54-calendar-field">
                              Fim{calendarDraft.allDay ? " (data exclusiva no Google Calendar)" : ""}
                              <input
                                type={calendarDraft.allDay ? "date" : "datetime-local"}
                                value={calendarDraft.end}
                                onChange={(e) => setCalendarDraft((current) => current ? { ...current, end: e.target.value } : current)}
                              />
                            </label>
                          </div>
                          <p className="iris54-calendar-timezone-note">
                            Horários usam o fuso original do evento quando disponível; em eventos de dia inteiro, a data final é exclusiva.
                          </p>
                          <div className="iris54-calendar-event-actions">
                            <Button
                              type="button"
                              onClick={() => void saveCalendarEdit()}
                              disabled={calendarActionBusyId === event.id || calendarLoading}
                            >
                              {calendarActionBusyId === event.id ? "Salvando…" : "Salvar alteração"}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => { setEditingCalendarEventId(null); setCalendarDraft(null); setCalendarError(""); }}
                              disabled={calendarActionBusyId === event.id}
                            >
                              Cancelar
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <strong>{event.summary || "Compromisso sem título"}</strong>
                          <p>
                            {calendarDateForDisplay(event.start as GoogleCalendarDate | undefined)}
                            {event.end ? ` até ${calendarDateForDisplay(event.end as GoogleCalendarDate)}` : ""}
                          </p>
                          {event.location && <p>Local: {event.location}</p>}
                          {event.description && <p>{event.description}</p>}
                          <div className="iris54-calendar-event-actions">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => beginCalendarEdit(event)}
                              disabled={calendarActionBusyId !== null || calendarLoading}
                              aria-label={`Editar ${event.summary || "compromisso"}`}
                            >
                              <Pencil size={14} /> Editar
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => void deleteCalendarEvent(event)}
                              disabled={calendarActionBusyId !== null || calendarLoading}
                              aria-label={`Excluir ${event.summary || "compromisso"}`}
                            >
                              {calendarActionBusyId === event.id ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                              {calendarActionBusyId === event.id ? "Excluindo…" : "Excluir"}
                            </Button>
                          </div>
                        </>
                      )}
                    </article>
                  )) : !calendarLoading && !calendarError ? (
                    <div className="iris54-feature-card">
                      <strong>Agenda sem compromissos futuros</strong>
                      <p>{calendarMessage}</p>
                    </div>
                  ) : null}
                </div>

                <div
                  style={{
                    marginTop: 24,
                    display: "flex",
                    justifyContent: "flex-end",
                  }}
                >
                  <Button
                    onClick={() => {
                      void sendMessage(
                        "Quais são meus próximos compromissos e prazos na agenda?",
                      );
                    }}
                    style={{ background: "var(--iris-blue)", color: "#fff" }}
                  >
                    Consultar com a Iris IA
                  </Button>
                </div>
              </>
            )}

            {/* 5. MÓDULO: ARQUIVOS & DOCUMENT INTELLIGENCE */}
            {activeView === "arquivos" && (
              <>
                <div className="iris54-view-header">
                  <div>
                    <span className="iris54-kicker">
                      DOCUMENT INTELLIGENCE · CENTRO DOCUMENTAL
                    </span>
                    <h2>
                      <FileText size={20} color="#34d399" /> Arquivos e
                      Documentos
                    </h2>
                    <p>
                      PDFs, imagens, planilhas, notas fiscais, pedidos, boletos,
                      contratos e exames sob controle seguro.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="iris54-close-btn"
                    onClick={() => setActiveView(null)}
                    aria-label="Fechar"
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* CONSULTAS RÁPIDAS DE DOCUMENT INTELLIGENCE */}
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                    marginBottom: 16,
                  }}
                >
                  <button
                    type="button"
                    className="iris54-filter-btn active"
                    onClick={() => {
                      void sendMessage(
                        "O que tem nos meus documentos recentes e quais assuntos estão cadastrados?",
                      );
                    }}
                  >
                    <Sparkles
                      size={13}
                      style={{
                        display: "inline",
                        verticalAlign: "middle",
                        marginRight: 4,
                      }}
                    />
                    O que tem nesse documento?
                  </button>
                  <button
                    type="button"
                    className="iris54-filter-btn"
                    onClick={() => {
                      void sendMessage(
                        "Encontre os documentos e notas fiscais relacionados a compras e pagamentos.",
                      );
                    }}
                  >
                    Notas fiscais &amp; Pedidos
                  </button>
                  <button
                    type="button"
                    className="iris54-filter-btn"
                    onClick={() => {
                      void sendMessage(
                        "Localize contratos, apólices de seguro e boletos cadastrados.",
                      );
                    }}
                  >
                    Contratos &amp; Boletos
                  </button>
                  <button
                    type="button"
                    className="iris54-filter-btn"
                    onClick={() => setActiveView("saude")}
                  >
                    Exames de Saúde
                  </button>
                </div>

                <div className="iris54-feature-grid">
                  <div className="iris54-feature-card">
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 4,
                      }}
                    >
                      <FileText size={16} color="#34d399" />
                      <strong>PDFs &amp; Contratos</strong>
                    </div>
                    <p>
                      Apólices de seguro, contratos de aluguel e certidões
                      organizados com busca de conteúdo.
                    </p>
                  </div>
                  <div className="iris54-feature-card">
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 4,
                      }}
                    >
                      <Layers size={16} color="#38bdf8" />
                      <strong>Notas Fiscais &amp; Boletos</strong>
                    </div>
                    <p>
                      Identificação de valores, datas de vencimento e histórico
                      financeiro catalogado.
                    </p>
                  </div>
                  <div className="iris54-feature-card">
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 4,
                      }}
                    >
                      <Activity size={16} color="#22d3ee" />
                      <strong>Laudos &amp; Exames</strong>
                    </div>
                    <p>
                      Laudos médicos associados à Central de Saúde para extração
                      de biomarcadores.
                    </p>
                  </div>
                </div>

                {/* LISTAGEM DE ARQUIVOS REGISTRADOS */}
                <div style={{ marginTop: 20 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 10,
                    }}
                  >
                    <strong style={{ fontSize: 14, color: "#fff" }}>
                      Arquivos Armazenados ({userFiles.data?.length ?? 0})
                    </strong>
                    <span style={{ fontSize: 12, color: "var(--iris-muted)" }}>
                      Criptografia em repouso · Custo zero
                    </span>
                  </div>

                  {(userFiles.data?.length ?? 0) === 0 ? (
                    <div
                      style={{
                        padding: "24px 16px",
                        borderRadius: 14,
                        background: "rgba(10, 19, 36, 0.5)",
                        border: "1px dashed var(--iris-border)",
                        textAlign: "center",
                        color: "var(--iris-muted)",
                        fontSize: 13,
                      }}
                    >
                      Envie documentos pelo chat da Iris ou pela Central de
                      Saúde para ativar a pesquisa documental inteligente.
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      {(userFiles.data ?? []).slice(0, 5).map((file) => (
                        <div
                          key={file.id}
                          style={{
                            padding: "10px 14px",
                            borderRadius: 12,
                            background: "rgba(14, 26, 48, 0.55)",
                            border: "1px solid var(--iris-border)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                            }}
                          >
                            <FileText size={16} color="#38bdf8" />
                            <div>
                              <strong style={{ fontSize: 13, color: "#fff" }}>
                                {file.originalName}
                              </strong>
                              <div
                                style={{
                                  fontSize: 11,
                                  color: "var(--iris-muted)",
                                }}
                              >
                                {(file.sizeBytes / 1024).toFixed(1)} KB ·{" "}
                                {file.mimeType}
                              </div>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              void sendMessage(
                                `O que tem no documento "${file.originalName}"?`,
                              );
                            }}
                          >
                            Analisar com Iris
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div
                  style={{
                    marginTop: 20,
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 10,
                  }}
                >
                  <Button
                    onClick={() => {
                      void sendMessage(
                        "Encontre os documentos relacionados a determinado assunto.",
                      );
                    }}
                    style={{ background: "var(--iris-green)", color: "#fff" }}
                  >
                    Buscar Arquivo com a Iris IA
                  </Button>
                </div>
              </>
            )}

            {/* 6. MÓDULO: ANÁLISES */}
            {activeView === "analises" && (
              <>
                <div className="iris54-view-header">
                  <div>
                    <span className="iris54-kicker">
                      INSIGHTS &amp; INTELIGÊNCIA
                    </span>
                    <h2>
                      <BarChart3 size={20} color="#f59e0b" /> Análises da Iris
                      IA
                    </h2>
                    <p>
                      Diagnósticos proativos, economia inteligente e previsões.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="iris54-close-btn"
                    onClick={() => setActiveView(null)}
                    aria-label="Fechar"
                  >
                    <X size={18} />
                  </button>
                </div>

                {analysisLoading && <p className="iris54-source-message" role="status">Atualizando fontes locais e remotas…</p>}
                {analysisError && <p className="iris54-source-error" role="alert">{analysisError}</p>}
                <div className="iris54-feature-grid">
                  <button
                    type="button"
                    className="iris54-feature-card iris54-feature-card-action"
                    onClick={() => navigate("/financas")}
                    aria-label="Abrir Finanças"
                  >
                    <span className="iris54-kicker">FINANÇAS · RESUMO LOCAL</span>
                    <strong>Finanças carregadas</strong>
                    <p>
                      {analysisLoading ? "Atualizando…" : analysisRows.finances === null ? "Contagem indisponível" : `${analysisRows.finances.length} lançamento(s) encontrados.`}
                      <br />Fonte: {analysisSources.finances}.
                    </p>
                  </button>
                  <button
                    type="button"
                    className="iris54-feature-card iris54-feature-card-action"
                    onClick={() => navigate("/documentos")}
                    aria-label="Abrir Documentos"
                  >
                    <span className="iris54-kicker">DOCUMENTOS</span>
                    <strong>Arquivo catalogado</strong>
                    <p>
                      {analysisLoading ? "Atualizando…" : analysisRows.documents === null ? "Contagem indisponível" : `${analysisRows.documents.length} documento(s) encontrados.`}
                      <br />Fonte: {analysisSources.documents}.
                    </p>
                  </button>
                  <button
                    type="button"
                    className="iris54-feature-card iris54-feature-card-action"
                    onClick={() => setActiveView("radar")}
                    aria-label="Abrir Radar de pendências"
                  >
                    <span className="iris54-kicker">RADAR</span>
                    <strong>Pendências atuais</strong>
                    <p>{items.filter((item) => item.status !== "completed").length} item(ns) não concluído(s) na lista atual.</p>
                  </button>
                </div>

                <div
                  style={{
                    marginTop: 24,
                    display: "flex",
                    justifyContent: "flex-end",
                  }}
                >
                  <Button
                    onClick={generateLocalAnalysisReport}
                    disabled={analysisLoading}
                    style={{
                      background: "var(--iris-yellow)",
                      color: "#000",
                      fontWeight: 700,
                    }}
                  >
                    {analysisLoading ? "Carregando fontes…" : "Gerar Novo Relatório"}
                  </Button>
                </div>
                {analysisReport && (
                  <section className="iris54-local-report" aria-labelledby="iris54-local-report-title">
                    <div className="iris54-local-report-header">
                      <div>
                        <span className="iris54-kicker">RESUMO LOCAL VERIFICÁVEL</span>
                        <strong id="iris54-local-report-title">Relatório calculado neste dispositivo</strong>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => downloadBlob("iris-resumo-local.txt", analysisReport, "text/plain;charset=utf-8")}
                      >
                        <Download size={15} /> Baixar texto
                      </Button>
                    </div>
                    <pre>{analysisReport}</pre>
                  </section>
                )}
              </>
            )}

            {/* 7. MÓDULO: FERRAMENTAS & SEGURANÇA */}
            {activeView === "ferramentas" && (
              <>
                <div className="iris54-view-header">
                  <div>
                    <span className="iris54-kicker">
                      CONEXÕES &amp; GOVERNANÇA
                    </span>
                    <h2>
                      <Wrench size={20} color="#a78bfa" /> Ferramentas do
                      Sistema
                    </h2>
                    <p>
                      Conectores de integração, módulos avançados e políticas de
                      segurança.
                    </p>
                  </div>
                  <div
                    style={{ display: "flex", gap: 8, alignItems: "center" }}
                  >
                    <button
                      type="button"
                      className="iris54-top-btn"
                      onClick={() => toggleTheme?.()}
                      title={theme === "dark" ? "Modo Claro" : "Modo Escuro"}
                    >
                      {theme === "dark" ? (
                        <Sun size={15} />
                      ) : (
                        <Moon size={15} />
                      )}
                      <span style={{ fontSize: 12 }}>
                        {theme === "dark" ? "Modo Claro" : "Modo Escuro"}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="iris54-close-btn"
                      onClick={() => setActiveView(null)}
                      aria-label="Fechar"
                    >
                      <X size={18} />
                    </button>
                  </div>
                </div>

                <div className="iris54-feature-grid">
                  <div
                    className="iris54-feature-card"
                    style={{ cursor: "pointer" }}
                    onClick={() => setActiveView("assistente")}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <MessageCircle size={18} color="#22d3ee" />
                      <strong>Conversar com a Iris IA</strong>
                    </div>
                    <p>
                      Diálogo direto em linguagem natural, comandos e
                      orientações personalizadas.
                    </p>
                  </div>
                  <Link
                    href="/interprete"
                    className="iris54-feature-card"
                    style={{ textDecoration: "none" }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <Languages size={18} color="#38bdf8" />
                      <strong>Intérprete Multilíngue</strong>
                    </div>
                    <p>
                      Tradução em tempo real e interpretação de diálogos por voz
                      e texto.
                    </p>
                  </Link>
                  <Link
                    href="/conexoes"
                    className="iris54-feature-card"
                    style={{ textDecoration: "none" }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <Activity size={18} color="#34d399" />
                      <strong>Conexões e Integrações</strong>
                    </div>
                    <p>
                      Gerenciamento de integrações, permissões e serviços
                      conectados.
                    </p>
                  </Link>
                  <Link
                    href="/perfil"
                    className="iris54-feature-card"
                    style={{ textDecoration: "none" }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <UserRound size={18} color="#a78bfa" />
                      <strong>Perfil e Preferências</strong>
                    </div>
                    <p>
                      Configurações de conta, chaves de IA, tema e memórias
                      autorizadas.
                    </p>
                  </Link>
                  <Link
                    href="/operacao"
                    className="iris54-feature-card"
                    style={{ textDecoration: "none" }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <ShieldCheck size={18} color="#f59e0b" />
                      <strong>Saúde da Operação</strong>
                    </div>
                    <p>
                      Diagnóstico de conectores, filas de eventos e webhook do
                      WhatsApp.
                    </p>
                  </Link>
                  <Link
                    href="/laboratorio"
                    className="iris54-feature-card"
                    style={{ textDecoration: "none" }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <SlidersHorizontal size={18} color="#ec4899" />
                      <strong>Laboratório Local</strong>
                    </div>
                    <p>
                      Testes avançados de modelos de inteligência e conectores
                      universais.
                    </p>
                  </Link>
                </div>

                {/* CARDS DE SEGURANÇA E PRIVACIDADE */}
                <div className="iris54-footer-cards">
                  <div className="iris54-footer-card">
                    <span className="iris54-kicker">AUTORIZAÇÃO SEGURA</span>
                    <strong>Controle Absoluto</strong>
                    <p>
                      A Iris pede sua confirmação antes de executar qualquer
                      ação sensível ou financeira.
                    </p>
                  </div>
                  <div className="iris54-footer-card">
                    <span className="iris54-kicker">MODO IRIS</span>
                    <strong>Assistente Proativa</strong>
                    <p>
                      Analisa, organiza e sugere soluções mantendo seus dados
                      protegidos.
                    </p>
                  </div>
                  <div className="iris54-footer-card">
                    <span className="iris54-kicker">PRIVACIDADE</span>
                    <strong>Dados Protegidos</strong>
                    <p>
                      Seus dados permanecem criptografados e acessíveis
                      exclusivamente por você.
                    </p>
                  </div>
                </div>

                {/* CONTROLE DE CUSTOS & GOVERNANÇA FINANCEIRA */}
                <div
                  style={{
                    padding: "16px 20px",
                    borderRadius: "16px",
                    background: "rgba(14, 28, 54, 0.75)",
                    border: "1px solid rgba(56, 189, 248, 0.3)",
                    marginTop: 16,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 12,
                  }}
                >
                  <div>
                    <span className="iris54-kicker">
                      CUSTO DE IA · ARQUITETURA ECONÔMICA
                    </span>
                    <strong
                      style={{
                        display: "block",
                        fontSize: "15px",
                        color: "#fff",
                      }}
                    >
                      Governança de Custos e Faturamento Zero
                    </strong>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--iris-muted)",
                        marginTop: 2,
                      }}
                    >
                      Hoje:{" "}
                      <span style={{ color: "#fff", fontWeight: 700 }}>
                        R$ {(costStatus.data?.todayBrl ?? 0).toFixed(2)}
                      </span>{" "}
                      · Mês:{" "}
                      <span style={{ color: "#fff", fontWeight: 700 }}>
                        R$ {(costStatus.data?.monthBrl ?? 0).toFixed(2)}
                      </span>{" "}
                      · Limite Seguro:{" "}
                      <span
                        style={{ color: "var(--iris-cyan)", fontWeight: 700 }}
                      >
                        R$ {(costStatus.data?.limitBrl ?? 100).toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <span
                      style={{
                        padding: "4px 10px",
                        borderRadius: "8px",
                        background: "rgba(16, 185, 129, 0.15)",
                        border: "1px solid rgba(16, 185, 129, 0.3)",
                        color: "#34d399",
                        fontSize: "12px",
                        fontWeight: 700,
                      }}
                    >
                      {costStatus.data?.status ?? "Dentro do limite"}
                    </span>
                  </div>
                </div>
              </>
            )}

            {/* 7. MÓDULO: SAÚDE (CENTRAL DE SAÚDE IRIS) */}
            {activeView === "saude" && (
              <IrisHealthCenter onClose={() => setActiveView(null)} />
            )}
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------------
          MODAL DE EDIÇÃO DE TAREFA
          -------------------------------------------------------------------- */}
      {editingId && (
        <div className="iris54-modal-backdrop">
          <div className="iris54-modal-box">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <div>
                <span className="iris54-kicker">EDITAR TAREFA</span>
                <h3 style={{ margin: "4px 0 0", fontSize: 20 }}>
                  Ajustar Detalhes
                </h3>
              </div>
              <button
                type="button"
                className="iris54-top-btn"
                onClick={() => setEditingId(null)}
                style={{ padding: 6, borderRadius: "50%" }}
              >
                <X size={18} />
              </button>
            </div>
            <Input
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              autoFocus
              style={{
                background: "#060b16",
                borderColor: "var(--iris-border)",
                color: "#fff",
              }}
            />
            <div className="iris54-modal-actions">
              <Button variant="outline" onClick={() => setEditingId(null)}>
                Cancelar
              </Button>
              <Button
                onClick={saveEdit}
                style={{ background: "var(--iris-blue)", color: "#fff" }}
              >
                Salvar Alteração
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------------
          MODAL DE AUTORIZAÇÃO / PROPOSTA DO AGENTE
          -------------------------------------------------------------------- */}
      {pendingSuggestion && (
        <div className="iris54-modal-backdrop">
          <div className="iris54-modal-box">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <div>
                <span className="iris54-kicker">AUTORIZAÇÃO NECESSÁRIA</span>
                <h3 style={{ margin: "4px 0 0", fontSize: 20 }}>
                  {pendingSuggestion.label}
                </h3>
              </div>
              <button
                type="button"
                className="iris54-top-btn"
                onClick={cancelSuggestion}
                style={{ padding: 6, borderRadius: "50%" }}
                aria-label="Recusar proposta"
              >
                <X size={18} />
              </button>
            </div>
            <p style={{ color: "var(--iris-muted)", margin: "0 0 12px" }}>
              {pendingSuggestion.detail}
            </p>
            <p style={{ fontSize: 13, margin: "6px 0" }}>
              <strong>Prazo:</strong>{" "}
              {pendingSuggestion.date || "não informado"}
            </p>
            <p style={{ fontSize: 13, margin: "6px 0" }}>
              <strong>Prioridade:</strong>{" "}
              {priorityLabels[pendingSuggestion.priority]}
            </p>
            <p style={{ fontSize: 13, margin: "6px 0" }}>
              <strong>Risco:</strong> {pendingSuggestion.riskLevel ?? "baixo"} ·{" "}
              <strong>Confiança:</strong>{" "}
              {Math.round((pendingSuggestion.confidence ?? 0.95) * 100)}%
            </p>

            {/* ETAPAS COGNITIVAS & REGRA DE SEGURANÇA */}
            <div
              style={{
                margin: "12px 0 14px",
                padding: "10px 12px",
                borderRadius: "10px",
                background: "rgba(56, 189, 248, 0.08)",
                border: "1px solid rgba(56, 189, 248, 0.25)",
                fontSize: "11px",
                lineHeight: 1.4,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flexWrap: "wrap",
                  marginBottom: 6,
                }}
              >
                <span style={{ fontWeight: 800, color: "var(--iris-cyan)" }}>
                  FLUXO SEGURO:
                </span>
                <span
                  style={{
                    color:
                      irisState === "analyzing"
                        ? "#38bdf8"
                        : "var(--iris-muted)",
                    fontWeight: irisState === "analyzing" ? 800 : 400,
                  }}
                >
                  ENTENDER
                </span>{" "}
                →{" "}
                <span
                  style={{
                    color:
                      irisState === "analyzing"
                        ? "#38bdf8"
                        : "var(--iris-muted)",
                    fontWeight: irisState === "analyzing" ? 800 : 400,
                  }}
                >
                  ANALISAR
                </span>{" "}
                → <span style={{ color: "var(--iris-muted)" }}>DECIDIR</span> →{" "}
                <span
                  style={{
                    fontWeight: 800,
                    color:
                      irisState === "awaiting_authorization"
                        ? "#a5f3fc"
                        : "var(--iris-muted)",
                    background:
                      irisState === "awaiting_authorization"
                        ? "rgba(34, 211, 238, 0.25)"
                        : "transparent",
                    padding: "2px 6px",
                    borderRadius: "4px",
                  }}
                >
                  PEDIR AUTORIZAÇÃO
                </span>{" "}
                →{" "}
                <span
                  style={{
                    fontWeight: irisState === "executing" ? 800 : 400,
                    color:
                      irisState === "executing"
                        ? "var(--iris-green)"
                        : "var(--iris-muted)",
                    background:
                      irisState === "executing"
                        ? "rgba(34, 197, 94, 0.25)"
                        : "transparent",
                    padding: "2px 6px",
                    borderRadius: "4px",
                  }}
                >
                  EXECUTAR
                </span>{" "}
                →{" "}
                <span
                  style={{
                    fontWeight: irisState === "completed" ? 800 : 400,
                    color:
                      irisState === "completed"
                        ? "var(--iris-green)"
                        : "var(--iris-muted)",
                  }}
                >
                  CONFIRMAR
                </span>
              </div>
              <div style={{ color: "#cbd5e1" }}>
                <strong>Regra Permanente:</strong> Qualquer ação que altere,
                exclua, envie ou organize dados exige autorização explícita do
                usuário.
              </div>
            </div>

            <div className="iris54-modal-actions">
              <Button variant="outline" onClick={cancelSuggestion}>
                Recusar
              </Button>
              <Button
                onClick={() => void confirmSuggestion()}
                disabled={
                  confirmRadar.isPending ||
                  isExecuting ||
                  irisState === "executing"
                }
                style={{ background: "var(--iris-green)", color: "#fff" }}
              >
                {confirmRadar.isPending ||
                isExecuting ||
                irisState === "executing"
                  ? "Executando…"
                  : "Confirmar e Executar"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------------
          MODAL DE ONBOARDING
          -------------------------------------------------------------------- */}
      {onboarding && (
        <div className="iris54-modal-backdrop">
          <div className="iris54-modal-box">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <span className="iris54-kicker">
                PASSO {step + 1} DE {onboardingSteps.length}
              </span>
              <button
                type="button"
                className="iris54-top-btn"
                onClick={() => setOnboarding(false)}
                style={{ padding: 6, borderRadius: "50%" }}
              >
                <X size={18} />
              </button>
            </div>
            <h3 style={{ margin: "0 0 8px", fontSize: 22 }}>
              {onboardingSteps[step].title}
            </h3>
            <p style={{ color: "var(--iris-muted)", margin: "0 0 20px" }}>
              {onboardingSteps[step].body}
            </p>

            {step === 0 && (
              <Input
                value={demoName}
                onChange={(e) => setDemoName(e.target.value)}
                placeholder="Seu nome (opcional)"
                style={{
                  background: "#060b16",
                  borderColor: "var(--iris-border)",
                  color: "#fff",
                }}
              />
            )}

            {step === 1 && (
              <div style={{ display: "grid", gap: 8 }}>
                {[
                  "Tarefas e lembretes",
                  "Contas e prazos",
                  "Documentos",
                  "Tudo um pouco",
                ].map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    className={`iris54-filter-btn ${focus === opt ? "active" : ""}`}
                    onClick={() => setFocus(opt)}
                    style={{
                      textAlign: "left",
                      padding: "10px 14px",
                      borderRadius: 12,
                    }}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}

            {step === 2 && (
              <div
                style={{
                  padding: 16,
                  borderRadius: 14,
                  background: "rgba(59, 130, 246, 0.1)",
                  border: "1px solid rgba(59, 130, 246, 0.25)",
                  color: "#93c5fd",
                }}
              >
                <Sparkles
                  size={16}
                  style={{ display: "inline", marginRight: 8 }}
                />
                “Minha conta de internet vence dia 10”
              </div>
            )}

            <div className="iris54-modal-actions">
              <Button
                onClick={() => {
                  if (step < onboardingSteps.length - 1) {
                    setStep((v) => v + 1);
                  } else {
                    setOnboarding(false);
                  }
                }}
                style={{ background: "var(--iris-blue)", color: "#fff" }}
              >
                {step < onboardingSteps.length - 1 ? "Continuar" : "Começar"}{" "}
                <ArrowRight size={16} />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
