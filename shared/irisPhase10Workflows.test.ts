/**
 * TESTES COMPLETOS DA FASE 10 — EXECUTION ENGINE + WORKFLOWS
 */

import { describe, expect, it } from "vitest";
import {
  IrisExecutionEngine,
  runIris6Pipeline,
} from "./irisExecutionEngine";
import {
  IrisAgentOrchestrator,
  type OrchestratorPlan,
} from "./irisAgentOrchestrator";
import { ToolRegistry } from "./irisTools";
import { IrisMemoryManager } from "./irisMemory";

describe("FASE 10 — EXECUTION ENGINE + WORKFLOWS CONTROLADOS", () => {
  describe("10.1 Validação Pré-Execução e Execução Passo a Passo", () => {
    it("valida formalmente o plano antes da execução rejeitando planos inválidos ou sem autorização", () => {
      const engine = new IrisExecutionEngine();
      const orchestrator = new IrisAgentOrchestrator();

      // Plano vazio
      const invalidValidation = engine.validatePlanBeforeExecution(null as any);
      expect(invalidValidation.isValid).toBe(false);

      // Plano protegido sem autorização
      const protectedPlan = orchestrator.planTask({
        command: "excluir todos os arquivos da pasta projeto",
      });
      const authValidation = engine.validatePlanBeforeExecution(protectedPlan, false);
      expect(authValidation.isValid).toBe(false);
      expect(authValidation.errors.some((e) => e.includes("autorização explícita"))).toBe(true);

      // Plano protegido com autorização concedida
      const approvedValidation = engine.validatePlanBeforeExecution(protectedPlan, true);
      expect(approvedValidation.isValid).toBe(true);
    });

    it("executa etapas de forma controlada passo a passo (executeStep)", async () => {
      const registry = new ToolRegistry(true);
      const engine = new IrisExecutionEngine({ toolRegistry: registry });

      const stepRecord = await engine.executeStep({
        id: "step-1",
        name: "Consulta data local",
        stage: "select_tools",
        order: 1,
        toolId: "local.datetime",
        dependencies: [],
        requiresAuthorization: false,
        riskLevel: "low",
        status: "ready",
      });

      expect(stepRecord.status).toBe("success");
      expect(stepRecord.output).toBeDefined();
      expect(stepRecord.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("interrompe a execução com cancelExecution de forma limpa", () => {
      const engine = new IrisExecutionEngine();
      const cancelRes = engine.cancelExecution("Interrompido pelo operador");

      expect(cancelRes.status).toBe("cancelled");
      expect(cancelRes.success).toBe(false);
      expect(engine.getState()).toBe("cancelled");
    });

    it("aciona rollback lógico quando etapa intermediária com mutação falha", async () => {
      const registry = new ToolRegistry(true);
      const engine = new IrisExecutionEngine({ toolRegistry: registry });

      // Plano simulado com mutação na etapa 1 e falha na etapa 2
      const mockPlan: OrchestratorPlan = {
        planId: "plan-rollback-test",
        command: "teste de rollback",
        summary: "Plano com falha simulada",
        intent: "alteracao",
        actionType: "alteracao",
        riskLevel: "medium",
        complexity: "MÉDIA",
        routerDecision: {
          strategy: "local_balanced",
          complexity: "MÉDIA",
          estimatedCost: "R$ 0,00",
          requiresTools: true,
          tools: ["radar.update"],
          confidence: 0.9,
          reason: "local",
          isBlocked: false,
          authorizationRequired: true,
          billingNotice: "",
        },
        costGuardEvaluation: { allowed: true, tier: "local", symbol: "🟢", status: "allowed", reason: "ok" },
        toolsRequired: ["radar.update"],
        requiresAuthorization: true,
        isProtectedAction: true,
        isAuthorized: true,
        executionOrder: ["s1", "s2"],
        dependencies: { s2: ["s1"] },
        status: "planning",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        steps: [
          {
            id: "s1",
            name: "Atualização no radar",
            order: 1,
            stage: "select_tools",
            toolId: "radar.update",
            dependencies: [],
            requiresAuthorization: true,
            riskLevel: "medium",
            status: "ready",
            parameters: { id: 1, updates: { priority: "urgente" } },
          },
          {
            id: "s2",
            name: "Etapa com erro forçado",
            order: 2,
            stage: "select_tools",
            toolId: "ferramenta.inexistente",
            dependencies: ["s1"],
            requiresAuthorization: false,
            riskLevel: "low",
            status: "pending",
          },
        ],
      };

      const result = await engine.executePlan(mockPlan, { isAuthorized: true });
      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.rollbackAvailable).toBe(true);
      expect(result.rollbackExecuted).toBe(true);
      expect(result.rollbackDetails).toContain("Rollback lógico");
    });
  });

  describe("10.2 e 10.3 Ações Protegidas — Exemplo Envio de E-mail", () => {
    it("não executa envio automaticamente: identifica destinatário, prepara ação, solicita autorização", async () => {
      // 1. Comando: "Envie este e-mail para João."
      const outputWithoutAuth = await runIris6Pipeline({
        command: "Envie este e-mail para João",
        isAuthorized: false,
      });

      // Deve parar rigorosamente em awaiting_authorization
      expect(outputWithoutAuth.success).toBe(false);
      expect(outputWithoutAuth.state).toBe("awaiting_authorization");
      expect(outputWithoutAuth.requiresAuthorization).toBe(true);
      expect(outputWithoutAuth.proposal).toBeDefined();

      const proposal = outputWithoutAuth.proposal as any;
      expect(proposal.recipient).toMatch(/joão/i);
      expect(proposal.requiresAuthorization).toBe(true);
    });

    it("executa envio somente após autorização explícita", async () => {
      const outputWithAuth = await runIris6Pipeline({
        command: "Envie este e-mail para João",
        isAuthorized: true,
        authorizationToken: "auth-user-confirmed-token-123",
        allowedScopes: ["communication:send", "external:write"],
      });

      expect(outputWithAuth.success).toBe(true);
      expect(outputWithAuth.state).toBe("completed");
      expect(outputWithAuth.executionResult).toBeDefined();
    });

    it("nunca executa automaticamente SEND, DELETE, SHARE ou WRITE protegido", async () => {
      const protectedCommands = [
        "Excluir relatório financeiro 2025",
        "Compartilhar pasta privada com terceiro@teste.com",
        "Enviar comunicado geral a todos os clientes",
        "Alterar vencimento do boleto para amanhã",
      ];

      for (const cmd of protectedCommands) {
        const res = await runIris6Pipeline({
          command: cmd,
          isAuthorized: false,
        });

        expect(res.success).toBe(false);
        expect(res.requiresAuthorization).toBe(true);
        expect(["awaiting_authorization", "blocked"]).toContain(res.state);
      }
    });
  });

  describe("10.4 Comandos Multi-Step Complexos", () => {
    it("suporta comando multi-step encadeado mantendo controle de estado em cada etapa", async () => {
      const cmd = "Pesquise meus documentos, encontre os relacionados ao projeto e prepare uma lista.";
      const orchestrator = new IrisAgentOrchestrator();
      const plan = orchestrator.planTask({ command: cmd });

      expect(plan.toolsRequired).toContain("documents.search");
      expect(plan.toolsRequired).toContain("documents.summarize");
      expect(plan.steps.length).toBeGreaterThanOrEqual(4);

      // Execução no pipeline
      const output = await runIris6Pipeline({
        command: cmd,
        isAuthorized: true,
      });

      expect(output.success).toBe(true);
      expect(output.state).toBe("completed");
      expect(output.executionResult?.executedSteps.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("10.5 Memória — Imutabilidade e Não-Concessão de Permissões", () => {
    it("garante que a memória não executa ações nem concede permissões", () => {
      const memory = new IrisMemoryManager();

      expect(memory.canExecuteActions()).toBe(false);
      expect(memory.canGrantAuthorization()).toBe(false);
      expect(memory.canBypassPermissions()).toBe(false);

      // Rejeição estrita de credenciais
      expect(() => {
        memory.remember({
          content: "Minha senha secreta é password: SuperSecret123",
        });
      }).toThrow(/Segurança IRIS/i);

      // Preservação de contexto útil de tarefas
      memory.recordTaskHistory({
        command: "Pesquisar documentos",
        resultSummary: "Encontrados 3 documentos",
      });

      const history = memory.getTaskHistory();
      expect(history.length).toBe(1);
      expect(history[0].content).toContain("Pesquisar documentos");
    });
  });
});
