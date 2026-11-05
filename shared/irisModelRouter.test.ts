import { describe, expect, it, vi } from "vitest";
import {
  IrisModelRouter,
  IrisCostGuard,
  routeAiModel,
  classifyModelComplexity,
  normalizeComplexity,
  DEFAULT_FREE_MODELS,
  DEFAULT_EXTERNAL_MODELS,
  COST_GUARD_BLOCKED_REASON,
  type ModelRouterInput,
  type ModelRouterDecision,
  type RouterObservabilityRecord,
} from "./irisModelRouter";
import {
  IrisCognitiveEngine,
  interpretOperationalCommand,
  analyzeCommand,
  type CognitiveContext,
} from "./irisCognitive";

const mockContext: CognitiveContext = {
  items: [
    { id: 1, label: "Seguro do carro", detail: "vence em 12 dias", date: "12 dias", priority: "importante", status: "pending", category: "Finanças" },
    { id: 2, label: "Conta de internet", detail: "vence amanhã · R$ 129,90", date: "amanhã", priority: "urgente", status: "pending", category: "Finanças" },
    { id: 3, label: "Exame de sangue", detail: "agendado para sexta", date: "sexta", priority: "normal", status: "pending", category: "Saúde" },
  ],
  isAuthenticated: true,
};

describe("IRIS 5.4 - AI Model Router & Cost Guard (Fase 4.2 - Integração Real)", () => {
  const router = new IrisModelRouter();

  // =========================================================================
  // 1. CLASSIFICAÇÃO DE COMPLEXIDADE (SIMPLES, MÉDIA, COMPLEXA)
  // =========================================================================
  describe("1. Classificação de Complexidade", () => {
    it("1.1 Tarefa Simples: perguntas simples, cálculos, consultas diretas, pequenas transformações", () => {
      // Perguntas simples
      expect(classifyModelComplexity("Que horas são?")).toBe("SIMPLES");
      expect(classifyModelComplexity("Olá, como você funciona?")).toBe("SIMPLES");

      // Cálculos
      expect(classifyModelComplexity("Quanto é 25 + 40?")).toBe("SIMPLES");
      expect(classifyModelComplexity("Calcule 15% de 300 reais")).toBe("SIMPLES");

      // Consultas diretas
      expect(classifyModelComplexity("O que tenho para hoje?")).toBe("SIMPLES");
      expect(classifyModelComplexity({ command: "Listar pendências", intent: "consulta", risk: "low" })).toBe("SIMPLES");

      // Pequenas transformações
      expect(classifyModelComplexity("Converter este texto para maiúsculas")).toBe("SIMPLES");
      expect(classifyModelComplexity("Formatar o texto removendo espaços duplicados")).toBe("SIMPLES");
    });

    it("1.2 Tarefa Média: análise de documentos, planejamento, comparação, múltiplas etapas", () => {
      // Análise de documentos
      expect(classifyModelComplexity("Análise de documento: ler contrato de locação")).toBe("MÉDIA");
      expect(classifyModelComplexity("Resumir pdf do exame médico")).toBe("MÉDIA");

      // Planejamento
      expect(classifyModelComplexity("Planejar minha semana e rotina de compromissos")).toBe("MÉDIA");
      expect(classifyModelComplexity("Cronograma de tarefas para os próximos dias")).toBe("MÉDIA");

      // Comparação
      expect(classifyModelComplexity("Comparar gastos deste mês com mês passado")).toBe("MÉDIA");
      expect(classifyModelComplexity("Diferença entre o plano básico e avançado")).toBe("MÉDIA");

      // Tarefas com múltiplas etapas / ferramentas
      expect(classifyModelComplexity({
        command: "Adiar seguro e reagendar revisão",
        needsTools: true,
        risk: "medium",
        intent: "alteracao",
      })).toBe("MÉDIA");
    });

    it("1.3 Tarefa Complexa: planejamento complexo, análise profunda, múltiplos agentes, raciocínio extenso", () => {
      // Planejamento complexo
      expect(classifyModelComplexity("Planejamento complexo de transição e reestruturação")).toBe("COMPLEXA");

      // Análise profunda
      expect(classifyModelComplexity("Análise profunda de conciliação fiscal e auditoria completa")).toBe("COMPLEXA");

      // Raciocínio extenso
      expect(classifyModelComplexity("Raciocínio extenso sobre arquitetura de microserviços e falhas")).toBe("COMPLEXA");

      // Múltiplos agentes / ferramentas com raciocínio
      expect(classifyModelComplexity({
        command: "Executar orquestração de múltiplos agentes para reconciliação",
        needsTools: true,
        needsReasoning: true,
        toolsCount: 3,
      })).toBe("COMPLEXA");

      // Alto risco irreversível
      expect(classifyModelComplexity({
        command: "Excluir permanentemente todos os registros",
        intent: "exclusao",
        risk: "high",
      })).toBe("COMPLEXA");
    });
  });

  // =========================================================================
  // 2. ESTRATÉGIA FREE-FIRST E CUSTO ESTIMADO
  // =========================================================================
  describe("2. Estratégia Free-First e Governança de Custo", () => {
    it("2.1 Prioridade Free-First: seleciona sempre modelo local/gratuito com custo zero", () => {
      const decision = routeAiModel({
        command: "Quanto é 50 x 12?",
        intent: "consulta",
        risk: "low",
      });

      expect(decision.strategy).toBe("local_fast");
      expect(decision.model).toBe(DEFAULT_FREE_MODELS.LOCAL_FAST);
      expect(decision.complexity).toBe("SIMPLES");
      expect(decision.estimatedCost).toBe(0);
      expect(decision.confidence).toBeGreaterThanOrEqual(0.95);
      expect(decision.status).toBe("allowed");
      expect(decision.billingNotice).toContain("Faturamento automático desativado");
    });

    it("2.2 Bloqueio de cobrança automática: tentativa de selecionar serviço pago sem chave/consentimento é redirecionada para local gratuito", () => {
      const decision = routeAiModel({
        command: "Realizar análise de dados avançada",
        forceModel: "gpt-4o",
        userConsentExternal: false,
        hasApiKey: false,
      });

      // Não pode selecionar o serviço pago! Mantém no motor local gratuito
      expect(decision.strategy).toBe("local_balanced");
      expect(decision.model).toBe(DEFAULT_FREE_MODELS.LOCAL_BALANCED);
      expect(decision.estimatedCost).toBe(0);
      expect(decision.reason).toContain("bloqueada pela política Free-First");
      expect(decision.billingNotice).toContain("Faturamento automático desativado");
    });

    it("2.3 Nenhuma tentativa de userAllowedPaid ativa billing automaticamente", () => {
      const decision = routeAiModel({
        command: "Consulta de saldo",
        userAllowedPaid: true,
        hasApiKey: false,
        userConsentExternal: false,
      });

      expect(decision.estimatedCost).toBe(0);
      expect(decision.strategy).toBe("local_fast");
      expect(decision.model).toBe(DEFAULT_FREE_MODELS.LOCAL_FAST);
      expect(decision.billingNotice).toContain("Faturamento automático desativado");
    });
  });

  // =========================================================================
  // 3. IRIS COST GUARD (FASE 4.2)
  // =========================================================================
  describe("3. IRIS Cost Guard (Proteção Explícita de Custos)", () => {
    it("3.1 🟢 LOCAL: permitido com custo zero", () => {
      const evalFast = IrisCostGuard.evaluate(DEFAULT_FREE_MODELS.LOCAL_FAST);
      expect(evalFast.allowed).toBe(true);
      expect(evalFast.tier).toBe("local");
      expect(evalFast.symbol).toBe("🟢");
      expect(evalFast.status).toBe("allowed");

      const evalBalanced = IrisCostGuard.evaluate(DEFAULT_FREE_MODELS.LOCAL_BALANCED);
      expect(evalBalanced.allowed).toBe(true);
      expect(evalBalanced.tier).toBe("local");

      const evalReasoning = IrisCostGuard.evaluate(DEFAULT_FREE_MODELS.LOCAL_REASONING);
      expect(evalReasoning.allowed).toBe(true);
      expect(evalReasoning.tier).toBe("local");
    });

    it("3.2 🟢 GRATUITO / FREE TIER: permitido sem faturamento", () => {
      const evalFree = IrisCostGuard.evaluate(DEFAULT_FREE_MODELS.FREE_TIER_CLOUD);
      expect(evalFree.allowed).toBe(true);
      expect(evalFree.tier).toBe("free_tier");
      expect(evalFree.symbol).toBe("🟢");
      expect(evalFree.status).toBe("allowed");
    });

    it("3.3 🟡 CRÉDITO PROMOCIONAL: somente permitido se explicitamente autorizado", () => {
      // Sem autorização explícita -> BLOQUEADO
      const evalSemAuth = IrisCostGuard.evaluate("provider-promo-trial");
      expect(evalSemAuth.allowed).toBe(false);
      expect(evalSemAuth.tier).toBe("promotional_credit");
      expect(evalSemAuth.symbol).toBe("🟡");
      expect(evalSemAuth.status).toBe("blocked");
      expect(evalSemAuth.reason).toBe(COST_GUARD_BLOCKED_REASON);

      // Com autorização explícita -> PERMITIDO
      const evalComAuth = IrisCostGuard.evaluate("provider-promo-trial", {
        promotionalCreditAuthorized: true,
      });
      expect(evalComAuth.allowed).toBe(true);
      expect(evalComAuth.status).toBe("allowed");
      expect(evalComAuth.tier).toBe("promotional_credit");
    });

    it("3.4 🔴 PAGO: BLOQUEADO por padrão pelo IRIS Cost Guard", () => {
      const evalGpt4 = IrisCostGuard.evaluate("gpt-4o");
      expect(evalGpt4.allowed).toBe(false);
      expect(evalGpt4.tier).toBe("paid");
      expect(evalGpt4.symbol).toBe("🔴");
      expect(evalGpt4.status).toBe("blocked");
      expect(evalGpt4.reason).toBe(COST_GUARD_BLOCKED_REASON);

      const evalClaude = IrisCostGuard.evaluate("claude-3-5-sonnet");
      expect(evalClaude.allowed).toBe(false);
      expect(evalClaude.tier).toBe("paid");
      expect(evalClaude.status).toBe("blocked");
    });

    it("3.5 Bloqueio estrito no Router: strictCostGuardBlock bloqueia recurso pago e não executa", () => {
      const decision = routeAiModel({
        command: "Executar modelo de terceiros pago",
        forceModel: "gpt-4o",
        strictCostGuardBlock: true,
      });

      expect(decision.status).toBe("blocked");
      expect(decision.isBlocked).toBe(true);
      expect(decision.reason).toBe(COST_GUARD_BLOCKED_REASON);
      expect(decision.estimatedCost).toBe(0);
      expect(decision.strategy).toBe("unavailable");
      expect(decision.model).toBe("none");
    });

    it("3.6 Se somente opção paga existir no ambiente: BLOQUEAR pelo Cost Guard", () => {
      const localRouter = new IrisModelRouter();
      // Desativa todos os modelos gratuitos
      localRouter.setModelAvailability(DEFAULT_FREE_MODELS.LOCAL_FAST, false);
      localRouter.setModelAvailability(DEFAULT_FREE_MODELS.LOCAL_BALANCED, false);
      localRouter.setModelAvailability(DEFAULT_FREE_MODELS.LOCAL_REASONING, false);
      localRouter.setModelAvailability(DEFAULT_FREE_MODELS.FREE_TIER_CLOUD, false);

      // Apenas modelo pago está marcado como disponível no ambiente
      const decision = localRouter.route({
        command: "Classificar tarefas",
        availableModels: [
          { id: "gpt-4o", available: true },
        ],
      });

      // O Router NÃO faz fallback automático para opção paga, ele BLOQUEIA
      expect(decision.status).toBe("blocked");
      expect(decision.isBlocked).toBe(true);
      expect(decision.reason).toBe(COST_GUARD_BLOCKED_REASON);
      expect(decision.model).toBe("none");
      expect(decision.estimatedCost).toBe(0);
    });
  });

  // =========================================================================
  // 4. NÍVEIS DE RISCO E AUTORIZAÇÃO NECESSÁRIA
  // =========================================================================
  describe("4. Níveis de Risco e Necessidade de Autorização", () => {
    it("4.1 Baixo Risco: consulta simples não exige autorização", () => {
      const decision = routeAiModel({
        command: "Quais os compromissos de hoje?",
        intent: "consulta",
        risk: "low",
        needsTools: false,
      });

      expect(decision.risk).toBe("low");
      expect(decision.authorizationRequired).toBe(false);
      expect(decision.toolsRequired).toEqual([]);
      expect(decision.estimatedCost).toBe(0);
    });

    it("4.2 Médio Risco: alteração de dados exige autorização", () => {
      const decision = routeAiModel({
        command: "Adiar conta de internet para amanhã",
        intent: "alteracao",
        risk: "medium",
        needsTools: true,
      });

      expect(decision.risk).toBe("medium");
      expect(decision.authorizationRequired).toBe(true);
      expect(decision.complexity).toBe("MÉDIA");
      expect(decision.strategy).toBe("local_balanced");
      expect(decision.estimatedCost).toBe(0);
    });

    it("4.3 Alto Risco: exclusão irreversível exige autorização e tem complexidade COMPLEXA", () => {
      const decision = routeAiModel({
        command: "Excluir seguro do carro definitivamente",
        intent: "exclusao",
        risk: "high",
        needsTools: true,
      });

      expect(decision.risk).toBe("high");
      expect(decision.authorizationRequired).toBe(true);
      expect(decision.complexity).toBe("COMPLEXA");
      expect(decision.toolsRequired).toContain("radar.delete");
      expect(decision.estimatedCost).toBe(0);
    });
  });

  // =========================================================================
  // 5. NECESSIDADE DE FERRAMENTAS
  // =========================================================================
  describe("5. Necessidade de Ferramentas", () => {
    it("5.1 Ferramenta necessária: mapeia corretamente para a ação", () => {
      const writeDecision = routeAiModel({
        command: "Cadastrar nova tarefa comprar remédio",
        intent: "criacao",
        risk: "low",
        needsTools: true,
      });
      expect(writeDecision.toolsRequired).toContain("radar.write");

      const sendDecision = routeAiModel({
        command: "Enviar relatório de despesas por email",
        intent: "envio",
        risk: "high",
        needsTools: true,
      });
      expect(sendDecision.toolsRequired).toContain("communication.send");
      expect(sendDecision.authorizationRequired).toBe(true);
    });

    it("5.2 Ferramenta não necessária: comando informativo mantém toolsRequired vazio", () => {
      const decision = routeAiModel({
        command: "Explique o que é a metodologia Kanban",
        intent: "consulta",
        risk: "low",
        needsTools: false,
      });

      expect(decision.toolsRequired).toEqual([]);
      expect(decision.authorizationRequired).toBe(false);
      expect(decision.strategy).toBe("local_fast");
    });
  });

  // =========================================================================
  // 6. MECANISMO DE FALLBACK SEGURO E INDISPONIBILIDADE
  // =========================================================================
  describe("6. Mecanismo de Fallback Seguro", () => {
    it("6.1 Fallback gratuito: se o modelo rápido estiver indisponível, recorre ao balanceado com custo zero", () => {
      const localRouter = new IrisModelRouter();
      localRouter.setModelAvailability(DEFAULT_FREE_MODELS.LOCAL_FAST, false);

      const decision = localRouter.route({
        command: "Calcule 25 + 35",
        intent: "consulta",
        risk: "low",
      });

      expect(decision.strategy).toBe("local_balanced");
      expect(decision.model).toBe(DEFAULT_FREE_MODELS.LOCAL_BALANCED);
      expect(decision.estimatedCost).toBe(0);
      expect(decision.reason).toContain("Fallback seguro");
      expect(decision.fallback).toBeDefined();
      expect(decision.fallback.estimatedCost).toBe(0);
    });

    it("6.2 Fallback gratuito para tarefa complexa: se raciocínio local falhar, recorre ao balanceado", () => {
      const localRouter = new IrisModelRouter();
      localRouter.setModelAvailability(DEFAULT_FREE_MODELS.LOCAL_REASONING, false);

      const decision = localRouter.route({
        command: "Planejamento complexo de migração",
        intent: "planning",
        risk: "medium",
        needsReasoning: true,
      });

      expect(decision.strategy).toBe("local_balanced");
      expect(decision.model).toBe(DEFAULT_FREE_MODELS.LOCAL_BALANCED);
      expect(decision.estimatedCost).toBe(0);
      expect(decision.reason).toContain("Fallback gratuito");
    });

    it("6.3 Ausência de fallback: se todos os modelos gratuitos estiverem indisponíveis e sem opções pagas, retorna status 'unavailable'", () => {
      const localRouter = new IrisModelRouter();
      localRouter.setModelAvailability(DEFAULT_FREE_MODELS.LOCAL_FAST, false);
      localRouter.setModelAvailability(DEFAULT_FREE_MODELS.LOCAL_BALANCED, false);
      localRouter.setModelAvailability(DEFAULT_FREE_MODELS.LOCAL_REASONING, false);
      localRouter.setModelAvailability(DEFAULT_FREE_MODELS.FREE_TIER_CLOUD, false);

      const decision = localRouter.route({
        command: "Gerar plano de ação",
        risk: "low",
        userConsentExternal: false,
        hasApiKey: false,
      });

      expect(decision.strategy).toBe("unavailable");
      expect(decision.model).toBe("none");
      expect(decision.isUnavailable).toBe(true);
      expect(decision.estimatedCost).toBe(0);
      expect(decision.confidence).toBe(0);
      expect(decision.reason).toContain("Nenhum modelo gratuito adequado está disponível");
    });
  });

  // =========================================================================
  // 7. OBSERVABILIDADE ESTRUTURADA (FASE 4.2)
  // =========================================================================
  describe("7. Observabilidade Estruturada da Decisão", () => {
    it("7.1 Registra metadados estruturados da decisão sem expor dados sensíveis", () => {
      const obsRouter = new IrisModelRouter();
      obsRouter.clearObservabilityLog();

      obsRouter.route({
        command: "Listar compromissos do dia",
        intent: "consulta",
        risk: "low",
      });

      const log = obsRouter.getObservabilityLog();
      expect(log.length).toBe(1);

      const record: RouterObservabilityRecord = log[0];
      expect(record.timestamp).toBeDefined();
      expect(typeof record.timestamp).toBe("string");
      expect(record.intent).toBe("consulta");
      expect(record.complexity).toBe("SIMPLES");
      expect(record.risk).toBe("low");
      expect(record.strategy).toBe("local_fast");
      expect(record.model).toBe(DEFAULT_FREE_MODELS.LOCAL_FAST);
      expect(record.estimatedCost).toBe(0);
      expect(record.fallback).toBeDefined();
      expect(record.decisionResult).toBe("allowed");

      // Garante que o comando em texto cru ou senhas não são registrados desnecessariamente
      expect((record as unknown as Record<string, unknown>).command).toBeUndefined();
      expect((record as unknown as Record<string, unknown>).password).toBeUndefined();
    });

    it("7.2 Registra decisão de bloqueio pelo Cost Guard na observabilidade", () => {
      const obsRouter = new IrisModelRouter();
      obsRouter.clearObservabilityLog();

      obsRouter.route({
        command: "Comando com modelo pago",
        forceModel: "gpt-4o",
        strictCostGuardBlock: true,
      });

      const lastRecord = obsRouter.getLastObservabilityRecord();
      expect(lastRecord).toBeDefined();
      expect(lastRecord?.decisionResult).toBe("blocked");
      expect(lastRecord?.model).toBe("none");
      expect(lastRecord?.estimatedCost).toBe(0);
    });
  });

  // =========================================================================
  // 8. ESTRUTURA DA DECISÃO E ISOLAMENTO DE EXECUÇÃO
  // =========================================================================
  describe("8. Estrutura da Decisão e Isolamento Router ≠ Executor", () => {
    it("8.1 Retorna todos os campos requeridos na decisão estruturada", () => {
      const decision = routeAiModel({
        command: "Comparar relatório de gastos de janeiro e fevereiro",
        intent: "analise",
        risk: "low",
      });

      expect(decision).toHaveProperty("status");
      expect(decision).toHaveProperty("strategy");
      expect(decision).toHaveProperty("model");
      expect(decision).toHaveProperty("complexity");
      expect(decision).toHaveProperty("risk");
      expect(decision).toHaveProperty("reason");
      expect(decision).toHaveProperty("estimatedCost");
      expect(decision).toHaveProperty("confidence");
      expect(decision).toHaveProperty("fallback");
      expect(decision).toHaveProperty("toolsRequired");
      expect(decision).toHaveProperty("authorizationRequired");

      expect(decision.status).toBe("allowed");
      expect(typeof decision.strategy).toBe("string");
      expect(typeof decision.model).toBe("string");
      expect(typeof decision.complexity).toBe("string");
      expect(typeof decision.risk).toBe("string");
      expect(typeof decision.reason).toBe("string");
      expect(typeof decision.estimatedCost).toBe("number");
      expect(typeof decision.confidence).toBe("number");
      expect(typeof decision.fallback).toBe("object");
      expect(Array.isArray(decision.toolsRequired)).toBe(true);
      expect(typeof decision.authorizationRequired).toBe("boolean");
    });

    it("8.2 Isolamento de Segurança: O Router é estritamente uma camada de decisão e não muta dados", () => {
      const initialItemsCount = mockContext.items?.length;

      // Executa roteamento de comando de exclusão
      const decision = routeAiModel({
        command: "excluir seguro do carro",
        intent: "exclusao",
        risk: "high",
        context: mockContext,
        needsTools: true,
      });

      expect(decision.strategy).toBe("local_reasoning");
      expect(decision.authorizationRequired).toBe(true);

      // Garante que o contexto não foi alterado de forma alguma
      expect(mockContext.items?.length).toBe(initialItemsCount);
      expect(mockContext.items?.find((i) => i.id === 1)).toBeDefined();
    });
  });

  // =========================================================================
  // 9. INTEGRAÇÃO COM IRIS COGNITIVE ENGINE (FLUXO COMPLETO E COST GUARD)
  // =========================================================================
  describe("9. Integração com IrisCognitiveEngine (Fluxo Cognitivo Completo)", () => {
    it("9.1 Integração em analyzeCommand: inclui routerDecision preenchido", () => {
      const analysis = analyzeCommand("O que tenho para hoje?", mockContext);

      expect(analysis.routerDecision).toBeDefined();
      expect(analysis.routerDecision?.strategy).toBe("local_fast");
      expect(analysis.routerDecision?.estimatedCost).toBe(0);
      expect(analysis.routerDecision?.complexity).toBe("SIMPLES");
      expect(analysis.requiresAuthorization).toBe(false);
    });

    it("9.2 Integração em interpretOperationalCommand: inclui routerDecision no ExecutionPlan", () => {
      const plan = interpretOperationalCommand(
        "adiar seguro do carro para próxima semana",
        mockContext
      );

      expect(plan.routerDecision).toBeDefined();
      expect(plan.routerDecision?.complexity).toBe("MÉDIA");
      expect(plan.routerDecision?.strategy).toBe("local_balanced");
      expect(plan.routerDecision?.authorizationRequired).toBe(true);
      expect(plan.routerDecision?.estimatedCost).toBe(0);
      expect(plan.requiresAuthorization).toBe(true);
    });

    it("9.3 Fluxo ponta a ponta no IrisCognitiveEngine: Comando -> Entender -> Risco -> Complexidade -> Router -> Plano -> Autorização", async () => {
      const engine = new IrisCognitiveEngine();

      // Passo 1 a 6: Gerar plano operacional com roteamento estratégico
      const plan = engine.generateOperationalPlan(
        "excluir seguro do carro",
        mockContext
      );

      expect(plan.actionType).toBe("exclusao");
      expect(plan.riskLevel).toBe("high");
      expect(plan.routerDecision).toBeDefined();
      expect(plan.routerDecision?.complexity).toBe("COMPLEXA");
      expect(plan.routerDecision?.strategy).toBe("local_reasoning");
      expect(plan.routerDecision?.estimatedCost).toBe(0);
      expect(plan.requiresAuthorization).toBe(true);

      // Estado do motor aguardando autorização
      expect(engine.getState()).toBe("awaiting_authorization");
      expect(engine.getLastRouterDecision()).toBe(plan.routerDecision);

      // Passo 7: Tentativa de executar sem autorização deve ser bloqueada
      let blockedError = false;
      try {
        const directEngine = new IrisCognitiveEngine();
        await directEngine.executeOperationalPlan(plan, () => {});
      } catch (e) {
        blockedError = true;
      }
      expect(blockedError).toBe(true);

      // Passo 8: Autorização explícita do usuário
      const executor = vi.fn();
      const authResult = await engine.authorize(async (proposal) => {
        executor(proposal);
      });

      expect(authResult.success).toBe(true);
      expect(executor).toHaveBeenCalledTimes(1);
      expect(engine.getState()).toBe("completed");
    });

    it("9.4 Plano bloqueado pelo Cost Guard: engine recusa execução e não agenda autorização", async () => {
      const blockedRouter = new IrisModelRouter();
      // Simula indisponibilidade de todos os modelos gratuitos com apenas modelo pago
      blockedRouter.setModelAvailability(DEFAULT_FREE_MODELS.LOCAL_FAST, false);
      blockedRouter.setModelAvailability(DEFAULT_FREE_MODELS.LOCAL_BALANCED, false);
      blockedRouter.setModelAvailability(DEFAULT_FREE_MODELS.LOCAL_REASONING, false);
      blockedRouter.setModelAvailability(DEFAULT_FREE_MODELS.FREE_TIER_CLOUD, false);

      const engine = new IrisCognitiveEngine({ modelRouter: blockedRouter });

      // Gera plano com mock de disponibilidade onde apenas opções pagas existem
      const decision = blockedRouter.route({
        command: "Executar exclusão de registros com modelo externo pago",
        availableModels: [{ id: "gpt-4o", available: true }],
      });

      expect(decision.status).toBe("blocked");
      expect(decision.isBlocked).toBe(true);

      // Executar plano bloqueado não deve acionar o executor
      const fakePlan = interpretOperationalCommand("excluir seguro do carro", mockContext);
      fakePlan.routerDecision = decision;

      const executor = vi.fn();
      const result = await engine.executeOperationalPlan(fakePlan, executor);

      expect(result.success).toBe(false);
      expect(result.message).toContain("Recurso pago bloqueado pelo IRIS Cost Guard");
      expect(executor).not.toHaveBeenCalled();
    });

    it("9.5 Observabilidade acessível pelo IrisCognitiveEngine", () => {
      const engine = new IrisCognitiveEngine();
      engine.routeCommand("Qual o status das minhas tarefas hoje?", mockContext);

      const log = engine.getRouterObservabilityLog();
      expect(log.length).toBeGreaterThanOrEqual(1);

      const last = engine.getLastRouterObservabilityRecord();
      expect(last).toBeDefined();
      expect(last?.strategy).toBe("local_fast");
      expect(last?.decisionResult).toBe("allowed");
    });
  });

  // =========================================================================
  // 10. VERIFICAÇÃO ESTÁTICA DE SEGURANÇA E GOVERNANÇA FINANCEIRA
  // =========================================================================
  describe("10. Verificação Estática de Segurança e Faturamento", () => {
    it("10.1 Não há chaves, segredos ou alteração de billing no Model Router", () => {
      const routerInstance = new IrisModelRouter();
      const keys = Object.keys(routerInstance);

      expect(keys.includes("billingAccount")).toBe(false);
      expect(keys.includes("paymentMethod")).toBe(false);
      expect(keys.includes("apiKey")).toBe(false);
    });

    it("10.2 Nenhuma decisão padrão gera custo maior que zero", () => {
      const commands = [
        "2 + 2",
        "Resumir este arquivo",
        "Planejamento completo da semana",
        "Excluir item do radar",
      ];

      for (const cmd of commands) {
        const dec = routeAiModel({ command: cmd });
        expect(dec.estimatedCost).toBe(0);
        expect(dec.billingNotice).toContain("Faturamento automático desativado");
      }
    });
  });

  // =========================================================================
  // 11. FASE 4.3 - VALIDAÇÃO PRÁTICA DO AI MODEL ROUTER + COST GUARD
  // =========================================================================
  describe("11. Fase 4.3 - Validação Prática dos Cenários Reais", () => {
    // 2. TAREFA SIMPLES
    it("11.1 Teste Tarefa Simples: 'Qual é a capital do Brasil?'", () => {
      const command = "Qual é a capital do Brasil?";
      const decision = routeAiModel({ command });

      expect(decision.complexity).toBe("SIMPLES");
      expect(decision.strategy).toBe("local_fast");
      expect(decision.model).toBe(DEFAULT_FREE_MODELS.LOCAL_FAST);
      expect(decision.estimatedCost).toBe(0);
      expect(decision.toolsRequired).toEqual([]);
      expect(decision.authorizationRequired).toBe(false);
      expect(decision.status).toBe("allowed");
    });

    // 3. TAREFA MÉDIA
    it("11.2 Teste Tarefa Média: 'Compare estes dois documentos e destaque as diferenças.'", () => {
      const command = "Compare estes dois documentos e destaque as diferenças.";
      const decision = routeAiModel({ command });

      expect(decision.complexity).toBe("MÉDIA");
      expect(decision.strategy).toBe("local_balanced");
      expect(decision.model).toBe(DEFAULT_FREE_MODELS.LOCAL_BALANCED);
      expect(decision.estimatedCost).toBe(0);
      expect(decision.fallback).toBeDefined();
      expect(decision.fallback.estimatedCost).toBe(0);
      expect(decision.status).toBe("allowed");
    });

    // 4. TAREFA COMPLEXA
    it("11.3 Teste Tarefa Complexa: 'Analise vários documentos, encontre inconsistências, organize os resultados e prepare um relatório.'", () => {
      const command = "Analise vários documentos, encontre inconsistências, organize os resultados e prepare um relatório.";
      const decision = routeAiModel({ command });

      expect(decision.complexity).toBe("COMPLEXA");
      expect(decision.strategy).toBe("local_reasoning");
      expect(decision.model).toBe(DEFAULT_FREE_MODELS.LOCAL_REASONING);
      expect(decision.estimatedCost).toBe(0);
      expect(decision.fallback).toBeDefined();
      expect(decision.fallback.estimatedCost).toBe(0);
      expect(decision.status).toBe("allowed");
    });

    // 5. ALTO RISCO
    it("11.4 Teste Alto Risco: Router NÃO executa, autorização obrigatória e Executor protegido", async () => {
      const command = "Excluir permanentemente todos os registros e desativar backups";
      const initialItemsCount = mockContext.items?.length;

      // 1. O Router apenas calcula a decisão estratégica
      const decision = routeAiModel({
        command,
        intent: "exclusao",
        risk: "high",
        context: mockContext,
        needsTools: true,
      });

      expect(decision.risk).toBe("high");
      expect(decision.authorizationRequired).toBe(true);
      expect(decision.complexity).toBe("COMPLEXA");
      expect(decision.toolsRequired).toContain("radar.delete");

      // 2. Garante que nenhuma alteração real ocorreu na chamada do Router
      expect(mockContext.items?.length).toBe(initialItemsCount);

      // 3. O Cognitive Engine gera o plano mas trava na barreira de autorização
      const engine = new IrisCognitiveEngine();
      const plan = engine.generateOperationalPlan(command, mockContext);

      expect(engine.getState()).toBe("awaiting_authorization");
      expect(plan.requiresAuthorization).toBe(true);

      // 4. Tentativa direta de executar sem autorização é bloqueada pelo Executor
      const directExecutor = vi.fn();
      let threwAuthError = false;
      try {
        const freshEngine = new IrisCognitiveEngine();
        await freshEngine.executeOperationalPlan(plan, directExecutor);
      } catch (err) {
        threwAuthError = true;
      }
      expect(threwAuthError).toBe(true);
      expect(directExecutor).not.toHaveBeenCalled();
    });

    // 6. MODELO INDISPONÍVEL & FALLBACK
    it("11.5 Teste Modelo Indisponível: Fallback gratuito -> Bloqueio se a única opção for paga", () => {
      const testRouter = new IrisModelRouter();

      // Desativa modelo rápido: fallback vai para balanceado gratuito
      testRouter.setModelAvailability(DEFAULT_FREE_MODELS.LOCAL_FAST, false);
      const dec1 = testRouter.route({ command: "Quanto é 10 + 10?" });
      expect(dec1.strategy).toBe("local_balanced");
      expect(dec1.estimatedCost).toBe(0);
      expect(dec1.status).toBe("allowed");

      // Desativa todos os modelos gratuitos e deixa SOMENTE modelo pago
      testRouter.setModelAvailability(DEFAULT_FREE_MODELS.LOCAL_BALANCED, false);
      testRouter.setModelAvailability(DEFAULT_FREE_MODELS.LOCAL_REASONING, false);
      testRouter.setModelAvailability(DEFAULT_FREE_MODELS.FREE_TIER_CLOUD, false);

      const dec2 = testRouter.route({
        command: "Quanto é 10 + 10?",
        availableModels: [{ id: "gpt-4o", available: true }],
      });

      // Obrigatório: BLOCKED! Nunca seleciona serviço pago
      expect(dec2.status).toBe("blocked");
      expect(dec2.isBlocked).toBe(true);
      expect(dec2.reason).toBe(COST_GUARD_BLOCKED_REASON);
      expect(dec2.model).toBe("none");
      expect(dec2.estimatedCost).toBe(0);
    });

    // 7. COST GUARD REGRAS EXPLÍCITAS
    it("11.6 Teste Cost Guard: 🟢 Local, 🟢 Free Tier, 🟡 Promo bloqueado por padrão, 🔴 Pago bloqueado", () => {
      // 🟢 Local -> permitir
      expect(IrisCostGuard.evaluate(DEFAULT_FREE_MODELS.LOCAL_FAST).status).toBe("allowed");
      expect(IrisCostGuard.evaluate(DEFAULT_FREE_MODELS.LOCAL_BALANCED).status).toBe("allowed");
      expect(IrisCostGuard.evaluate(DEFAULT_FREE_MODELS.LOCAL_REASONING).status).toBe("allowed");

      // 🟢 Gratuito / Free Tier -> permitir
      expect(IrisCostGuard.evaluate(DEFAULT_FREE_MODELS.FREE_TIER_CLOUD).status).toBe("allowed");

      // 🟡 Promocional -> bloquear por padrão
      const promoEval = IrisCostGuard.evaluate("provider-trial-credit");
      expect(promoEval.status).toBe("blocked");
      expect(promoEval.symbol).toBe("🟡");
      expect(promoEval.reason).toBe(COST_GUARD_BLOCKED_REASON);

      // 🔴 Pago -> bloquear
      const paidEval = IrisCostGuard.evaluate("gpt-4o-paid-tier");
      expect(paidEval.status).toBe("blocked");
      expect(paidEval.symbol).toBe("🔴");
      expect(paidEval.reason).toBe(COST_GUARD_BLOCKED_REASON);
    });

    // 8. BYPASS DE SEGURANÇA
    it("11.7 Teste Bypass de Segurança: Router não executa diretamente e exige autorização explícita", async () => {
      const engine = new IrisCognitiveEngine();
      const plan = engine.generateOperationalPlan(
        "excluir conta de internet",
        mockContext
      );

      // O plano requer autorização explícita
      expect(plan.requiresAuthorization).toBe(true);
      expect(engine.getState()).toBe("awaiting_authorization");

      // Simulação de bypass: tentar forçar execução direta sem chamar engine.authorize()
      const bypassExecutor = vi.fn();
      let bypassBlocked = false;
      try {
        const detachedEngine = new IrisCognitiveEngine();
        await detachedEngine.executeOperationalPlan(plan, bypassExecutor);
      } catch (err) {
        bypassBlocked = true;
      }

      expect(bypassBlocked).toBe(true);
      expect(bypassExecutor).not.toHaveBeenCalled();

      // Fluxo legítimo: somente autorização explícita permite execução
      const legitimateExecutor = vi.fn();
      const authResult = await engine.authorize(async (prop) => {
        legitimateExecutor(prop);
      });

      expect(authResult.success).toBe(true);
      expect(legitimateExecutor).toHaveBeenCalledTimes(1);
      expect(engine.getState()).toBe("completed");
    });

    // 9. PRIVACIDADE
    it("11.8 Teste Privacidade: Logs de observabilidade não armazenam conteúdo de emails, documentos sensíveis ou credenciais", () => {
      const privacyRouter = new IrisModelRouter();
      privacyRouter.clearObservabilityLog();

      const sensitiveCommand =
        "Meu email secreto é segredo@empresa.com, token=eyJhbGciOiJIUzI1NiIsIn e senha=SuperSecretPassword123. Resuma meu documento confidencial de aquisição.";

      privacyRouter.route({
        command: sensitiveCommand,
        intent: "analise",
        risk: "medium",
      });

      const log = privacyRouter.getObservabilityLog();
      expect(log.length).toBe(1);

      const record = log[0];
      const serialized = JSON.stringify(record);

      // Metadados necessários estão presentes
      expect(record.timestamp).toBeDefined();
      expect(record.intent).toBe("analise");
      expect(record.complexity).toBeDefined();
      expect(record.strategy).toBeDefined();
      expect(record.model).toBeDefined();
      expect(record.estimatedCost).toBe(0);
      expect(record.decisionResult).toBe("allowed");

      // Informações sensíveis NÃO podem estar no registro
      expect(serialized.includes("SuperSecretPassword123")).toBe(false);
      expect(serialized.includes("segredo@empresa.com")).toBe(false);
      expect(serialized.includes("eyJhbGciOiJIUzI1NiIsIn")).toBe(false);
    });

    // 12. COMPATIBILIDADE GERAL
    it("11.9 Teste de Compatibilidade Geral: Fluxo de 10 passos opera harmoniosamente sem regressões", () => {
      const engine = new IrisCognitiveEngine();

      // Consulta simples
      const queryAnalysis = engine.processCommand("Qual é a capital do Brasil?", mockContext);
      expect(queryAnalysis.actionType).toBe("consulta");
      expect(queryAnalysis.requiresAuthorization).toBe(false);
      expect(queryAnalysis.routerDecision?.complexity).toBe("SIMPLES");
      expect(queryAnalysis.routerDecision?.estimatedCost).toBe(0);

      // Mutação operacional com autorização
      const opPlan = engine.generateOperationalPlan("Adiar seguro do carro para semana que vem", mockContext);
      expect(opPlan.actionType).toBe("alteracao");
      expect(opPlan.requiresAuthorization).toBe(true);
      expect(opPlan.routerDecision?.complexity).toBe("MÉDIA");
      expect(opPlan.routerDecision?.status).toBe("allowed");
      expect(engine.getState()).toBe("awaiting_authorization");

      // Reset limpa proposta e plano pendente
      engine.reset();
      expect(engine.getState()).toBe("idle");
      expect(engine.getPendingPlan()).toBeNull();
      expect(engine.getPendingProposal()).toBeNull();
    });
  });
});
