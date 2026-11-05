import { describe, expect, it, vi } from "vitest";
import {
  IrisAgentOrchestrator,
  isOrchestratorProtectedAction,
  inferOrchestratorTools,
  type TaskStep,
} from "./irisAgentOrchestrator";

describe("IRIS 6.0 — FASE 5: AGENT ORCHESTRATOR", () => {
  describe("1. Plano Simples (Consulta informativa sem mutação)", () => {
    it("cria plano com custo zero e status idle sem exigir autorização", () => {
      const orchestrator = new IrisAgentOrchestrator();
      const plan = orchestrator.planTask({
        command: "Qual é a previsão do tempo para amanhã?",
      });

      expect(plan.requiresAuthorization).toBe(false);
      expect(plan.isProtectedAction).toBe(false);
      expect(plan.costGuardEvaluation.allowed).toBe(true);
      expect(plan.costGuardEvaluation.tier).toBe("local");
      expect(orchestrator.getState()).toBe("idle");
      expect(plan.steps.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("2. Plano Complexo e Múltiplas Etapas com Dependências", () => {
    it("divide tarefas complexas em etapas ordenadas com dependências sequenciais", () => {
      const orchestrator = new IrisAgentOrchestrator();
      const plan = orchestrator.planTask({
        command: "organizar todas as faturas e cadastrar novo seguro de saúde dia 20 R$ 450",
      });

      expect(plan.steps.length).toBeGreaterThanOrEqual(4);
      expect(plan.executionOrder.length).toBe(plan.steps.length);

      // Checa se cada etapa posterior depende da anterior
      for (let i = 1; i < plan.steps.length; i++) {
        const step = plan.steps[i];
        expect(step.dependencies.length).toBeGreaterThan(0);
        expect(step.order).toBe(i + 1);
      }
    });
  });

  describe("3. Exigência de Autorização para Ações Protegidas", () => {
    it("coloca o orquestrador em awaiting_authorization para ações protegidas (exclusão/envio/organização)", () => {
      const orchestrator = new IrisAgentOrchestrator();
      const plan = orchestrator.planTask({
        command: "excluir seguro do carro imediatamente",
      });

      expect(plan.requiresAuthorization).toBe(true);
      expect(plan.isProtectedAction).toBe(true);
      expect(orchestrator.getState()).toBe("awaiting_authorization");
    });

    it("impede execução quando autorização for obrigatória e não foi concedida", async () => {
      const orchestrator = new IrisAgentOrchestrator();
      orchestrator.planTask({
        command: "enviar relatório financeiro por email para diretoria",
      });

      const executor = vi.fn().mockResolvedValue({ sent: true });
      const result = await orchestrator.executePlan(executor);

      expect(result.success).toBe(false);
      expect(result.state).toBe("awaiting_authorization");
      expect(result.error).toContain("Autorização explícita ausente");
      expect(executor).not.toHaveBeenCalled();
    });

    it("permite execução após autorização explícita do usuário", async () => {
      const orchestrator = new IrisAgentOrchestrator();
      orchestrator.planTask({
        command: "cadastrar conta de luz dia 15",
      });

      expect(orchestrator.getState()).toBe("awaiting_authorization");

      // Conceder autorização explícita
      const authorized = orchestrator.authorize("token-confirmacao-123");
      expect(authorized).toBe(true);
      expect(orchestrator.getState()).toBe("idle");
      expect(orchestrator.getCurrentPlan()?.isAuthorized).toBe(true);

      const executor = vi.fn().mockResolvedValue({ created: true });
      const result = await orchestrator.executePlan(executor);

      expect(result.success).toBe(true);
      expect(result.state).toBe("completed");
      expect(executor).toHaveBeenCalled();
    });
  });

  describe("4. Bloqueio pelo IRIS Cost Guard", () => {
    it("bloqueia o plano quando o modelo ou recurso for pago e não permitido pelo Cost Guard", async () => {
      const orchestrator = new IrisAgentOrchestrator();
      const plan = orchestrator.planTask({
        command: "executar modelo gpt-4o pago sem permissão",
        routerDecision: {
          intent: "mutation",
          complexity: "COMPLEXA",
          risk: "high",
          strategy: "capable_cloud",
          model: "gpt-4o",
          costLevel: "high_capability",
          estimatedCost: 0.15,
          fallback: {
            strategy: "local_balanced",
            model: "iris-local-balanced",
            costLevel: "free_local",
            estimatedCost: 0,
            reason: "Fallback",
            available: true,
          },
          status: "blocked",
          reason: "Recurso pago bloqueado pelo IRIS Cost Guard.",
          isBlocked: true,
          authorizationRequired: true,
          billingNotice: "Bloqueado",
        },
      });

      expect(orchestrator.getState()).toBe("blocked");
      expect(plan.validationErrors).toBeDefined();

      const executor = vi.fn();
      const result = await orchestrator.executePlan(executor);

      expect(result.success).toBe(false);
      expect(result.state).toBe("blocked");
      expect(executor).not.toHaveBeenCalled();
    });
  });

  describe("5. Ferramenta Indisponível", () => {
    it("bloqueia o plano se uma ferramenta necessária não estiver disponível", async () => {
      const orchestrator = new IrisAgentOrchestrator();
      const plan = orchestrator.planTask({
        command: "enviar mensagem por email",
        availableTools: ["radar.read"], // communication.send não está disponível
      });

      expect(orchestrator.getState()).toBe("blocked");
      expect(plan.validationErrors?.some((e) => e.includes("indisponível"))).toBe(true);
    });
  });

  describe("6. Controle de Sucesso, Falha e Dependências", () => {
    it("interrompe a execução com segurança quando uma etapa intermediária falha", async () => {
      const orchestrator = new IrisAgentOrchestrator();
      orchestrator.planTask({
        command: "organizar contas de casa",
        isAuthorized: true,
      });

      let callCount = 0;
      const executor = vi.fn().mockImplementation(async (step: TaskStep) => {
        callCount++;
        if (step.stage === "select_tools") {
          throw new Error("Falha simulada na execução da ferramenta.");
        }
        return { step: step.id };
      });

      const result = await orchestrator.executePlan(executor);

      expect(result.success).toBe(false);
      expect(result.state).toBe("failed");
      expect(result.failedStep).toBeDefined();
      expect(result.failedStep?.error).toContain("Falha simulada");
      expect(orchestrator.getState()).toBe("failed");
    });
  });

  describe("7. Cancelamento Seguro", () => {
    it("permite o cancelamento do plano sem efetuar mutações", () => {
      const orchestrator = new IrisAgentOrchestrator();
      orchestrator.planTask({
        command: "excluir dados antigos",
      });

      expect(orchestrator.getState()).toBe("awaiting_authorization");

      const cancelResult = orchestrator.cancel("Usuário desistiu da ação");
      expect(cancelResult.success).toBe(true);
      expect(cancelResult.state).toBe("cancelled");
      expect(orchestrator.getState()).toBe("cancelled");
    });
  });

  describe("8. Fallback Seguro", () => {
    it("aciona fallback seguro quando a ferramenta primária falha e o fallback está configurado", async () => {
      const orchestrator = new IrisAgentOrchestrator();
      orchestrator.planTask({
        command: "atualizar registro",
        isAuthorized: true,
      });

      const executor = vi.fn().mockImplementation(async (step: TaskStep) => {
        if (step.toolId === "radar.update") {
          throw new Error("Item bloqueado para atualização");
        }
        if (step.toolId === "radar.read") {
          return { fallbackData: "leitura realizada com sucesso" };
        }
        return { ok: true };
      });

      const result = await orchestrator.executePlan(executor);
      expect(result.success).toBe(true);
      expect(result.fallbackUsed).toBe(true);
      expect(result.state).toBe("completed");
    });
  });

  describe("9. Observabilidade e Proteção de Dados Sensíveis", () => {
    it("registra logs estruturados sem expor tokens ou credenciais", () => {
      const orchestrator = new IrisAgentOrchestrator();
      orchestrator.planTask({
        command: "consultar saldo com Bearer secret-token-xyz123 e password: mySuperSecretPassword",
      });

      const logs = orchestrator.getAuditLogs();
      expect(logs.length).toBeGreaterThan(0);
      const allLogText = logs.map((l) => l.message).join(" ");
      expect(allLogText).not.toContain("secret-token-xyz123");
      expect(allLogText).not.toContain("mySuperSecretPassword");
    });
  });

  describe("10. Funções Auxiliares: isOrchestratorProtectedAction e inferOrchestratorTools", () => {
    it("classifica corretamente intenções e ferramentas protegidas", () => {
      expect(isOrchestratorProtectedAction("exclusao", "high")).toBe(true);
      expect(isOrchestratorProtectedAction("consulta", "low", ["radar.read"])).toBe(false);
      expect(isOrchestratorProtectedAction("consulta", "low", ["communication.send"])).toBe(true);
    });

    it("infere ferramentas adequadas para comandos em linguagem natural", () => {
      expect(inferOrchestratorTools("excluir item", "exclusao")).toContain("radar.delete");
      expect(inferOrchestratorTools("enviar email", "envio")).toContain("communication.send");
      expect(inferOrchestratorTools("agendar reunião", "organizacao")).toContain("calendar.create");
      expect(inferOrchestratorTools("qual o status", "consulta")).toContain("radar.read");
    });
  });
});
