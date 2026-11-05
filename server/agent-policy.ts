export type AgentRisk = "low" | "medium" | "high";

export type AgentDecision = "respond" | "clarify" | "propose";

/**
 * ESTÁGIOS DO FLUXO COGNITIVO DA IRIS:
 * ENTENDER → ANALISAR → DECIDIR → PEDIR AUTORIZAÇÃO → EXECUTAR → CONFIRMAR
 */
export type IrisCognitiveStage =
  | "ENTENDER"
  | "ANALISAR"
  | "DECIDIR"
  | "PEDIR_AUTORIZACAO"
  | "EXECUTAR"
  | "CONFIRMAR";

/**
 * MODOS DE INTERAÇÃO DA IRIS:
 * - INFORMAR: Apenas apresenta dados/respostas, sem alterar nada.
 * - ANALISAR: Examina contexto, laudos, métricas e tendências a pedido do usuário.
 * - SUGERIR: Propõe ideias ou recomendações conceituais (nunca auto-executadas).
 * - PROPOR_ACAO: Estrutura uma ação concreta para avaliação do usuário.
 * - PEDIR_AUTORIZACAO: Bloqueia a execução até que o usuário autorize explicitamente.
 * - EXECUTAR: Roda exclusivamente ações autorizadas, idempotentes e auditadas.
 * - CONFIRMAR_RESULTADO: Reporta a conclusão da execução com transparência total.
 */
export type IrisInteractionMode =
  | "INFORMAR"
  | "ANALISAR"
  | "SUGERIR"
  | "PROPOR_ACAO"
  | "PEDIR_AUTORIZACAO"
  | "EXECUTAR"
  | "CONFIRMAR_RESULTADO";

export type Understanding = {
  intent: string;
  objective: string;
  entities: string[];
  missingInformation: string[];
  confidence: number;
  riskLevel: AgentRisk;
  requiresAuthorization: boolean;

  // Campos operacionais para governança estrita
  externalAction?: boolean;
  destructiveAction?: boolean;
  modifiesExternalData?: boolean;
  sendsCommunication?: boolean;
  sharesData?: boolean;
  organizesData?: boolean;
  paymentAction?: boolean;
  toolName?: string | null;
  stage?: IrisCognitiveStage;
  interactionMode?: IrisInteractionMode;
};

export type PolicyResult = {
  decision: AgentDecision;
  reason: string;
  requiresExplicitAuthorization: boolean;
  riskLevel: AgentRisk;
  interactionMode: IrisInteractionMode;
  actionClass:
    | "informational"
    | "external"
    | "destructive"
    | "communication"
    | "data_change"
    | "data_sharing"
    | "organize_data"
    | "financial";
};

const HIGH_RISK_TOOLS = new Set([
  "delete",
  "remove",
  "destroy",
  "send",
  "publish",
  "share",
  "transfer",
  "payment",
  "purchase",
]);

function normalizedToolName(toolName?: string | null) {
  return (toolName ?? "").trim().toLowerCase();
}

export function evaluatePolicy(input: Understanding): PolicyResult {
  if (input.missingInformation.length > 0) {
    return {
      decision: "clarify",
      reason: "Faltam informações necessárias para uma proposta segura.",
      requiresExplicitAuthorization: false,
      riskLevel: input.riskLevel,
      interactionMode: "INFORMAR",
      actionClass: "informational",
    };
  }

  const toolName = normalizedToolName(input.toolName);

  const destructive =
    input.destructiveAction === true ||
    ["delete", "remove", "destroy"].includes(toolName);

  const communication =
    input.sendsCommunication === true ||
    ["send", "publish"].includes(toolName);

  const sharing =
    input.sharesData === true ||
    toolName === "share";

  const financial =
    input.paymentAction === true ||
    ["payment", "purchase", "transfer"].includes(toolName);

  const dataChange =
    input.modifiesExternalData === true;

  const organizesData =
    input.organizesData === true ||
    ["organize", "move", "archive", "reorganize"].includes(toolName);

  const external =
    input.externalAction === true ||
    input.requiresAuthorization === true ||
    destructive ||
    communication ||
    sharing ||
    financial ||
    dataChange ||
    organizesData;

  if (destructive) {
    return {
      decision: "propose",
      reason: "A ação pode excluir ou destruir dados e exige autorização explícita.",
      requiresExplicitAuthorization: true,
      riskLevel: "high",
      interactionMode: "PEDIR_AUTORIZACAO",
      actionClass: "destructive",
    };
  }

  if (financial) {
    return {
      decision: "propose",
      reason: "A ação possui impacto financeiro e exige autorização explícita.",
      requiresExplicitAuthorization: true,
      riskLevel: "high",
      interactionMode: "PEDIR_AUTORIZACAO",
      actionClass: "financial",
    };
  }

  if (communication) {
    return {
      decision: "propose",
      reason: "A ação enviará ou publicará uma comunicação externa e exige autorização explícita.",
      requiresExplicitAuthorization: true,
      riskLevel: input.riskLevel === "low" ? "medium" : input.riskLevel,
      interactionMode: "PEDIR_AUTORIZACAO",
      actionClass: "communication",
    };
  }

  if (sharing) {
    return {
      decision: "propose",
      reason: "A ação compartilhará dados com um serviço externo e exige autorização explícita.",
      requiresExplicitAuthorization: true,
      riskLevel: input.riskLevel === "low" ? "medium" : input.riskLevel,
      interactionMode: "PEDIR_AUTORIZACAO",
      actionClass: "data_sharing",
    };
  }

  if (dataChange) {
    return {
      decision: "propose",
      reason: "A ação altera dados e exige autorização explícita.",
      requiresExplicitAuthorization: true,
      riskLevel: input.riskLevel === "low" ? "medium" : input.riskLevel,
      interactionMode: "PEDIR_AUTORIZACAO",
      actionClass: "data_change",
    };
  }

  if (organizesData) {
    return {
      decision: "propose",
      reason: "A ação organiza ou move dados e exige autorização explícita.",
      requiresExplicitAuthorization: true,
      riskLevel: input.riskLevel === "low" ? "medium" : input.riskLevel,
      interactionMode: "PEDIR_AUTORIZACAO",
      actionClass: "organize_data",
    };
  }

  if (external) {
    return {
      decision: "propose",
      reason: "A ação possui efeito operacional externo e precisa de autorização explícita.",
      requiresExplicitAuthorization: true,
      riskLevel: input.riskLevel,
      interactionMode: "PEDIR_AUTORIZACAO",
      actionClass: "external",
    };
  }

  if (input.riskLevel !== "low") {
    return {
      decision: "propose",
      reason: "A ação foi classificada acima de baixo risco e requer confirmação antes da execução.",
      requiresExplicitAuthorization: true,
      riskLevel: input.riskLevel,
      interactionMode: "PEDIR_AUTORIZACAO",
      actionClass: "external",
    };
  }

  const isAnalysis = /\b(analis|compar|avali|tendenc|grafic|histor|explic|como esta|o que tem)\w*/i.test(input.intent + " " + input.objective);
  const isSuggestion = /\b(sugir|sugestao|ideia|recomenda|oportunidade)\w*/i.test(input.intent + " " + input.objective);

  return {
    decision: "respond",
    reason: "Nenhuma ação externa ou persistente foi identificada.",
    requiresExplicitAuthorization: false,
    riskLevel: "low",
    interactionMode: isAnalysis ? "ANALISAR" : isSuggestion ? "SUGERIR" : "INFORMAR",
    actionClass: "informational",
  };
}
