/**
 * IRIS 5.4 — EXECUTOR CONTROLADO DA IRIS
 *
 * Conecta o IRIS Planner/Orchestrator ao motor de execução mantendo o fluxo estrito:
 * ENTENDER → ROUTER → PLANEJAR → AUTORIZAR → EXECUTAR → CONFIRMAR.
 *
 * REGRAS FUNDAMENTAIS:
 * 1. O Planner NUNCA executa ações (função puramente declarativa).
 * 2. O Executor SÓ PODE receber um plano VALIDADO.
 * 3. Toda ação protegida exige autorização explícita antes da execução:
 *    - enviar, excluir, alterar, compartilhar, organizar dados, financeiro, mutações.
 * 4. Bloqueio imediato se: plano inválido, falta de autorização, dependência não concluída,
 *    risco incompatível ou ausência de estratégia válida do Router.
 * 5. Execução estrita na ordem do Planner respeitando dependências.
 * 6. Registro auditável de cada etapa, resultado, erro e confirmação final.
 * 7. Fallback seguro: se uma etapa falhar, NUNCA executar ações protegidas alternativas
 *    automaticamente; o estado retorna para decisão/autorização humana.
 */

import { and, eq } from "drizzle-orm";
import { agentAuditLogs, agentExecutions, agentExecutionSteps, agentProposals, aiMemories } from "../drizzle/schema";
import { getAgentTool } from "./agent-tools";
import { getDb } from "./db";
import { evaluateExecutionPolicy } from "./execution-policy";
import {
  validateOrchestratedPlan,
  isProtectedAction,
  type OrchestratedPlan,
  type OrchestratedStep,
  type OrchestratorStage,
} from "./agent-orchestrator";
import type { AgentPlan } from "./agent-planner";

export class AgentExecutionError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "AgentExecutionError";
  }
}

export interface ExecutionStepResult {
  stepId: string;
  order: number;
  stage: OrchestratorStage;
  name: string;
  status: "succeeded" | "failed" | "skipped" | "blocked";
  output?: unknown;
  error?: string;
}

export interface OrchestratedExecutionResult {
  success: boolean;
  planId: string;
  currentStage: OrchestratorStage;
  executedSteps: ExecutionStepResult[];
  completedStepIds: string[];
  failedStep?: ExecutionStepResult;
  fallbackTriggered: boolean;
  fallbackAction?: string;
  summary: string;
}

type ToolStep = { toolName: string; input: unknown; scope?: string };

function parseSteps(toolName: string | null, payload: string): ToolStep[] {
  let parsed: any;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new AgentExecutionError("invalid-tool-input", "Entrada da ferramenta inválida");
  }
  if (Array.isArray(parsed?.steps)) {
    return parsed.steps.map((s: any) => ({ toolName: s.toolName, input: s.input, scope: s.scope }));
  }
  if (!toolName) {
    throw new AgentExecutionError("tool-missing", "A proposta não possui uma ferramenta autorizada");
  }
  return [{ toolName, input: parsed }];
}

/**
 * Validação formal pré-execução de qualquer plano (OrchestratedPlan ou AgentPlan).
 * Rejeita imediatamente a execução se:
 * - O plano estiver nulo ou estruturalmente inválido;
 * - A validação de dependências ou ordem falhar;
 * - Houver ação protegida sem autorização explícita;
 * - O AI Model Router não tiver definido estratégia/modelo válido.
 */
export function validatePlanBeforeExecution(
  plan: OrchestratedPlan | AgentPlan | null | undefined,
  isApproved: boolean
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!plan) {
    errors.push("Nenhum plano fornecido para execução.");
    return { isValid: false, errors };
  }

  // 1. Se contiver plano orquestrado
  const orchestrated: OrchestratedPlan | undefined =
    "stages" in plan && "executionOrder" in plan
      ? (plan as OrchestratedPlan)
      : "orchestrated" in plan && plan.orchestrated
      ? plan.orchestrated
      : undefined;

  if (orchestrated) {
    const valResult = validateOrchestratedPlan(orchestrated);
    if (!valResult.isValid) {
      errors.push(...valResult.errors);
    }

    // Validação da estratégia do AI Model Router
    if (!orchestrated.strategy || !orchestrated.provider) {
      errors.push("O AI Model Router não definiu uma estratégia ou modelo válido para este plano.");
    }

    // Ação protegida sem autorização
    if ((orchestrated.isProtectedAction || orchestrated.requiresAuthorization) && !isApproved) {
      errors.push("Ação protegida requer autorização explícita do usuário antes da execução.");
    }
  } else {
    // AgentPlan legado
    const legacyTools = "tools" in plan && Array.isArray(plan.tools) ? (plan.tools as string[]) : [];
    const isProtected = isProtectedAction({
      intent: "",
      risk: "low",
      tools: legacyTools,
    });
    const legacySteps = "steps" in plan && Array.isArray(plan.steps) ? plan.steps : [];
    const requiresAuth = isProtected || legacySteps.some((s) => Boolean(s && s.requiresAuthorization));

    if (requiresAuth && !isApproved) {
      errors.push("Ação protegida requer autorização explícita do usuário antes da execução.");
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Motor de execução orquestrada para planos estruturados.
 * Executa as etapas na ordem estrita do Planner (executionOrder), verificando dependências
 * e travando imediatamente caso uma etapa falhe, sem jamais disparar ações protegidas alternativas automáticas.
 */
export async function executeOrchestratedPlan(input: {
  plan: OrchestratedPlan;
  isApproved: boolean;
  toolExecutor?: (toolName: string, stepInput: unknown) => Promise<unknown>;
  onStepAudit?: (step: OrchestratedStep, result: ExecutionStepResult) => Promise<void> | void;
}): Promise<OrchestratedExecutionResult> {
  // 1. Validação prévia mandatória
  const preValidation = validatePlanBeforeExecution(input.plan, input.isApproved);
  if (!preValidation.isValid) {
    throw new AgentExecutionError("invalid-plan", preValidation.errors.join("; "));
  }

  const completedStepIds = new Set<string>();
  const executedSteps: ExecutionStepResult[] = [];

  // Ordenar passos pela ordem numérica de execução
  const orderedSteps = [...input.plan.steps].sort((a, b) => a.order - b.order);

  for (const step of orderedSteps) {
    // 2. Checar se todas as dependências da etapa foram concluídas com sucesso
    for (const depId of step.dependencies) {
      if (!completedStepIds.has(depId)) {
        const blockedResult: ExecutionStepResult = {
          stepId: step.id,
          order: step.order,
          stage: step.stage,
          name: step.name,
          status: "blocked",
          error: `Dependência anterior “${depId}” não foi concluída com sucesso.`,
        };
        executedSteps.push(blockedResult);
        if (input.onStepAudit) await input.onStepAudit(step, blockedResult);

        return {
          success: false,
          planId: input.plan.planId,
          currentStage: step.stage,
          executedSteps,
          completedStepIds: Array.from(completedStepIds),
          failedStep: blockedResult,
          fallbackTriggered: true,
          fallbackAction: "Interromper execução com segurança devido a dependência quebrada.",
          summary: `Execução interrompida na etapa ${step.name}: dependência ${depId} não concluída.`,
        };
      }
    }

    // 3. Estágio ENTENDER
    if (step.stage === "ENTENDER") {
      const stepResult: ExecutionStepResult = {
        stepId: step.id,
        order: step.order,
        stage: step.stage,
        name: step.name,
        status: "succeeded",
        output: { understood: true, parameters: step.parameters },
      };
      executedSteps.push(stepResult);
      completedStepIds.add(step.id);
      if (input.onStepAudit) await input.onStepAudit(step, stepResult);
      continue;
    }

    // 4. Estágio PLANEJAR
    if (step.stage === "PLANEJAR") {
      const stepResult: ExecutionStepResult = {
        stepId: step.id,
        order: step.order,
        stage: step.stage,
        name: step.name,
        status: "succeeded",
        output: { prepared: true, tool: step.toolRequired },
      };
      executedSteps.push(stepResult);
      completedStepIds.add(step.id);
      if (input.onStepAudit) await input.onStepAudit(step, stepResult);
      continue;
    }

    // 5. Estágio AUTORIZAR
    if (step.stage === "AUTORIZAR") {
      if (!input.isApproved) {
        const authFailedResult: ExecutionStepResult = {
          stepId: step.id,
          order: step.order,
          stage: step.stage,
          name: step.name,
          status: "failed",
          error: "Autorização explícita do usuário não foi concedida.",
        };
        executedSteps.push(authFailedResult);
        if (input.onStepAudit) await input.onStepAudit(step, authFailedResult);

        throw new AgentExecutionError(
          "authorization-required",
          "Execução bloqueada: autorização explícita do usuário não foi concedida para ação protegida."
        );
      }

      const stepResult: ExecutionStepResult = {
        stepId: step.id,
        order: step.order,
        stage: step.stage,
        name: step.name,
        status: "succeeded",
        output: { authorized: true, timestamp: new Date().toISOString() },
      };
      executedSteps.push(stepResult);
      completedStepIds.add(step.id);
      if (input.onStepAudit) await input.onStepAudit(step, stepResult);
      continue;
    }

    // 6. Estágio EXECUTAR
    if (step.stage === "EXECUTAR") {
      if (step.requiresAuthorization && !input.isApproved) {
        throw new AgentExecutionError(
          "authorization-required",
          `Etapa ${step.name} requer autorização prévia e não pode ser executada.`
        );
      }

      try {
        let stepOutput: unknown = { directResponse: true };
        if (step.toolRequired && input.toolExecutor) {
          stepOutput = await input.toolExecutor(step.toolRequired, step.parameters);
        }

        const stepResult: ExecutionStepResult = {
          stepId: step.id,
          order: step.order,
          stage: step.stage,
          name: step.name,
          status: "succeeded",
          output: stepOutput,
        };
        executedSteps.push(stepResult);
        completedStepIds.add(step.id);
        if (input.onStepAudit) await input.onStepAudit(step, stepResult);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const failedResult: ExecutionStepResult = {
          stepId: step.id,
          order: step.order,
          stage: step.stage,
          name: step.name,
          status: "failed",
          error: errorMsg,
        };
        executedSteps.push(failedResult);
        if (input.onStepAudit) await input.onStepAudit(step, failedResult);

        // REGRA DE OURO 8: NUNCA executar ações protegidas alternativas automaticamente.
        // Retornar o estado com segurança para decisão/autorização humana.
        return {
          success: false,
          planId: input.plan.planId,
          currentStage: "EXECUTAR",
          executedSteps,
          completedStepIds: Array.from(completedStepIds),
          failedStep: failedResult,
          fallbackTriggered: true,
          fallbackAction: "Interrupção segura sem execução de ações protegidas alternativas automáticas.",
          summary: `Falha na etapa de execução “${step.name}”: ${errorMsg}. Estado preservado para decisão humana.`,
        };
      }
      continue;
    }

    // 7. Estágio CONFIRMAR
    if (step.stage === "CONFIRMAR") {
      const stepResult: ExecutionStepResult = {
        stepId: step.id,
        order: step.order,
        stage: step.stage,
        name: step.name,
        status: "succeeded",
        output: { confirmed: true, audited: true },
      };
      executedSteps.push(stepResult);
      completedStepIds.add(step.id);
      if (input.onStepAudit) await input.onStepAudit(step, stepResult);
      continue;
    }
  }

  return {
    success: true,
    planId: input.plan.planId,
    currentStage: "CONFIRMAR",
    executedSteps,
    completedStepIds: Array.from(completedStepIds),
    fallbackTriggered: false,
    summary: `Plano ${input.plan.planId} executado com sucesso em todas as etapas autorizadas.`,
  };
}

/**
 * Executa uma proposta de agente explicitamente autorizada pelo usuário,
 * validando o plano orquestrado, as permissões de escopo e a política de execução.
 */
export async function executeApprovedProposal(userId: number, proposalId: number) {
  const db = await getDb();
  if (!db) throw new AgentExecutionError("database-unavailable", "Banco de dados indisponível");

  const rows = await db
    .select()
    .from(agentProposals)
    .where(and(eq(agentProposals.id, proposalId), eq(agentProposals.userId, userId)))
    .limit(1);
  const proposal = rows[0];
  if (!proposal) throw new AgentExecutionError("proposal-not-found", "Proposta não encontrada");
  if (proposal.status !== "approved") {
    throw new AgentExecutionError(
      "proposal-not-approved",
      "A proposta precisa estar autorizada antes da execução"
    );
  }
  if (proposal.expiresAt.getTime() <= Date.now()) {
    await db
      .update(agentProposals)
      .set({ status: "expired" })
      .where(and(eq(agentProposals.id, proposal.id), eq(agentProposals.userId, userId), eq(agentProposals.status, "approved")));
    await db.insert(agentAuditLogs).values({
      userId,
      proposalId,
      event: "proposal_expired_before_execution",
      toolName: proposal.toolName ?? null,
      details: JSON.stringify({ reason: "expired" }),
    });
    throw new AgentExecutionError("proposal-expired", "Esta proposta expirou. Gere uma nova proposta.");
  }

  // Validação formal do plano pré-execução
  let parsedPlan: any = null;
  try {
    parsedPlan = proposal.plan ? JSON.parse(proposal.plan) : null;
  } catch {
    throw new AgentExecutionError("invalid-plan", "O plano anexado à proposta possui formato inválido.");
  }

  const planValidation = validatePlanBeforeExecution(parsedPlan, proposal.status === "approved");
  if (!planValidation.isValid) {
    throw new AgentExecutionError("invalid-plan", planValidation.errors.join("; "));
  }

  const executionPolicy = evaluateExecutionPolicy({
    riskLevel: proposal.riskLevel,
    toolName: proposal.toolName,
    approved: proposal.status === "approved",
    userId,
    proposalId,
  });

  await db.insert(agentAuditLogs).values({
    userId,
    proposalId,
    event:
      executionPolicy.decision === "allow"
        ? "execution_policy_allowed"
        : "execution_policy_denied",
    toolName: proposal.toolName ?? null,
    details: JSON.stringify({
      decision: executionPolicy.decision,
      reason: executionPolicy.reason,
      riskLevel: proposal.riskLevel,
      modelProvider: proposal.modelProvider,
    }),
  });

  if (executionPolicy.decision === "deny") {
    throw new AgentExecutionError("execution-policy-denied", executionPolicy.reason);
  }

  const steps = parseSteps(proposal.toolName, proposal.payload);
  let allowedScopes: string[] = [];
  try {
    allowedScopes = proposal.requiredScopes ? JSON.parse(proposal.requiredScopes) : [];
  } catch {
    throw new AgentExecutionError("invalid-permissions", "Permissões da proposta inválidas");
  }
  if (!steps.length || steps.length > 8) {
    throw new AgentExecutionError("invalid-plan", "Plano de execução inválido");
  }

  const tools = steps.map((step) => {
    if (typeof step.toolName !== "string") {
      throw new AgentExecutionError("tool-missing", "Etapa sem ferramenta");
    }
    const tool = getAgentTool(step.toolName);
    if (!tool) throw new AgentExecutionError("tool-not-allowed", `Ferramenta não disponível: ${step.toolName}`);
    if (!allowedScopes.includes(tool.scope)) {
      throw new AgentExecutionError("scope-denied", `Permissão insuficiente para ${step.toolName}`);
    }
    const parsedInput = tool.inputSchema.safeParse(step.input);
    if (!parsedInput.success) {
      throw new AgentExecutionError("invalid-tool-input", `Entrada inválida para ${step.toolName}`);
    }
    return tool;
  });

  const claimed = await db
    .update(agentProposals)
    .set({ status: "executing", confirmedAt: proposal.confirmedAt ?? new Date() })
    .where(and(eq(agentProposals.id, proposal.id), eq(agentProposals.userId, userId), eq(agentProposals.status, "approved")));
  if ((claimed as any).rowsAffected !== undefined && (claimed as any).rowsAffected !== 1) {
    throw new AgentExecutionError("proposal-replay", "A proposta já foi processada");
  }

  const execution = await db.insert(agentExecutions).values({
    proposalId,
    userId,
    toolName: tools.map((t) => t.name).join(","),
    status: "running",
    input: JSON.stringify({ steps: steps.map((s) => ({ toolName: s.toolName, scope: s.scope ?? null })) }),
  });
  const executionId = Number(execution[0].insertId);
  await db.insert(agentAuditLogs).values({
    userId,
    proposalId,
    executionId,
    event: "execution_started",
    toolName: proposal.toolName ?? null,
    details: JSON.stringify({
      riskLevel: proposal.riskLevel,
      modelProvider: proposal.modelProvider,
      steps: tools.map((t) => t.name),
    }),
  });

  const outputs: unknown[] = [];
  try {
    for (let i = 0; i < steps.length; i++) {
      const tool = tools[i];
      const step = steps[i];
      const idempotencyKey = `proposal:${proposalId}:step:${i + 1}`;
      const existing = await db
        .select()
        .from(agentExecutionSteps)
        .where(eq(agentExecutionSteps.idempotencyKey, idempotencyKey))
        .limit(1);
      if (existing[0]?.status === "succeeded") {
        outputs.push(existing[0].output ? JSON.parse(existing[0].output) : null);
        continue;
      }
      const stepRow = await db.insert(agentExecutionSteps).values({
        executionId,
        userId,
        stepIndex: i + 1,
        toolName: tool.name,
        idempotencyKey,
        input: JSON.stringify(step.input),
        status: "running",
      });
      const stepId = Number(stepRow[0].insertId);
      await db.insert(agentAuditLogs).values({
        userId,
        proposalId,
        executionId,
        event: "tool_started",
        toolName: tool.name,
        details: JSON.stringify({ step: i + 1, total: steps.length, scope: tool.scope, idempotencyKey }),
      });

      const result = await tool.execute({ db, userId }, step.input);
      outputs.push(result.result);
      await db
        .update(agentExecutionSteps)
        .set({ status: "succeeded", output: JSON.stringify(result.result), finishedAt: new Date() })
        .where(eq(agentExecutionSteps.id, stepId));
      await db.insert(agentAuditLogs).values({
        userId,
        proposalId,
        executionId,
        event: "tool_succeeded",
        toolName: tool.name,
        details: JSON.stringify({ step: i + 1, result: result.result }),
      });
    }

    const summary = JSON.stringify({ proposalId, executionId, tools: tools.map((t) => t.name), results: outputs });
    await db.transaction(async (tx) => {
      await tx
        .update(agentProposals)
        .set({ status: "executed", executedAt: new Date() })
        .where(and(eq(agentProposals.id, proposal.id), eq(agentProposals.userId, userId), eq(agentProposals.status, "executing")));
      await tx
        .update(agentExecutions)
        .set({ status: "succeeded", output: summary, finishedAt: new Date() })
        .where(and(eq(agentExecutions.id, executionId), eq(agentExecutions.userId, userId)));
      await tx.insert(aiMemories).values({
        userId,
        content: `Execução autorizada concluída: ${tools.map((t) => t.name).join(", ")}. Resultado: ${JSON.stringify(
          outputs
        ).slice(0, 1500)}`,
        source: "agent-execution",
      });
      await tx.insert(agentAuditLogs).values({
        userId,
        proposalId,
        executionId,
        event: "execution_succeeded",
        toolName: proposal.toolName ?? null,
        details: summary,
      });
    });
    return {
      success: true as const,
      proposalId,
      executionId,
      toolName: proposal.toolName,
      result: outputs.length === 1 ? outputs[0] : outputs,
    };
  } catch (error) {
    const code = error instanceof AgentExecutionError ? error.code : "tool-execution-failed";
    await db
      .update(agentExecutionSteps)
      .set({ status: "failed", errorCode: code, finishedAt: new Date() })
      .where(and(eq(agentExecutionSteps.executionId, executionId), eq(agentExecutionSteps.status, "running")));
    // Mantém estado seguro: devolve a proposta para o estado approved ou preserva para decisão humana
    // Sem jamais disparar mutações alternativas
    await db
      .update(agentProposals)
      .set({ status: "approved" })
      .where(and(eq(agentProposals.id, proposal.id), eq(agentProposals.userId, userId), eq(agentProposals.status, "executing")));
    await db
      .update(agentExecutions)
      .set({
        status: "failed",
        errorCode: code,
        output: JSON.stringify({ message: error instanceof Error ? error.message : "unknown", completedSteps: outputs.length }),
        finishedAt: new Date(),
      })
      .where(and(eq(agentExecutions.id, executionId), eq(agentExecutions.userId, userId)));
    await db.insert(agentAuditLogs).values({
      userId,
      proposalId,
      executionId,
      event: "execution_failed",
      toolName: proposal.toolName ?? null,
      details: JSON.stringify({ code, completedSteps: outputs.length }),
    });
    throw error instanceof AgentExecutionError ? error : new AgentExecutionError(code, "A execução da ferramenta falhou");
  }
}
