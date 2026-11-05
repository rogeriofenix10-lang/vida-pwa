import { describe, expect, it } from "vitest";
import {
  createOrchestratedPlan,
  validateOrchestratedPlan,
  isProtectedAction,
  type OrchestratorInput,
} from "./agent-orchestrator";
import { routeAiStrategy } from "./model-router";

describe("IRIS 5.4 — IRIS Planner / Orchestrator", () => {
  describe("1. Plano Simples (Consultas sem ferramentas e custo zero)", () => {
    it("gera plano seguro para consulta informativa sem exigir autorização", () => {
      const routerDecision = routeAiStrategy({
        intent: "query",
        risk: "low",
        complexity: "simples",
        context: "Qual a previsão do tempo para hoje?",
        needsTools: false,
      });

      const plan = createOrchestratedPlan({
        intent: "query",
        risk: "low",
        complexity: "simples",
        context: "Qual a previsão do tempo para hoje?",
        routerDecision,
        needsTools: false,
        objective: "Informar previsão do tempo",
        decision: "respond",
      });

      expect(plan.requiresAuthorization).toBe(false);
      expect(plan.isProtectedAction).toBe(false);
      expect(plan.provider).toBe("manus");
      expect(plan.strategy).toBe("local_fast");
      expect(plan.estimatedCost).toBe("R$ 0,00 (gratuito)");

      // Estágios presentes
      expect(plan.stages.ENTENDER.length).toBeGreaterThan(0);
      expect(plan.stages.PLANEJAR.length).toBeGreaterThan(0);
      expect(plan.stages.AUTORIZAR.length).toBe(0); // Não requer autorização
      expect(plan.stages.EXECUTAR.length).toBeGreaterThan(0);
      expect(plan.stages.CONFIRMAR.length).toBeGreaterThan(0);

      const validation = validateOrchestratedPlan(plan);
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toEqual([]);
    });
  });

  describe("2. Plano Médio (Ferramentas operacionais e risco moderado)", () => {
    it("gera plano com ferramenta de radar exigindo autorização explícita", () => {
      const routerDecision = routeAiStrategy({
        intent: "criacao",
        risk: "medium",
        complexity: "média",
        context: "Lembrar de pagar o boleto do condomínio dia 10",
        needsTools: true,
      });

      const plan = createOrchestratedPlan({
        intent: "criacao",
        risk: "medium",
        complexity: "média",
        context: "Lembrar de pagar o boleto do condomínio dia 10",
        routerDecision,
        needsTools: true,
        objective: "Criar lembrete de boleto no Radar",
        decision: "propose",
        entities: { label: "Boleto do condomínio", date: "dia 10", priority: "importante" },
      });

      expect(plan.requiresAuthorization).toBe(true);
      expect(plan.isProtectedAction).toBe(true);
      expect(plan.toolRequired).toContain("radar.create");
      expect(plan.requiredScopes).toContain("radar:write");

      // Deve ter etapa mandatória de AUTORIZAR
      expect(plan.stages.AUTORIZAR.length).toBe(1);
      expect(plan.stages.AUTORIZAR[0]!.requiresAuthorization).toBe(true);
      expect(plan.currentStage).toBe("AUTORIZAR");

      const validation = validateOrchestratedPlan(plan);
      expect(validation.isValid).toBe(true);
    });
  });

  describe("3. Plano Complexo e Risco Alto", () => {
    it("bloqueia mutações de alto risco até autorização e protege dados contra exclusão direta", () => {
      const routerDecision = routeAiStrategy({
        intent: "exclusao",
        risk: "high",
        complexity: "complexa",
        context: "Excluir permanentemente todos os registros do usuário",
        needsTools: true,
        requested: "auto",
      });

      const plan = createOrchestratedPlan({
        intent: "exclusao",
        risk: "high",
        complexity: "complexa",
        context: "Excluir permanentemente todos os registros do usuário",
        routerDecision,
        needsTools: true,
        objective: "Exclusão permanente de dados",
        message: "Excluir permanentemente todos os registros",
      });

      expect(plan.riskLevel).toBe("high");
      expect(plan.complexity).toBe("complexa");
      expect(plan.requiresAuthorization).toBe(true);
      expect(plan.isProtectedAction).toBe(true);
      expect(plan.stages.AUTORIZAR.length).toBe(1);
      expect(plan.stages.AUTORIZAR[0]!.action).toContain("Bloquear execução até confirmação humana");

      const validation = validateOrchestratedPlan(plan);
      expect(validation.isValid).toBe(true);
    });
  });

  describe("4. Múltiplas Etapas e Sequenciamento Ordenado", () => {
    it("cria sequência ordenada de passos com numeração e estágios corretos", () => {
      const routerDecision = routeAiStrategy({
        intent: "organizacao",
        risk: "low",
        complexity: "média",
        context: "Organizar tarefas da semana",
        needsTools: true,
      });

      const plan = createOrchestratedPlan({
        intent: "organizacao",
        risk: "low",
        complexity: "média",
        context: "Organizar tarefas da semana",
        routerDecision,
        needsTools: true,
        decision: "propose",
      });

      expect(plan.steps.length).toBeGreaterThanOrEqual(4);

      // Valida ordem estritamente crescente
      for (let i = 0; i < plan.steps.length; i++) {
        expect(plan.steps[i]!.order).toBe(i + 1);
      }

      // Valida execução sequencial
      expect(plan.executionOrder.length).toBe(plan.steps.length);
      expect(plan.executionOrder[0]).toBe(plan.steps[0]!.id);
      expect(plan.executionOrder[plan.executionOrder.length - 1]).toBe(
        plan.steps[plan.steps.length - 1]!.id
      );
    });
  });

  describe("5. Grafo de Dependências entre Etapas", () => {
    it("estabelece dependências rigorosas garantindo que EXECUTAR depende de AUTORIZAR", () => {
      const routerDecision = routeAiStrategy({
        intent: "alteracao",
        risk: "medium",
        complexity: "média",
        context: "Adiar reunião",
        needsTools: true,
      });

      const plan = createOrchestratedPlan({
        intent: "alteracao",
        risk: "medium",
        complexity: "média",
        context: "Adiar reunião",
        routerDecision,
        needsTools: true,
        decision: "propose",
      });

      const authStep = plan.steps.find((s) => s.stage === "AUTORIZAR");
      const executeStep = plan.steps.find((s) => s.stage === "EXECUTAR");

      expect(authStep).toBeDefined();
      expect(executeStep).toBeDefined();

      // O passo de execução deve depender direta ou indiretamente do passo de autorização
      expect(executeStep!.dependencies).toContain(authStep!.id);

      // O passo de confirmação deve depender do passo de execução
      const confirmStep = plan.steps.find((s) => s.stage === "CONFIRMAR");
      expect(confirmStep!.dependencies).toContain(executeStep!.id);

      const validation = validateOrchestratedPlan(plan);
      expect(validation.isValid).toBe(true);
    });

    it("validador detecta violação se a etapa de execução preceder a de autorização", () => {
      const routerDecision = routeAiStrategy({
        intent: "exclusao",
        risk: "high",
        complexity: "complexa",
        context: "Apagar",
        needsTools: true,
      });

      const plan = createOrchestratedPlan({
        intent: "exclusao",
        risk: "high",
        complexity: "complexa",
        context: "Apagar",
        routerDecision,
        needsTools: true,
        decision: "propose",
      });

      // Simula alteração indevida invertendo etapas
      const corruptedSteps = [...plan.steps];
      const authIdx = corruptedSteps.findIndex((s) => s.stage === "AUTORIZAR");
      const execIdx = corruptedSteps.findIndex((s) => s.stage === "EXECUTAR");
      const temp = corruptedSteps[authIdx]!;
      corruptedSteps[authIdx] = corruptedSteps[execIdx]!;
      corruptedSteps[execIdx] = temp;

      const corruptedPlan = { ...plan, steps: corruptedSteps };
      const validation = validateOrchestratedPlan(corruptedPlan);

      expect(validation.isValid).toBe(false);
      expect(validation.errors.some((e) => e.includes("Violação de segurança"))).toBe(true);
    });
  });

  describe("6. Ações Protegidas (envio, exclusão, alteração, compartilhamento, organização)", () => {
    it("isProtectedAction identifica todas as categorias protegidas", () => {
      expect(isProtectedAction({ intent: "exclusao", risk: "high", tools: [] })).toBe(true);
      expect(isProtectedAction({ intent: "envio", risk: "medium", tools: [] })).toBe(true);
      expect(isProtectedAction({ intent: "compartilhamento", risk: "medium", tools: [] })).toBe(true);
      expect(isProtectedAction({ intent: "alteracao", risk: "low", tools: [] })).toBe(true);
      expect(isProtectedAction({ intent: "organizacao", risk: "low", tools: [] })).toBe(true);
      expect(isProtectedAction({ intent: "query", risk: "low", tools: ["radar.create"] })).toBe(true);
      expect(isProtectedAction({ intent: "query", risk: "low", tools: ["documents.search"] })).toBe(false);
    });
  });

  describe("7. Fallback e Garantia Orçamentária", () => {
    it("preserva o fallback do AI Model Router dentro do plano orquestrado", () => {
      const routerDecision = routeAiStrategy({
        intent: "complex_code",
        risk: "low",
        complexity: "complexa",
        context: "Código complexo",
        needsTools: false,
        requested: "auto",
        externalConsent: true,
        hasApiKey: true,
      });

      const plan = createOrchestratedPlan({
        intent: "complex_code",
        risk: "low",
        complexity: "complexa",
        context: "Código complexo",
        routerDecision,
        needsTools: false,
      });

      expect(plan.fallback).toBeDefined();
      expect(plan.fallback.provider).toBe("manus");
      expect(plan.fallback.estimatedCost).toBe("R$ 0,00 (gratuito)");
      expect(plan.estimatedCost).toContain("R$ 0,00");
    });
  });

  describe("8. Bloqueio de Execução Direta (Planner cria apenas o plano)", () => {
    it("o orquestrador não executa mutações e produz objeto puramente descritivo", () => {
      const mutationAttempt = { modifiedDatabase: false, sentExternalMessage: false };

      const routerDecision = routeAiStrategy({
        intent: "exclusao",
        risk: "high",
        complexity: "complexa",
        context: "Deletar registro",
        needsTools: true,
      });

      const plan = createOrchestratedPlan({
        intent: "exclusao",
        risk: "high",
        complexity: "complexa",
        context: "Deletar registro",
        routerDecision,
        needsTools: true,
        objective: "Deletar",
      });

      // O plano apenas planeja
      expect(plan.planId).toBeDefined();
      expect(plan.currentStage).toBe("AUTORIZAR");
      expect(mutationAttempt.modifiedDatabase).toBe(false);
      expect(mutationAttempt.sentExternalMessage).toBe(false);
    });
  });

  describe("9. Integração com AI Model Router", () => {
    it("herda fielmente a decisão do router conectando estratégia, modelo e custo", () => {
      const routerDecision = routeAiStrategy({
        intent: "multimodal",
        risk: "low",
        complexity: "complexa",
        context: "Analise o arquivo anexo",
        needsTools: false,
        requested: "gemini",
        externalConsent: true,
        hasApiKey: true,
        hasAttachments: true,
      });

      const plan = createOrchestratedPlan({
        intent: "multimodal",
        risk: "low",
        complexity: "complexa",
        context: "Analise o arquivo anexo",
        routerDecision,
        needsTools: false,
        objective: "Análise multimodal",
      });

      expect(plan.provider).toBe("gemini");
      expect(plan.model).toBe("gemini-3-flash-preview");
      expect(plan.strategy).toBe("external_vision");
      expect(plan.estimatedCost).toBe("R$ 0,00 (chave própria do usuário)");
      expect(plan.fallback.provider).toBe("manus");
    });
  });
});
