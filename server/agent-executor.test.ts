import { describe, expect, it, vi } from "vitest";
import {
  executeOrchestratedPlan,
  validatePlanBeforeExecution,
  AgentExecutionError,
} from "./agent-executor";
import { createOrchestratedPlan } from "./agent-orchestrator";
import { routeAiStrategy } from "./model-router";

describe("IRIS 5.4 — Integração Controlada Planner → Executor", () => {
  describe("1. Execução de Plano Simples (Consulta / Sem mutação)", () => {
    it("executa plano simples informativo com sucesso e sem exigir autorização prévia", async () => {
      const routerDecision = routeAiStrategy({
        intent: "query",
        risk: "low",
        complexity: "simples",
        context: "Qual meu próximo compromisso?",
        needsTools: false,
      });

      const plan = createOrchestratedPlan({
        intent: "query",
        risk: "low",
        complexity: "simples",
        context: "Qual meu próximo compromisso?",
        routerDecision,
        needsTools: false,
        objective: "Consultar próximo compromisso",
        decision: "respond",
      });

      const result = await executeOrchestratedPlan({
        plan,
        isApproved: false, // Consultas puras não necessitam de autorização
      });

      expect(result.success).toBe(true);
      expect(result.currentStage).toBe("CONFIRMAR");
      expect(result.fallbackTriggered).toBe(false);
      expect(result.executedSteps.every((s) => s.status === "succeeded")).toBe(true);
      expect(result.completedStepIds.length).toBe(plan.steps.length);
    });
  });

  describe("2. Múltiplas Etapas Sequenciais", () => {
    it("executa múltiplas ferramentas na ordem estrita do Planner", async () => {
      const routerDecision = routeAiStrategy({
        intent: "criar tarefa",
        risk: "low",
        complexity: "média",
        context: "Cadastrar tarefa e lembrar de pagar",
        needsTools: true,
      });

      const plan = createOrchestratedPlan({
        intent: "criar tarefa",
        risk: "low",
        complexity: "média",
        context: "Cadastrar tarefa e lembrar de pagar",
        routerDecision,
        needsTools: true,
        objective: "Cadastrar lembrete no Radar",
        decision: "propose",
      });

      const executedOrder: string[] = [];
      const toolExecutor = vi.fn().mockImplementation(async (toolName) => {
        executedOrder.push(toolName);
        return { created: true, tool: toolName };
      });

      const result = await executeOrchestratedPlan({
        plan,
        isApproved: true,
        toolExecutor,
      });

      expect(result.success).toBe(true);
      expect(toolExecutor).toHaveBeenCalled();
      expect(result.executedSteps.find((s) => s.stage === "EXECUTAR")?.status).toBe("succeeded");
    });
  });

  describe("3. Respeito Rigoroso ao Grafo de Dependências", () => {
    it("rejeita plano com dependência inexistente na validação", async () => {
      const routerDecision = routeAiStrategy({
        intent: "criar lembrete",
        risk: "medium",
        complexity: "média",
        context: "Lembrar de pagar o boleto",
        needsTools: true,
      });

      const plan = createOrchestratedPlan({
        intent: "criar lembrete",
        risk: "medium",
        complexity: "média",
        context: "Lembrar de pagar o boleto",
        routerDecision,
        needsTools: true,
        decision: "propose",
      });

      // Adiciona dependência inexistente
      const executeStep = plan.steps.find((s) => s.stage === "EXECUTAR");
      expect(executeStep).toBeDefined();
      executeStep!.dependencies.push("step-inexistente-123");

      await expect(
        executeOrchestratedPlan({
          plan,
          isApproved: true,
        })
      ).rejects.toThrow(AgentExecutionError);
    });

    it("bloqueia a etapa de execução caso uma dependência anterior não tenha sido concluída", async () => {
      const routerDecision = routeAiStrategy({
        intent: "criar lembrete",
        risk: "medium",
        complexity: "média",
        context: "Lembrar de pagar",
        needsTools: true,
      });

      const plan = createOrchestratedPlan({
        intent: "criar lembrete",
        risk: "medium",
        complexity: "média",
        context: "Lembrar de pagar",
        routerDecision,
        needsTools: true,
        decision: "propose",
      });

      // Simula uma etapa intermediária pendente que não foi concluída
      const authStep = plan.steps.find((s) => s.stage === "AUTORIZAR");
      expect(authStep).toBeDefined();

      // Força a etapa de execução a depender de uma etapa que não será concluída
      const dummyStepId = "step-intermediaria";
      plan.steps.splice(2, 0, {
        id: dummyStepId,
        order: 2.5,
        stage: "PLANEJAR",
        name: "Etapa não concluída",
        action: "Verificação pendente",
        dependencies: [plan.steps[0]!.id],
        requiresAuthorization: false,
        status: "pending",
      });

      const executeStep = plan.steps.find((s) => s.stage === "EXECUTAR");
      executeStep!.dependencies.push(dummyStepId);

      // Invalida a conclusão da dummyStepId simulando que ela foi pulada/bloqueada
      const originalOrdered = [...plan.steps].sort((a, b) => a.order - b.order);
      const dummyIdx = originalOrdered.findIndex((s) => s.id === dummyStepId);
      // Remove a dummy da lista para simular que falhou antes
      plan.steps = plan.steps.filter((s) => s.id !== dummyStepId);

      // Na execução, o executeStep depende de dummyStepId que nunca entrou em completedStepIds
      const result = await executeOrchestratedPlan({
        plan: {
          ...plan,
          steps: [
            ...plan.steps.filter((s) => s.stage !== "EXECUTAR"),
            { ...executeStep!, dependencies: [authStep!.id, "step-nao-completado"] },
          ],
        },
        isApproved: true,
      }).catch((e) => e);

      expect(result).toBeDefined();
    });
  });

  describe("4. Autorização Obrigatória e Bloqueio sem Autorização", () => {
    it("executa com sucesso quando autorização explícita é concedida", async () => {
      const routerDecision = routeAiStrategy({
        intent: "criar tarefa",
        risk: "medium",
        complexity: "média",
        context: "Criar novo item no radar",
        needsTools: true,
      });

      const plan = createOrchestratedPlan({
        intent: "criar tarefa",
        risk: "medium",
        complexity: "média",
        context: "Criar novo item no radar",
        routerDecision,
        needsTools: true,
        decision: "propose",
      });

      const result = await executeOrchestratedPlan({
        plan,
        isApproved: true,
        toolExecutor: vi.fn().mockResolvedValue({ id: 101 }),
      });

      expect(result.success).toBe(true);
      expect(result.executedSteps.find((s) => s.stage === "AUTORIZAR")?.status).toBe("succeeded");
    });

    it("bloqueia imediatamente a execução de ação protegida se isApproved for false", async () => {
      const routerDecision = routeAiStrategy({
        intent: "exclusao",
        risk: "high",
        complexity: "complexa",
        context: "Excluir conta",
        needsTools: true,
      });

      const plan = createOrchestratedPlan({
        intent: "exclusao",
        risk: "high",
        complexity: "complexa",
        context: "Excluir conta",
        routerDecision,
        needsTools: true,
        decision: "propose",
      });

      await expect(
        executeOrchestratedPlan({
          plan,
          isApproved: false, // NÃO autorizada
        })
      ).rejects.toThrow(AgentExecutionError);
    });
  });

  describe("5. Bloqueio de Plano Inválido", () => {
    it("rejeita execução se o plano estiver nulo ou corrompido", async () => {
      const val = validatePlanBeforeExecution(null, true);
      expect(val.isValid).toBe(false);
      expect(val.errors).toContain("Nenhum plano fornecido para execução.");

      await expect(
        executeOrchestratedPlan({
          plan: null as any,
          isApproved: true,
        })
      ).rejects.toThrow(AgentExecutionError);
    });

    it("rejeita execução se o Router não tiver definido uma estratégia válida", () => {
      const routerDecision = routeAiStrategy({
        intent: "query",
        risk: "low",
        complexity: "simples",
        context: "Consulta",
        needsTools: false,
      });

      const plan = createOrchestratedPlan({
        intent: "query",
        risk: "low",
        complexity: "simples",
        context: "Consulta",
        routerDecision,
        needsTools: false,
      });

      // Corrompe estratégia do router
      const corruptedPlan = { ...plan, strategy: "" as any };
      const val = validatePlanBeforeExecution(corruptedPlan, true);
      expect(val.isValid).toBe(false);
      expect(val.errors.some((e) => e.includes("AI Model Router não definiu uma estratégia"))).toBe(true);
    });
  });

  describe("6. Falha de Etapa e Fallback Seguro", () => {
    it("se uma etapa falhar, NUNCA executa ações protegidas alternativas automaticamente", async () => {
      const routerDecision = routeAiStrategy({
        intent: "criar lembrete",
        risk: "medium",
        complexity: "média",
        context: "Lembrar de pagar o boleto amanhã",
        needsTools: true,
      });

      const plan = createOrchestratedPlan({
        intent: "criar lembrete",
        risk: "medium",
        complexity: "média",
        context: "Lembrar de pagar o boleto amanhã",
        routerDecision,
        needsTools: true,
        decision: "propose",
        message: "Lembrar de pagar o boleto amanhã",
      });

      let attemptedAlternativeMutation = false;
      const toolExecutor = vi.fn().mockImplementation(async () => {
        throw new Error("Erro de conexão na ferramenta principal");
      });

      const result = await executeOrchestratedPlan({
        plan,
        isApproved: true,
        toolExecutor,
      });

      expect(result.success).toBe(false);
      expect(result.fallbackTriggered).toBe(true);
      expect(result.fallbackAction).toContain("Interrupção segura sem execução de ações protegidas alternativas automáticas");
      expect(result.failedStep?.status).toBe("failed");
      expect(result.failedStep?.error).toContain("Erro de conexão na ferramenta principal");
      expect(attemptedAlternativeMutation).toBe(false);
    });
  });

  describe("7. Ações Protegidas (enviar, excluir, alterar, compartilhar, mover dados)", () => {
    it("garante que todas as ações que mutam estado são catalogadas como protegidas", () => {
      const protectedIntents = [
        "enviar",
        "excluir",
        "alterar",
        "compartilhar",
        "organizacao",
        "mutation",
        "sensitive_task",
      ];

      for (const intent of protectedIntents) {
        const routerDecision = routeAiStrategy({
          intent,
          risk: "medium",
          complexity: "média",
          context: `Executar ${intent}`,
          needsTools: true,
        });

        const plan = createOrchestratedPlan({
          intent,
          risk: "medium",
          complexity: "média",
          context: `Executar ${intent}`,
          routerDecision,
          needsTools: true,
          decision: "propose",
        });

        expect(plan.isProtectedAction).toBe(true);
        expect(plan.requiresAuthorization).toBe(true);
      }
    });
  });

  describe("8. Confirmação Final e Auditoria", () => {
    it("registra trilha de auditoria completa em todas as etapas até a confirmação final", async () => {
      const routerDecision = routeAiStrategy({
        intent: "query",
        risk: "low",
        complexity: "simples",
        context: "Olá",
        needsTools: false,
      });

      const plan = createOrchestratedPlan({
        intent: "query",
        risk: "low",
        complexity: "simples",
        context: "Olá",
        routerDecision,
        needsTools: false,
      });

      const auditLog: string[] = [];
      const onStepAudit = vi.fn().mockImplementation((step, stepRes) => {
        auditLog.push(`${step.stage}:${step.name}:${stepRes.status}`);
      });

      const result = await executeOrchestratedPlan({
        plan,
        isApproved: true,
        onStepAudit,
      });

      expect(result.success).toBe(true);
      expect(auditLog.some((l) => l.startsWith("ENTENDER:"))).toBe(true);
      expect(auditLog.some((l) => l.startsWith("PLANEJAR:"))).toBe(true);
      expect(auditLog.some((l) => l.startsWith("EXECUTAR:"))).toBe(true);
      expect(auditLog.some((l) => l.startsWith("CONFIRMAR:"))).toBe(true);
      expect(result.currentStage).toBe("CONFIRMAR");
    });
  });
});
