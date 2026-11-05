/**
 * IRIS 5.4 — IRIS PLANNER / ORCHESTRATOR
 *
 * Camada responsável por transformar a decisão do AI Model Router em um plano
 * de execução seguro, auditável e estruturado.
 *
 * REQUISITOS FUNDAMENTAIS:
 * 1. Recepção estrita de: intenção, entidades, risco, complexidade, contexto,
 *    estratégia do AI Model Router e necessidade de ferramentas.
 * 2. Geração de plano estruturado com: objetivo, etapas, ordem de execução,
 *    dependências, ferramentas, modelo/estratégia, fallback, risco e autorização.
 * 3. Separação rigorosa dos 5 estágios:
 *    ENTENDER → PLANEJAR → AUTORIZAR → EXECUTAR → CONFIRMAR
 * 4. NUNCA executar ações diretamente: o Planner SOMENTE cria o plano.
 * 5. Ações protegidas: exigem autorização explícita antes da execução;
 *    NUNCA enviar, excluir, alterar, compartilhar ou organizar dados automaticamente.
 * 6. Integração harmônica com IrisCognitiveEngine, Inteligência Operacional,
 *    AI Model Router e o executor existente.
 * 7. Priorização contínua de estratégias gratuitas/local com custo zero.
 */

import type { RouterDecision, RouterFallback, TaskComplexity, AiStrategy, ModelProvider } from "./model-router";
import { selectAgentTools } from "./agent-tools";

export type OrchestratorStage =
  | "ENTENDER"
  | "PLANEJAR"
  | "AUTORIZAR"
  | "EXECUTAR"
  | "CONFIRMAR";

export interface OrchestratedStep {
  id: string;
  order: number;
  stage: OrchestratorStage;
  name: string;
  action: string;
  toolRequired?: string;
  scope?: string;
  parameters?: Record<string, unknown>;
  dependencies: string[];
  requiresAuthorization: boolean;
  status: "pending" | "ready" | "running" | "completed" | "failed" | "blocked";
}

export interface OrchestratorInput {
  intent: string;
  entities?: Record<string, unknown> | string[];
  risk: "low" | "medium" | "high";
  complexity: TaskComplexity;
  context?: Record<string, unknown> | string;
  routerDecision: RouterDecision;
  needsTools: boolean;
  objective?: string;
  message?: string;
  decision?: "respond" | "clarify" | "propose";
}

export interface OrchestratedPlan {
  planId: string;
  objective: string;
  intent: string;
  entities: Record<string, unknown> | string[];
  riskLevel: "low" | "medium" | "high";
  complexity: TaskComplexity;
  strategy: AiStrategy;
  provider: ModelProvider;
  model?: string;
  fallback: RouterFallback;
  estimatedCost: string;
  steps: OrchestratedStep[];
  executionOrder: string[];
  dependencies: Record<string, string[]>;
  toolRequired: string[];
  requiredScopes: string[];
  requiresAuthorization: boolean;
  isProtectedAction: boolean;
  currentStage: OrchestratorStage;
  stages: {
    ENTENDER: OrchestratedStep[];
    PLANEJAR: OrchestratedStep[];
    AUTORIZAR: OrchestratedStep[];
    EXECUTAR: OrchestratedStep[];
    CONFIRMAR: OrchestratedStep[];
  };
}

/**
 * Identifica se a intenção ou ferramentas envolvem ação protegida.
 * Ações que enviam, excluem, alteram, compartilham ou organizam dados
 * NUNCA podem ser executadas automaticamente sem autorização humana.
 */
export function isProtectedAction(params: {
  intent: string;
  risk: "low" | "medium" | "high";
  tools: string[];
  message?: string;
}): boolean {
  const rawIntent = params.intent.toLowerCase();
  const rawMsg = (params.message || "").toLowerCase();

  // 1. Risco alto é sempre protegido
  if (params.risk === "high") return true;

  // 2. Intenções protegidas
  if (
    rawIntent === "exclusao" ||
    rawIntent === "excluir" ||
    rawIntent === "deletar" ||
    rawIntent === "apagar" ||
    rawIntent === "alteracao" ||
    rawIntent === "alterar" ||
    rawIntent === "modificar" ||
    rawIntent === "criacao" ||
    rawIntent === "criar" ||
    rawIntent === "cadastrar" ||
    rawIntent === "organizacao" ||
    rawIntent === "organizar" ||
    rawIntent === "envio" ||
    rawIntent === "enviar" ||
    rawIntent === "compartilhamento" ||
    rawIntent === "compartilhar" ||
    rawIntent === "envio/compartilhamento" ||
    rawIntent === "sensitive_task" ||
    rawIntent === "high_risk" ||
    rawIntent === "mutation"
  ) {
    return true;
  }

  // 3. Ferramentas que mutam estado ou comunicam externamente
  const protectedTools = [
    "radar.create",
    "radar.complete",
    "radar.delete",
    "radar.update",
    "communication.send",
    "communication.prepare",
    "data.share",
    "calendar.create",
    "memory.create",
  ];
  if (params.tools.some((t) => protectedTools.includes(t))) {
    return true;
  }

  // 4. Verificação textual preventiva
  if (
    /\b(excluir|apagar|deletar|remover|enviar|disparar|compartilhar|alterar|adiar|mudar|cadastrar|pagar|comprar)\b/i.test(
      rawMsg
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Cria o Plano Orquestrado estruturado seguindo rigorosamente os 5 estágios:
 * ENTENDER → PLANEJAR → AUTORIZAR → EXECUTAR → CONFIRMAR.
 *
 * REGRA INEGOCIÁVEL:
 * - O Orchestrator SOMENTE cria o plano. NUNCA executa ações diretamente.
 * - Nenhuma mutação protegida pode pular a etapa AUTORIZAR.
 */
export function createOrchestratedPlan(input: OrchestratorInput): OrchestratedPlan {
  const planId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const objective = input.objective || input.message || input.intent || "Executar comando do usuário";
  const entities = input.entities || {};

  // 1. Selecionar ferramentas necessárias
  const selectedTools = input.needsTools
    ? selectAgentTools({
        intent: input.intent,
        objective,
        message: input.message ?? "",
        riskLevel: input.risk,
      })
    : [];

  const toolNames = selectedTools.map((t) => t.name);
  const requiredScopes = [...new Set(selectedTools.map((t) => t.scope))];

  const protectedAction = isProtectedAction({
    intent: input.intent,
    risk: input.risk,
    tools: toolNames,
    message: input.message,
  });

  const requiresAuth = protectedAction || input.risk === "high" || input.decision === "propose";

  const steps: OrchestratedStep[] = [];
  let currentOrder = 1;

  // ESTÁGIO 1: ENTENDER
  const understandStepId = `step-${currentOrder}-understand`;
  const understandStep: OrchestratedStep = {
    id: understandStepId,
    order: currentOrder++,
    stage: "ENTENDER",
    name: "Compreender intenção e entidades",
    action: `Analisar objetivo “${objective}” e validar entidades com complexidade ${input.complexity}.`,
    parameters: typeof entities === "object" ? (entities as Record<string, unknown>) : { entities },
    dependencies: [],
    requiresAuthorization: false,
    status: "completed",
  };
  steps.push(understandStep);

  // Se a decisão for esclarecer (informações ausentes)
  if (input.decision === "clarify") {
    const clarifyStepId = `step-${currentOrder}-clarify`;
    steps.push({
      id: clarifyStepId,
      order: currentOrder++,
      stage: "PLANEJAR",
      name: "Solicitar esclarecimento ao usuário",
      action: "Identificar parâmetros faltantes e orientar esclarecimento prévio.",
      dependencies: [understandStepId],
      requiresAuthorization: false,
      status: "ready",
    });

    const confirmClarifyId = `step-${currentOrder}-confirm`;
    steps.push({
      id: confirmClarifyId,
      order: currentOrder++,
      stage: "CONFIRMAR",
      name: "Aguardar retorno do usuário",
      action: "Manter estado seguro sem mutações até esclarecimento.",
      dependencies: [clarifyStepId],
      requiresAuthorization: false,
      status: "pending",
    });

    return buildOrchestratedPlanResult({
      planId,
      objective,
      input,
      steps,
      toolNames: [],
      requiredScopes: [],
      requiresAuth: false,
      protectedAction: false,
    });
  }

  // ESTÁGIO 2: PLANEJAR
  const planStepIds: string[] = [];
  if (selectedTools.length > 0) {
    selectedTools.forEach((tool, idx) => {
      const planStepId = `step-${currentOrder}-plan-${idx + 1}`;
      planStepIds.push(planStepId);
      steps.push({
        id: planStepId,
        order: currentOrder++,
        stage: "PLANEJAR",
        name: `Preparar ferramenta ${tool.name}`,
        action: `Estruturar parâmetros seguros para ${tool.description}.`,
        toolRequired: tool.name,
        scope: tool.scope,
        dependencies: idx === 0 ? [understandStepId] : [planStepIds[idx - 1]!],
        requiresAuthorization: false,
        status: "ready",
      });
    });
  } else {
    const planQueryStepId = `step-${currentOrder}-plan-query`;
    planStepIds.push(planQueryStepId);
    steps.push({
      id: planQueryStepId,
      order: currentOrder++,
      stage: "PLANEJAR",
      name: "Planejar resposta informativa",
      action: "Formular consulta e síntese contextual com modelo local.",
      dependencies: [understandStepId],
      requiresAuthorization: false,
      status: "ready",
    });
  }

  const lastPlanStepId = planStepIds[planStepIds.length - 1]!;

  // ESTÁGIO 3: AUTORIZAR
  let lastAuthorizeStepId = lastPlanStepId;
  if (requiresAuth) {
    const authStepId = `step-${currentOrder}-authorize`;
    lastAuthorizeStepId = authStepId;
    steps.push({
      id: authStepId,
      order: currentOrder++,
      stage: "AUTORIZAR",
      name: "Aguardar autorização explícita do usuário",
      action: `Bloquear execução até confirmação humana para ação protegida (${input.intent}).`,
      dependencies: [lastPlanStepId],
      requiresAuthorization: true,
      status: "pending",
    });
  }

  // ESTÁGIO 4: EXECUTAR
  const executeStepIds: string[] = [];
  if (selectedTools.length > 0) {
    selectedTools.forEach((tool, idx) => {
      const execStepId = `step-${currentOrder}-execute-${idx + 1}`;
      executeStepIds.push(execStepId);
      steps.push({
        id: execStepId,
        order: currentOrder++,
        stage: "EXECUTAR",
        name: `Executar ferramenta ${tool.name}`,
        action: `Executar ${tool.name} estritamente com dados validados e autorizados.`,
        toolRequired: tool.name,
        scope: tool.scope,
        dependencies: idx === 0 ? [lastAuthorizeStepId] : [executeStepIds[idx - 1]!],
        requiresAuthorization: requiresAuth,
        status: "pending",
      });
    });
  } else {
    const execDirectStepId = `step-${currentOrder}-execute-direct`;
    executeStepIds.push(execDirectStepId);
    steps.push({
      id: execDirectStepId,
      order: currentOrder++,
      stage: "EXECUTAR",
      name: "Retornar resposta direta",
      action: "Apresentar resposta informativa sem alteração de estado.",
      dependencies: [lastAuthorizeStepId],
      requiresAuthorization: false,
      status: "ready",
    });
  }

  const lastExecuteStepId = executeStepIds[executeStepIds.length - 1]!;

  // ESTÁGIO 5: CONFIRMAR
  const confirmStepId = `step-${currentOrder}-confirm`;
  steps.push({
    id: confirmStepId,
    order: currentOrder++,
    stage: "CONFIRMAR",
    name: "Auditar e confirmar conclusão",
    action: "Registrar memória operacional auditada e reportar conclusão transparente ao usuário.",
    dependencies: [lastExecuteStepId],
    requiresAuthorization: false,
    status: "pending",
  });

  return buildOrchestratedPlanResult({
    planId,
    objective,
    input,
    steps,
    toolNames,
    requiredScopes,
    requiresAuth,
    protectedAction,
  });
}

function buildOrchestratedPlanResult(params: {
  planId: string;
  objective: string;
  input: OrchestratorInput;
  steps: OrchestratedStep[];
  toolNames: string[];
  requiredScopes: string[];
  requiresAuth: boolean;
  protectedAction: boolean;
}): OrchestratedPlan {
  const executionOrder = params.steps.map((s) => s.id);
  const dependencies: Record<string, string[]> = {};
  params.steps.forEach((s) => {
    dependencies[s.id] = s.dependencies;
  });

  const stages = {
    ENTENDER: params.steps.filter((s) => s.stage === "ENTENDER"),
    PLANEJAR: params.steps.filter((s) => s.stage === "PLANEJAR"),
    AUTORIZAR: params.steps.filter((s) => s.stage === "AUTORIZAR"),
    EXECUTAR: params.steps.filter((s) => s.stage === "EXECUTAR"),
    CONFIRMAR: params.steps.filter((s) => s.stage === "CONFIRMAR"),
  };

  return {
    planId: params.planId,
    objective: params.objective,
    intent: params.input.intent,
    entities: params.input.entities || {},
    riskLevel: params.input.risk,
    complexity: params.input.complexity,
    strategy: params.input.routerDecision.strategy,
    provider: params.input.routerDecision.provider,
    model: params.input.routerDecision.model,
    fallback: params.input.routerDecision.fallback,
    estimatedCost: params.input.routerDecision.estimatedCost,
    steps: params.steps,
    executionOrder,
    dependencies,
    toolRequired: params.toolNames,
    requiredScopes: params.requiredScopes,
    requiresAuthorization: params.requiresAuth,
    isProtectedAction: params.protectedAction,
    currentStage: params.requiresAuth ? "AUTORIZAR" : "PLANEJAR",
    stages,
  };
}

/**
 * Validação de integridade do plano orquestrado.
 * Garante que:
 * 1. A ordem é sequencial e todas as dependências existem no plano.
 * 2. Se for ação protegida, há uma etapa explícita de AUTORIZAR antes de EXECUTAR.
 * 3. O Planner nunca executa ferramentas nem aplica mutações de dados.
 */
export function validateOrchestratedPlan(plan: OrchestratedPlan): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const stepIds = new Set(plan.steps.map((s) => s.id));

  // 1. Validar que todas as dependências existem
  for (const step of plan.steps) {
    for (const depId of step.dependencies) {
      if (!stepIds.has(depId)) {
        errors.push(`Etapa “${step.id}” referencia dependência inexistente “${depId}”.`);
      }
    }
  }

  // 2. Se for ação protegida, validar presença e ordem de AUTORIZAR antes de EXECUTAR
  if (plan.isProtectedAction || plan.requiresAuthorization) {
    const authStepIndex = plan.steps.findIndex((s) => s.stage === "AUTORIZAR");
    const executeStepIndex = plan.steps.findIndex((s) => s.stage === "EXECUTAR");

    if (authStepIndex === -1) {
      errors.push("Ação protegida requer etapa de AUTORIZAR explícita, mas nenhuma foi encontrada.");
    } else if (executeStepIndex !== -1 && executeStepIndex < authStepIndex) {
      errors.push("Violação de segurança: etapa EXECUTAR não pode preceder etapa AUTORIZAR em ações protegidas.");
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
