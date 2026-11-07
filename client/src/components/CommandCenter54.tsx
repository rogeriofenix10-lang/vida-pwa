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
  gmailAuthUrl,
  gmailBody,
  gmailHeader,
  gmailMessage,
  gmailMessages,
  gmailStatus,
  googleCalendarEvents,
  loadIrisData,
  saveIrisData,
} from "@/lib/irisWorker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowRight,
  Bell,
  Check,
  ChevronRight,
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
        text: "Olá. Sou a Iris IA. Estou no modo conectado e posso consultar Gmail, Calendar e arquivos autorizados quando você pedir. Ações que alteram dados sempre exigem sua confirmação.",
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
  const [calendarEvents, setCalendarEvents] = useState<Array<{ id: string; summary?: string; description?: string; start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string } }>>([]);
  const [calendarMessage, setCalendarMessage] = useState("Carregando agenda autorizada…");
  const [analysisRows, setAnalysisRows] = useState<{ finances: Array<Record<string, unknown>>; documents: Array<Record<string, unknown>> }>({ finances: [], documents: [] });
  const lastVoiceCommandRef = useRef({ text: "", at: 0 });
  const lastVoiceErrorRef = useRef({ text: "", at: 0 });
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    try {
      localStorage.setItem(
        "iris-chat-history",
        JSON.stringify(chat.slice(-30)),
      );
    } catch {}
  }, [chat]);

  useEffect(() => {
    let cancelled = false;
    void loadIrisData("radar")
      .then(({ items: rows }) => {
        if (cancelled || !rows.length) return;
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
      })
      .catch(() => {
        // O modo local continua disponível quando o Worker está indisponível.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void googleCalendarEvents(new Date().toISOString())
      .then((result) => {
        if (!active) return;
        const events = result.items ?? [];
        setCalendarEvents(events);
        setCalendarMessage(events.length ? "Agenda sincronizada com o Google Calendar." : "Nenhum compromisso futuro encontrado.");
      })
      .catch(() => { if (active) setCalendarMessage("Google Calendar não autorizado ou indisponível. Autorize em Google Workspace."); });
    void Promise.all([loadIrisData("finances"), loadIrisData("documents")])
      .then(([finances, documents]) => { if (active) setAnalysisRows({ finances: finances.items, documents: documents.items }); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

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
    enabled: isAuthenticated,
    retry: false,
  });
  const preference = trpc.ai.preference.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: false,
  });
  const radarQuery = trpc.radar.list.useQuery(undefined, {
    enabled: isAuthenticated,
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
    enabled: isAuthenticated,
    retry: false,
  });
  const updateVoiceProfile = trpc.voice.updateProfile.useMutation();
  const userFiles = trpc.documents.list.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: false,
  });
  const costStatus = trpc.control.costStatus.useQuery(undefined, {
    enabled: isAuthenticated,
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
    if (!isAuthenticated) {
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
  }, [isAuthenticated, radarQuery.data, radarQuery.isError]);

  useEffect(() => {
    if (!isAuthenticated || !radarQuery.isLoading) return;
    const timer = window.setTimeout(() => {
      if (!radarQuery.data) {
        setRadarFallback(true);
        setItems(initialItems);
      }
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [isAuthenticated, radarQuery.isLoading, radarQuery.data]);

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
      if (isAuthenticated) {
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

    if (isAuthenticated) {
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

      const isGmailCommand = /(e-?mail|gmail|remetente|título|titulo)/i.test(text);
      if (isGmailCommand) {
        const status = await gmailStatus();
        if (!status.authorized) {
          const reply = `O Gmail ainda não está autorizado. Abra este endereço para autorizar somente leitura: ${gmailAuthUrl()}`;
          setChat((current) => [...current, { role: "assistant", text: reply }]);
          if (voiceEnabled) voice.speak(reply);
          return;
        }
        const listing = await gmailMessages();
        const ids = (listing.messages ?? []).slice(0, 20).map((item) => item.id);
        if (/quantos|quantidade|número|numero/i.test(text)) {
          const reply = `Você recebeu aproximadamente ${listing.resultSizeEstimate ?? ids.length} e-mails. A consulta atual mostra até ${ids.length} mensagens.`;
          setChat((current) => [...current, { role: "assistant", text: reply }]);
          if (voiceEnabled) voice.speak(reply);
          return;
        }
        const details = await Promise.all(ids.map((id) => gmailMessage(id)));
        const query = text
          .replace(/.*e-?mail\s*/i, "")
          .replace(/^(de|do|da|com assunto|sobre)\s+/i, "")
          .trim();
        const target = /leia|ler|leitura/i.test(text)
          ? details.find((message) => {
              if (!query) return false;
              const subject = gmailHeader(message, "Subject").toLowerCase();
              const from = gmailHeader(message, "From").toLowerCase();
              return subject.includes(query.toLowerCase()) || from.includes(query.toLowerCase());
            })
          : null;
        if (target) {
          const reply = `Assunto: ${gmailHeader(target, "Subject")}\nRemetente: ${gmailHeader(target, "From")}\n\n${gmailBody(target)}`;
          setChat((current) => [...current, { role: "assistant", text: reply }]);
          if (voiceEnabled) voice.speak(reply);
          return;
        }
        const reply = details.length
          ? details
              .map((message, index) => `${index + 1}. ${gmailHeader(message, "Subject")} — ${gmailHeader(message, "From")}`)
              .join("\n")
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

                <div className="iris54-chat-feed">
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
                  <button
                    type="button"
                    className="iris54-close-btn"
                    onClick={() => setActiveView(null)}
                    aria-label="Fechar"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="iris54-feature-grid">
                  {calendarEvents.length ? calendarEvents.slice(0, 12).map((event) => (
                    <div className="iris54-feature-card" key={event.id}>
                      <span className="iris54-priority-badge" style={{ background: "rgba(59, 130, 246, 0.2)", color: "#93c5fd" }}>CALENDAR</span>
                      <strong>{event.summary || "Compromisso sem título"}</strong>
                      <p>{event.start?.dateTime || event.start?.date || "Data não informada"}{event.description ? ` · ${event.description}` : ""}</p>
                    </div>
                  )) : <div className="iris54-feature-card"><strong>Agenda sem dados demonstrativos</strong><p>{calendarMessage}</p></div>}
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

                <div className="iris54-feature-grid">
                  <div className="iris54-feature-card"><span className="iris54-kicker">DADOS REAIS</span><strong>Finanças carregadas</strong><p>{analysisRows.finances.length} lançamento(s) persistente(s) no D1. Gere um relatório para interpretação detalhada.</p></div>
                  <div className="iris54-feature-card"><span className="iris54-kicker">DOCUMENTOS</span><strong>Arquivo catalogado</strong><p>{analysisRows.documents.length} documento(s) encontrado(s) no arquivo persistente.</p></div>
                  <div className="iris54-feature-card"><span className="iris54-kicker">RADAR</span><strong>Pendências atuais</strong><p>{items.filter((item) => item.status !== "completed").length} item(ns) não concluído(s) no Radar local/D1.</p></div>
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
                        "Faça uma análise completa das minhas pendências e oportunidades de economia.",
                      );
                    }}
                    style={{
                      background: "var(--iris-yellow)",
                      color: "#000",
                      fontWeight: 700,
                    }}
                  >
                    Gerar Novo Relatório
                  </Button>
                </div>
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
