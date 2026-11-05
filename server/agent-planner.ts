import { selectAgentTools } from "./agent-tools";
import {
  createOrchestratedPlan,
  type OrchestratedPlan,
  type OrchestratorStage,
} from "./agent-orchestrator";
import {
  routeAiStrategy,
  type RouterDecision,
  type TaskComplexity,
} from "./model-router";

export type PlanStep = {
  id: string;
  action: string;
  requiresAuthorization: boolean;
  toolName?: string;
  scope?: string;
  dependency?: string | null;
  stage?: OrchestratorStage;
  order?: number;
};

export type AgentPlan = {
  version: 2;
  steps: PlanStep[];
  tools: string[];
  requiredScopes: string[];
  orchestrated?: OrchestratedPlan;
  executionOrder?: string[];
  dependencies?: Record<string, string[]>;
};

export function buildPlan(input: {
  intent: string;
  objective: string;
  message?: string;
  decision: "respond" | "clarify" | "propose";
  riskLevel: "low" | "medium" | "high";
  routerDecision?: RouterDecision;
  complexity?: TaskComplexity;
  entities?: Record<string, unknown> | string[];
}): AgentPlan {
  // Se o routerDecision não foi injetado diretamente, gera decisão local gratuita com custo zero
  const routerDecision =
    input.routerDecision ||
    routeAiStrategy({
      intent: input.intent,
      risk: input.riskLevel,
      context: input.message ?? input.objective,
      needsTools: input.decision === "propose",
      requested: "auto",
    });

  const orchestrated = createOrchestratedPlan({
    intent: input.intent,
    objective: input.objective,
    message: input.message,
    risk: input.riskLevel,
    complexity: input.complexity || routerDecision.complexity,
    context: input.message ?? input.objective,
    routerDecision,
    needsTools: input.decision === "propose",
    decision: input.decision,
    entities: input.entities,
  });

  if (input.decision === "respond") {
    return {
      version: 2,
      tools: [],
      requiredScopes: [],
      steps: [
        {
          id: "respond",
          action: "Responder ao usuário sem executar ação externa.",
          requiresAuthorization: false,
          stage: "EXECUTAR",
          order: 1,
        },
      ],
      orchestrated,
      executionOrder: orchestrated.executionOrder,
      dependencies: orchestrated.dependencies,
    };
  }

  if (input.decision === "clarify") {
    return {
      version: 2,
      tools: [],
      requiredScopes: [],
      steps: [
        {
          id: "clarify",
          action: "Solicitar as informações que faltam antes de criar uma proposta.",
          requiresAuthorization: false,
          stage: "PLANEJAR",
          order: 1,
        },
      ],
      orchestrated,
      executionOrder: orchestrated.executionOrder,
      dependencies: orchestrated.dependencies,
    };
  }

  const tools = selectAgentTools({
    intent: input.intent,
    objective: input.objective,
    message: input.message ?? "",
    riskLevel: input.riskLevel,
  });
  const selectedTools = tools.map((t) => t.name);
  const scopes = [...new Set(tools.map((t) => t.scope))];

  return {
    version: 2,
    tools: selectedTools,
    requiredScopes: scopes,
    steps: [
      {
        id: "understand",
        action: `Confirmar objetivo: ${input.objective || input.intent}.`,
        requiresAuthorization: false,
        stage: "ENTENDER",
        order: 1,
      },
      ...tools.map((tool, index) => ({
        id: `tool-${index + 1}`,
        action: `Preparar ${tool.name}: ${tool.description}`,
        requiresAuthorization: true,
        toolName: tool.name,
        scope: tool.scope,
        dependency: index > 0 ? `tool-${index}` : null,
        stage: "PLANEJAR" as OrchestratorStage,
        order: index + 2,
      })),
      {
        id: "authorize",
        action: "Aguardar autorização explícita do usuário.",
        requiresAuthorization: true,
        stage: "AUTORIZAR",
        order: tools.length + 2,
      },
      {
        id: "execute",
        action: "Executar somente as ferramentas registradas e autorizadas.",
        requiresAuthorization: true,
        stage: "EXECUTAR",
        order: tools.length + 3,
      },
    ],
    orchestrated,
    executionOrder: orchestrated.executionOrder,
    dependencies: orchestrated.dependencies,
  };
}
