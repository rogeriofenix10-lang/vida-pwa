import { describe, expect, it } from "vitest";
import {
  IrisExecutionEngine,
} from "./irisExecutionEngine";
import {
  IrisAgentOrchestrator,
} from "./irisAgentOrchestrator";
import { ToolRegistry } from "./irisTools";

describe("IRIS 6.0 — FASE 8: REAL EXECUTION ENGINE", () => {
  describe("1. Execução de Plano Autorizado com Sucesso", () => {
    it("executa todas as etapas de um plano simples com status success", async () => {
      const orchestrator = new IrisAgentOrchestrator();
      const plan = orchestrator.planTask({
        command: "Qual a previsão do tempo?",
      });

      const engine = new IrisExecutionEngine();
      const result = await engine.executePlan(plan);

      expect(result.success).toBe(true);
      expect(result.status).toBe("success");
      expect(result.executedSteps.length).toBe(plan.steps.length);
      expect(result.executedSteps.every((s) => s.status === "success")).toBe(true);
      expect(result.timestamp).toBeDefined();
      expect(result.rollbackAvailable).toBe(false);
      expect(engine.getState()).toBe("success");
    });
  });

  describe("2. Barreira Inviolável de Autorização", () => {
    it("bloqueia imediatamente a execução quando a ação for protegida e isAuthorized = false", async () => {
      const orchestrator = new IrisAgentOrchestrator();
      const plan = orchestrator.planTask({
        command: "enviar mensagem por email para diretoria",
      });

      const engine = new IrisExecutionEngine();
      const result = await engine.executePlan(plan, { isAuthorized: false });

      expect(result.success).toBe(false);
      expect(result.status).toBe("blocked");
      expect(result.error).toContain("Segurança IRIS: Execução bloqueada");
      expect(result.executedSteps.length).toBe(0);
      expect(engine.getState()).toBe("blocked");
    });

    it("permite a execução quando o usuário concede autorização explícita e escopo necessário", async () => {
      const orchestrator = new IrisAgentOrchestrator();
      const plan = orchestrator.planTask({
        command: "enviar mensagem por email para diretoria",
      });

      orchestrator.authorize("token-valido-xyz");

      const engine = new IrisExecutionEngine();
      const result = await engine.executePlan(plan, {
        isAuthorized: true,
        allowedScopes: ["communication:send"],
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe("success");
      expect(engine.getState()).toBe("success");
    });
  });

  describe("3. Bloqueio pelo Cost Guard", () => {
    it("bloqueia a execução antes de disparar qualquer etapa se o Cost Guard rejeitar", async () => {
      const orchestrator = new IrisAgentOrchestrator();
      const plan = orchestrator.planTask({
        command: "executar modelo pago gpt-4o",
        routerDecision: {
          intent: "query",
          complexity: "COMPLEXA",
          risk: "high",
          strategy: "capable_cloud",
          model: "gpt-4o",
          costLevel: "high_capability",
          estimatedCost: 0.1,
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

      const engine = new IrisExecutionEngine();
      const result = await engine.executePlan(plan);

      expect(result.success).toBe(false);
      expect(result.status).toBe("blocked");
      expect(result.error).toContain("Cost Guard");
      expect(result.executedSteps.length).toBe(0);
    });
  });

  describe("4. Tratamento de Erro e Interrupção Segura", () => {
    it("interrompe a execução com status failed quando uma ferramenta falha", async () => {
      const customRegistry = new ToolRegistry(false);
      customRegistry.registerTool({
        id: "failing.tool",
        name: "Failing Tool",
        description: "Falha intencional para teste",
        category: "local",
        permissions: [],
        riskLevel: "high", // High risk não faz retry
        costLevel: "zero",
        parameters: [],
        isAvailable: true,
        requiresAuthorization: false,
        execute: async () => {
          throw new Error("Erro de infraestrutura simulado");
        },
      });

      const orchestrator = new IrisAgentOrchestrator();
      const plan = orchestrator.planTask({
        command: "executar teste de erro",
        toolsRequired: ["failing.tool"],
      });

      const engine = new IrisExecutionEngine({ toolRegistry: customRegistry });
      const result = await engine.executePlan(plan);

      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.failedStep).toBeDefined();
      expect(result.failedStep?.error).toContain("Erro de infraestrutura");
      expect(engine.getState()).toBe("failed");
    });
  });

  describe("5. Cancelamento de Execução", () => {
    it("permite o cancelamento formal com status cancelled", () => {
      const engine = new IrisExecutionEngine();
      const cancelRes = engine.cancelExecution("Abortado pelo usuário");

      expect(cancelRes.success).toBe(false);
      expect(cancelRes.status).toBe("cancelled");
      expect(cancelRes.error).toContain("Abortado pelo usuário");
      expect(engine.getState()).toBe("cancelled");
    });
  });

  describe("6. Retry Seguro para Operações Idempotentes", () => {
    it("executa retries automáticos para ferramentas de baixo risco que falham temporariamente", async () => {
      let attempts = 0;
      const customRegistry = new ToolRegistry(false);
      customRegistry.registerTool({
        id: "flaky.tool",
        name: "Flaky Tool",
        description: "Falha na 1ª tentativa e sucede na 2ª",
        category: "local",
        permissions: [],
        riskLevel: "low",
        costLevel: "zero",
        parameters: [],
        isAvailable: true,
        requiresAuthorization: false,
        execute: async () => {
          attempts++;
          if (attempts === 1) {
            throw new Error("Instabilidade de rede temporária");
          }
          return {
            success: true,
            toolId: "flaky.tool",
            data: { recovered: true },
          };
        },
      });

      const orchestrator = new IrisAgentOrchestrator();
      const plan = orchestrator.planTask({
        command: "executar ferramenta instável",
        toolsRequired: ["flaky.tool"],
      });

      const engine = new IrisExecutionEngine({
        toolRegistry: customRegistry,
        maxRetries: 2,
      });

      const result = await engine.executePlan(plan);
      expect(result.success).toBe(true);
      expect(result.status).toBe("success");
      const flakyStep = result.executedSteps.find((s) => s.toolId === "flaky.tool");
      expect(flakyStep).toBeDefined();
      expect(flakyStep?.retries).toBe(1);
    });
  });
});
