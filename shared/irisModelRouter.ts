/**
 * IRIS 5.4 - AI MODEL ROUTER (FASE 4.2 - INTEGRAÇÃO E VALIDAÇÃO REAL)
 *
 * Camada independente e desacoplada entre a interpretação cognitiva e a execução.
 * O Router decide QUAL estratégia/modelo de IA é mais adequada para cada solicitação,
 * mas NUNCA executa ações protegidas nem ativa serviços pagos automaticamente.
 *
 * PILARES FUNDAMENTAIS:
 * 1. CLASSIFICAÇÃO AUTOMÁTICA DE COMPLEXIDADE: SIMPLES, MÉDIA, COMPLEXA.
 * 2. ESTRATÉGIA FREE-FIRST INVIOLÁVEL:
 *    1º LOCAL / GRATUITO
 *    2º MODELO GRATUITO DISPONÍVEL
 *    3º FREE TIER
 *    4º MODELO MAIS ECONÔMICO (com chave própria)
 *    5º MODELO MAIS CAPAZ SOMENTE QUANDO ESTRITAMENTE NECESSÁRIO
 * 3. IRIS COST GUARD (PROTEÇÃO EXPLÍCITA CONTRA CUSTOS):
 *    🟢 LOCAL: permitido
 *    🟢 GRATUITO: permitido
 *    🟢 FREE TIER: permitido
 *    🟡 CRÉDITO PROMOCIONAL: somente se explicitamente autorizado
 *    🔴 PAGO: BLOQUEADO por padrão ("Recurso pago bloqueado pelo IRIS Cost Guard.")
 * 4. SEGURANÇA FINANCEIRA TOTAL:
 *    NUNCA habilitar cobrança automaticamente.
 *    NUNCA criar API paga automaticamente.
 *    NUNCA alterar configuração de faturamento.
 * 5. ISOLAMENTO DE EXECUÇÃO:
 *    Model Router ≠ Executor. O Router apenas decide. Nenhuma decisão executa ações protegidas.
 * 6. FALLBACK SEGURO:
 *    Modelo gratuito disponível → fallback gratuito → recurso indisponível.
 *    Se somente opção paga existir → BLOQUEAR.
 * 7. OBSERVABILIDADE ESTRUTURADA:
 *    Registro seguro das decisões (timestamp, intenção, complexidade, risco, estratégia, modelo, custo, fallback, resultado).
 */

export type ModelComplexity = "SIMPLES" | "MÉDIA" | "COMPLEXA";

export type ModelStrategy =
  | "local_fast"
  | "local_balanced"
  | "local_reasoning"
  | "free_tier"
  | "economic_cloud"
  | "capable_cloud"
  | "unavailable";

export type ModelCostLevel =
  | "free_local"
  | "free_tier"
  | "low_cost"
  | "high_capability"
  | "zero";

/**
 * Níveis do IRIS Cost Guard
 */
export type CostGuardTier =
  | "local"               // 🟢 LOCAL (Permitido)
  | "free"                // 🟢 GRATUITO (Permitido)
  | "free_tier"           // 🟢 FREE TIER (Permitido)
  | "promotional_credit"  // 🟡 CRÉDITO PROMOCIONAL (Somente se explicitamente autorizado)
  | "paid";               // 🔴 PAGO (BLOQUEADO por padrão)

export interface CostGuardEvaluation {
  allowed: boolean;
  tier: CostGuardTier;
  symbol: "🟢" | "🟡" | "🔴";
  status: "allowed" | "blocked";
  reason: string;
}

export interface RouterObservabilityRecord {
  timestamp: string;
  intent: string;
  complexity: ModelComplexity;
  risk: "low" | "medium" | "high";
  strategy: ModelStrategy;
  model: string;
  estimatedCost: number;
  fallback: string;
  decisionResult: "allowed" | "blocked" | "unavailable";
}

export interface ModelFallback {
  strategy: ModelStrategy;
  model: string;
  costLevel: ModelCostLevel;
  estimatedCost: number;
  reason: string;
  available: boolean;
  toString?: () => string;
}

export interface ModelRouterInput {
  command?: string;
  intent?: string;
  risk?: "low" | "medium" | "high";
  complexity?: ModelComplexity | "MEDIA" | "SIMPLES" | "COMPLEXA" | string;
  context?: unknown;
  needsTools?: boolean;
  needsReasoning?: boolean;
  modality?: {
    needsVision?: boolean;
    needsVoice?: boolean;
    needsDocuments?: boolean;
    attachmentsCount?: number;
  };
  toolsRequired?: string[];
  toolsCount?: number;
  stepsCount?: number;
  userConsentExternal?: boolean;
  hasApiKey?: boolean;
  userAllowedPaid?: boolean;
  promotionalCreditAuthorized?: boolean;
  strictCostGuardBlock?: boolean;
  availableModels?: Record<string, boolean> | Array<{ id: string; available: boolean }>;
  forceModel?: string;
  requestedProvider?: string;
}

export interface ModelRouterDecision {
  status: "allowed" | "blocked" | "unavailable";
  strategy: ModelStrategy;
  model: string;
  complexity: ModelComplexity;
  risk: "low" | "medium" | "high";
  reason: string;
  estimatedCost: number;
  confidence: number;
  fallback: ModelFallback;
  toolsRequired: string[];
  authorizationRequired: boolean;
  isUnavailable?: boolean;
  isBlocked?: boolean;
  costGuardTier?: CostGuardTier;
  billingNotice: string;
}

export interface ComplexityClassificationInput {
  command?: string;
  intent?: string;
  risk?: "low" | "medium" | "high";
  context?: unknown;
  needsTools?: boolean;
  needsReasoning?: boolean;
  toolsCount?: number;
  stepsCount?: number;
  hasAttachments?: boolean;
  needsVision?: boolean;
  needsDocuments?: boolean;
}

export const BILLING_NOTICE_SECURE =
  "Faturamento automático desativado por design. A IRIS opera sob a diretriz Free-First e nunca ativa APIs pagas automaticamente.";

export const COST_GUARD_BLOCKED_REASON = "Recurso pago bloqueado pelo IRIS Cost Guard.";

// Catálogo padrão de modelos Free-First da IRIS
export const DEFAULT_FREE_MODELS = {
  LOCAL_FAST: "iris-local-fast",
  LOCAL_BALANCED: "iris-local-balanced",
  LOCAL_REASONING: "iris-local-reasoning",
  FREE_TIER_CLOUD: "gemini-1.5-flash-free",
} as const;

export const DEFAULT_EXTERNAL_MODELS = {
  ECONOMIC: "gpt-4o-mini",
  CAPABLE: "gpt-4o",
  ADVANCED_VISION: "gemini-1.5-pro",
} as const;

/**
 * IRIS COST GUARD (Proteção explícita de custos)
 *
 * Avalia se um modelo ou estratégia é permitido:
 * 🟢 LOCAL -> permitido
 * 🟢 GRATUITO -> permitido
 * 🟢 FREE TIER -> permitido
 * 🟡 CRÉDITO PROMOCIONAL -> permitido somente se explicitamente autorizado
 * 🔴 PAGO -> BLOQUEADO por padrão
 */
export class IrisCostGuard {
  public static evaluate(
    modelOrStrategy: string,
    options?: {
      promotionalCreditAuthorized?: boolean;
      userAllowedPaid?: boolean;
    }
  ): CostGuardEvaluation {
    const raw = (modelOrStrategy || "").toLowerCase();

    // 🟢 LOCAL
    if (
      raw.includes("local") ||
      raw.startsWith("iris-local") ||
      raw === "manus" ||
      raw === "local_fast" ||
      raw === "local_balanced" ||
      raw === "local_reasoning"
    ) {
      return {
        allowed: true,
        tier: "local",
        symbol: "🟢",
        status: "allowed",
        reason: "🟢 Recurso local com custo zero e execução segura.",
      };
    }

    // 🟢 GRATUITO / FREE TIER
    if (
      raw.includes("free") ||
      raw.includes("gratuito") ||
      raw === "free_tier" ||
      raw === "gemini-1.5-flash-free"
    ) {
      return {
        allowed: true,
        tier: "free_tier",
        symbol: "🟢",
        status: "allowed",
        reason: "🟢 Modelo de camada gratuita (Free Tier) permitido sem faturamento.",
      };
    }

    // 🟡 CRÉDITO PROMOCIONAL
    if (raw.includes("promo") || raw.includes("credit") || raw.includes("trial")) {
      if (options?.promotionalCreditAuthorized) {
        return {
          allowed: true,
          tier: "promotional_credit",
          symbol: "🟡",
          status: "allowed",
          reason: "🟡 Crédito promocional explicitamente autorizado pelo usuário.",
        };
      }
      return {
        allowed: false,
        tier: "promotional_credit",
        symbol: "🟡",
        status: "blocked",
        reason: COST_GUARD_BLOCKED_REASON,
      };
    }

    // 🔴 PAGO (BLOQUEADO POR PADRÃO)
    return {
      allowed: false,
      tier: "paid",
      symbol: "🔴",
      status: "blocked",
      reason: COST_GUARD_BLOCKED_REASON,
    };
  }

  public static isAllowed(
    modelOrStrategy: string,
    options?: { promotionalCreditAuthorized?: boolean }
  ): boolean {
    return IrisCostGuard.evaluate(modelOrStrategy, options).allowed;
  }
}

/**
 * Normaliza complexidade para "SIMPLES" | "MÉDIA" | "COMPLEXA"
 */
export function normalizeComplexity(raw?: string): ModelComplexity | undefined {
  if (!raw) return undefined;
  const upper = raw.trim().toUpperCase();
  if (upper === "SIMPLES" || upper === "SIMPLE") return "SIMPLES";
  if (upper === "MÉDIA" || upper === "MEDIA" || upper === "MEDIUM") return "MÉDIA";
  if (upper === "COMPLEXA" || upper === "COMPLEX") return "COMPLEXA";
  return undefined;
}

/**
 * Classifica automaticamente a complexidade da solicitação:
 *
 * SIMPLES:
 * - perguntas simples
 * - cálculos
 * - consultas diretas
 * - pequenas transformações
 *
 * MÉDIA:
 * - análise de documentos
 * - planejamento
 * - comparação
 * - tarefas com múltiplas etapas
 *
 * COMPLEXA:
 * - planejamento complexo
 * - análise profunda
 * - múltiplos agentes/ferramentas
 * - tarefas que exigem raciocínio extenso
 */
export function classifyModelComplexity(input: ComplexityClassificationInput | string): ModelComplexity {
  if (typeof input === "string") {
    return classifyModelComplexity({ command: input });
  }

  const rawCmd = input.command || "";
  const lower = rawCmd.toLowerCase();
  const rawIntent = (input.intent || "").toLowerCase();
  const risk = input.risk || "low";

  // 1. COMPLEXA
  // Múltiplos agentes ou múltiplas ferramentas combinadas com raciocínio profundo explícito
  const hasMultipleTools = (input.toolsCount ?? 0) > 1;
  const deepReasoningRequested = input.needsReasoning === true;

  if (deepReasoningRequested && hasMultipleTools) {
    return "COMPLEXA";
  }

  if (
    risk === "high" ||
    rawIntent === "exclusao" ||
    rawIntent === "envio" ||
    rawIntent === "compartilhamento" ||
    rawIntent === "envio/compartilhamento" ||
    rawIntent === "high_risk"
  ) {
    return "COMPLEXA";
  }

  // Padrões explícitos de complexidade alta
  const isComplexPlanning =
    /\b(planejamento complexo|planejar detalhadamente|plano estratégico|estratégia complexa)\b/i.test(lower) ||
    /\b(racioc[íi]nio extenso|racioc[íi]nio profundo|an[áa]lise profunda|diagn[óo]stico profundo)\b/i.test(lower) ||
    /\b(m[úu]ltiplos agentes|orquestra[çc][ãa]o|reconcilia[çc][ãa]o financeira|auditoria completa)\b/i.test(lower) ||
    /\b(refatora[çc][ãa]o completa|arquitetura de sistemas|c[óo]digo complexo)\b/i.test(lower) ||
    /\b(v[áa]rios documentos|m[úu]ltiplos documentos|inconsist[êe]ncias)\b/i.test(lower) ||
    (/\b(analis(e|ar)|examinar)\b/i.test(lower) && /\b(relat[óo]rio|auditoria|inconsist)\b/i.test(lower) && /\b(documentos?)\b/i.test(lower));

  if (isComplexPlanning) {
    return "COMPLEXA";
  }

  if (input.needsVision && (input.hasAttachments || input.needsDocuments)) {
    return "COMPLEXA";
  }

  // 2. MÉDIA
  // Análise de documentos, planejamento básico, comparação, tarefas com múltiplas etapas
  const isDocAnalysis =
    /\b(an[áa]lise de documentos?|analis(e|ar) documentos?|ler contratos?|resumir pdf|analis(e|ar) relat[óo]rios?|ap[óo]lice|laudo|exame m[ée]dico|dois documentos)\b/i.test(lower) ||
    input.needsDocuments === true;

  const isPlanning =
    /\b(planejar|planejamento|organizar minha semana|organizar semana|cronograma|roteiro|estruturar plano)\b/i.test(lower);

  const isComparison =
    /\b(comparar?|compare|compara[çc][ãa]o|diferen[çc]as?|evolu[çc][ãa]o|tend[êe]ncia|hist[óo]rico)\b/i.test(lower);

  const isMultiStep =
    /\b(m[úu]ltiplas etapas|passo a passo|etapas|sequ[êe]ncia)\b/i.test(lower) ||
    (input.stepsCount ?? 0) > 1;

  const isModerateMutation =
    rawIntent === "alteracao" ||
    rawIntent === "criacao" ||
    rawIntent === "organizacao" ||
    rawIntent === "mutation" ||
    risk === "medium" ||
    Boolean(input.needsTools);

  if (isDocAnalysis || isPlanning || isComparison || isMultiStep || isModerateMutation) {
    return "MÉDIA";
  }

  // 3. SIMPLES
  // Perguntas simples, cálculos, consultas diretas, pequenas transformações
  return "SIMPLES";
}

/**
 * Cria um objeto fallback tipado e compatível
 */
function createFallback(
  strategy: ModelStrategy,
  model: string,
  costLevel: ModelCostLevel,
  reason: string,
  available: boolean = true
): ModelFallback {
  const fb: ModelFallback = {
    strategy,
    model,
    costLevel,
    estimatedCost: 0, // Fallback da IRIS sempre prioriza custo zero
    reason,
    available,
  };
  fb.toString = () => `${model} (${strategy}) - Custo: R$ 0,00 [Disponível: ${available ? "Sim" : "Não"}]`;
  return fb;
}

/**
 * IA MODEL ROUTER PRINCIPAL (FASE 4.2)
 *
 * Recebe:
 * - intenção
 * - comando original
 * - risco
 * - complexidade
 * - contexto
 * - necessidade de ferramentas
 * - necessidade de raciocínio
 * - necessidade de visão/voz/documentos
 *
 * Retorna uma decisão estruturada contendo:
 * - status: "allowed" | "blocked" | "unavailable"
 * - estratégia escolhida
 * - modelo recomendado
 * - complexidade
 * - nível de risco
 * - justificativa
 * - custo estimado (0 para gratuito/local)
 * - nível de confiança
 * - fallback seguro
 * - ferramentas necessárias
 * - autorização necessária
 */
export function routeAiModel(input: ModelRouterInput): ModelRouterDecision {
  const rawCmd = input.command || "";
  const lower = rawCmd.toLowerCase();
  const rawIntent = (input.intent || "").toLowerCase();
  const risk = input.risk || "low";

  // Identifica ferramentas necessárias com base na intenção e comando
  const toolsRequired: string[] = [...(input.toolsRequired || [])];
  if (input.needsTools && toolsRequired.length === 0) {
    if (rawIntent === "exclusao" || /\b(excluir|apagar|deletar)\b/i.test(lower)) {
      toolsRequired.push("radar.delete");
    } else if (rawIntent === "criacao" || rawIntent === "alteracao" || rawIntent === "organizacao") {
      toolsRequired.push("radar.write");
    } else if (rawIntent === "envio" || rawIntent === "compartilhamento" || rawIntent === "envio/compartilhamento") {
      toolsRequired.push("communication.send");
    } else if (rawIntent === "analise" || /\b(analis|diagn[óo]stic)\b/i.test(lower)) {
      toolsRequired.push("analytics.summary");
    } else {
      toolsRequired.push("radar.read");
    }
  }

  // 1. CLASSIFICAÇÃO AUTOMÁTICA DE COMPLEXIDADE (se não fornecida)
  const complexity: ModelComplexity =
    normalizeComplexity(input.complexity) ||
    classifyModelComplexity({
      command: input.command,
      intent: input.intent,
      risk: input.risk,
      context: input.context,
      needsTools: input.needsTools || toolsRequired.length > 0,
      needsReasoning: input.needsReasoning,
      toolsCount: toolsRequired.length,
      stepsCount: input.stepsCount,
      hasAttachments: Boolean(input.modality?.attachmentsCount),
      needsVision: Boolean(input.modality?.needsVision),
      needsDocuments: Boolean(input.modality?.needsDocuments),
    });

  // Determinação de necessidade de autorização (segurança e integridade)
  const authorizationRequired =
    risk === "high" ||
    risk === "medium" ||
    rawIntent === "exclusao" ||
    rawIntent === "alteracao" ||
    rawIntent === "criacao" ||
    rawIntent === "organizacao" ||
    rawIntent === "envio" ||
    rawIntent === "compartilhamento" ||
    rawIntent === "envio/compartilhamento" ||
    rawIntent === "mutation";

  // Verificação de disponibilidade de modelos
  const isAvailable = (modelId: string): boolean => {
    if (!input.availableModels) return true;
    if (Array.isArray(input.availableModels)) {
      const found = input.availableModels.find((m) => m.id === modelId);
      return found ? found.available : true;
    }
    if (typeof input.availableModels === "object" && input.availableModels !== null) {
      const val = (input.availableModels as Record<string, boolean>)[modelId];
      return val !== undefined ? val : true;
    }
    return true;
  };

  // =========================================================================
  // IRIS COST GUARD: VERIFICAÇÃO DE MODELOS EXCLUSIVAMENTE PAGOS
  // =========================================================================
  const hasFreeLocalFast = isAvailable(DEFAULT_FREE_MODELS.LOCAL_FAST);
  const hasFreeLocalBalanced = isAvailable(DEFAULT_FREE_MODELS.LOCAL_BALANCED);
  const hasFreeLocalReasoning = isAvailable(DEFAULT_FREE_MODELS.LOCAL_REASONING);
  const hasFreeTierCloud = isAvailable(DEFAULT_FREE_MODELS.FREE_TIER_CLOUD);
  const anyFreeAvailable =
    hasFreeLocalFast || hasFreeLocalBalanced || hasFreeLocalReasoning || hasFreeTierCloud;

  // Se nenhum modelo gratuito estiver disponível, verificar se somente opções pagas foram configuradas
  let hasOnlyPaidAvailable = false;
  if (!anyFreeAvailable && input.availableModels) {
    if (Array.isArray(input.availableModels)) {
      hasOnlyPaidAvailable = input.availableModels.some(
        (m) => m.available && !IrisCostGuard.evaluate(m.id).allowed
      );
    } else if (typeof input.availableModels === "object") {
      hasOnlyPaidAvailable = Object.entries(input.availableModels).some(
        ([id, avail]) => avail && !IrisCostGuard.evaluate(id).allowed
      );
    }
  }

  // REGRA COST GUARD: Se somente opção paga existir -> BLOQUEAR!
  if (!anyFreeAvailable && hasOnlyPaidAvailable) {
    return {
      status: "blocked",
      strategy: "unavailable",
      model: "none",
      complexity,
      risk,
      reason: COST_GUARD_BLOCKED_REASON,
      estimatedCost: 0,
      confidence: 0,
      fallback: createFallback(
        "unavailable",
        "none",
        "free_local",
        COST_GUARD_BLOCKED_REASON,
        false
      ),
      toolsRequired,
      authorizationRequired: false,
      isUnavailable: true,
      isBlocked: true,
      costGuardTier: "paid",
      billingNotice: BILLING_NOTICE_SECURE,
    };
  }

  // =========================================================================
  // PROTEÇÃO CONTRA SELEÇÃO AUTOMÁTICA DE SERVIÇOS PAGOS / BILLING
  // =========================================================================
  const forceRequested = input.forceModel || input.requestedProvider;

  // Bloqueio estrito quando solicitado modelo pago via strictCostGuardBlock
  if (
    input.strictCostGuardBlock &&
    forceRequested &&
    !IrisCostGuard.evaluate(forceRequested, {
      promotionalCreditAuthorized: input.promotionalCreditAuthorized,
    }).allowed
  ) {
    return {
      status: "blocked",
      strategy: "unavailable",
      model: "none",
      complexity,
      risk,
      reason: COST_GUARD_BLOCKED_REASON,
      estimatedCost: 0,
      confidence: 0,
      fallback: createFallback(
        "unavailable",
        "none",
        "free_local",
        COST_GUARD_BLOCKED_REASON,
        false
      ),
      toolsRequired,
      authorizationRequired: false,
      isUnavailable: true,
      isBlocked: true,
      costGuardTier: "paid",
      billingNotice: BILLING_NOTICE_SECURE,
    };
  }

  const isPaidServiceAttempt =
    Boolean(forceRequested && !forceRequested.includes("local") && !forceRequested.includes("free"));

  // Se houver tentativa de selecionar serviço pago sem chave própria e consentimento:
  if (isPaidServiceAttempt && (!input.userConsentExternal || !input.hasApiKey)) {
    const fallbackModel = isAvailable(DEFAULT_FREE_MODELS.LOCAL_BALANCED)
      ? DEFAULT_FREE_MODELS.LOCAL_BALANCED
      : DEFAULT_FREE_MODELS.LOCAL_FAST;

    return {
      status: "allowed",
      strategy: "local_balanced",
      model: fallbackModel,
      complexity,
      risk,
      reason:
        "Tentativa de selecionar serviço pago bloqueada pela política Free-First da IRIS (IRIS Cost Guard). APIs pagas nunca são acionadas sem consentimento explícito e chave própria do usuário. Roteado para o motor local gratuito.",
      estimatedCost: 0,
      confidence: 0.94,
      fallback: createFallback(
        "local_fast",
        DEFAULT_FREE_MODELS.LOCAL_FAST,
        "free_local",
        "Fallback local de contingência imediata com custo zero."
      ),
      toolsRequired,
      authorizationRequired,
      isBlocked: false,
      costGuardTier: "local",
      billingNotice: BILLING_NOTICE_SECURE,
    };
  }

  // =========================================================================
  // ESTRATÉGIA FREE-FIRST: SELEÇÃO DETERMINÍSTICA DO MODELO ESTRATÉGICO
  // =========================================================================

  // Caso A: Tarefa SIMPLES (perguntas simples, cálculos, consultas diretas, pequenas transformações)
  if (complexity === "SIMPLES") {
    // 1º Local Fast
    if (isAvailable(DEFAULT_FREE_MODELS.LOCAL_FAST)) {
      const fbModel = isAvailable(DEFAULT_FREE_MODELS.LOCAL_BALANCED)
        ? DEFAULT_FREE_MODELS.LOCAL_BALANCED
        : DEFAULT_FREE_MODELS.FREE_TIER_CLOUD;
      const fbStrategy = isAvailable(DEFAULT_FREE_MODELS.LOCAL_BALANCED)
        ? "local_balanced"
        : "free_tier";

      return {
        status: "allowed",
        strategy: "local_fast",
        model: DEFAULT_FREE_MODELS.LOCAL_FAST,
        complexity: "SIMPLES",
        risk,
        reason:
          "Tarefa simples (consulta, cálculo ou transformação direta): atendida com motor local rápido, custo zero e resposta imediata.",
        estimatedCost: 0,
        confidence: 0.98,
        fallback: createFallback(
          fbStrategy,
          fbModel,
          fbStrategy === "local_balanced" ? "free_local" : "free_tier",
          "Fallback gratuito disponível caso o motor local rápido oscile."
        ),
        toolsRequired,
        authorizationRequired,
        isBlocked: false,
        costGuardTier: "local",
        billingNotice: BILLING_NOTICE_SECURE,
      };
    }

    // Fallback 1: Local Balanced
    if (isAvailable(DEFAULT_FREE_MODELS.LOCAL_BALANCED)) {
      return {
        status: "allowed",
        strategy: "local_balanced",
        model: DEFAULT_FREE_MODELS.LOCAL_BALANCED,
        complexity: "SIMPLES",
        risk,
        reason:
          "Motor local rápido indisponível. Fallback seguro para o motor local balanceado com custo zero mantido.",
        estimatedCost: 0,
        confidence: 0.95,
        fallback: createFallback(
          "free_tier",
          DEFAULT_FREE_MODELS.FREE_TIER_CLOUD,
          "free_tier",
          "Fallback secundário na camada gratuita em nuvem."
        ),
        toolsRequired,
        authorizationRequired,
        isBlocked: false,
        costGuardTier: "local",
        billingNotice: BILLING_NOTICE_SECURE,
      };
    }

    // Fallback 2: Free Tier
    if (isAvailable(DEFAULT_FREE_MODELS.FREE_TIER_CLOUD)) {
      return {
        status: "allowed",
        strategy: "free_tier",
        model: DEFAULT_FREE_MODELS.FREE_TIER_CLOUD,
        complexity: "SIMPLES",
        risk,
        reason:
          "Motores locais indisponíveis. Roteado para modelo em nuvem de camada gratuita sem cobrança.",
        estimatedCost: 0,
        confidence: 0.92,
        fallback: createFallback(
          "unavailable",
          "none",
          "free_local",
          "Nenhum outro modelo gratuito disponível.",
          false
        ),
        toolsRequired,
        authorizationRequired,
        isBlocked: false,
        costGuardTier: "free_tier",
        billingNotice: BILLING_NOTICE_SECURE,
      };
    }

    return createUnavailableDecision(complexity, risk, toolsRequired, authorizationRequired);
  }

  // Caso B: Tarefa MÉDIA (análise de documentos, planejamento, comparação, múltiplas etapas)
  if (complexity === "MÉDIA") {
    // Se precisar de visão ou documentos especiais e tiver anexo
    if (input.modality?.needsVision && isAvailable(DEFAULT_FREE_MODELS.FREE_TIER_CLOUD)) {
      return {
        status: "allowed",
        strategy: "free_tier",
        model: DEFAULT_FREE_MODELS.FREE_TIER_CLOUD,
        complexity: "MÉDIA",
        risk,
        reason:
          "Tarefa de visão e documentos: roteada para modelo de camada gratuita em nuvem com custo zero.",
        estimatedCost: 0,
        confidence: 0.95,
        fallback: createFallback(
          "local_balanced",
          DEFAULT_FREE_MODELS.LOCAL_BALANCED,
          "free_local",
          "Fallback local balanceado para contingência."
        ),
        toolsRequired,
        authorizationRequired,
        isBlocked: false,
        costGuardTier: "free_tier",
        billingNotice: BILLING_NOTICE_SECURE,
      };
    }

    // 1º Local Balanced
    if (isAvailable(DEFAULT_FREE_MODELS.LOCAL_BALANCED)) {
      const fbModel = isAvailable(DEFAULT_FREE_MODELS.LOCAL_REASONING)
        ? DEFAULT_FREE_MODELS.LOCAL_REASONING
        : DEFAULT_FREE_MODELS.LOCAL_FAST;
      const fbStrategy = isAvailable(DEFAULT_FREE_MODELS.LOCAL_REASONING)
        ? "local_reasoning"
        : "local_fast";

      return {
        status: "allowed",
        strategy: "local_balanced",
        model: DEFAULT_FREE_MODELS.LOCAL_BALANCED,
        complexity: "MÉDIA",
        risk,
        reason:
          "Tarefa de complexidade média (planejamento, análise operacional ou comparação): processada com motor local balanceado e custo zero.",
        estimatedCost: 0,
        confidence: 0.95,
        fallback: createFallback(
          fbStrategy,
          fbModel,
          "free_local",
          "Fallback local gratuito com capacidade cognitiva adequada."
        ),
        toolsRequired,
        authorizationRequired,
        isBlocked: false,
        costGuardTier: "local",
        billingNotice: BILLING_NOTICE_SECURE,
      };
    }

    // Fallback 1: Local Reasoning
    if (isAvailable(DEFAULT_FREE_MODELS.LOCAL_REASONING)) {
      return {
        status: "allowed",
        strategy: "local_reasoning",
        model: DEFAULT_FREE_MODELS.LOCAL_REASONING,
        complexity: "MÉDIA",
        risk,
        reason:
          "Motor balanceado indisponível. Fallback seguro para o motor local de raciocínio profundo com custo zero mantido.",
        estimatedCost: 0,
        confidence: 0.94,
        fallback: createFallback(
          "local_fast",
          DEFAULT_FREE_MODELS.LOCAL_FAST,
          "free_local",
          "Fallback local de contingência rápida."
        ),
        toolsRequired,
        authorizationRequired,
        isBlocked: false,
        costGuardTier: "local",
        billingNotice: BILLING_NOTICE_SECURE,
      };
    }

    // Fallback 2: Free Tier
    if (isAvailable(DEFAULT_FREE_MODELS.FREE_TIER_CLOUD)) {
      return {
        status: "allowed",
        strategy: "free_tier",
        model: DEFAULT_FREE_MODELS.FREE_TIER_CLOUD,
        complexity: "MÉDIA",
        risk,
        reason:
          "Motores locais balanceados indisponíveis. Fallback para camada gratuita em nuvem com custo zero.",
        estimatedCost: 0,
        confidence: 0.92,
        fallback: createFallback(
          "unavailable",
          "none",
          "free_local",
          "Nenhuma outra alternativa gratuita disponível.",
          false
        ),
        toolsRequired,
        authorizationRequired,
        isBlocked: false,
        costGuardTier: "free_tier",
        billingNotice: BILLING_NOTICE_SECURE,
      };
    }

    return createUnavailableDecision(complexity, risk, toolsRequired, authorizationRequired);
  }

  // Caso C: Tarefa COMPLEXA (planejamento complexo, análise profunda, múltiplos agentes, raciocínio extenso)
  // 1º Prioridade Free-First: Local Reasoning
  if (isAvailable(DEFAULT_FREE_MODELS.LOCAL_REASONING)) {
    const fbModel = isAvailable(DEFAULT_FREE_MODELS.LOCAL_BALANCED)
      ? DEFAULT_FREE_MODELS.LOCAL_BALANCED
      : DEFAULT_FREE_MODELS.FREE_TIER_CLOUD;
    const fbStrategy = isAvailable(DEFAULT_FREE_MODELS.LOCAL_BALANCED)
      ? "local_balanced"
      : "free_tier";

    return {
      status: "allowed",
      strategy: "local_reasoning",
      model: DEFAULT_FREE_MODELS.LOCAL_REASONING,
      complexity: "COMPLEXA",
      risk,
      reason:
        "Demanda complexa (raciocínio extenso, múltiplos agentes ou análise profunda): roteada prioritariamente para o motor local de raciocínio profundo com custo zero.",
      estimatedCost: 0,
      confidence: 0.92,
      fallback: createFallback(
        fbStrategy,
        fbModel,
        fbStrategy === "local_balanced" ? "free_local" : "free_tier",
        "Fallback gratuito com alta estabilidade caso o raciocínio local oscile."
      ),
      toolsRequired,
      authorizationRequired,
      isBlocked: false,
      costGuardTier: "local",
      billingNotice: BILLING_NOTICE_SECURE,
    };
  }

  // Fallback 1: Local Balanced
  if (isAvailable(DEFAULT_FREE_MODELS.LOCAL_BALANCED)) {
    return {
      status: "allowed",
      strategy: "local_balanced",
      model: DEFAULT_FREE_MODELS.LOCAL_BALANCED,
      complexity: "COMPLEXA",
      risk,
      reason:
        "Motor de raciocínio profundo indisponível. Fallback gratuito para o motor local balanceado.",
      estimatedCost: 0,
      confidence: 0.88,
      fallback: createFallback(
        "free_tier",
        DEFAULT_FREE_MODELS.FREE_TIER_CLOUD,
        "free_tier",
        "Fallback secundário na camada gratuita em nuvem."
      ),
      toolsRequired,
      authorizationRequired,
      isBlocked: false,
      costGuardTier: "local",
      billingNotice: BILLING_NOTICE_SECURE,
    };
  }

  // Fallback 2: Free Tier Cloud
  if (isAvailable(DEFAULT_FREE_MODELS.FREE_TIER_CLOUD)) {
    return {
      status: "allowed",
      strategy: "free_tier",
      model: DEFAULT_FREE_MODELS.FREE_TIER_CLOUD,
      complexity: "COMPLEXA",
      risk,
      reason:
        "Motores locais indisponíveis. Fallback seguro para modelo gratuito em nuvem sem custos.",
      estimatedCost: 0,
      confidence: 0.90,
      fallback: createFallback(
        "unavailable",
        "none",
        "free_local",
        "Nenhum outro modelo gratuito disponível.",
        false
      ),
      toolsRequired,
      authorizationRequired,
      isBlocked: false,
      costGuardTier: "free_tier",
      billingNotice: BILLING_NOTICE_SECURE,
    };
  }

  // Fallback 3: Somente se o usuário autorizou expressamente com chave própria
  if (input.userConsentExternal && input.hasApiKey && input.userAllowedPaid) {
    return {
      status: "allowed",
      strategy: "economic_cloud",
      model: DEFAULT_EXTERNAL_MODELS.ECONOMIC,
      complexity: "COMPLEXA",
      risk,
      reason:
        "Modelos gratuitos locais e em nuvem indisponíveis. Roteado para modelo econômico autorizado com chave própria do usuário. A IRIS não realiza faturamento.",
      estimatedCost: 0,
      confidence: 0.93,
      fallback: createFallback(
        "unavailable",
        "none",
        "low_cost",
        "Nenhum outro modelo disponível.",
        false
      ),
      toolsRequired,
      authorizationRequired,
      isBlocked: false,
      costGuardTier: "paid",
      billingNotice: BILLING_NOTICE_SECURE,
    };
  }

  // Se nenhum modelo gratuito nem chave própria autorizada estiver disponível:
  return createUnavailableDecision(complexity, risk, toolsRequired, authorizationRequired);
}

/**
 * Cria decisão estruturada de indisponibilidade segura
 */
function createUnavailableDecision(
  complexity: ModelComplexity,
  risk: "low" | "medium" | "high",
  toolsRequired: string[],
  authorizationRequired: boolean
): ModelRouterDecision {
  const emptyFallback = createFallback(
    "unavailable",
    "none",
    "free_local",
    "Nenhum fallback gratuito ou seguro disponível no momento.",
    false
  );

  return {
    status: "unavailable",
    strategy: "unavailable",
    model: "none",
    complexity,
    risk,
    reason:
      "Nenhum modelo gratuito adequado está disponível e a IRIS nunca aciona serviços pagos automaticamente.",
    estimatedCost: 0,
    confidence: 0,
    fallback: emptyFallback,
    toolsRequired,
    authorizationRequired,
    isUnavailable: true,
    isBlocked: false,
    costGuardTier: "local",
    billingNotice: BILLING_NOTICE_SECURE,
  };
}

/**
 * Classe principal do AI Model Router da IRIS (Fase 4.2)
 * Mantém isolamento total entre a decisão estratégica e a execução de ações.
 * Contém camada integrada de IRIS Cost Guard e registro estruturado de Observabilidade.
 */
export class IrisModelRouter {
  private availabilityMap: Map<string, boolean> = new Map();
  private observabilityLog: RouterObservabilityRecord[] = [];

  constructor(initialAvailability?: Record<string, boolean>) {
    if (initialAvailability) {
      for (const [key, val] of Object.entries(initialAvailability)) {
        this.availabilityMap.set(key, val);
      }
    }
  }

  /**
   * Decide a estratégia e o modelo adequado para o comando fornecido
   * e registra a observabilidade estruturada da decisão.
   */
  public route(input: ModelRouterInput): ModelRouterDecision {
    const mergedAvailability: Record<string, boolean> = {};
    for (const [key, val] of this.availabilityMap.entries()) {
      mergedAvailability[key] = val;
    }

    if (input.availableModels) {
      if (Array.isArray(input.availableModels)) {
        for (const item of input.availableModels) {
          mergedAvailability[item.id] = item.available;
        }
      } else if (typeof input.availableModels === "object") {
        Object.assign(mergedAvailability, input.availableModels);
      }
    }

    const decision = routeAiModel({
      ...input,
      availableModels: mergedAvailability,
    });

    // Observabilidade estruturada (somente metadados seguros, sem PII ou payload de mensagens)
    const record: RouterObservabilityRecord = {
      timestamp: new Date().toISOString(),
      intent: input.intent || "query",
      complexity: decision.complexity,
      risk: decision.risk,
      strategy: decision.strategy,
      model: decision.model,
      estimatedCost: decision.estimatedCost,
      fallback:
        typeof decision.fallback === "object"
          ? `${decision.fallback.model} (${decision.fallback.strategy})`
          : String(decision.fallback),
      decisionResult: decision.status,
    };

    this.observabilityLog.push(record);
    if (this.observabilityLog.length > 200) {
      this.observabilityLog.shift();
    }

    return decision;
  }

  /**
   * Retorna os registros de observabilidade estruturada
   */
  public getObservabilityLog(): RouterObservabilityRecord[] {
    return [...this.observabilityLog];
  }

  /**
   * Retorna o registro de observabilidade mais recente
   */
  public getLastObservabilityRecord(): RouterObservabilityRecord | null {
    return this.observabilityLog.length > 0
      ? this.observabilityLog[this.observabilityLog.length - 1]
      : null;
  }

  /**
   * Limpa o histórico de observabilidade
   */
  public clearObservabilityLog(): void {
    this.observabilityLog = [];
  }

  /**
   * Classifica automaticamente a complexidade da demanda
   */
  public classifyComplexity(input: ComplexityClassificationInput | string): ModelComplexity {
    return classifyModelComplexity(input);
  }

  /**
   * Define disponibilidade de um modelo específico para testes e controle de falhas
   */
  public setModelAvailability(modelId: string, available: boolean): void {
    this.availabilityMap.set(modelId, available);
  }

  /**
   * Consulta disponibilidade de um modelo
   */
  public isModelAvailable(modelId: string): boolean {
    const val = this.availabilityMap.get(modelId);
    return val !== undefined ? val : true;
  }

  /**
   * Restaura o status de disponibilidade padrão de todos os modelos
   */
  public resetAvailability(): void {
    this.availabilityMap.clear();
  }

  /**
   * Retorna os IDs dos modelos padrão da arquitetura
   */
  public getStandardModels(): string[] {
    return [
      DEFAULT_FREE_MODELS.LOCAL_FAST,
      DEFAULT_FREE_MODELS.LOCAL_BALANCED,
      DEFAULT_FREE_MODELS.LOCAL_REASONING,
      DEFAULT_FREE_MODELS.FREE_TIER_CLOUD,
    ];
  }
}
