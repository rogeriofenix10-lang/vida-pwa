/**
 * IRIS 5.4 - Motor Cognitivo
 * Estados cognitivos, classificação de intenções, análise de risco e fluxo seguro com autorização explícita.
 */

import {
  routeAiModel,
  classifyModelComplexity,
  IrisModelRouter,
  IrisCostGuard,
  type ModelRouterInput,
  type ModelRouterDecision,
  type ModelComplexity,
  type ModelStrategy,
  type ModelCostLevel,
  type ModelFallback,
  type CostGuardTier,
  type CostGuardEvaluation,
  type RouterObservabilityRecord,
} from "./irisModelRouter";

export {
  routeAiModel,
  classifyModelComplexity,
  IrisModelRouter,
  IrisCostGuard,
  type ModelRouterInput,
  type ModelRouterDecision,
  type ModelComplexity,
  type ModelStrategy,
  type ModelCostLevel,
  type ModelFallback,
  type CostGuardTier,
  type CostGuardEvaluation,
  type RouterObservabilityRecord,
};

export type IrisState =
  | "idle"
  | "analyzing"
  | "awaiting_authorization"
  | "executing"
  | "completed"
  | "error";

export type CommandIntent = "query" | "mutation";

export type ActionClassification =
  | "consulta"
  | "analise"
  | "criacao"
  | "alteracao"
  | "exclusao"
  | "organizacao"
  | "envio"
  | "compartilhamento"
  | "envio/compartilhamento";

export type RiskLevel = "low" | "medium" | "high";

export type Priority = "urgente" | "importante" | "atencao" | "normal" | "informacao";

export interface CognitiveProposal {
  proposalId?: number;
  confirmationToken?: string;
  label: string;
  detail: string;
  date?: string;
  priority: Priority;
  action: string;
  targetId?: number;
  category?: string;
  dueAt?: string | null;
  reminderAt?: string | null;
}

export interface CommandAnalysis {
  command: string;
  intent: CommandIntent;
  actionType: ActionClassification;
  requiresAuthorization: boolean;
  riskLevel: RiskLevel;
  confidence: number;
  explanation: string;
  proposal?: CognitiveProposal;
  directResponse?: string;
  routerDecision?: ModelRouterDecision;
}

export interface CognitiveContext {
  items?: Array<{
    id: number;
    label: string;
    detail: string;
    date?: string;
    priority?: string;
    status?: string;
    category?: string;
  }>;
  isAuthenticated?: boolean;
}

export interface OperationalEntities {
  label?: string;
  targetId?: number;
  targetItem?: string;
  date?: string;
  dueDate?: string;
  amount?: number;
  amountFormatted?: string;
  priority?: Priority;
  category?: string;
  recipient?: string;
  channel?: string;
  action?: string;
  parameters: Record<string, unknown>;
  missingParameters?: string[];
}

export type PlanStepType =
  | "read"
  | "validate"
  | "prepare"
  | "authorize"
  | "execute"
  | "audit"
  | "clarify";

export interface PlanExecutionStep {
  id: string;
  name: string;
  type: PlanStepType;
  toolName?: string;
  parameters?: Record<string, unknown>;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  result?: unknown;
  error?: string;
}

export interface ExecutionPlan {
  planId: string;
  summary: string;
  intent: string;
  actionType: ActionClassification;
  riskLevel: RiskLevel;
  requiresAuthorization: boolean;
  isAmbiguous: boolean;
  clarificationPrompt?: string;
  entities: OperationalEntities;
  steps: PlanExecutionStep[];
  proposal?: CognitiveProposal;
  directResponse?: string;
  routerDecision?: ModelRouterDecision;
}

export interface PlanExecutionResult {
  planId: string;
  success: boolean;
  message: string;
  completedSteps: number;
  totalSteps: number;
  results: Record<string, unknown>;
  error?: string;
}

/**
 * Análise interna do comando seguindo o fluxo cognitivo
 */
function internalAnalyzeCommand(command: string, context?: CognitiveContext): CommandAnalysis {
  const raw = command || "";
  const normalized = raw.trim();
  const lower = normalized.toLowerCase();

  // Comando vazio
  if (!normalized) {
    return {
      command: normalized,
      intent: "query",
      actionType: "consulta",
      requiresAuthorization: false,
      riskLevel: "low",
      confidence: 1.0,
      explanation: "Comando vazio ou não informado.",
      directResponse: "Olá! Como posso ajudar você a organizar seu dia?",
    };
  }

  // 1. EXCLUSÃO (Risco Alto - Irreversível)
  const isDeletion = /\b(excluir|apagar|remover|deletar|eliminar|limpar item)\b/i.test(lower);
  if (isDeletion) {
    const matchedItem = context?.items?.find((item) =>
      lower.includes(item.label.toLowerCase())
    );

    const label = matchedItem
      ? `Excluir: ${matchedItem.label}`
      : `Excluir item solicitado`;

    const detail = matchedItem
      ? `Remover definitivamente “${matchedItem.label}” (${matchedItem.detail})`
      : `Remoção do item especificado no comando: “${normalized}”`;

    return {
      command: normalized,
      intent: "mutation",
      actionType: "exclusao",
      requiresAuthorization: true,
      riskLevel: "high",
      confidence: 0.95,
      explanation: "A exclusão definitiva de registros é permanente e exige autorização explícita.",
      proposal: {
        label,
        detail,
        date: "imediato",
        priority: "urgente",
        action: "Confirmar exclusão",
        targetId: matchedItem?.id,
      },
    };
  }

  // 2. ENVIO / NOTIFICAÇÃO EXTERNA (Risco Alto - Comunicação externa)
  const isSending = /\b(enviar|mandar|disparar|notificar|transmitir)\b/i.test(lower) &&
    /\b(email|e-mail|mensagem|whatsapp|notifica[çc][ãa]o|relat[óo]rio|sms)\b/i.test(lower);
  if (isSending) {
    return {
      command: normalized,
      intent: "mutation",
      actionType: "envio",
      requiresAuthorization: true,
      riskLevel: "high",
      confidence: 0.92,
      explanation: "O envio de dados para canais externos ou terceiros exige autorização explícita.",
      proposal: {
        label: "Disparo externo de mensagem/relatório",
        detail: `Enviar: “${normalized}”`,
        date: "imediato",
        priority: "urgente",
        action: "Autorizar envio externo",
      },
    };
  }

  // 3. COMPARTILHAMENTO (Risco Alto/Médio)
  const isSharing = /\b(compartilhar|exportar|conceder acesso|dar permiss[ãa]o)\b/i.test(lower);
  if (isSharing) {
    return {
      command: normalized,
      intent: "mutation",
      actionType: "compartilhamento",
      requiresAuthorization: true,
      riskLevel: "high",
      confidence: 0.9,
      explanation: "O compartilhamento de dados pessoais ou documentos exige autorização explícita.",
      proposal: {
        label: "Compartilhamento de dados",
        detail: `Permitir compartilhamento para o comando: “${normalized}”`,
        date: "imediato",
        priority: "importante",
        action: "Autorizar compartilhamento",
      },
    };
  }

  // 4. ALTERAÇÃO / ATUALIZAÇÃO (Risco Médio)
  const isAlteration = /\b(adiar|mudar|alterar|modificar|postergar|remarcar|atualizar|concluir|finalizar|completar)\b/i.test(lower);
  if (isAlteration) {
    const matchedItem = context?.items?.find((item) =>
      lower.includes(item.label.toLowerCase())
    );

    const isCompletion = /\b(concluir|finalizar|completar)\b/i.test(lower);
    const label = matchedItem
      ? `${isCompletion ? "Concluir" : "Alterar"}: ${matchedItem.label}`
      : `Atualização de registro`;

    const detail = matchedItem
      ? `${isCompletion ? "Marcar como concluído" : "Modificar prazo/detalhes de"} “${matchedItem.label}”`
      : `Alteração solicitada: “${normalized}”`;

    return {
      command: normalized,
      intent: "mutation",
      actionType: "alteracao",
      requiresAuthorization: true,
      riskLevel: "medium",
      confidence: 0.94,
      explanation: "Qualquer alteração ou conclusão de registros existentes exige confirmação explícita.",
      proposal: {
        label,
        detail,
        date: isCompletion ? "hoje" : "amanhã",
        priority: "importante",
        action: isCompletion ? "Marcar como concluído" : "Salvar alteração",
        targetId: matchedItem?.id,
      },
    };
  }

  // 5. ORGANIZAÇÃO / CRIAÇÃO DE DADOS (Risco Baixo/Médio - Exige autorização explícita)
  const isOrganization = /\b(organizar|adicionar|agendar|cadastrar|novo|nova|lembrar|lembrete|vence|vencimento|pagar|comprar|anotar)\b/i.test(lower);
  if (isOrganization) {
    const dayMatch = lower.match(/\bdia\s+(\d{1,2})\b/);
    const hasTomorrow = /\bamanh[ãa]\b/.test(lower);
    const now = new Date();
    const due = new Date(now);

    if (hasTomorrow) {
      due.setDate(now.getDate() + 1);
    } else if (dayMatch) {
      const day = Number(dayMatch[1]);
      due.setDate(1);
      due.setDate(day);
      if (due < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
        due.setMonth(due.getMonth() + 1);
      }
    } else {
      due.setDate(now.getDate() + 1);
    }

    const dateLabel = hasTomorrow
      ? "amanhã"
      : due.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

    const labelMatch = lower.match(/\b(?:minha|meu|a|o)\s+(.+?)(?:\s+vence|\s+vencimento|\s+dia\s+\d|\s+amanh|$)/i);
    const cleanedCommand = normalized
      .replace(/^(lembrar de|cadastrar|adicionar|agendar|anotar)\s*/i, "")
      .replace(/\s+(?:dia\s+\d{1,2}|amanh[ãa]|r\$\s*[\d.,]+).*$/i, "")
      .trim();
    const rawLabel = (labelMatch?.[1]?.trim() || cleanedCommand || normalized)
      .replace(/\s+(?:dia\s+\d{1,2}|amanh[ãa]|r\$\s*[\d.,]+).*$/i, "");
    const label = rawLabel.replace(/\s+/g, " ").replace(/^./, (c) => c.toUpperCase());

    const amountMatch = normalized.match(/R\$\s*([\d.,]+)/i);
    const isInternet = label.toLowerCase().includes("internet") || label.toLowerCase().includes("conta");
    const detail = isInternet && dayMatch
      ? `Conta com vencimento no dia ${dayMatch[1]}${amountMatch ? ` · R$ ${amountMatch[1]}` : ""}`
      : `Vencimento em ${dateLabel}${amountMatch ? ` · R$ ${amountMatch[1]}` : ""}`;

    const priority: Priority = hasTomorrow || Boolean(dayMatch && due.getTime() - now.getTime() < 3 * 86400000)
      ? "urgente"
      : "importante";

    return {
      command: normalized,
      intent: "mutation",
      actionType: "organizacao",
      requiresAuthorization: true,
      riskLevel: "low",
      confidence: 0.95,
      explanation: "A organização ou criação de novos itens no Radar requer autorização explícita do usuário.",
      proposal: {
        label,
        detail,
        date: dateLabel,
        priority,
        action: hasTomorrow ? "Lembrar amanhã" : "Acompanhar no Radar",
        dueAt: due.toISOString(),
        reminderAt: due.toISOString(),
        category: /(conta|seguro|pagar|dinheiro)/i.test(label) ? "Finanças" : "Geral",
      },
    };
  }

  // 6. ANÁLISE / DIAGNÓSTICO (Apenas consulta reflexiva - Sem mutação de dados)
  const isAnalysis = /\b(analisar|an[áa]lise|diagn[óo]stico|estat[íi]sticas?|resumo geral|vis[ãa]o geral|insights?|oportunidades?|avaliar)\b/i.test(lower);
  if (isAnalysis) {
    const totalItems = context?.items?.length ?? 0;
    const pendingItems = context?.items?.filter((i) => (i.status ?? "pending") === "pending").length ?? 0;
    const urgentItems = context?.items?.filter((i) => i.priority === "urgente").length ?? 0;

    let reply = "Realizei a análise do seu ecossistema. ";
    if (totalItems > 0) {
      reply += `Você tem ${totalItems} itens no Radar, sendo ${pendingItems} pendências ativas`;
      if (urgentItems > 0) {
        reply += ` e ${urgentItems} com prioridade urgente exigindo atenção`;
      }
      reply += ". Nenhum dado precisou ser alterado.";
    } else {
      reply += "No momento seus compromissos e tarefas estão organizados e em dia. Posso monitorar novas demandas para você.";
    }

    return {
      command: normalized,
      intent: "query",
      actionType: "analise",
      requiresAuthorization: false,
      riskLevel: "low",
      confidence: 0.96,
      explanation: "Análise diagnóstica e estatística não muta dados e é respondida de imediato.",
      directResponse: reply,
    };
  }

  // 7. CONSULTA / INQUIRY (Apenas consulta - Sem mutação de dados)
  const isQuery = /\b(o que|quais|qual|listar|ver|como|onde|quanto|quando|ajuda|ol[áa]|bom dia|boa tarde|boa noite)\b/i.test(lower) ||
    lower.endsWith("?");

  let directReply = "Entendido. Esta é uma consulta informativa: não há alterações nem remoções de dados agendadas.";
  if (/\b(o que tenho|quais tarefas|meus compromissos|prazos)\b/i.test(lower)) {
    const active = context?.items?.filter((i) => (i.status ?? "pending") === "pending") ?? [];
    if (active.length > 0) {
      const list = active.slice(0, 3).map((it) => `“${it.label}” (${it.date || it.detail})`).join(", ");
      directReply = `Você tem ${active.length} item(ns) pendente(s) no Radar: ${list}.`;
    } else {
      directReply = "Você não possui tarefas pendentes registradas no momento.";
    }
  } else if (/\b(documento|documentos|arquivo|arquivos)\b/i.test(lower)) {
    directReply = "Seus documentos estão catalogados no módulo Documentos. Posso analisar apólices, contratos e notas fiscais quando desejar.";
  } else if (/\b(sa[úu]de|exames?|medicamento)\b/i.test(lower)) {
    directReply = "Seu módulo de Saúde Inteligente está ativo. Você pode consultar exames, medicamentos e histórico no Health Center.";
  } else if (/\b(ol[áa]|bom dia|boa tarde|boa noite)\b/i.test(lower)) {
    directReply = "Olá! Estou pronta para te apoiar. Diga o que precisa consultar ou organizar.";
  }

  return {
    command: normalized,
    intent: "query",
    actionType: "consulta",
    requiresAuthorization: false,
    riskLevel: "low",
    confidence: 0.95,
    explanation: "Consultas de status e informativas não alteram dados e são respondidas diretamente.",
    directResponse: directReply,
  };
}

/**
 * Analisa comando do usuário seguindo o fluxo cognitivo e integrando o AI Model Router (Fase 4):
 * 1. Receber comando
 * 2. Entender intenção
 * 3. Analisar contexto e risco
 * 4. Classificar a ação
 * 5. Consultar AI Model Router (Free-First)
 * 6. Responder diretamente ou exigir autorização
 */
export function analyzeCommand(command: string, context?: CognitiveContext): CommandAnalysis {
  const analysis = internalAnalyzeCommand(command, context);
  const routerDecision = routeAiModel({
    command,
    intent: analysis.actionType,
    risk: analysis.riskLevel,
    context,
    needsTools: false,
    needsReasoning: analysis.actionType === "analise",
  });
  analysis.routerDecision = routerDecision;

  if (routerDecision.status === "blocked" || routerDecision.isBlocked) {
    analysis.directResponse = routerDecision.reason;
    analysis.explanation = routerDecision.reason;
  }

  return analysis;
}

/**
 * Interpretação operacional interna dos comandos naturais
 */
function internalInterpretOperationalCommand(command: string, context?: CognitiveContext): ExecutionPlan {
  const raw = command || "";
  const normalized = raw.trim();
  const lower = normalized.toLowerCase();
  const planId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // Comando vazio
  if (!normalized) {
    return {
      planId,
      summary: "Comando vazio",
      intent: "indefinida",
      actionType: "consulta",
      riskLevel: "low",
      requiresAuthorization: false,
      isAmbiguous: true,
      clarificationPrompt: "Por favor, digite ou fale o que você precisa.",
      entities: { parameters: {}, missingParameters: ["command"] },
      steps: [
        { id: "step-1", name: "Solicitar esclarecimento ao usuário", type: "clarify", status: "completed" },
      ],
      directResponse: "Olá! Como posso ajudar você a organizar seu dia?",
    };
  }

  // 1. Detecção de Comandos Ambíguos / Parâmetros Faltantes
  const isVagueDeletion = /^(excluir|apagar|deletar|remover|eliminar)$/i.test(normalized) ||
    /^(excluir|apagar|deletar|remover|eliminar)\s+(isso|aquilo|o item|algo)$/i.test(normalized);
  if (isVagueDeletion) {
    return {
      planId,
      summary: "Comando de exclusão ambíguo sem alvo definido",
      intent: "Exclusão indefinida",
      actionType: "exclusao",
      riskLevel: "high",
      requiresAuthorization: true,
      isAmbiguous: true,
      clarificationPrompt: "Por favor, especifique qual item ou compromisso você deseja excluir do Radar.",
      entities: { parameters: {}, missingParameters: ["targetItem"] },
      steps: [
        { id: "step-1", name: "Esclarecer item a ser excluído", type: "clarify", status: "pending" },
      ],
      directResponse: "Por favor, especifique qual item ou compromisso você deseja excluir do Radar.",
    };
  }

  const isVagueAlteration = /^(mudar|alterar|adiar|postergar|remarcar)$/i.test(normalized) ||
    /^(mudar|alterar|adiar)\s+(isso|aquilo|o item|o prazo)$/i.test(normalized);
  if (isVagueAlteration) {
    return {
      planId,
      summary: "Comando de alteração ambíguo sem alvo ou prazo",
      intent: "Alteração indefinida",
      actionType: "alteracao",
      riskLevel: "medium",
      requiresAuthorization: true,
      isAmbiguous: true,
      clarificationPrompt: "Qual compromisso você gostaria de alterar e para qual data?",
      entities: { parameters: {}, missingParameters: ["targetItem", "date"] },
      steps: [
        { id: "step-1", name: "Esclarecer compromisso e nova data", type: "clarify", status: "pending" },
      ],
      directResponse: "Qual compromisso você gostaria de alterar e para qual data?",
    };
  }

  const isVagueCommunication = /^(enviar|mandar|compartilhar)$/i.test(normalized) ||
    /^(enviar|mandar|compartilhar)\s+(isso|aquilo|uma mensagem|um email)$/i.test(normalized);
  if (isVagueCommunication) {
    return {
      planId,
      summary: "Comando de comunicação/compartilhamento sem destinatário ou conteúdo",
      intent: "Comunicação externa indefinida",
      actionType: "envio/compartilhamento",
      riskLevel: "high",
      requiresAuthorization: true,
      isAmbiguous: true,
      clarificationPrompt: "Para quem você deseja enviar e qual é a mensagem ou arquivo a ser compartilhado?",
      entities: { parameters: {}, missingParameters: ["recipient", "content"] },
      steps: [
        { id: "step-1", name: "Esclarecer destinatário e conteúdo", type: "clarify", status: "pending" },
      ],
      directResponse: "Para quem você deseja enviar e qual é a mensagem ou arquivo a ser compartilhado?",
    };
  }

  const isVagueAction = /^(faça aquilo|fazer aquilo|execute aquilo|executar aquilo|fazer isso|executa ai|faz ai)\b/i.test(normalized);
  if (isVagueAction) {
    return {
      planId,
      summary: "Comando de ação genérico sem instrução específica",
      intent: "Ação genérica",
      actionType: "consulta",
      riskLevel: "low",
      requiresAuthorization: false,
      isAmbiguous: true,
      clarificationPrompt: "Por favor, especifique qual tarefa ou comando você gostaria que eu realizasse.",
      entities: { parameters: {}, missingParameters: ["actionTarget"] },
      steps: [
        { id: "step-1", name: "Esclarecer instrução", type: "clarify", status: "pending" },
      ],
      directResponse: "Por favor, especifique qual tarefa ou comando você gostaria que eu realizasse.",
    };
  }

  // 2. Extração de Entidades e Parâmetros
  const amountMatch = normalized.match(/R\$\s*([\d.,]+)/i);
  const amount = amountMatch
    ? parseFloat(amountMatch[1].replace(/\./g, "").replace(",", "."))
    : undefined;
  const amountFormatted = amountMatch ? `R$ ${amountMatch[1]}` : undefined;

  const dayMatch = lower.match(/\bdia\s+(\d{1,2})\b/);
  const hasTomorrow = /\bamanh[ãa]\b/.test(lower);
  const hasToday = /\bhoje\b/.test(lower);
  const hasNextWeek = /\b(?:semana que vem|próxima semana)\b/.test(lower);

  const now = new Date();
  const due = new Date(now);
  let dateLabel = "hoje";

  if (hasTomorrow) {
    due.setDate(now.getDate() + 1);
    dateLabel = "amanhã";
  } else if (hasNextWeek) {
    due.setDate(now.getDate() + 7);
    dateLabel = "próxima semana";
  } else if (dayMatch) {
    const day = Number(dayMatch[1]);
    due.setDate(1);
    due.setDate(day);
    if (due < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
      due.setMonth(due.getMonth() + 1);
    }
    dateLabel = due.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  // Identificação do alvo em relação ao contexto
  const matchedItem = context?.items?.find((item) =>
    lower.includes(item.label.toLowerCase())
  );

  // Destinatário / Canal
  const recipientMatch = lower.match(/(?:para|com)\s+(?:o|a|meu|minha)?\s*([a-záàâãéèêíïóôõöúçñ\s]+?)(?:\s+(?:por|via|no|na)\s+|$)/i);
  const recipient = recipientMatch?.[1]?.trim();
  const channel = /\b(email|e-mail)\b/i.test(lower)
    ? "email"
    : /\bwhatsapp\b/i.test(lower)
    ? "whatsapp"
    : /\bsms\b/i.test(lower)
    ? "sms"
    : undefined;

  // Categoria e Prioridade
  const isFinance = /\b(conta|seguro|pagar|dinheiro|banco|fatura|boleto)\b/i.test(lower);
  const isHealth = /\b(sa[úu]de|exame|m[ée]dico|rem[ée]dio|consulta)\b/i.test(lower);
  const isDocs = /\b(documento|ap[óo]lice|contrato|arquivo)\b/i.test(lower);
  const category = isFinance ? "Finanças" : isHealth ? "Saúde" : isDocs ? "Documentos" : "Geral";

  const priority: Priority = hasTomorrow || hasToday || Boolean(dayMatch && due.getTime() - now.getTime() < 3 * 86400000)
    ? "urgente"
    : "importante";

  const parameters: Record<string, unknown> = {
    amount,
    amountFormatted,
    date: dateLabel,
    dueDate: due.toISOString(),
    category,
    priority,
    recipient,
    channel,
    targetId: matchedItem?.id,
  };

  // 3. Classificação da Ação e Plano Estruturado
  const isDeletion = /\b(excluir|apagar|remover|deletar|eliminar)\b/i.test(lower);
  if (isDeletion) {
    const label = matchedItem ? `Excluir: ${matchedItem.label}` : "Excluir registro solicitado";
    const detail = matchedItem
      ? `Remover definitivamente “${matchedItem.label}” (${matchedItem.detail})`
      : `Remoção do registro indicado no comando: “${normalized}”`;

    const proposal: CognitiveProposal = {
      label,
      detail,
      date: "imediato",
      priority: "urgente",
      action: "Confirmar exclusão",
      targetId: matchedItem?.id,
      category,
    };

    return {
      planId,
      summary: `Plano de exclusão definitiva: ${label}`,
      intent: "Excluir dados do ecossistema",
      actionType: "exclusao",
      riskLevel: "high",
      requiresAuthorization: true,
      isAmbiguous: false,
      entities: {
        label,
        targetId: matchedItem?.id,
        targetItem: matchedItem?.label,
        priority: "urgente",
        category,
        action: "Confirmar exclusão",
        parameters,
      },
      proposal,
      steps: [
        { id: "step-1", name: "Validar existência do registro", type: "validate", status: "pending", parameters },
        { id: "step-2", name: "Preparar instrução de exclusão (radar.delete)", type: "prepare", toolName: "radar.delete", status: "pending", parameters },
        { id: "step-3", name: "Aguardar autorização explícita do usuário", type: "authorize", status: "pending" },
        { id: "step-4", name: "Executar exclusão definitiva autorizada", type: "execute", toolName: "radar.delete", status: "pending", parameters },
        { id: "step-5", name: "Registrar auditoria de exclusão", type: "audit", status: "pending" },
      ],
    };
  }

  const isSendingOrSharing = /\b(envi[aeo]r?|mand[aeo]r?|dispar[aeo]r?|notific[aeo]r?|compartilh[aeo]r?|export[aeo]r?)\b/i.test(lower);
  if (isSendingOrSharing) {
    const isShare = /\b(compartilhar|exportar|conceder)\b/i.test(lower);
    const label = isShare ? "Compartilhamento de dados" : "Disparo de comunicação externa";
    const detail = isShare
      ? `Compartilhar dados com ${recipient || "destinatário indicado"} (${channel || "canal seguro"})`
      : `Enviar mensagem para ${recipient || "destinatário indicado"} (${channel || "canal configurado"})`;

    const proposal: CognitiveProposal = {
      label,
      detail,
      date: "imediato",
      priority: "urgente",
      action: isShare ? "Autorizar compartilhamento" : "Autorizar envio externo",
      category,
    };

    return {
      planId,
      summary: `Plano de transmissão de dados: ${label}`,
      intent: isShare ? "Compartilhar dados com terceiros" : "Enviar comunicação externa",
      actionType: "envio/compartilhamento",
      riskLevel: "high",
      requiresAuthorization: true,
      isAmbiguous: false,
      entities: {
        label,
        recipient,
        channel,
        priority: "urgente",
        category,
        action: proposal.action,
        parameters,
      },
      proposal,
      steps: [
        { id: "step-1", name: "Validar credenciais e destinatário", type: "validate", status: "pending", parameters },
        { id: "step-2", name: "Preparar payload de transmissão", type: "prepare", toolName: isShare ? "data.share" : "communication.send", status: "pending", parameters },
        { id: "step-3", name: "Aguardar autorização explícita do usuário", type: "authorize", status: "pending" },
        { id: "step-4", name: "Transmitir comunicação autorizada", type: "execute", toolName: isShare ? "data.share" : "communication.send", status: "pending", parameters },
        { id: "step-5", name: "Auditar transmissão externa", type: "audit", status: "pending" },
      ],
    };
  }

  const isAlteration = /\b(adiar|mudar|alterar|modificar|postergar|remarcar|atualizar|concluir|finalizar|completar)\b/i.test(lower);
  if (isAlteration) {
    const isCompletion = /\b(concluir|finalizar|completar)\b/i.test(lower);
    const label = matchedItem
      ? `${isCompletion ? "Concluir" : "Alterar"}: ${matchedItem.label}`
      : "Alteração de registro existente";
    const detail = matchedItem
      ? `${isCompletion ? "Marcar como concluído" : "Modificar prazo para " + dateLabel + " de"} “${matchedItem.label}”`
      : `Modificação solicitada: “${normalized}”`;

    const proposal: CognitiveProposal = {
      label,
      detail,
      date: isCompletion ? "hoje" : dateLabel,
      priority,
      action: isCompletion ? "Marcar como concluído" : "Salvar alteração",
      targetId: matchedItem?.id,
      category,
    };

    return {
      planId,
      summary: `Plano de atualização: ${label}`,
      intent: isCompletion ? "Concluir item do radar" : "Alterar dados e prazos",
      actionType: "alteracao",
      riskLevel: "medium",
      requiresAuthorization: true,
      isAmbiguous: false,
      entities: {
        label,
        targetId: matchedItem?.id,
        targetItem: matchedItem?.label,
        date: dateLabel,
        priority,
        category,
        action: proposal.action,
        parameters,
      },
      proposal,
      steps: [
        { id: "step-1", name: "Validar identificador do registro", type: "validate", status: "pending", parameters },
        { id: "step-2", name: "Preparar mutação de estado (radar.update)", type: "prepare", toolName: isCompletion ? "radar.complete" : "radar.update", status: "pending", parameters },
        { id: "step-3", name: "Aguardar autorização explícita do usuário", type: "authorize", status: "pending" },
        { id: "step-4", name: "Executar atualização no Radar", type: "execute", toolName: isCompletion ? "radar.complete" : "radar.update", status: "pending", parameters },
        { id: "step-5", name: "Registrar auditoria de alteração", type: "audit", status: "pending" },
      ],
    };
  }

  // Criação explícita vs Organização de dados
  const isExplicitCreation = /\b(cadastrar|adicionar|novo|nova|criar tarefa|criar lembrete|criar compromisso)\b/i.test(lower) &&
    !/\b(organizar|planejar|estruturar)\b/i.test(lower);
  const isOrganization = /\b(organizar|planejar|estruturar|lembrar|lembrete|vence|vencimento|pagar|comprar|anotar)\b/i.test(lower);

  if (isExplicitCreation || isOrganization) {
    const labelMatch = lower.match(/\b(?:minha|meu|a|o)\s+(.+?)(?:\s+vence|\s+vencimento|\s+dia\s+\d|\s+amanh|$)/i);
    const cleanedCommand = normalized
      .replace(/^(lembrar de|cadastrar|adicionar|agendar|anotar|organizar|planejar)\s+(?:novo|nova|o|a|minha|meu)?\s*/i, "")
      .replace(/^(novo|nova)\s+/i, "")
      .replace(/\s+(?:dia\s+\d{1,2}|amanh[ãa]|r\$\s*[\d.,]+).*$/i, "")
      .trim();
    const rawLabel = (labelMatch?.[1]?.trim() || cleanedCommand || normalized)
      .replace(/^(novo|nova)\s+/i, "")
      .replace(/\s+(?:dia\s+\d{1,2}|amanh[ãa]|r\$\s*[\d.,]+).*$/i, "");
    const label = rawLabel.replace(/\s+/g, " ").replace(/^./, (c) => c.toUpperCase());

    const isInternet = label.toLowerCase().includes("internet") || label.toLowerCase().includes("conta");
    const detail = isInternet && dayMatch
      ? `Conta com vencimento no dia ${dayMatch[1]}${amountFormatted ? ` · ${amountFormatted}` : ""}`
      : `Vencimento em ${dateLabel}${amountFormatted ? ` · ${amountFormatted}` : ""}`;

    const actionType: ActionClassification = isExplicitCreation ? "criacao" : "organizacao";

    const proposal: CognitiveProposal = {
      label,
      detail,
      date: dateLabel,
      priority,
      action: hasTomorrow ? "Lembrar amanhã" : "Acompanhar no Radar",
      dueAt: due.toISOString(),
      reminderAt: due.toISOString(),
      category,
    };

    return {
      planId,
      summary: `Plano de ${actionType === "criacao" ? "criação" : "organização"}: ${label}`,
      intent: actionType === "criacao" ? "Criar novo compromisso no Radar" : "Organizar compromissos do ecossistema",
      actionType,
      riskLevel: "low",
      requiresAuthorization: true,
      isAmbiguous: false,
      entities: {
        label,
        date: dateLabel,
        dueDate: due.toISOString(),
        amount,
        amountFormatted,
        priority,
        category,
        action: proposal.action,
        parameters,
      },
      proposal,
      steps: [
        { id: "step-1", name: "Validar parâmetros do compromisso", type: "validate", status: "pending", parameters },
        { id: "step-2", name: "Preparar registro no Radar (radar.create)", type: "prepare", toolName: "radar.create", status: "pending", parameters },
        { id: "step-3", name: "Aguardar autorização explícita do usuário", type: "authorize", status: "pending" },
        { id: "step-4", name: "Inserir item no Radar da Vida", type: "execute", toolName: "radar.create", status: "pending", parameters },
        { id: "step-5", name: "Auditar criação e registrar memória", type: "audit", status: "pending" },
      ],
    };
  }

  // Análise diagnóstica
  const isAnalysis = /\b(analisar|an[áa]lise|diagn[óo]stico|estat[íi]sticas?|resumo geral|vis[ãa]o geral|insights?|oportunidades?|avaliar)\b/i.test(lower);
  if (isAnalysis) {
    const analysis = analyzeCommand(normalized, context);
    return {
      planId,
      summary: "Plano de análise diagnóstica e estatística",
      intent: "Análise cognitiva reflexiva",
      actionType: "analise",
      riskLevel: "low",
      requiresAuthorization: false,
      isAmbiguous: false,
      entities: { parameters },
      steps: [
        { id: "step-1", name: "Consultar pendências e métricas no Radar", type: "read", toolName: "analytics.summary", status: "pending", parameters },
        { id: "step-2", name: "Registrar síntese diagnóstica no histórico", type: "audit", status: "pending" },
      ],
      directResponse: analysis.directResponse,
    };
  }

  // Consulta informativa
  const queryAnalysis = analyzeCommand(normalized, context);
  return {
    planId,
    summary: "Plano de consulta informativa",
    intent: "Consulta e esclarecimento",
    actionType: "consulta",
    riskLevel: "low",
    requiresAuthorization: false,
    isAmbiguous: false,
    entities: { parameters },
    steps: [
      { id: "step-1", name: "Buscar dados e informações solicitadas", type: "read", toolName: "radar.read", status: "pending", parameters },
      { id: "step-2", name: "Formatar e retornar resposta ao usuário", type: "audit", status: "pending" },
    ],
    directResponse: queryAnalysis.directResponse,
  };
}

/**
 * Transforma comandos naturais do usuário em planos de execução seguros integrados ao AI Model Router (Fase 4):
 * 1. Interpreta intenção
 * 2. Identifica entidades e parâmetros
 * 3. Classifica a ação
 * 4. Determina nível de risco
 * 5. Classifica complexidade e consulta o Model Router
 * 6. Gera plano estruturado com decisão estratégica
 */
export function interpretOperationalCommand(command: string, context?: CognitiveContext): ExecutionPlan {
  const plan = internalInterpretOperationalCommand(command, context);
  const needsTools = plan.steps.some(
    (s) => s.type === "execute" || (Boolean(s.toolName) && s.toolName !== "radar.read")
  );
  const toolsRequired = plan.steps.filter((s) => Boolean(s.toolName)).map((s) => s.toolName as string);
  const routerDecision = routeAiModel({
    command,
    intent: plan.actionType,
    risk: plan.riskLevel,
    context,
    needsTools,
    toolsRequired,
    stepsCount: plan.steps.length,
    needsReasoning: /\b(profund|extens|reconcili|orquestr|arquitetur|complex)\b/i.test(command),
  });
  plan.routerDecision = routerDecision;

  if (routerDecision.status === "blocked" || routerDecision.isBlocked) {
    plan.summary = "Comando bloqueado pelo IRIS Cost Guard";
    plan.directResponse = routerDecision.reason;
  }

  return plan;
}

export interface CognitiveExecutionRecord {
  proposal: CognitiveProposal;
  success: boolean;
  message: string;
  timestamp: string;
  error?: string;
}

/**
 * FLUXO COGNITIVO REAL DA IRIS (Fase 4.3):
 * 1.  COMANDO         → Entrada em linguagem natural do usuário
 * 2.  INTERPRETAÇÃO   → Identificação de intenção, entidades e parâmetros
 * 3.  RISCO           → Avaliação de criticidade (low, medium, high)
 * 4.  COMPLEXIDADE    → Classificação automática (SIMPLES, MÉDIA, COMPLEXA)
 * 5.  MODEL ROUTER    → Roteamento inteligente da estratégia e modelo Free-First
 * 6.  COST GUARD      → Verificação estrita de custos (🟢 Local/Free, 🟡 Promo, 🔴 Bloqueio Pago)
 * 7.  PLANO           → Estruturação do plano operacional de etapas com decisão
 * 8.  AUTORIZAÇÃO     → Exigência de autorização explícita para ações com risco/mutação
 * 9.  EXECUÇÃO        → Execução controlada após autorização do usuário (Router ≠ Executor)
 * 10. CONFIRMAÇÃO     → Registro de auditoria e resposta final confirmada
 *
 * Motor de Gerenciamento Cognitivo da IRIS
 * Controla os estados (idle, analyzing, awaiting_authorization, executing, completed, error),
 * a garantia de autorização e a execução controlada da aplicação.
 */
export class IrisCognitiveEngine {
  private state: IrisState = "idle";
  private pendingProposal: CognitiveProposal | null = null;
  private pendingPlan: ExecutionPlan | null = null;
  private onStateChange?: (state: IrisState) => void;
  private lastExecution: CognitiveExecutionRecord | null = null;
  private modelRouter: IrisModelRouter = new IrisModelRouter();
  private lastRouterDecision: ModelRouterDecision | null = null;

  constructor(options?: {
    onStateChange?: (state: IrisState) => void;
    modelRouter?: IrisModelRouter;
  }) {
    this.onStateChange = options?.onStateChange;
    if (options?.modelRouter) {
      this.modelRouter = options.modelRouter;
    }
  }

  public getState(): IrisState {
    return this.state;
  }

  public getPendingProposal(): CognitiveProposal | null {
    return this.pendingProposal;
  }

  public getPendingPlan(): ExecutionPlan | null {
    return this.pendingPlan;
  }

  public getLastExecution(): CognitiveExecutionRecord | null {
    return this.lastExecution;
  }

  public getModelRouter(): IrisModelRouter {
    return this.modelRouter;
  }

  public getLastRouterDecision(): ModelRouterDecision | null {
    return this.lastRouterDecision;
  }

  public getRouterObservabilityLog(): RouterObservabilityRecord[] {
    return this.modelRouter.getObservabilityLog();
  }

  public getLastRouterObservabilityRecord(): RouterObservabilityRecord | null {
    return this.modelRouter.getLastObservabilityRecord();
  }

  public routeCommand(
    command: string,
    context?: CognitiveContext,
    options?: Partial<ModelRouterInput>
  ): ModelRouterDecision {
    const analysis = analyzeCommand(command, context);
    const decision = this.modelRouter.route({
      command,
      intent: analysis.actionType,
      risk: analysis.riskLevel,
      context,
      needsTools: false,
      needsReasoning: analysis.actionType === "analise",
      ...options,
    });
    this.lastRouterDecision = decision;
    return decision;
  }

  private setState(newState: IrisState) {
    this.state = newState;
    this.onStateChange?.(newState);
  }

  /**
   * Gera plano operacional a partir de comando em linguagem natural (Inteligência Operacional IRIS)
   */
  public generateOperationalPlan(command: string, context?: CognitiveContext): ExecutionPlan {
    this.setState("analyzing");
    const plan = interpretOperationalCommand(command, context);
    this.pendingPlan = plan;
    this.lastRouterDecision = plan.routerDecision ?? null;

    // Se o comando for bloqueado pelo IRIS Cost Guard, não agenda proposta de autorização
    if (plan.routerDecision?.status === "blocked" || plan.routerDecision?.isBlocked) {
      this.pendingProposal = null;
      this.setState("idle");
      return plan;
    }

    if (plan.requiresAuthorization && plan.proposal) {
      this.pendingProposal = plan.proposal;
      this.setState("awaiting_authorization");
    } else {
      this.pendingProposal = null;
      this.setState("completed");
    }

    return plan;
  }

  /**
   * Executa um plano estruturado de execução controlado (Regras 6, 7, 8, 9)
   */
  public async executeOperationalPlan(
    plan: ExecutionPlan,
    executor: (step: PlanExecutionStep) => Promise<unknown> | unknown
  ): Promise<PlanExecutionResult> {
    // Casos bloqueados pelo Cost Guard não executam nada
    if (plan.routerDecision?.status === "blocked" || plan.routerDecision?.isBlocked) {
      this.setState("idle");
      return {
        planId: plan.planId,
        success: false,
        message: plan.routerDecision.reason || "Recurso pago bloqueado pelo IRIS Cost Guard.",
        completedSteps: 0,
        totalSteps: plan.steps.length,
        results: {},
      };
    }

    // Casos ambíguos exigem esclarecimento antes de qualquer plano
    if (plan.isAmbiguous) {
      this.setState("idle");
      return {
        planId: plan.planId,
        success: false,
        message: plan.clarificationPrompt || "Comando ambíguo necessita de esclarecimento.",
        completedSteps: 0,
        totalSteps: plan.steps.length,
        results: {},
      };
    }

    // Regra 9: Nunca executar ação protegida sem autorização explícita
    if (plan.requiresAuthorization && this.state !== "awaiting_authorization") {
      throw new Error("Segurança IRIS: nenhuma ação protegida pode ser executada sem autorização explícita.");
    }

    this.setState("executing");
    const results: Record<string, unknown> = {};
    let completedSteps = 0;

    try {
      for (const step of plan.steps) {
        step.status = "running";
        if (step.type === "execute") {
          const stepResult = await executor(step);
          step.result = stepResult;
          results[step.id] = stepResult;
        }
        step.status = "completed";
        completedSteps++;
      }

      this.pendingProposal = null;
      this.pendingPlan = null;
      this.setState("completed");

      const successMsg = `Plano “${plan.summary}” executado com sucesso.`;
      if (plan.proposal) {
        this.lastExecution = {
          proposal: plan.proposal,
          success: true,
          message: successMsg,
          timestamp: new Date().toISOString(),
        };
      }

      return {
        planId: plan.planId,
        success: true,
        message: successMsg,
        completedSteps,
        totalSteps: plan.steps.length,
        results,
      };
    } catch (err) {
      this.setState("error");
      const errorMsg = err instanceof Error ? err.message : "Falha na execução do plano operacional.";

      if (plan.proposal) {
        this.lastExecution = {
          proposal: plan.proposal,
          success: false,
          message: errorMsg,
          timestamp: new Date().toISOString(),
          error: errorMsg,
        };
      }

      return {
        planId: plan.planId,
        success: false,
        message: errorMsg,
        completedSteps,
        totalSteps: plan.steps.length,
        results,
        error: errorMsg,
      };
    }
  }

  /**
   * Executa diretamente consultas e análises (Regra 1)
   * Se o comando exigir autorização (mutação), recusa execução direta e orienta o fluxo.
   */
  public async executeDirectQuery(
    command: string,
    context?: CognitiveContext,
    queryRunner?: (cmd: string) => Promise<string> | string
  ): Promise<{ success: boolean; result: string }> {
    this.setState("analyzing");
    const analysis = analyzeCommand(command, context);

    if (analysis.requiresAuthorization) {
      if (analysis.proposal) {
        this.pendingProposal = analysis.proposal;
      }
      this.setState("awaiting_authorization");
      throw new Error("Esta ação exige autorização explícita e não pode ser executada diretamente como consulta.");
    }

    try {
      const result = queryRunner
        ? await queryRunner(command)
        : (analysis.directResponse || "Consulta realizada com sucesso.");

      this.setState("completed");
      return { success: true, result };
    } catch (err) {
      this.setState("error");
      const message = err instanceof Error ? err.message : "Erro ao executar consulta.";
      return { success: false, result: message };
    }
  }

  public processCommand(command: string, context?: CognitiveContext): CommandAnalysis {
    this.setState("analyzing");
    const analysis = analyzeCommand(command, context);
    this.lastRouterDecision = analysis.routerDecision ?? null;

    if (analysis.requiresAuthorization && analysis.proposal) {
      this.pendingProposal = analysis.proposal;
      this.setState("awaiting_authorization");
    } else {
      this.pendingProposal = null;
      this.setState("completed");
    }

    return analysis;
  }

  /**
   * Executa SOMENTE a ação previamente aprovada após autorização explícita (Regras 3, 4, 5, 6).
   * Em caso de erro, não repete automaticamente ações protegidas.
   */
  public async authorize(
    executor: (proposal: CognitiveProposal) => Promise<void> | void
  ): Promise<{ success: boolean; message: string; proposal?: CognitiveProposal }> {
    if (this.state !== "awaiting_authorization" || !this.pendingProposal) {
      throw new Error("Nenhuma proposta aguardando autorização para ser executada.");
    }

    // Isola e consome a proposta previamente aprovada para impedir replay ou repetição
    const approvedAction: CognitiveProposal = { ...this.pendingProposal };
    this.pendingProposal = null;

    this.setState("executing");
    try {
      await executor(approvedAction);
      this.setState("completed");
      const successMessage = `Ação “${approvedAction.label}” foi autorizada e executada com sucesso.`;

      // Registra o resultado da execução controlada
      this.lastExecution = {
        proposal: approvedAction,
        success: true,
        message: successMessage,
        timestamp: new Date().toISOString(),
      };

      return {
        success: true,
        message: successMessage,
        proposal: approvedAction,
      };
    } catch (err) {
      this.setState("error");
      const errorMessage = err instanceof Error ? err.message : "Erro durante a execução da ação autorizada.";

      // Registra a falha e garante que a ação não seja repetida automaticamente
      this.lastExecution = {
        proposal: approvedAction,
        success: false,
        message: errorMessage,
        timestamp: new Date().toISOString(),
        error: errorMessage,
      };

      return {
        success: false,
        message: errorMessage,
        proposal: approvedAction,
      };
    }
  }

  public cancel(): { success: boolean; message: string } {
    if (!this.pendingProposal) {
      this.setState("idle");
      return { success: true, message: "Nenhuma ação pendente para cancelar." };
    }
    const label = this.pendingProposal.label;
    this.pendingProposal = null;
    this.setState("idle");
    return {
      success: true,
      message: `Ação “${label}” foi cancelada pelo usuário. Nenhuma alteração foi realizada.`,
    };
  }

  public reset(): void {
    this.pendingProposal = null;
    this.pendingPlan = null;
    this.setState("idle");
  }
}

