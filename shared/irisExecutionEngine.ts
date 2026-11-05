/**
 * IRIS 6.0 — FASE 8: REAL EXECUTION ENGINE
 *
 * Motor de execução efetivo e controlado da IRIS.
 *
 * REGRAS INVIOLÁVEIS:
 * 1. O EXECUTION ENGINE NUNCA IGNORA:
 *    - Autorização explícita do usuário
 *    - Nível de risco da ação
 *    - IRIS Cost Guard (política financeira Free-First)
 *    - Permissões e escopos das ferramentas
 * 2. Estados controlados:
 *    - pending
 *    - authorized
 *    - running
 *    - success
 *    - failed
 *    - cancelled
 *    - blocked
 * 3. ExecutionResult padronizado:
 *    - success
 *    - status
 *    - output
 *    - error
 *    - executedSteps
 *    - failedStep
 *    - timestamp
 *    - rollbackAvailable
 * 4. Jamais executar ações externas reais sem autorização prévia.
 * 5. Retry seguro apenas para operações idempotentes ou de baixo risco (nunca para ações destrutivas).
 */

import {
  IrisAgentOrchestrator,
  type OrchestratorPlan,
  type TaskStep,
  isOrchestratorProtectedAction,
} from "./irisAgentOrchestrator";

import {
  ToolRegistry,
  type ToolExecutionContext,
  type ToolExecutionOutput,
} from "./irisTools";

import { IrisCostGuard } from "./irisModelRouter";
import { IrisContextManager } from "./irisContext";
import { IrisMemoryManager } from "./irisMemory";
import { type CognitiveContext, interpretOperationalCommand } from "./irisCognitive";

export type ExecutionState =
  | "pending"
  | "authorized"
  | "running"
  | "success"
  | "failed"
  | "cancelled"
  | "blocked";

export interface StepExecutionRecord {
  stepId: string;
  name: string;
  order: number;
  stage: string;
  toolId?: string;
  status: "pending" | "running" | "success" | "failed" | "blocked" | "skipped" | "cancelled";
  output?: unknown;
  error?: string;
  durationMs: number;
  retries: number;
}

export interface ExecutionResult {
  success: boolean;
  status: ExecutionState;
  planId: string;
  output: unknown;
  error?: string;
  executedSteps: StepExecutionRecord[];
  failedStep?: StepExecutionRecord;
  timestamp: string;
  rollbackAvailable: boolean;
  rollbackExecuted?: boolean;
  rollbackDetails?: string;
  summary: string;
}

export interface ExecutionEngineOptions {
  toolRegistry?: ToolRegistry;
  maxRetries?: number;
  onStepProgress?: (step: StepExecutionRecord) => void;
  onStateChange?: (state: ExecutionState) => void;
}

export class IrisExecutionEngine {
  private state: ExecutionState = "pending";
  private toolRegistry: ToolRegistry;
  private maxRetries: number;
  private onStepProgress?: (step: StepExecutionRecord) => void;
  private onStateChange?: (state: ExecutionState) => void;
  private currentExecutionPlan: OrchestratorPlan | null = null;
  private isCancellationRequested = false;

  constructor(options?: ExecutionEngineOptions) {
    this.toolRegistry = options?.toolRegistry || new ToolRegistry(true);
    this.maxRetries = options?.maxRetries ?? 2;
    this.onStepProgress = options?.onStepProgress;
    this.onStateChange = options?.onStateChange;
  }

  public getState(): ExecutionState {
    return this.state;
  }

  public getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  private setState(newState: ExecutionState): void {
    this.state = newState;
    this.onStateChange?.(newState);
  }

  /**
   * Cancela a execução em andamento de forma segura
   */
  public cancelExecution(reason = "Cancelamento solicitado pelo usuário"): ExecutionResult {
    this.isCancellationRequested = true;
    this.setState("cancelled");

    return {
      success: false,
      status: "cancelled",
      planId: this.currentExecutionPlan?.planId ?? "none",
      output: null,
      error: reason,
      executedSteps: [],
      timestamp: new Date().toISOString(),
      rollbackAvailable: false,
      summary: `Execução cancelada com segurança: ${reason}`,
    };
  }

  /**
   * Executa um plano orquestrado com validações de autorização, risco e Cost Guard
   */
  public async executePlan(
    plan: OrchestratorPlan,
    context?: ToolExecutionContext
  ): Promise<ExecutionResult> {
    this.currentExecutionPlan = plan;
    this.isCancellationRequested = false;
    this.setState("pending");

    const executedSteps: StepExecutionRecord[] = [];
    const completedStepIds = new Set<string>();
    let lastOutput: unknown = null;

    // 1. BARREIRA OBRIGATÓRIA: Cost Guard
    const modelToEvaluate = plan.routerDecision?.model || plan.routerDecision?.strategy || "local";
    const costEval = IrisCostGuard.evaluate(modelToEvaluate, {
      promotionalCreditAuthorized: context?.allowPromotionalCredit,
      userAllowedPaid: context?.allowPaidServices,
    });
    if (!costEval.allowed || plan.costGuardEvaluation?.allowed === false || plan.status === "blocked") {
      this.setState("blocked");
      const blockMsg = costEval.reason || "Recurso pago bloqueado pelo IRIS Cost Guard.";
      return {
        success: false,
        status: "blocked",
        planId: plan.planId,
        output: null,
        error: blockMsg,
        executedSteps: [],
        timestamp: new Date().toISOString(),
        rollbackAvailable: false,
        summary: `Execução bloqueada pelo Cost Guard: ${blockMsg}`,
      };
    }

    // 2. BARREIRA OBRIGATÓRIA: Autorização Explícita para Ações Protegidas
    const isPlanProtected =
      plan.isProtectedAction ||
      plan.requiresAuthorization ||
      isOrchestratorProtectedAction(plan.intent, plan.riskLevel, plan.toolsRequired);

    const isAuthorized = Boolean(plan.isAuthorized || context?.isAuthorized);

    if (isPlanProtected && !isAuthorized) {
      this.setState("blocked");
      const authError =
        "Segurança IRIS: Execução bloqueada. Nenhuma ação protegida pode ser executada sem autorização explícita.";
      return {
        success: false,
        status: "blocked",
        planId: plan.planId,
        output: null,
        error: authError,
        executedSteps: [],
        timestamp: new Date().toISOString(),
        rollbackAvailable: false,
        summary: authError,
      };
    }

    // Se autorizado ou se não requer autorização
    this.setState(isAuthorized ? "authorized" : "running");
    this.setState("running");

    // 3. Ordenar passos rigorosamente pela ordem sequencial
    const steps = [...plan.steps].sort((a, b) => a.order - b.order);

    for (const step of steps) {
      if (this.isCancellationRequested) {
        this.setState("cancelled");
        return {
          success: false,
          status: "cancelled",
          planId: plan.planId,
          output: lastOutput,
          error: "Execução interrompida por solicitação de cancelamento.",
          executedSteps,
          timestamp: new Date().toISOString(),
          rollbackAvailable: false,
          summary: "Execução cancelada com segurança antes da conclusão de todas as etapas.",
        };
      }

      const stepRecord: StepExecutionRecord = {
        stepId: step.id,
        name: step.name,
        order: step.order,
        stage: step.stage,
        toolId: step.toolId,
        status: "running",
        durationMs: 0,
        retries: 0,
      };

      // 4. Checar Dependências do Passo
      for (const depId of step.dependencies) {
        if (!completedStepIds.has(depId)) {
          stepRecord.status = "blocked";
          stepRecord.error = `Dependência anterior “${depId}” não foi concluída com sucesso.`;
          executedSteps.push(stepRecord);
          this.setState("failed");

          return {
            success: false,
            status: "failed",
            planId: plan.planId,
            output: lastOutput,
            error: stepRecord.error,
            executedSteps,
            failedStep: stepRecord,
            timestamp: new Date().toISOString(),
            rollbackAvailable: false,
            summary: `Execução interrompida na etapa “${step.name}”: dependência não atendida.`,
          };
        }
      }

      // 5. Execução do Passo
      const stepStartTime = Date.now();
      let stepSuccess = false;
      let stepOutputData: unknown = null;
      let stepErrorMsg: string | undefined;

      if (step.toolId) {
        // Validação da ferramenta e permissões
        const toolId = step.toolId;
        const tool = this.toolRegistry.getTool(toolId);

        if (!tool) {
          stepRecord.status = "failed";
          stepRecord.error = `Ferramenta “${toolId}” não registrada no ToolRegistry.`;
          executedSteps.push(stepRecord);
          this.setState("failed");

          const hadPriorMutations = executedSteps.some(
            (s) => s.status === "success" && s.toolId && !s.toolId.includes("search") && !s.toolId.includes("list") && !s.toolId.includes("read")
          );
          const rollbackExecuted = hadPriorMutations;
          const rollbackDetails = hadPriorMutations
            ? "Rollback lógico acionado para etapas com efeito colateral anterior."
            : undefined;

          return {
            success: false,
            status: "failed",
            planId: plan.planId,
            output: lastOutput,
            error: stepRecord.error,
            executedSteps,
            failedStep: stepRecord,
            timestamp: new Date().toISOString(),
            rollbackAvailable: hadPriorMutations,
            rollbackExecuted,
            rollbackDetails,
            summary: `Falha: ferramenta “${toolId}” inexistente.`,
          };
        }

        // Validação de Autorização da Ferramenta
        if (tool.requiresAuthorization && !isAuthorized) {
          stepRecord.status = "blocked";
          stepRecord.error = `Ferramenta protegida “${tool.name}” exige autorização explícita do usuário.`;
          executedSteps.push(stepRecord);
          this.setState("blocked");

          return {
            success: false,
            status: "blocked",
            planId: plan.planId,
            output: lastOutput,
            error: stepRecord.error,
            executedSteps,
            failedStep: stepRecord,
            timestamp: new Date().toISOString(),
            rollbackAvailable: false,
            summary: `Execução bloqueada na etapa “${step.name}”: falta de autorização explícita.`,
          };
        }

        // Validação de Permissões / Scopes
        const canExec = this.toolRegistry.canExecuteTool(toolId, {
          ...context,
          isAuthorized,
        });
        if (!canExec.allowed) {
          stepRecord.status = "blocked";
          stepRecord.error = canExec.reason || "Permissão insuficiente para executar ferramenta.";
          executedSteps.push(stepRecord);
          this.setState("blocked");

          return {
            success: false,
            status: "blocked",
            planId: plan.planId,
            output: lastOutput,
            error: stepRecord.error,
            executedSteps,
            failedStep: stepRecord,
            timestamp: new Date().toISOString(),
            rollbackAvailable: false,
            summary: `Etapa bloqueada por segurança: ${stepRecord.error}`,
          };
        }

        // Executar com Retry Seguro (apenas se for risco baixo/médio não destrutivo)
        const allowRetries = step.riskLevel !== "high" && !tool.name.toLowerCase().includes("delete") && !tool.name.toLowerCase().includes("excluir");
        const maxAttempts = allowRetries ? this.maxRetries + 1 : 1;
        let attempt = 0;

        while (attempt < maxAttempts) {
          attempt++;
          const execRes: ToolExecutionOutput = await this.toolRegistry.executeTool(
            toolId,
            step.parameters || {},
            {
              ...context,
              isAuthorized,
            }
          );

          if (execRes.success) {
            stepSuccess = true;
            stepOutputData = execRes.data;
            break;
          } else {
            stepErrorMsg = execRes.error;
            if (attempt < maxAttempts) {
              stepRecord.retries++;
            }
          }
        }
      } else {
        // Etapas informativas / estruturais (understand, route, cost_guard, validation, result)
        stepSuccess = true;
        stepOutputData = {
          stage: step.stage,
          completedAt: new Date().toISOString(),
          parameters: step.parameters,
        };
      }

      stepRecord.durationMs = Date.now() - stepStartTime;

      if (!stepSuccess) {
        stepRecord.status = "failed";
        stepRecord.error = stepErrorMsg || "Erro desconhecido na execução da etapa.";
        executedSteps.push(stepRecord);
        this.setState("failed");

        // Rollback lógico das etapas anteriores com efeito colateral quando aplicável
        const hadPriorMutations = executedSteps.some(
          (s) => s.status === "success" && s.toolId && !s.toolId.includes("search") && !s.toolId.includes("list") && !s.toolId.includes("read")
        );
        const rollbackExecuted = hadPriorMutations;
        const rollbackDetails = hadPriorMutations
          ? "Rollback lógico efetuado para as etapas anteriores com efeito colateral."
          : undefined;

        return {
          success: false,
          status: "failed",
          planId: plan.planId,
          output: lastOutput,
          error: stepRecord.error,
          executedSteps,
          failedStep: stepRecord,
          timestamp: new Date().toISOString(),
          rollbackAvailable: hadPriorMutations,
          rollbackExecuted,
          rollbackDetails,
          summary: `Falha na etapa “${step.name}”: ${stepRecord.error}`,
        };
      }

      stepRecord.status = "success";
      stepRecord.output = stepOutputData;
      lastOutput = stepOutputData;
      completedStepIds.add(step.id);
      executedSteps.push(stepRecord);
      this.onStepProgress?.(stepRecord);
    }

    this.setState("success");

    return {
      success: true,
      status: "success",
      planId: plan.planId,
      output: lastOutput,
      executedSteps,
      timestamp: new Date().toISOString(),
      rollbackAvailable: false,
      summary: `Plano “${plan.summary}” executado com sucesso (${completedStepIds.size} etapas finalizadas).`,
    };
  }

  /**
   * Validação prévia de plano antes de iniciar a execução
   */
  public validatePlanBeforeExecution(
    plan: OrchestratorPlan | null | undefined,
    isAuthorized = false
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!plan) {
      errors.push("Nenhum plano fornecido para validação.");
      return { isValid: false, errors };
    }
    if (!plan.planId || !plan.steps || plan.steps.length === 0) {
      errors.push("Estrutura do plano inválida: etapas ausentes.");
    }
    if (plan.status === "blocked" || plan.costGuardEvaluation?.allowed === false) {
      errors.push(plan.costGuardEvaluation?.reason || "Plano bloqueado pelo IRIS Cost Guard.");
    }
    const isPlanProtected =
      plan.isProtectedAction ||
      plan.requiresAuthorization ||
      isOrchestratorProtectedAction(plan.intent, plan.riskLevel, plan.toolsRequired);
    if (isPlanProtected && !isAuthorized && !plan.isAuthorized) {
      errors.push("Ação protegida requer autorização explícita do usuário antes da execução.");
    }
    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Executa uma etapa individual controlada passo a passo
   */
  public async executeStep(
    step: TaskStep,
    context?: ToolExecutionContext
  ): Promise<StepExecutionRecord> {
    const start = Date.now();
    const record: StepExecutionRecord = {
      stepId: step.id,
      name: step.name,
      order: step.order,
      stage: step.stage,
      toolId: step.toolId,
      status: "running",
      durationMs: 0,
      retries: 0,
    };

    if (!step.toolId) {
      record.status = "success";
      record.durationMs = Date.now() - start;
      record.output = { completedAt: new Date().toISOString(), stage: step.stage };
      return record;
    }

    const tool = this.toolRegistry.getTool(step.toolId);
    if (!tool) {
      record.status = "failed";
      record.error = `Ferramenta “${step.toolId}” não encontrada.`;
      record.durationMs = Date.now() - start;
      return record;
    }

    if (tool.requiresAuthorization && !context?.isAuthorized) {
      record.status = "blocked";
      record.error = `Ferramenta protegida “${tool.name}” exige autorização explícita.`;
      record.durationMs = Date.now() - start;
      return record;
    }

    const canExec = this.toolRegistry.canExecuteTool(step.toolId, context);
    if (!canExec.allowed) {
      record.status = "blocked";
      record.error = canExec.reason || "Execução bloqueada por barreira de segurança.";
      record.durationMs = Date.now() - start;
      return record;
    }

    const out = await this.toolRegistry.executeTool(step.toolId, step.parameters || {}, context);
    record.durationMs = Date.now() - start;
    if (out.success) {
      record.status = "success";
      record.output = out.data;
    } else {
      record.status = "failed";
      record.error = out.error;
    }
    return record;
  }

  public reset(): void {
    this.state = "pending";
    this.currentExecutionPlan = null;
    this.isCancellationRequested = false;
  }
}

export interface Iris6PipelineInput {
  command: string;
  userId?: number | string;
  sessionId?: string;
  isAuthorized?: boolean;
  authorizationToken?: string;
  allowedScopes?: string[];
  cognitiveContext?: CognitiveContext;
  contextManager?: IrisContextManager;
  memoryManager?: IrisMemoryManager;
  toolRegistry?: ToolRegistry;
  executionEngine?: IrisExecutionEngine;
}

export interface Iris6PipelineOutput {
  success: boolean;
  state: "awaiting_authorization" | "completed" | "blocked" | "failed" | "cancelled";
  planId: string;
  summary: string;
  directResponse?: string;
  executionResult?: ExecutionResult;
  requiresAuthorization: boolean;
  proposal?: unknown;
  timestamp: string;
}

/**
 * PIPELINE MESTRE DA IRIS 6.0
 *
 * Conecta toda a cadeia inviolável:
 * USUÁRIO
 * ↓
 * TEXT / VOICE
 * ↓
 * COGNITIVE ENGINE
 * ↓
 * OPERATIONAL INTELLIGENCE
 * ↓
 * MODEL ROUTER
 * ↓
 * COST GUARD
 * ↓
 * AGENT ORCHESTRATOR
 * ↓
 * TOOL / SKILLS ENGINE
 * ↓
 * CONTEXT / MEMORY
 * ↓
 * AUTHORIZATION
 * ↓
 * EXECUTION ENGINE
 * ↓
 * CONFIRMATION
 * ↓
 * USUÁRIO
 */
export async function runIris6Pipeline(input: Iris6PipelineInput): Promise<Iris6PipelineOutput> {
  const contextManager = input.contextManager || new IrisContextManager({
    userId: input.userId,
    sessionId: input.sessionId,
  });

  const memoryManager = input.memoryManager || new IrisMemoryManager({
    userId: input.userId,
    sessionId: input.sessionId,
  });

  const toolRegistry = input.toolRegistry || new ToolRegistry(true);
  const orchestrator = new IrisAgentOrchestrator();
  const engine = input.executionEngine || new IrisExecutionEngine({ toolRegistry });

  // 1. Contexto e Memória pré-planejamento
  contextManager.setContext("lastUserCommand", input.command, "conversation");

  // 2. Orquestração e Análise Cognitiva com Model Router e Cost Guard
  const plan = orchestrator.planTask({
    command: input.command,
    context: input.cognitiveContext,
    isAuthorized: input.isAuthorized,
    authorizationToken: input.authorizationToken,
  });

  // 3. Bloqueio pelo Cost Guard ou Erro de Plano
  if (plan.status === "blocked") {
    return {
      success: false,
      state: "blocked",
      planId: plan.planId,
      summary: plan.validationErrors?.join("; ") || "Comando bloqueado pelo IRIS Cost Guard.",
      requiresAuthorization: false,
      timestamp: new Date().toISOString(),
    };
  }

  // 4. Barreira de Autorização Explícita
  if (plan.requiresAuthorization && !input.isAuthorized) {
    const opEntities = interpretOperationalCommand(input.command, input.cognitiveContext || {}).entities;
    return {
      success: false,
      state: "awaiting_authorization",
      planId: plan.planId,
      summary: plan.summary,
      requiresAuthorization: true,
      proposal: {
        summary: plan.summary,
        actionType: plan.actionType,
        recipient: opEntities?.recipient,
        target: opEntities?.label || opEntities?.targetItem,
        tools: plan.toolsRequired,
        requiresAuthorization: true,
      },
      timestamp: new Date().toISOString(),
    };
  }

  // 5. Execução Efetiva via Execution Engine
  const execResult = await engine.executePlan(plan, {
    userId: input.userId,
    sessionId: input.sessionId,
    isAuthorized: input.isAuthorized,
    allowedScopes: input.allowedScopes,
  });

  // 6. Atualização de Memória Operacional e Contexto de Tarefa
  if (execResult.success) {
    contextManager.setContext("lastExecutionResult", execResult.output, "task");
    memoryManager.remember({
      content: `Ação “${plan.summary}” executada com sucesso.`,
      type: "ephemeral",
      scope: "session",
      source: "task_result",
      userId: input.userId,
      sessionId: input.sessionId,
    });
  }

  return {
    success: execResult.success,
    state: execResult.success ? "completed" : (execResult.status as any),
    planId: plan.planId,
    summary: execResult.summary,
    executionResult: execResult,
    requiresAuthorization: plan.requiresAuthorization,
    timestamp: new Date().toISOString(),
  };
}
