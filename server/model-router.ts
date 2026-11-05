/**
 * IRIS 5.4 - AI MODEL ROUTER
 *
 * Camada inteligente que escolhe automaticamente a melhor estratégia de IA para cada comando.
 *
 * REQUISITOS FUNDAMENTAIS:
 * 1. Classificação de complexidade: simples, média, complexa.
 * 2. Priorização contínua de opção gratuita/local quando adequada.
 * 3. NUNCA habilitar ou utilizar API paga automaticamente.
 * 4. Fallback seguro quando o modelo principal estiver indisponível.
 * 5. Recepção estrita de: intenção, risco, complexidade, contexto, necessidade de ferramentas.
 * 6. Decisão estruturada: modelo/estratégia escolhida, motivo, custo estimado, fallback.
 * 7. Isolamento de autoridade: o Router SOMENTE decide a estratégia/modelo; NÃO executa ações protegidas.
 * 8. Compatibilidade retroativa integral com o ecossistema IRIS.
 */

export type ModelProvider = "manus" | "chatgpt" | "gemini" | "kimi";

export type TaskComplexity = "simples" | "média" | "complexa";

export type AiStrategy =
  | "local_fast"
  | "local_balanced"
  | "local_reasoning"
  | "external_vision"
  | "external_reasoning";

export type RoutingTask =
  | "chat"
  | "simple_query"
  | "complex_code"
  | "large_document"
  | "sensitive_task"
  | "planning"
  | "document"
  | "multimodal"
  | "high_risk";

export interface RouterFallback {
  provider: ModelProvider;
  model?: string;
  strategy: AiStrategy;
  reason: string;
  estimatedCost: string;
}

export interface RouterDecision {
  provider: ModelProvider;
  model?: string;
  strategy: AiStrategy;
  reason: string;
  estimatedCost: string;
  fallback: RouterFallback;
  complexity: TaskComplexity;
  requiresConfirmation: boolean;
  isExternal: boolean;
  tier: "fast" | "appropriate" | "large_context" | "sensitive_confirmed";
}

export type ModelRoute = RouterDecision;

export interface AiRouterInput {
  intent: string;
  risk: "low" | "medium" | "high";
  complexity?: TaskComplexity;
  context?: {
    message?: string;
    hasAttachments?: boolean;
    attachmentCount?: number;
    recentMessagesCount?: number;
    memoryItemsCount?: number;
    activeTasksCount?: number;
    [key: string]: unknown;
  } | unknown;
  needsTools: boolean;
  requested?: ModelProvider | "auto";
  externalConsent?: boolean;
  hasApiKey?: boolean;
  hasAttachments?: boolean;
}

export interface ComplexityClassificationInput {
  intent?: string;
  risk?: "low" | "medium" | "high";
  context?: unknown;
  needsTools?: boolean;
  hasAttachments?: boolean;
  message?: string;
}

/**
 * 1. Classifica a complexidade da demanda em:
 * - "simples": consultas diretas, saudações, tarefas de baixa latência sem ferramentas.
 * - "média": atualizações, agendamentos, tarefas operacionais com 1 ferramenta ou risco médio.
 * - "complexa": tarefas com anexos/visão, alto risco, código complexo, planejamento profundo, mutações críticas.
 */
export function classifyComplexity(input: ComplexityClassificationInput): TaskComplexity {
  const msg = (input.message || (typeof input.context === "string" ? input.context : "")).toLowerCase();
  const rawIntent = (input.intent || "").toLowerCase();

  // 1. Complexa: anexos, documentos pesados, código ou alto risco
  if (input.hasAttachments) return "complexa";
  if (input.risk === "high") return "complexa";

  if (
    rawIntent === "exclusao" ||
    rawIntent === "envio" ||
    rawIntent === "compartilhamento" ||
    rawIntent === "envio/compartilhamento" ||
    rawIntent === "high_risk" ||
    rawIntent === "sensitive_task" ||
    rawIntent === "complex_code"
  ) {
    return "complexa";
  }

  if (
    /\b(codigo|programar|debug|funcao|algoritmo|refator|typescript|javascript|python|sql|schema|api|backend|frontend)\w*/i.test(msg) ||
    /\b(documento|contrato|pdf|laudo|exame|planilha|extrato|comprovante|relat[oó]rio)\w*/i.test(msg) ||
    /\b(planej|organiza[çc][ãa]o profunda|estrat[ée]gia|reconcilia[çc][ãa]o|auditoria completa)\w*/i.test(msg) ||
    /\b(comprar|pagamento|financeir|transferir|pix|senha|autoriz)\w*/i.test(msg)
  ) {
    return "complexa";
  }

  // Se o contexto contiver múltiplos passos ou múltiplos anexos
  if (typeof input.context === "object" && input.context !== null) {
    const ctx = input.context as Record<string, unknown>;
    if (Boolean(ctx.hasAttachments) || (typeof ctx.attachmentCount === "number" && ctx.attachmentCount > 0)) {
      return "complexa";
    }
  }

  // 2. Média: necessita de ferramentas, risco médio ou mutações moderadas
  if (input.risk === "medium") return "média";
  if (input.needsTools) return "média";

  if (
    rawIntent === "mutation" ||
    rawIntent === "alteracao" ||
    rawIntent === "criacao" ||
    rawIntent === "organizacao" ||
    rawIntent === "planning"
  ) {
    return "média";
  }

  if (
    /\b(adiar|mudar|alterar|modificar|postergar|remarcar|atualizar|concluir|finalizar)\w*/i.test(msg) ||
    /\b(cadastrar|adicionar|novo|nova|lembrar|lembrete|vence|vencimento|agendar)\w*/i.test(msg) ||
    /\b(comparar|evolu[çc][ãa]o|tend[êe]ncia)\w*/i.test(msg)
  ) {
    return "média";
  }

  // 3. Simples: perguntas gerais, leituras rápidas, saudações
  return "simples";
}

/**
 * AI MODEL ROUTER PRINCIPAL
 *
 * Recebe:
 * - intenção
 * - risco
 * - complexidade (se ausente, infere automaticamente)
 * - contexto
 * - necessidade de ferramentas
 *
 * Retorna uma decisão estruturada contendo:
 * - modelo/estratégia escolhida
 * - motivo
 * - custo estimado (garantia de R$ 0,00 ou chave própria do usuário)
 * - fallback seguro
 *
 * REGRA INEGOCIÁVEL:
 * - O Router SOMENTE decide estratégia e modelo. NUNCA executa ações protegidas.
 * - NUNCA habilita APIs pagas automaticamente.
 */
export function routeAiStrategy(input: AiRouterInput): RouterDecision {
  const contextMessage =
    typeof input.context === "string"
      ? input.context
      : typeof input.context === "object" && input.context !== null && "message" in input.context
      ? String((input.context as Record<string, unknown>).message || "")
      : "";

  const hasAttachments =
    Boolean(input.hasAttachments) ||
    (typeof input.context === "object" && input.context !== null && Boolean((input.context as Record<string, unknown>).hasAttachments));

  // 1. Determinação da complexidade (se não for explicitamente passada)
  const complexity: TaskComplexity =
    input.complexity ||
    classifyComplexity({
      intent: input.intent,
      risk: input.risk,
      context: input.context,
      needsTools: input.needsTools,
      hasAttachments,
      message: contextMessage,
    });

  const requested = input.requested || "auto";
  const externalConsent = Boolean(input.externalConsent);
  const hasApiKey = Boolean(input.hasApiKey);

  // Fallback padrão universal: modelo local seguro e gratuito
  const defaultLocalFallback: RouterFallback = {
    provider: "manus",
    strategy: "local_fast",
    reason: "Fallback local seguro com custo zero e alta disponibilidade.",
    estimatedCost: "R$ 0,00 (gratuito)",
  };

  const isSensitive = input.risk === "high" || input.intent === "exclusao" || input.intent === "envio" || input.intent === "sensitive_task" || input.intent === "high_risk";

  // CENÁRIO A: Usuário solicitou um modelo específico
  if (requested !== "auto") {
    if (requested === "manus") {
      return {
        provider: "manus",
        strategy: complexity === "complexa" ? "local_reasoning" : complexity === "média" ? "local_balanced" : "local_fast",
        reason: "Modelo local Manus selecionado pelo usuário (custo zero).",
        estimatedCost: "R$ 0,00 (gratuito)",
        fallback: defaultLocalFallback,
        complexity,
        requiresConfirmation: isSensitive,
        isExternal: false,
        tier: isSensitive ? "sensitive_confirmed" : "appropriate",
      };
    }

    // Provedor externo solicitado: exige consentimento explícito
    if (!externalConsent) {
      return {
        provider: "manus",
        strategy: "local_balanced",
        reason: "Provedor externo solicitado requer consentimento explícito do usuário. Roteado com segurança para o motor local gratuito.",
        estimatedCost: "R$ 0,00 (gratuito)",
        fallback: defaultLocalFallback,
        complexity,
        requiresConfirmation: isSensitive,
        isExternal: false,
        tier: isSensitive ? "sensitive_confirmed" : "fast",
      };
    }

    // Se o usuário solicitou externo e tem consentimento
    const externalModel =
      requested === "chatgpt" ? "gpt-5-mini" : requested === "gemini" ? "gemini-3-flash-preview" : undefined;

    return {
      provider: requested,
      model: externalModel,
      strategy: requested === "gemini" ? "external_vision" : "external_reasoning",
      reason: `Modelo externo ${requested} solicitado pelo usuário com consentimento.`,
      estimatedCost: "R$ 0,00 (chave própria do usuário)",
      fallback: {
        provider: "manus",
        strategy: "local_balanced",
        reason: "Fallback local seguro caso o provedor externo solicitado esteja indisponível.",
        estimatedCost: "R$ 0,00 (gratuito)",
      },
      complexity,
      requiresConfirmation: isSensitive,
      isExternal: true,
      tier: isSensitive ? "sensitive_confirmed" : "appropriate",
    };
  }

  // CENÁRIO B: Roteamento Automático inteligente ("auto")

  // 1. Complexidade SIMPLES -> Sempre modelo local gratuito (baixo consumo, latência mínima)
  if (complexity === "simples") {
    return {
      provider: "manus",
      strategy: "local_fast",
      reason: "Demanda simples: resolvida com motor local rápido, custo zero e alta disponibilidade.",
      estimatedCost: "R$ 0,00 (gratuito)",
      fallback: defaultLocalFallback,
      complexity: "simples",
      requiresConfirmation: false,
      isExternal: false,
      tier: "fast",
    };
  }

  // 2. Complexidade MÉDIA -> Modelo local balanceado gratuito
  if (complexity === "média") {
    return {
      provider: "manus",
      strategy: "local_balanced",
      reason: "Demanda de complexidade média: priorizada no motor local balanceado com custo zero.",
      estimatedCost: "R$ 0,00 (gratuito)",
      fallback: defaultLocalFallback,
      complexity: "média",
      requiresConfirmation: input.risk === "medium" || input.risk === "high",
      isExternal: false,
      tier: input.risk === "medium" || input.risk === "high" ? "sensitive_confirmed" : "appropriate",
    };
  }

  // 3. Complexidade COMPLEXA
  // REGRA DE OURO: NUNCA habilitar ou usar API externa paga automaticamente!
  // Se não houver consentimento explícito e chave própria, PERMANECE NO MOTOR LOCAL GRATUITO.
  if (!externalConsent || !hasApiKey) {
    return {
      provider: "manus",
      strategy: "local_reasoning",
      reason: isSensitive
        ? "Tarefa sensível/complexa mantida no motor local: APIs pagas nunca são acionadas automaticamente sem consentimento explícito e chave configurada."
        : "Tarefa complexa mantida no motor local: APIs pagas nunca são acionadas automaticamente sem consentimento explícito e chave configurada.",
      estimatedCost: "R$ 0,00 (gratuito)",
      fallback: {
        provider: "manus",
        strategy: "local_balanced",
        reason: "Fallback local balanceado para contingência.",
        estimatedCost: "R$ 0,00 (gratuito)",
      },
      complexity: "complexa",
      requiresConfirmation: isSensitive,
      isExternal: false,
      tier: isSensitive ? "sensitive_confirmed" : "appropriate",
    };
  }

  // Usuário possui consentimento externo E chave configurada
  // Casos multimodais ou documentos grandes -> Gemini
  if (hasAttachments || input.intent === "multimodal" || input.intent === "large_document") {
    return {
      provider: "gemini",
      model: "gemini-3-flash-preview",
      strategy: "external_vision",
      reason: "Anexo/documento complexo: roteado para visão e contexto expandido com chave própria do usuário.",
      estimatedCost: "R$ 0,00 (chave própria do usuário)",
      fallback: {
        provider: "manus",
        strategy: "local_reasoning",
        reason: "Fallback local seguro com custo zero em caso de falha na API de visão.",
        estimatedCost: "R$ 0,00 (gratuito)",
      },
      complexity: "complexa",
      requiresConfirmation: isSensitive,
      isExternal: true,
      tier: "large_context",
    };
  }

  // Casos analíticos ou sensíveis com consentimento -> ChatGPT
  return {
    provider: "chatgpt",
    model: "gpt-5-mini",
    strategy: "external_reasoning",
    reason: isSensitive
      ? "Tarefa de alto risco com consentimento: roteada com confirmação explícita obrigatória."
      : "Raciocínio complexo: roteado para processamento analítico com chave própria do usuário.",
    estimatedCost: "R$ 0,00 (chave própria do usuário)",
    fallback: {
      provider: "manus",
      strategy: "local_reasoning",
      reason: "Fallback local seguro com custo zero em caso de indisponibilidade externa.",
      estimatedCost: "R$ 0,00 (gratuito)",
    },
    complexity: "complexa",
    requiresConfirmation: isSensitive,
    isExternal: true,
    tier: isSensitive ? "sensitive_confirmed" : "appropriate",
  };
}

/**
 * Função utilitária de fallback seguro em tempo de execução.
 * Executa a chamada primária e, se falhar ou estiver indisponível, executa o fallback automaticamente.
 */
export async function executeWithRouterFallback<T>(
  decision: RouterDecision,
  primaryExecutor: (provider: ModelProvider, model?: string) => Promise<T>,
  fallbackExecutor?: (fallback: RouterFallback) => Promise<T>
): Promise<{
  result: T;
  usedFallback: boolean;
  provider: ModelProvider;
  model?: string;
  error?: string;
}> {
  try {
    const result = await primaryExecutor(decision.provider, decision.model);
    return {
      result,
      usedFallback: false,
      provider: decision.provider,
      model: decision.model,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (fallbackExecutor) {
      const fallbackResult = await fallbackExecutor(decision.fallback);
      return {
        result: fallbackResult,
        usedFallback: true,
        provider: decision.fallback.provider,
        model: decision.fallback.model,
        error: errorMsg,
      };
    }
    // Se não forneceu fallbackExecutor customizado, re-executa primaryExecutor com os parâmetros de fallback
    const fallbackResult = await primaryExecutor(decision.fallback.provider, decision.fallback.model);
    return {
      result: fallbackResult,
      usedFallback: true,
      provider: decision.fallback.provider,
      model: decision.fallback.model,
      error: errorMsg,
    };
  }
}

/**
 * Retrocompatibilidade: Função de Roteamento Legada
 * Mantém as assinaturas existentes para chamadas em routers.ts e testes existentes,
 * usando internamente a infraestrutura do AI Model Router.
 */
export function routeModel(input: {
  requested: ModelProvider | "auto";
  task: RoutingTask;
  hasAttachments: boolean;
  externalConsent: boolean;
  hasApiKey?: boolean;
}): RouterDecision {
  const isHighRisk = input.task === "sensitive_task" || input.task === "high_risk";
  const needsTools = isHighRisk || input.task === "planning";

  return routeAiStrategy({
    intent: input.task,
    risk: isHighRisk ? "high" : input.task === "planning" ? "medium" : "low",
    context: { message: input.task, hasAttachments: input.hasAttachments },
    needsTools,
    requested: input.requested,
    externalConsent: input.externalConsent,
    hasApiKey: input.hasApiKey ?? input.externalConsent, // Preserva compatibilidade quando não especificado
    hasAttachments: input.hasAttachments,
  });
}

/**
 * Retrocompatibilidade: Classificação de tarefa textual legada
 */
export function classifyRoutingTask(input: { message: string; hasAttachments: boolean }): RoutingTask {
  if (input.hasAttachments) return "multimodal";

  const msg = input.message.toLowerCase();

  // Tarefa sensível
  if (/\b(comprar|pagamento|financeir|contratar|excluir|deletar|apagar|enviar mensagem|transferir|pix|senha|autoriz)\w*/i.test(msg)) {
    return "sensitive_task";
  }

  // Código complexo
  if (/\b(codigo|programar|debug|funcao|algoritmo|refator|typescript|javascript|python|sql|schema|api|backend|frontend)\w*/i.test(msg)) {
    return "complex_code";
  }

  // Documento grande / exame
  if (/\b(documento|contrato|pdf|arquivo|relat[oó]rio|laudo|exame|planilha|extrato|comprovante)\w*/i.test(msg)) {
    return "large_document";
  }

  // Planejamento
  if (/\b(planej|organiza|viagem|estrat|compar|decid|roteiro|orçamento)\w*/i.test(msg)) {
    return "planning";
  }

  // Pergunta simples
  if (msg.length < 50 && /\b(que horas|bom dia|boa tarde|ola|oi|tudo bem|quem e|o que e|qual o)\b/i.test(msg)) {
    return "simple_query";
  }

  return "chat";
}
