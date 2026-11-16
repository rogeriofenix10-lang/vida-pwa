import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
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
  googleCalendarCreate,
  googleCalendarDelete,
  googleCalendarCalendars,
  googleCalendarEvents,
  googleCalendarStatus,
  googleCalendarUpdate,
  loadIrisData,
  saveIrisData,
  restoreIrisAccess,
  startGoogleOAuth,
  type GmailSummary,
  type GoogleCalendarEvent,
} from "@/lib/irisWorker";
import {
  buildCalendarDateTime,
  calendarCanWrite,
  calendarDateForDisplay,
  calendarRange,
  formatCalendarDateTimeInputValue as calendarDateTimeInputValue,
  formatCalendarEventPeriod,
  parseAgendaQuestion,
  type GoogleCalendarInfo,
} from "@/lib/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowRight,
  Bell,
  Check,
  ChevronRight,
  Calendar,
  Layers,
  Loader2,
  Mic,
  Pencil,
  Plus,
  Search,
  Sparkles,
  X,
  ExternalLink,
  RefreshCw,
  MessageCircle,
  Menu,
  WalletCards,
} from "lucide-react";
import IrisOcularEye from "./IrisOcularEye";
import IrisHealthCenter from "./IrisHealthCenter";
import AgendaCalendar, { ALL_CALENDARS, type AgendaCalendarMode } from "./AgendaCalendar";
import RemoteServiceAccess from "./RemoteServiceAccess";
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
  | "nova-tarefa"
  | "saude";

type HomeMenuItem =
  | { label: string; href: string }
  | { label: string; view: Exclude<ActiveModalView, null> };

const homeMenuItems: HomeMenuItem[] = [
  { label: "Tarefas", view: "radar" },
  { label: "Documentos e contratos", href: "/documentos" },
  { label: "Catálogo", href: "/catalogo" },
  { label: "Comercial", href: "/comercial" },
  { label: "Notas", href: "/offline" },
  { label: "Google Drive", href: "/google" },
  { label: "Mídia", href: "/midia" },
  { label: "Segurança", href: "/seguranca" },
  { label: "Diagnóstico", href: "/diagnostico" },
  { label: "Configurações", href: "/configuracoes" },
  { label: "Intérprete", href: "/interprete" },
  { label: "Conexões", href: "/conexoes" },
  { label: "Perfil e preferências", href: "/perfil" },
  { label: "Saúde da operação", href: "/operacao" },
  { label: "Laboratório local", href: "/laboratorio" },
  { label: "Saúde", view: "saude" },
];

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
  agendaAction?: boolean;
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
type CalendarCreateDraft = { summary: string; start: string; end: string };
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
    body: "Escolha seu foco inicial para Tarefas e lembretes.",
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
  const search = useSearch();
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
  const [calendarCatalog, setCalendarCatalog] = useState<GoogleCalendarInfo[]>([]);
  const [calendarScopeId, setCalendarScopeId] = useState(ALL_CALENDARS);
  const [calendarPeriodMode, setCalendarPeriodMode] = useState<AgendaCalendarMode>("month");
  const [calendarCursorDate, setCalendarCursorDate] = useState(() => new Date());
  const [calendarTruncated, setCalendarTruncated] = useState(false);
  const [calendarWarnings, setCalendarWarnings] = useState<string[]>([]);
  const [calendarCreateCalendarId, setCalendarCreateCalendarId] = useState("primary");
  const [calendarAuthorized, setCalendarAuthorized] = useState(false);
  const [calendarMessage, setCalendarMessage] = useState("Carregando agenda autorizada…");
  const [calendarError, setCalendarError] = useState("");
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarActionBusyId, setCalendarActionBusyId] = useState<string | null>(null);
  const [editingCalendarEventId, setEditingCalendarEventId] = useState<string | null>(null);
  const [calendarDraft, setCalendarDraft] = useState<CalendarEditDraft | null>(null);
  const [calendarCreateDraft, setCalendarCreateDraft] = useState<CalendarCreateDraft>({ summary: "", start: "", end: "" });
  const [calendarCreateBusy, setCalendarCreateBusy] = useState(false);
  const [calendarAccessHelp, setCalendarAccessHelp] = useState<"settings" | "connections" | null>(null);
  const radarRetryAfterUnlockRef = useRef(false);
  const calendarRetryAfterUnlockRef = useRef(false);
  const lastVoiceCommandRef = useRef({ text: "", at: 0 });
  const lastVoiceErrorRef = useRef({ text: "", at: 0 });
  const chatFeedRef = useRef<HTMLDivElement | null>(null);
  const chatPinnedToBottomRef = useRef(true);
  const { theme, toggleTheme } = useTheme();
  const canManageCalendar = remoteAccessReady && calendarAuthorized && isIrisRemoteModeEnabled() && isIrisAccessUnlocked();
  const createCalendar = calendarCatalog.find((calendar) => calendar.id === calendarCreateCalendarId);
  const canCreateCalendar = canManageCalendar && calendarCanWrite(createCalendar?.accessRole);

  useEffect(() => {
    const requestedView = new URLSearchParams(search).get("view");
    if (requestedView === "agenda") setActiveView("agenda");
    else if (requestedView === "tarefas") setActiveView("radar");
  }, [search]);

  const openHomeMenuItem = (item: HomeMenuItem) => {
    setMenuOpen(false);
    if ("view" in item) {
      setActiveView(item.view);
      return;
    }
    navigate(item.href);
  };

  const calendarRequestRef = useRef(0);
  const refreshCalendar = async (
    requestedRange = calendarRange(calendarCursorDate, calendarPeriodMode),
    requestedScopeId = calendarScopeId,
  ) => {
    const requestId = ++calendarRequestRef.current;
    setCalendarLoading(true);
    setCalendarError("");
    setCalendarEvents([]);
    try {
      if (!isIrisRemoteModeEnabled()) {
        calendarRetryAfterUnlockRef.current = true;
        setCalendarAuthorized(false);
        setCalendarEvents([]);
        setCalendarCatalog([]);
        setCalendarTruncated(false);
        setCalendarWarnings([]);
        setCalendarAccessHelp("settings");
        setCalendarMessage(
          "A Agenda do Google está bloqueada intencionalmente no modo Demonstração. Nenhum dado foi enviado. Ative o acesso remoto em Configurações somente se quiser usar esse recurso.",
        );
        return false;
      }

      if (!isIrisAccessUnlocked()) {
        const restored = await restoreIrisAccess();
        if (requestId !== calendarRequestRef.current) return false;
        if (!restored.restored || !isIrisAccessUnlocked()) {
          calendarRetryAfterUnlockRef.current = true;
          setCalendarAuthorized(false);
          setCalendarEvents([]);
          setCalendarCatalog([]);
          setCalendarTruncated(false);
          setCalendarWarnings([]);
          setCalendarAccessHelp("settings");
          setCalendarMessage(
            "A Agenda exige uma sessão remota desbloqueada. Nenhuma consulta de compromissos foi enviada; desbloqueie o acesso remoto em Configurações para continuar.",
          );
          return false;
        }
      }

      setCalendarAccessHelp(null);
      setCalendarMessage("Verificando autorização do Google Calendar…");
      const status = await googleCalendarStatus();
      if (requestId !== calendarRequestRef.current) return false;
      if (!status.authorized) {
        calendarRetryAfterUnlockRef.current = false;
        setCalendarAuthorized(false);
        setCalendarEvents([]);
        setCalendarCatalog([]);
        setCalendarTruncated(false);
        setCalendarWarnings([]);
        setCalendarAccessHelp("connections");
        setCalendarMessage(
          "O Google Calendar ainda não está autorizado. Nenhum compromisso foi consultado; abra Conexões para autorizar quando desejar.",
        );
        return false;
      }

      setCalendarAuthorized(true);
      setCalendarMessage(`Consultando agendas para ${requestedRange.label}…`);
      const calendarList = await googleCalendarCalendars();
      if (requestId !== calendarRequestRef.current) return false;
      setCalendarCatalog(calendarList.items);
      const effectiveScopeId = requestedScopeId !== ALL_CALENDARS && !calendarList.items.some((calendar) => calendar.id === requestedScopeId)
        ? ALL_CALENDARS
        : requestedScopeId;
      if (effectiveScopeId !== requestedScopeId) setCalendarScopeId(effectiveScopeId);
      const nextCreateCalendar = calendarList.items.find((calendar) => calendar.id === calendarCreateCalendarId)
        ?? calendarList.items.find((calendar) => calendar.primary)
        ?? calendarList.items[0];
      if (nextCreateCalendar && nextCreateCalendar.id !== calendarCreateCalendarId) setCalendarCreateCalendarId(nextCreateCalendar.id);
      const result = await googleCalendarEvents({
        timeMin: requestedRange.timeMin,
        timeMax: requestedRange.timeMax,
        calendars: calendarList.items,
        ...(effectiveScopeId !== ALL_CALENDARS ? { calendarId: effectiveScopeId } : {}),
      });
      if (requestId !== calendarRequestRef.current || !isIrisRemoteModeEnabled() || !isIrisAccessUnlocked()) return false;
      const events = result.items;
      const warnings = [calendarList.warning, ...result.warnings].filter((warning): warning is string => Boolean(warning));
      calendarRetryAfterUnlockRef.current = false;
      setCalendarEvents(events);
      setCalendarTruncated(calendarList.truncated || result.truncated);
      setCalendarWarnings(warnings);
      const sourceCount = result.calendarsQueried.length;
      setCalendarMessage(events.length
        ? `${events.length} compromisso(s) consultado(s) em ${sourceCount} agenda(s), no período ${requestedRange.label}.`
        : calendarList.truncated || result.truncated
          ? `Nenhum compromisso foi retornado no período ${requestedRange.label}, mas a consulta é parcial; confira os avisos antes de concluir que não há eventos.`
          : `Nenhum compromisso encontrado no período ${requestedRange.label} nas ${sourceCount} agenda(s) consultadas.`);
      return true;
    } catch (error) {
      if (requestId !== calendarRequestRef.current) return false;
      calendarRetryAfterUnlockRef.current = false;
      setCalendarAuthorized(false);
      setCalendarEvents([]);
      setCalendarTruncated(false);
      setCalendarWarnings([]);
      setCalendarAccessHelp(null);
      setCalendarMessage("Falha de rede ao consultar o Google Calendar. Tente novamente.");
      setCalendarError(error instanceof Error
        ? error.message
        : "A conexão com o Google Calendar falhou.");
      return false;
    } finally {
      if (requestId === calendarRequestRef.current) setCalendarLoading(false);
    }
  };

  const createCalendarEvent = async () => {
    if (!canManageCalendar) {
      setCalendarError("A criação exige o modo remoto, acesso desbloqueado e Google Calendar autorizado.");
      return;
    }
    if (!canCreateCalendar || !createCalendar) {
      setCalendarError("Selecione uma agenda Google com permissão de edição. Agendas somente leitura ou sem permissão confirmada não podem receber alterações.");
      return;
    }
    const summary = calendarCreateDraft.summary.trim();
    const startValue = calendarCreateDraft.start;
    const endValue = calendarCreateDraft.end;
    if (!summary || !startValue || !endValue) {
      setCalendarError("Informe o título, a data/hora inicial e a data/hora final.");
      return;
    }
    const startTime = Date.parse(startValue);
    const endTime = Date.parse(endValue);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
      setCalendarError("Informe datas e horários válidos.");
      return;
    }
    if (endTime <= startTime) {
      setCalendarError("A data/hora final precisa ser posterior à inicial.");
      return;
    }

    let start: GoogleCalendarDate;
    let end: GoogleCalendarDate;
    try {
      start = buildCalendarDateTime(startValue);
      end = buildCalendarDateTime(endValue);
    } catch (error) {
      setCalendarError(error instanceof Error ? error.message : "Não foi possível converter a data no fuso local.");
      return;
    }

    if (!window.confirm(
      `Confirmar criação deste evento no Google Calendar?\n\nAgenda: ${createCalendar.summary}\nTítulo: ${summary}\nInício: ${startValue.replace("T", " ")}\nFim: ${endValue.replace("T", " ")}\n\nO evento só será enviado após esta confirmação.`,
    )) return;

    setCalendarCreateBusy(true);
    setCalendarError("");
    try {
      await googleCalendarCreate({ summary, start, end }, true, createCalendar.id);
      setCalendarCreateDraft({ summary: "", start: "", end: "" });
      setCalendarMessage(`Evento criado na agenda “${createCalendar.summary}”.`);
      await refreshCalendar();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Falha ao criar o evento.";
      setCalendarMessage("A agenda não foi alterada.");
      setCalendarError(detail);
    } finally {
      setCalendarCreateBusy(false);
    }
  };

  const beginCalendarEdit = (event: GoogleCalendarEvent) => {
    if (!canManageCalendar || !calendarCanWrite(event.accessRole)) return;
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
    setEditingCalendarEventId(event.identity);
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
    if (!canManageCalendar) {
      setCalendarError("A alteração exige o modo remoto, acesso desbloqueado e Google Calendar autorizado.");
      return;
    }
    if (!calendarDraft || !editingCalendarEventId) return;
    const event = calendarEvents.find((candidate) => candidate.identity === editingCalendarEventId);
    if (!event) return;
    const summary = calendarDraft.summary.trim();
    if (!summary || !calendarDraft.start || !calendarDraft.end) {
      setCalendarError("Informe o título, a data/hora inicial e a data/hora final.");
      return;
    }
    const startValue = Date.parse(calendarDraft.allDay ? `${calendarDraft.start}T00:00:00` : calendarDraft.start);
    const endValue = Date.parse(calendarDraft.allDay ? `${calendarDraft.end}T00:00:00` : calendarDraft.end);
    if (!Number.isFinite(startValue) || !Number.isFinite(endValue) || endValue <= startValue) {
      setCalendarError("A data/hora final precisa ser posterior à inicial.");
      return;
    }
    if (!calendarCanWrite(event.accessRole)) {
      setCalendarError("Esta agenda é somente leitura ou não tem permissão de edição confirmada.");
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
      `Confirmar atualização deste evento no Google Calendar?\n\nAgenda: ${event.calendarName}\nTítulo: ${summary}\nData: ${displayedDate}\n\nO Calendar receberá PATCH somente após esta confirmação.`,
    )) return;

    setCalendarActionBusyId(event.identity);
    setCalendarError("");
    try {
      await googleCalendarUpdate(event.id, payload, true, event.calendarId);
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
    if (!canManageCalendar) {
      setCalendarError("A exclusão exige o modo remoto, acesso desbloqueado e Google Calendar autorizado.");
      return;
    }
    if (!calendarCanWrite(event.accessRole)) {
      setCalendarError("Esta agenda é somente leitura ou não tem permissão de edição confirmada; nada foi enviado.");
      return;
    }
    const title = event.summary?.trim() || "Compromisso sem título";
    const start = calendarDateForDisplay(event.start as GoogleCalendarDate | undefined);
    const end = calendarDateForDisplay(event.end as GoogleCalendarDate | undefined);
    if (!window.confirm(
      `Confirmar exclusão deste evento do Google Calendar?\n\nAgenda: ${event.calendarName}\nTítulo: ${title}\nData: ${start}${end !== "Data não informada" ? ` até ${end}` : ""}\n\nA exclusão só será solicitada após esta confirmação.`,
    )) return;

    setCalendarActionBusyId(event.identity);
    setCalendarError("");
    try {
      await googleCalendarDelete(event.id, true, event.calendarId);
      setCalendarEvents((current) => current.filter((candidate) => candidate.identity !== event.identity));
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
    if (activeView === "agenda") {
      void refreshCalendar(calendarRange(calendarCursorDate, calendarPeriodMode), calendarScopeId);
    }
  }, [activeView, calendarCursorDate, calendarPeriodMode, calendarScopeId]);

  useEffect(() => {
    const onRemoteAccessChanged = () => {
      const ready = isIrisRemoteModeEnabled() && isIrisAccessUnlocked();
      setRemoteAccessReady(ready);
      if (!ready) {
        calendarRequestRef.current += 1;
        setCalendarLoading(false);
        setCalendarAuthorized(false);
        setCalendarEvents([]);
        setEditingCalendarEventId(null);
        setCalendarDraft(null);
        setCalendarError("");
        setCalendarAccessHelp("settings");
        if (!isIrisRemoteModeEnabled()) {
          calendarRetryAfterUnlockRef.current = false;
          setCalendarMessage(
            "A Agenda do Google está bloqueada intencionalmente no modo Demonstração. Nenhum dado foi enviado. Ative o acesso remoto em Configurações somente se quiser usar esse recurso.",
          );
        } else {
          calendarRetryAfterUnlockRef.current = true;
          setCalendarMessage(
            "A Agenda exige uma sessão remota desbloqueada. Nenhuma consulta de compromissos foi enviada; desbloqueie o acesso remoto em Configurações para continuar.",
          );
        }
        return;
      }
      if (radarRetryAfterUnlockRef.current) {
        radarRetryAfterUnlockRef.current = false;
        void refreshRadar();
      }
      if (activeView === "agenda" && calendarRetryAfterUnlockRef.current) {
        calendarRetryAfterUnlockRef.current = false;
        void refreshCalendar();
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

  const queryAgendaQuestion = async (question: NonNullable<ReturnType<typeof parseAgendaQuestion>>) => {
    const range = question.range;
    if (!isIrisRemoteModeEnabled() || !isIrisAccessUnlocked()) {
      const reply = !isIrisRemoteModeEnabled()
        ? `Consulta de Agenda não executada para ${question.label}: o modo Demonstração está ativo e nenhum dado foi enviado. Ative os serviços remotos em Configurações e desbloqueie a sessão somente se quiser consultar o Google Calendar.`
        : `Consulta de Agenda não executada para ${question.label}: desbloqueie os serviços remotos e repita o pedido. Nenhum compromisso foi consultado.`;
      setChat((current) => [...current, { role: "assistant", text: reply, agendaAction: true }]);
      setIrisState("idle");
      return;
    }

    setIsProcessing(true);
    setCalendarLoading(true);
    setIrisState("analyzing");
    try {
      const status = await googleCalendarStatus();
      if (!status.authorized) {
        const reply = `Consulta não executada para ${question.label}: o Google Calendar ainda não foi autorizado. Nenhum compromisso foi lido; use o botão para iniciar OAuth manualmente quando desejar.`;
        setChat((current) => [...current, { role: "assistant", text: reply, oauthAction: "calendar", agendaAction: true }]);
        setCalendarAuthorized(false);
        return;
      }

      const calendarList = await googleCalendarCalendars();
      const result = await googleCalendarEvents({
        timeMin: range.timeMin,
        timeMax: range.timeMax,
        calendars: calendarList.items,
        ...(calendarScopeId !== ALL_CALENDARS ? { calendarId: calendarScopeId } : {}),
      });
      setCalendarAuthorized(true);
      setCalendarCatalog(result.calendars);

      const total = result.items.length;
      const statusLabel = calendarList.truncated || result.truncated
        ? `A consulta é parcial: foram retornados ${total} compromissos, portanto esse é um mínimo, não um total completo.`
        : `${total} compromisso(s) encontrado(s).`;
      const shown = result.items.slice(0, 50);
      const lines = shown.map((event, index) =>
        `${index + 1}. ${event.summary || "Compromisso sem título"} — ${formatCalendarEventPeriod(event)} · ${event.calendarName}${calendarCanWrite(event.accessRole) ? "" : " · somente leitura"}`,
      );
      const omitted = total > shown.length
        ? `\nA lista abaixo mostra ${shown.length} de ${total} compromissos retornados; nenhum foi omitido sem aviso. Abra a Agenda e selecione os meses/dias deste período para consultar os demais.`
        : "";
      const warnings = [calendarList.warning, ...result.warnings].filter((warning): warning is string => Boolean(warning));
      const emptyResult = calendarList.truncated || result.truncated
        ? "\nNenhum compromisso foi retornado antes do limite; não é possível concluir que o período está vazio."
        : "\nNenhum compromisso retornado neste período.";
      const reply = `Consulta real ao Google Calendar · ${question.label} (${range.label}). ${statusLabel}${warnings.length ? `\nAvisos: ${warnings.join(" ")}` : ""}${lines.length ? `\n${lines.join("\n")}` : emptyResult}${omitted}`;
      setChat((current) => [...current, { role: "assistant", text: reply, agendaAction: true }]);
      if (voiceEnabled) voice.speak(`${question.label}. ${statusLabel}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Falha ao consultar o Google Calendar.";
      setChat((current) => [...current, { role: "assistant", text: `Não consegui consultar compromissos reais para ${question.label}: ${detail}. Nenhuma resposta foi gerada por IA sem os dados da agenda.`, agendaAction: true }]);
    } finally {
      setCalendarLoading(false);
      setIsProcessing(false);
      setIrisState("idle");
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

    const agendaQuestion = selectedAttachments.length === 0 ? parseAgendaQuestion(text) : null;
    if (agendaQuestion) {
      await queryAgendaQuestion(agendaQuestion);
      return;
    }

    if (selectedAttachments.length === 0 && /\b(agenda|calendario|calendar|compromissos?|eventos?|reunioes?)\b/.test(text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase())) {
      const reply = "Para consultar compromissos reais, informe hoje, amanhã, semana, mês ou um intervalo válido, por exemplo: agenda de 12/11/2026 a 15/11/2026. Para criar, editar ou excluir eventos, abra Agenda e confirme a ação no formulário. Nenhum evento ou tarefa foi alterado por esta pergunta.";
      setChat((current) => [...current, { role: "assistant", text: reply, agendaAction: true }]);
      return;
    }

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
          action: proposal?.action || "Acompanhar tarefa",
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
    if (!window.confirm("Excluir esta tarefa?")) return;
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
              {homeMenuItems.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  onClick={() => openHomeMenuItem(item)}
                  style={{
                    padding: "10px 12px",
                    border: 0,
                    borderRadius: 10,
                    color: "#cbd5e1",
                    background: "rgba(14, 26, 48, 0.72)",
                    textAlign: "center",
                    fontSize: 13,
                    fontFamily: "inherit",
                    cursor: "pointer",
                  }}
                >
                  {item.label}
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  toggleTheme?.();
                  setMenuOpen(false);
                }}
                style={{
                  padding: "10px 12px",
                  border: 0,
                  borderRadius: 10,
                  color: "#cbd5e1",
                  background: "rgba(14, 26, 48, 0.72)",
                  textAlign: "center",
                  fontSize: 13,
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                {theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
              </button>
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
                      {message.role === "assistant" && message.agendaAction && (
                        <Button type="button" variant="outline" onClick={() => setActiveView("agenda")}>
                          Abrir Agenda
                          <Calendar size={15} />
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
                    <span className="iris54-kicker">TAREFAS E LEMBRETES</span>
                    <h2>
                      <Layers size={20} color="#38bdf8" /> Tarefas
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
                    <span>Total de tarefas</span>
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
                      diretamente à lista de tarefas.
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
                      Salvar tarefa
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
                    <p>Consulte e gerencie compromissos reais nas agendas Google acessíveis; perguntas nunca criam ou alteram eventos.</p>
                  </div>
                  <div className="iris54-calendar-header-actions">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void refreshCalendar()}
                      disabled={!remoteAccessReady || !isIrisRemoteModeEnabled() || calendarLoading || calendarActionBusyId !== null || calendarCreateBusy}
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

                <RemoteServiceAccess onReady={() => {
                  setRemoteAccessReady(true);
                }} />
                {calendarMessage && <p className="iris54-source-message" role="status">{calendarMessage}</p>}
                {calendarError && <p className="iris54-source-error" role="alert">{calendarError}</p>}
                <AgendaCalendar
                  date={calendarCursorDate}
                  mode={calendarPeriodMode}
                  range={calendarRange(calendarCursorDate, calendarPeriodMode)}
                  events={calendarEvents}
                  calendars={calendarCatalog}
                  selectedCalendarId={calendarScopeId}
                  loading={calendarLoading}
                  truncated={calendarTruncated}
                  warnings={calendarWarnings}
                  onDateChange={setCalendarCursorDate}
                  onModeChange={setCalendarPeriodMode}
                  onCalendarChange={setCalendarScopeId}
                />
                {calendarAccessHelp === "connections" && (
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, margin: "0 0 16px" }}>
                    <Link
                      href="/conexoes"
                      className="iris54-top-btn"
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}
                    >
                      Abrir Conexões
                      <ExternalLink size={14} />
                    </Link>
                    {remoteAccessReady && (
                      <Button type="button" variant="outline" onClick={() => void connectChatGoogle("calendar")}>
                        Autorizar Google Calendar com OAuth
                      </Button>
                    )}
                  </div>
                )}
                {canManageCalendar && (
                  <section className="iris54-feature-card" style={{ marginBottom: 20 }} aria-label="Criar evento no Google Calendar">
                    <h3 style={{ marginTop: 0 }}>Criar evento no Google Calendar</h3>
                    <div className="iris54-calendar-edit-form">
                      <label className="iris54-calendar-field">
                        Título
                        <input
                          type="text"
                          value={calendarCreateDraft.summary}
                          onChange={(e) => setCalendarCreateDraft((current) => ({ ...current, summary: e.target.value }))}
                          autoComplete="off"
                        />
                      </label>
                      <label className="iris54-calendar-field">
                        Agenda de destino
                        <select
                          value={calendarCreateCalendarId}
                          onChange={(e) => setCalendarCreateCalendarId(e.target.value)}
                          disabled={calendarLoading || calendarCreateBusy}
                        >
                          {calendarCatalog.filter((calendar) => calendarCanWrite(calendar.accessRole)).length === 0 && (
                            <option value="" disabled>Nenhuma agenda com permissão de escrita</option>
                          )}
                          {calendarCatalog.filter((calendar) => calendarCanWrite(calendar.accessRole)).map((calendar) => (
                            <option key={calendar.id} value={calendar.id}>{calendar.summary}{calendar.primary ? " · principal" : ""}</option>
                          ))}
                        </select>
                      </label>
                      <div className="iris54-calendar-date-fields">
                        <label className="iris54-calendar-field">
                          Início
                          <input
                            type="datetime-local"
                            value={calendarCreateDraft.start}
                            onChange={(e) => setCalendarCreateDraft((current) => ({ ...current, start: e.target.value }))}
                          />
                        </label>
                        <label className="iris54-calendar-field">
                          Fim
                          <input
                            type="datetime-local"
                            value={calendarCreateDraft.end}
                            onChange={(e) => setCalendarCreateDraft((current) => ({ ...current, end: e.target.value }))}
                          />
                        </label>
                      </div>
                      <div className="iris54-calendar-event-actions">
                        <Button
                          type="button"
                          onClick={() => void createCalendarEvent()}
                          disabled={!canCreateCalendar || calendarCreateBusy || calendarLoading || calendarActionBusyId !== null}
                        >
                          <Plus size={14} /> {calendarCreateBusy ? "Criando…" : "Criar evento"}
                        </Button>
                      </div>
                    </div>
                  </section>
                )}
                <div className="iris54-feature-grid" aria-label={calendarPeriodMode === "day" ? "Compromissos do dia" : "Compromissos do mês"}>
                  {calendarEvents.length ? calendarEvents.map((event) => (
                    <article className="iris54-feature-card iris54-calendar-event-card" key={event.identity}>
                      <span className="iris54-priority-badge" style={{ background: "rgba(59, 130, 246, 0.2)", color: "#93c5fd" }}>CALENDAR</span>
                      {editingCalendarEventId === event.identity && calendarDraft && canManageCalendar ? (
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
                              disabled={calendarActionBusyId === event.identity || calendarLoading}
                            >
                              {calendarActionBusyId === event.identity ? "Salvando…" : "Salvar alteração"}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => { setEditingCalendarEventId(null); setCalendarDraft(null); setCalendarError(""); }}
                              disabled={calendarActionBusyId === event.identity}
                            >
                              Cancelar
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <strong>{event.summary || "Compromisso sem título"}</strong>
                          <p>
                            {formatCalendarEventPeriod(event)}
                          </p>
                          <p>Agenda: {event.calendarName} · {calendarCanWrite(event.accessRole) ? "pode editar" : "somente leitura"}</p>
                          {event.location && <p>Local: {event.location}</p>}
                          {event.description && <p>{event.description}</p>}
                          {canManageCalendar && calendarCanWrite(event.accessRole) && <div className="iris54-calendar-event-actions">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => beginCalendarEdit(event)}
                              disabled={!canManageCalendar || calendarActionBusyId !== null || calendarLoading || calendarCreateBusy}
                              aria-label={`Editar ${event.summary || "compromisso"}`}
                            >
                              <Pencil size={14} /> Editar
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => void deleteCalendarEvent(event)}
                              disabled={!canManageCalendar || calendarActionBusyId !== null || calendarLoading || calendarCreateBusy}
                              aria-label={`Excluir ${event.summary || "compromisso"}`}
                            >
                              {calendarActionBusyId === event.identity ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                              {calendarActionBusyId === event.identity ? "Excluindo…" : "Excluir"}
                            </Button>
                          </div>}
                        </>
                      )}
                    </article>
                  )) : !calendarLoading && !calendarError && !calendarAccessHelp ? (
                    <div className="iris54-feature-card">
                      <strong>Sem compromissos neste período</strong>
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

            {/* MÓDULO: SAÚDE (CENTRAL DE SAÚDE IRIS) */}
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
