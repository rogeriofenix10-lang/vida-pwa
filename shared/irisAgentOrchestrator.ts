/**
 * IRIS 6.0 — FASE 5: AGENT ORCHESTRATOR
 *
 * Camada central responsável por coordenar a execução de tarefas complexas.
 *
 * FLUXO CENTRAL OBRIGATÓRIO:
 * COMMAND
 * → UNDERSTAND
 * → PLAN
 * → ROUTE
 * → COST GUARD
 * → SELECT TOOLS
 * → AUTHORIZATION
 * → EXECUTION
 * → VALIDATION
 * → RESULT
 *
 * ESTADOS CONTROLADOS:
 * - idle
 * - planning
 * - routing
 * - awaiting_authorization
 * - executing
 * - validating
 * - completed
 * - failed
 * - blocked
 * - cancelled
 *
 * REGRAS INVIOLÁVEIS:
 * 1. O Orchestrator NÃO executa diretamente ferramentas protegidas. Ele coordena.
 * 2. Bloqueio imediato se:
 *    - Risco exige autorização e autorização explícita não existe;
 *    - IRIS Cost Guard bloquear (modelos/serviços pagos sem faturamento);
 *    - Ferramenta necessária estiver indisponível;
 *    - Plano for inválido ou dependências forem violadas.
 * 3. Permite fallback seguro apenas para opções gratuitas ou interrupção segura.
 * 4. Registro estruturado de observabilidade para cada etapa e decisão.
 */

import {
  routeAiModel,
  classifyModelComplexity,
  IrisCostGuard,
  type ModelComplexity,
  type ModelCostLevel,
  type ModelFallback,
  type ModelRouterDecision,
  type ModelRouterInput,
  type CostGuardEvaluation,
  type CostGuardTier,
} from "./irisModelRouter";

import {
  analyzeCommand,
  interpretOperationalCommand,
  type RiskLevel,
  type CommandIntent,
  type ActionClassification,
  type CognitiveContext,
  type ExecutionPlan,
} from "./irisCognitive";

export type OrchestratorState =
  | "idle"
  | "planning"
  | "routing"
  | "awaiting_authorization"
  | "executing"
  | "validating"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled";

export type OrchestratorStage =
  | "understand"
  | "plan"
  | "route"
  | "cost_guard"
  | "select_tools"
  | "authorization"
  | "execution"
  | "validation"
  | "result";

export interface TaskStep {
  id: string;
  name: string;
  stage: OrchestratorStage;
  order: number;
  toolId?: string;
  parameters?: Record<string, unknown>;
  dependencies: string[];
  requiresAuthorization: boolean;
  riskLevel: RiskLevel;
  status: "pending" | "ready" | "running" | "completed" | "failed" | "blocked" | "skipped" | "cancelled";
  result?: unknown;
  error?: string;
  fallbackToolId?: string;
}

export interface OrchestratorPlan {
  planId: string;
  command: string;
  summary: string;
  intent: string;
  actionType: ActionClassification;
  riskLevel: RiskLevel;
  complexity: ModelComplexity;
  routerDecision: ModelRouterDecision;
  costGuardEvaluation: CostGuardEvaluation;
  toolsRequired: string[];
  requiresAuthorization: boolean;
  isProtectedAction: boolean;
  isAuthorized: boolean;
  authorizationToken?: string;
  steps: TaskStep[];
  executionOrder: string[];
  dependencies: Record<string, string[]>;
  status: OrchestratorState;
  createdAt: string;
  updatedAt: string;
  context?: CognitiveContext | Record<string, unknown>;
  validationErrors?: string[];
  fallbackPolicy?: {
    allowFallback: boolean;
    fallbackReason?: string;
    fallbackModel?: string;
  };
}

export interface OrchestratorInput {
  command: string;
  intent?: string;
  context?: CognitiveContext | Record<string, unknown>;
  risk?: RiskLevel;
  routerDecision?: ModelRouterDecision;
  needsTools?: boolean;
  toolsRequired?: string[];
  isAuthorized?: boolean;
  authorizationToken?: string;
  availableTools?: string[];
  costGuardPolicy?: {
    promotionalCreditAuthorized?: boolean;
    userAllowedPaid?: boolean;
  };
  forceComplexity?: ModelComplexity;
}

export interface OrchestrationResult {
  success: boolean;
  planId: string;
  state: OrchestratorState;
  summary: string;
  output?: unknown;
  executedSteps: TaskStep[];
  completedStepIds: string[];
  failedStep?: TaskStep;
  error?: string;
  fallbackUsed?: boolean;
  fallbackDetails?: string;
  timestamp: string;
  rollbackAvailable?: boolean;
}

export interface OrchestratorAuditLog {
  timestamp: string;
  planId: string;
  command: string;
  stage: OrchestratorStage;
  tool?: string;
  risk: RiskLevel;
  state: OrchestratorState;
  decision: string;
  message: string;
  error?: string;
}

/**
 * Identifica ações protegidas que jamais podem executar automaticamente
 */
export function isOrchestratorProtectedAction(intent: string, risk: RiskLevel, tools: string[] = []): boolean {
  if (risk === "high") return true;

  const raw = intent.toLowerCase();
  const protectedIntents = [
    "exclusao",
    "excluir",
    "apagar",
    "remover",
    "alteracao",
    "alterar",
    "modificar",
    "criacao",
    "criar",
    "cadastrar",
    "organizacao",
    "organizar",
    "envio",
    "enviar",
    "compartilhamento",
    "compartilhar",
    "envio/compartilhamento",
    "mutation",
  ];
  if (protectedIntents.includes(raw)) return true;

  const protectedTools = [
    "radar.create",
    "radar.complete",
    "radar.delete",
    "radar.update",
    "communication.send",
    "communication.prepare",
    "documents.delete",
    "calendar.create",
    "calendar.update",
    "calendar.delete",
    "drive.createFolder",
    "drive.rename",
    "drive.move",
    "drive.delete",
    "drive.share",
    "gmail.send",
    "whatsapp.send",
    "system.modify",
  ];
  if (tools.some((t) => protectedTools.includes(t))) return true;

  return false;
}

/**
 * Seleciona ferramentas com base na análise e no comando
 */
export function inferOrchestratorTools(command: string, actionType: ActionClassification): string[] {
  const lower = command.toLowerCase();
  const tools: string[] = [];

  // Multi-step: Pesquisar documentos e preparar lista/resumo
  if (
    /\b(pesquis[aeo]r?|busc[aeo]r?|encontr[aeo]r?)\b/i.test(lower) &&
    /\b(documentos?|arquivos?)\b/i.test(lower) &&
    /\b(prepar[aeo]r?|cri[aeo]r?|list[aeo]r?|resum[aeo]r?|organizar)\b/i.test(lower) &&
    /\b(lista|resumo|relat[óo]rio)\b/i.test(lower)
  ) {
    return ["documents.search", "documents.summarize"];
  }

  // 1. Google Drive
  if (/\b(drive)\b/i.test(lower)) {
    if (/\b(excluir|apagar|deletar|remover)\b/i.test(lower)) {
      tools.push("drive.delete");
    } else if (/\b(renomear|renomeie)\b/i.test(lower)) {
      tools.push("drive.rename");
    } else if (/\b(mover|mova|transferir)\b/i.test(lower)) {
      tools.push("drive.move");
    } else if (/\b(compartilhar|compartilhe|share)\b/i.test(lower)) {
      tools.push("drive.share");
    } else if (/\b(pasta|criar pasta)\b/i.test(lower)) {
      tools.push("drive.createFolder");
    } else if (/\b(listar|ver todos)\b/i.test(lower)) {
      tools.push("drive.list");
    } else {
      tools.push("drive.search");
    }
    return tools;
  }

  // 2. Gmail / E-mail
  if (/\b(gmail|e-?mails?)\b/i.test(lower)) {
    if (actionType === "envio" || /\b(envi[aeo]r?|mand[aeo]r?|dispar[aeo]r?)\b/i.test(lower)) {
      tools.push("communication.send", "gmail.send");
    } else if (/\b(rascunho|preparar)\b/i.test(lower)) {
      tools.push("communication.prepare", "gmail.draft");
    } else if (/\b(ler|abrir|ver)\b/i.test(lower)) {
      tools.push("gmail.read");
    } else {
      tools.push("gmail.search");
    }
    return tools;
  }

  // 3. Google Calendar / Agenda
  if (/\b(agenda|calend[áa]rio|calendar|reuni[ãa]o|evento)\b/i.test(lower)) {
    if (actionType === "exclusao" || /\b(cancelar|desmarcar|excluir|remover)\b/i.test(lower)) {
      tools.push("calendar.delete");
    } else if (actionType === "alteracao" || /\b(adiar|mudar|remarcar|alterar)\b/i.test(lower)) {
      tools.push("calendar.update");
    } else if (actionType === "organizacao" || actionType === "criacao" || /\b(agendar|marcar|criar)\b/i.test(lower)) {
      tools.push("calendar.create");
    } else {
      tools.push("calendar.list");
    }
    return tools;
  }

  // 4. Radar e Comunicação Geral
  if (actionType === "exclusao" || /\b(excluir|apagar|remover|deletar)\b/i.test(lower)) {
    tools.push("radar.delete");
  } else if (actionType === "envio" || /\b(enviar|mandar|whatsapp|sms)\b/i.test(lower)) {
    if (/\b(whatsapp)\b/i.test(lower)) {
      tools.push("whatsapp.send");
    } else {
      tools.push("communication.send");
    }
  } else if (actionType === "compartilhamento" || /\b(compartilhar|exportar)\b/i.test(lower)) {
    tools.push("documents.share");
  } else if (actionType === "alteracao" || /\b(adiar|mudar|alterar|concluir|finalizar)\b/i.test(lower)) {
    if (/\b(concluir|finalizar)\b/i.test(lower)) {
      tools.push("radar.complete");
    } else {
      tools.push("radar.update");
    }
  } else if (actionType === "organizacao" || actionType === "criacao" || /\b(agendar|lembrar|cadastrar|novo|pagar)\b/i.test(lower)) {
    tools.push("radar.create");
  } else if (actionType === "analise" || /\b(analisar|diagn[óo]stico|estat[íi]sticas?|resumo)\b/i.test(lower)) {
    tools.push("analysis.run");
  } else if (/\b(documento|arquivo|pdf|buscar)\b/i.test(lower)) {
    tools.push("documents.search");
  } else if (actionType === "consulta") {
    tools.push("radar.read");
  }

  return tools;
}

/**
 * Classe principal do IRIS Agent Orchestrator (Fase 5)
 */
export class IrisAgentOrchestrator {
  private state: OrchestratorState = "idle";
  private currentPlan: OrchestratorPlan | null = null;
  private auditLogs: OrchestratorAuditLog[] = [];
  private onStateChange?: (state: OrchestratorState) => void;

  constructor(options?: { onStateChange?: (state: OrchestratorState) => void }) {
    this.onStateChange = options?.onStateChange;
  }

  public getState(): OrchestratorState {
    return this.state;
  }

  public getCurrentPlan(): OrchestratorPlan | null {
    return this.currentPlan;
  }

  public getAuditLogs(): OrchestratorAuditLog[] {
    return [...this.auditLogs];
  }

  private setState(newState: OrchestratorState, logDetails?: { stage: OrchestratorStage; tool?: string; risk: RiskLevel; message: string; error?: string }) {
    this.state = newState;
    if (this.currentPlan) {
      this.currentPlan.status = newState;
      this.currentPlan.updatedAt = new Date().toISOString();
    }
    if (logDetails) {
      this.logAudit({
        timestamp: new Date().toISOString(),
        planId: this.currentPlan?.planId ?? "none",
        command: this.currentPlan?.command ?? "",
        stage: logDetails.stage,
        tool: logDetails.tool,
        risk: logDetails.risk,
        state: newState,
        decision: newState,
        message: logDetails.message,
        error: logDetails.error,
      });
    }
    this.onStateChange?.(newState);
  }

  private logAudit(entry: OrchestratorAuditLog) {
    // Garantir que nenhum dado sensível (senhas, tokens, credenciais) seja logado
    const sanitize = (text: string) =>
      text
        .replace(/bearer\s+[a-zA-Z0-9_\-\.]+/gi, "Bearer [REDACTED]")
        .replace(/(password|senha)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
        .replace(/(secret|token|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[REDACTED]");

    this.auditLogs.push({
      ...entry,
      command: sanitize(entry.command || ""),
      message: sanitize(entry.message || ""),
      error: entry.error ? sanitize(entry.error) : undefined,
    });
  }

  /**
   * Constrói e valida o plano de tarefas complexas a partir do comando e contexto.
   * Executa rigorosamente os estágios:
   * UNDERSTAND → PLAN → ROUTE → COST GUARD → SELECT TOOLS → AUTHORIZATION CHECK
   */
  public planTask(input: OrchestratorInput): OrchestratorPlan {
    this.setState("planning", {
      stage: "understand",
      risk: input.risk || "low",
      message: "Iniciando compreensão e planejamento do comando.",
    });

    const command = (input.command || "").trim();
    const planId = `orch-plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // 1. UNDERSTAND: Análise Cognitiva da Intenção e Risco
    const cognitiveContext = (input.context as CognitiveContext) || {};
    const commandAnalysis = analyzeCommand(command, cognitiveContext);
    const intent = input.intent || commandAnalysis.actionType;
    const actionType = commandAnalysis.actionType;
    const riskLevel: RiskLevel = input.risk || commandAnalysis.riskLevel;

    // 2. ROUTE: Roteamento inteligente de IA (Free-First)
    this.setState("routing", {
      stage: "route",
      risk: riskLevel,
      message: "Roteando modelo de IA via IrisModelRouter.",
    });

    const complexity: ModelComplexity = input.forceComplexity || classifyModelComplexity({
      command,
      intent,
      risk: riskLevel,
      context: input.context,
      needsTools: input.needsTools ?? true,
    });

    const inferredTools = input.toolsRequired || inferOrchestratorTools(command, actionType);
    const routerDecision = input.routerDecision || routeAiModel({
      command,
      intent,
      risk: riskLevel,
      complexity,
      context: input.context,
      needsTools: inferredTools.length > 0,
      toolsRequired: inferredTools,
      stepsCount: 3 + inferredTools.length,
      promotionalCreditAuthorized: input.costGuardPolicy?.promotionalCreditAuthorized,
      userAllowedPaid: input.costGuardPolicy?.userAllowedPaid,
    });

    // 3. COST GUARD: Avaliação financeira estrita
    const modelToEvaluate = routerDecision.model || routerDecision.strategy;
    const costGuardEvaluation = IrisCostGuard.evaluate(
      modelToEvaluate,
      input.costGuardPolicy
    );

    // 4. SELECT TOOLS: Seleção e validação de ferramentas
    const availableToolsList = input.availableTools;
    const missingTools: string[] = [];
    if (availableToolsList && availableToolsList.length > 0) {
      for (const t of inferredTools) {
        if (!availableToolsList.includes(t)) {
          missingTools.push(t);
        }
      }
    }

    const isProtected = isOrchestratorProtectedAction(intent, riskLevel, inferredTools);
    const requiresAuth = isProtected || riskLevel === "high" || commandAnalysis.requiresAuthorization;

    // 5. DIVIDIR TAREFA EM ETAPAS ORDENADAS COM DEPENDÊNCIAS
    const steps: TaskStep[] = [];
    const executionOrder: string[] = [];
    const dependencies: Record<string, string[]> = {};
    let orderIndex = 1;

    // Etapa 1: Entendimento do Contexto
    const stepUnderstandId = `step-${orderIndex}-understand`;
    steps.push({
      id: stepUnderstandId,
      name: "Compreensão da Intenção e Parâmetros",
      stage: "understand",
      order: orderIndex++,
      dependencies: [],
      requiresAuthorization: false,
      riskLevel: "low",
      status: "ready",
      parameters: { command, actionType, complexity },
    });
    executionOrder.push(stepUnderstandId);
    dependencies[stepUnderstandId] = [];

    // Etapa 2: Verificação do IRIS Cost Guard
    const stepCostGuardId = `step-${orderIndex}-costguard`;
    steps.push({
      id: stepCostGuardId,
      name: "Verificação de Custos e Política Free-First",
      stage: "cost_guard",
      order: orderIndex++,
      dependencies: [stepUnderstandId],
      requiresAuthorization: false,
      riskLevel: "low",
      status: "pending",
      parameters: {
        model: routerDecision.model,
        tier: costGuardEvaluation.tier,
        allowed: costGuardEvaluation.allowed,
      },
    });
    executionOrder.push(stepCostGuardId);
    dependencies[stepCostGuardId] = [stepUnderstandId];

    // Etapas Operacionais / Ferramentas
    let previousStepId = stepCostGuardId;
    for (const tool of inferredTools) {
      const stepToolId = `step-${orderIndex}-${tool.replace(/[^a-zA-Z0-9]/g, "_")}`;
      steps.push({
        id: stepToolId,
        name: `Preparar e Executar Ferramenta: ${tool}`,
        stage: "select_tools",
        order: orderIndex++,
        toolId: tool,
        dependencies: [previousStepId],
        requiresAuthorization: isProtected,
        riskLevel,
        status: "pending",
        parameters: { command, targetAction: actionType },
        fallbackToolId: tool.startsWith("radar.") ? "radar.read" : undefined,
      });
      executionOrder.push(stepToolId);
      dependencies[stepToolId] = [previousStepId];
      previousStepId = stepToolId;
    }

    // Etapa de Validação
    const stepValidationId = `step-${orderIndex}-validation`;
    steps.push({
      id: stepValidationId,
      name: "Validação do Resultado Operacional",
      stage: "validation",
      order: orderIndex++,
      dependencies: [previousStepId],
      requiresAuthorization: false,
      riskLevel: "low",
      status: "pending",
    });
    executionOrder.push(stepValidationId);
    dependencies[stepValidationId] = [previousStepId];

    // Etapa Final de Resultado
    const stepResultId = `step-${orderIndex}-result`;
    steps.push({
      id: stepResultId,
      name: "Confirmação e Entrega do Resultado",
      stage: "result",
      order: orderIndex++,
      dependencies: [stepValidationId],
      requiresAuthorization: false,
      riskLevel: "low",
      status: "pending",
    });
    executionOrder.push(stepResultId);
    dependencies[stepResultId] = [stepValidationId];

    // Validação de Erros do Plano
    const validationErrors: string[] = [];
    if (!costGuardEvaluation.allowed || routerDecision.isBlocked) {
      validationErrors.push(
        costGuardEvaluation.reason || "Recurso pago bloqueado pelo IRIS Cost Guard."
      );
    }
    if (missingTools.length > 0) {
      validationErrors.push(`Ferramenta(s) necessária(s) indisponível(is): ${missingTools.join(", ")}`);
    }

    const isAuthorized = Boolean(input.isAuthorized);
    const plan: OrchestratorPlan = {
      planId,
      command,
      summary: commandAnalysis.proposal?.detail || `Plano orquestrado para “${command}”`,
      intent,
      actionType,
      riskLevel,
      complexity,
      routerDecision,
      costGuardEvaluation,
      toolsRequired: inferredTools,
      requiresAuthorization: requiresAuth,
      isProtectedAction: isProtected,
      isAuthorized,
      authorizationToken: input.authorizationToken,
      steps,
      executionOrder,
      dependencies,
      status: "planning",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      context: input.context,
      validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
      fallbackPolicy: {
        allowFallback: true,
        fallbackReason: routerDecision.fallback?.reason,
        fallbackModel: routerDecision.fallback?.model,
      },
    };

    this.currentPlan = plan;

    // Checagem de Bloqueio ou Autorização
    if (validationErrors.length > 0) {
      this.setState("blocked", {
        stage: "plan",
        risk: riskLevel,
        message: `Plano orquestrado bloqueado: ${validationErrors.join("; ")}`,
      });
      return plan;
    }

    if (requiresAuth && !isAuthorized) {
      this.setState("awaiting_authorization", {
        stage: "authorization",
        risk: riskLevel,
        message: "Plano orquestrado gerado. Aguardando autorização explícita do usuário para ação protegida.",
      });
    } else {
      this.setState("idle", {
        stage: "plan",
        risk: riskLevel,
        message: "Plano orquestrado gerado e pronto para execução segura.",
      });
    }

    return plan;
  }

  /**
   * Concede autorização explícita para o plano atual
   */
  public authorize(token?: string): boolean {
    if (!this.currentPlan) {
      throw new Error("Nenhum plano ativo no Orchestrator para autorizar.");
    }

    if (this.state !== "awaiting_authorization" && !this.currentPlan.requiresAuthorization) {
      return true;
    }

    this.currentPlan.isAuthorized = true;
    this.currentPlan.authorizationToken = token || `auth-${Date.now()}`;
    this.currentPlan.updatedAt = new Date().toISOString();
    this.setState("idle", {
      stage: "authorization",
      risk: this.currentPlan.riskLevel,
      message: "Autorização explícita do usuário concedida com sucesso.",
    });
    return true;
  }

  /**
   * Cancela o plano atual
   */
  public cancel(reason = "Cancelado pelo usuário"): OrchestrationResult {
    if (!this.currentPlan) {
      return {
        success: true,
        planId: "none",
        state: "cancelled",
        summary: "Nenhum plano ativo para cancelar.",
        executedSteps: [],
        completedStepIds: [],
        timestamp: new Date().toISOString(),
      };
    }

    const plan = this.currentPlan;
    this.setState("cancelled", {
      stage: "result",
      risk: plan.riskLevel,
      message: `Plano cancelado: ${reason}`,
    });

    for (const step of plan.steps) {
      if (step.status === "pending" || step.status === "ready" || step.status === "running") {
        step.status = "cancelled";
      }
    }

    return {
      success: true,
      planId: plan.planId,
      state: "cancelled",
      summary: `Plano “${plan.summary}” cancelado com segurança. Nenhuma ação protegida foi disparada.`,
      executedSteps: plan.steps,
      completedStepIds: [],
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Coordena a execução das etapas do plano através do executor seguro injetado.
   * O Orchestrator NUNCA executa ferramentas protegidas diretamente: ele coordena
   * a ordem, validações, autorização e tratamento de falhas.
   */
  public async executePlan(
    executor: (step: TaskStep) => Promise<unknown>
  ): Promise<OrchestrationResult> {
    if (!this.currentPlan) {
      throw new Error("Nenhum plano disponível no Orchestrator para execução.");
    }

    const plan = this.currentPlan;

    // 1. Verificação de Bloqueio do Cost Guard
    if (plan.status === "blocked" || (plan.validationErrors && plan.validationErrors.length > 0)) {
      this.setState("blocked", {
        stage: "cost_guard",
        risk: plan.riskLevel,
        message: "Tentativa de execução de plano bloqueado rejeitada.",
      });
      return {
        success: false,
        planId: plan.planId,
        state: "blocked",
        summary: plan.validationErrors?.join("; ") || "Plano bloqueado por violação de segurança ou custo.",
        executedSteps: [],
        completedStepIds: [],
        error: "Execução bloqueada pelo IRIS Orchestrator / Cost Guard.",
        timestamp: new Date().toISOString(),
      };
    }

    // 2. Verificação de Autorização
    if (plan.requiresAuthorization && !plan.isAuthorized) {
      this.setState("awaiting_authorization", {
        stage: "authorization",
        risk: plan.riskLevel,
        message: "Execução bloqueada: ação protegida exige autorização explícita do usuário.",
      });
      return {
        success: false,
        planId: plan.planId,
        state: "awaiting_authorization",
        summary: "Ação protegida requer autorização explícita do usuário antes da execução.",
        executedSteps: [],
        completedStepIds: [],
        error: "Autorização explícita ausente.",
        timestamp: new Date().toISOString(),
      };
    }

    this.setState("executing", {
      stage: "execution",
      risk: plan.riskLevel,
      message: `Iniciando execução orquestrada de ${plan.steps.length} etapas.`,
    });

    const completedStepIds = new Set<string>();
    const executedSteps: TaskStep[] = [];
    let lastStepOutput: unknown = null;
    let failedStep: TaskStep | undefined;
    let fallbackUsed = false;
    let fallbackDetails: string | undefined;

    // Ordenar estritamente por ordem numérica
    const orderedSteps = [...plan.steps].sort((a, b) => a.order - b.order);

    for (const step of orderedSteps) {
      // Checar se todas as dependências foram concluídas
      for (const depId of step.dependencies) {
        if (!completedStepIds.has(depId)) {
          step.status = "blocked";
          step.error = `Dependência “${depId}” não foi completada com sucesso.`;
          executedSteps.push(step);
          failedStep = step;

          this.setState("failed", {
            stage: step.stage,
            tool: step.toolId,
            risk: step.riskLevel,
            message: `Execução interrompida: dependência ${depId} não concluída.`,
            error: step.error,
          });

          return {
            success: false,
            planId: plan.planId,
            state: "failed",
            summary: `Execução interrompida na etapa ${step.name}: dependência ${depId} não concluída.`,
            executedSteps,
            completedStepIds: Array.from(completedStepIds),
            failedStep,
            error: step.error,
            timestamp: new Date().toISOString(),
          };
        }
      }

      // Validação do estado no estágio de validação
      if (step.stage === "validation") {
        this.setState("validating", {
          stage: "validation",
          risk: step.riskLevel,
          message: "Validando integridade dos resultados das etapas anteriores.",
        });
      }

      step.status = "running";
      try {
        const output = await executor(step);
        step.status = "completed";
        step.result = output;
        lastStepOutput = output;
        completedStepIds.add(step.id);
        executedSteps.push(step);

        this.logAudit({
          timestamp: new Date().toISOString(),
          planId: plan.planId,
          command: plan.command,
          stage: step.stage,
          tool: step.toolId,
          risk: step.riskLevel,
          state: "executing",
          decision: "step_succeeded",
          message: `Etapa “${step.name}” concluída com sucesso.`,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        step.error = errorMsg;

        // Tentar fallback seguro caso a etapa permita
        if (step.fallbackToolId && plan.fallbackPolicy?.allowFallback) {
          try {
            this.logAudit({
              timestamp: new Date().toISOString(),
              planId: plan.planId,
              command: plan.command,
              stage: step.stage,
              tool: step.fallbackToolId,
              risk: "low",
              state: "executing",
              decision: "fallback_attempt",
              message: `Tentando fallback seguro com ${step.fallbackToolId} após erro em ${step.toolId}.`,
            });

            const fallbackStep: TaskStep = {
              ...step,
              id: `${step.id}-fallback`,
              name: `Fallback: ${step.fallbackToolId}`,
              toolId: step.fallbackToolId,
              requiresAuthorization: false,
              riskLevel: "low",
            };
            const fallbackOutput = await executor(fallbackStep);
            step.status = "completed";
            step.result = fallbackOutput;
            lastStepOutput = fallbackOutput;
            completedStepIds.add(step.id);
            executedSteps.push(step);
            fallbackUsed = true;
            fallbackDetails = `Fallback para ${step.fallbackToolId} executado com sucesso.`;
            continue;
          } catch (fallbackErr) {
            step.error = `Falha principal: ${errorMsg}; Falha no fallback: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`;
          }
        }

        step.status = "failed";
        failedStep = step;
        executedSteps.push(step);

        this.setState("failed", {
          stage: step.stage,
          tool: step.toolId,
          risk: step.riskLevel,
          message: `Etapa “${step.name}” falhou: ${step.error}`,
          error: step.error,
        });

        return {
          success: false,
          planId: plan.planId,
          state: "failed",
          summary: `Falha na etapa “${step.name}”: ${step.error}`,
          executedSteps,
          completedStepIds: Array.from(completedStepIds),
          failedStep,
          error: step.error,
          fallbackUsed,
          fallbackDetails,
          timestamp: new Date().toISOString(),
        };
      }
    }

    this.setState("completed", {
      stage: "result",
      risk: plan.riskLevel,
      message: `Plano “${plan.summary}” concluído com êxito (${completedStepIds.size} etapas).`,
    });

    return {
      success: true,
      planId: plan.planId,
      state: "completed",
      summary: `Plano “${plan.summary}” executado com sucesso (${completedStepIds.size} etapas).`,
      output: lastStepOutput,
      executedSteps,
      completedStepIds: Array.from(completedStepIds),
      fallbackUsed,
      fallbackDetails,
      timestamp: new Date().toISOString(),
      rollbackAvailable: false,
    };
  }

  public reset(): void {
    this.currentPlan = null;
    this.state = "idle";
  }
}
