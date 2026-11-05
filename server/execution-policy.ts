export type ExecutionPolicyDecision = "allow" | "deny";

export type ExecutionPolicyInput = {
  riskLevel: "low" | "medium" | "high";
  toolName: string | null;
  approved: boolean;
  userId: number;
  proposalId: number;
};

export type ExecutionPolicyResult = {
  decision: ExecutionPolicyDecision;
  reason: string;
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

function normalizeToolName(toolName: string | null) {
  return (toolName ?? "").trim().toLowerCase();
}

export function evaluateExecutionPolicy(
  input: ExecutionPolicyInput
): ExecutionPolicyResult {
  if (!input.approved) {
    return {
      decision: "deny",
      reason: "A proposta ainda não foi autorizada.",
    };
  }

  const tool = normalizeToolName(input.toolName);

  if (HIGH_RISK_TOOLS.has(tool)) {
    return {
      decision: "allow",
      reason:
        "A proposta foi explicitamente autorizada pelo usuário e a execução está registrada para auditoria.",
    };
  }

  if (input.riskLevel === "high") {
    return {
      decision: "allow",
      reason:
        "A proposta de alto risco foi explicitamente autorizada pelo usuário.",
    };
  }

  return {
    decision: "allow",
    reason:
      "Execução autorizada dentro da política operacional da IRIS.",
  };
}
