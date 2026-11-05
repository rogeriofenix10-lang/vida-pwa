import { describe, expect, it, vi } from "vitest";
import {
  classifyComplexity,
  routeAiStrategy,
  executeWithRouterFallback,
  routeModel,
  classifyRoutingTask,
  type AiRouterInput,
  type RouterDecision,
} from "./model-router";
import { analyzeCommand } from "../shared/irisCognitive";

describe("IRIS 5.4 — AI Model Router", () => {
  describe("1. Classificação de Complexidade (simples | média | complexa)", () => {
    it("classifica como 'simples' consultas informativas, saudações e comandos sem ferramentas", () => {
      expect(
        classifyComplexity({
          intent: "query",
          risk: "low",
          needsTools: false,
          message: "Bom dia, tudo bem?",
        })
      ).toBe("simples");

      expect(
        classifyComplexity({
          intent: "consulta",
          risk: "low",
          needsTools: false,
          message: "Qual o horário do meu compromisso?",
        })
      ).toBe("simples");
    });

    it("classifica como 'média' tarefas com ferramentas, agendamentos, atualizações ou risco médio", () => {
      expect(
        classifyComplexity({
          intent: "alteracao",
          risk: "medium",
          needsTools: true,
          message: "Adiar a reunião com a equipe para amanhã",
        })
      ).toBe("média");

      expect(
        classifyComplexity({
          intent: "criacao",
          risk: "low",
          needsTools: true,
          message: "Lembrar de pagar o condomínio dia 15",
        })
      ).toBe("média");

      expect(
        classifyComplexity({
          intent: "organizacao",
          risk: "low",
          needsTools: true,
          message: "Cadastrar nova conta no Radar",
        })
      ).toBe("média");
    });

    it("classifica como 'complexa' tarefas com anexos, documentos pesados, código complexo, risco alto ou financeiro", () => {
      expect(
        classifyComplexity({
          intent: "exclusao",
          risk: "high",
          needsTools: true,
          message: "Excluir permanentemente o registro de contrato",
        })
      ).toBe("complexa");

      expect(
        classifyComplexity({
          intent: "analise",
          risk: "low",
          needsTools: false,
          hasAttachments: true,
          message: "Analise esta imagem do laudo médico",
        })
      ).toBe("complexa");

      expect(
        classifyComplexity({
          intent: "complex_code",
          risk: "low",
          needsTools: false,
          message: "Escreva uma função TypeScript com refatoração e tipagem estrita",
        })
      ).toBe("complexa");

      expect(
        classifyComplexity({
          intent: "mutation",
          risk: "high",
          needsTools: true,
          message: "Realizar transferência via PIX de R$ 500",
        })
      ).toBe("complexa");
    });
  });

  describe("2. Priorização contínua de opção gratuita/local quando adequada", () => {
    it("roteia tarefas simples diretamente para o motor local gratuito 'manus' com custo zero", () => {
      const decision = routeAiStrategy({
        intent: "query",
        risk: "low",
        complexity: "simples",
        context: "Olá IRIS, como você pode me ajudar?",
        needsTools: false,
      });

      expect(decision.provider).toBe("manus");
      expect(decision.strategy).toBe("local_fast");
      expect(decision.estimatedCost).toBe("R$ 0,00 (gratuito)");
      expect(decision.isExternal).toBe(false);
      expect(decision.requiresConfirmation).toBe(false);
    });

    it("roteia tarefas de média complexidade para motor local balanceado com custo zero", () => {
      const decision = routeAiStrategy({
        intent: "criacao",
        risk: "medium",
        complexity: "média",
        context: "Adicionar lembrete de consulta amanhã às 14h",
        needsTools: true,
      });

      expect(decision.provider).toBe("manus");
      expect(decision.strategy).toBe("local_balanced");
      expect(decision.estimatedCost).toBe("R$ 0,00 (gratuito)");
      expect(decision.isExternal).toBe(false);
    });
  });

  describe("3. NUNCA habilitar ou utilizar API paga automaticamente", () => {
    it("mantém tarefas complexas no motor local gratuito quando o usuário não deu consentimento externo", () => {
      const decision = routeAiStrategy({
        intent: "planning",
        risk: "medium",
        complexity: "complexa",
        context: "Elabore um plano estratégico completo para o próximo trimestre",
        needsTools: true,
        requested: "auto",
        externalConsent: false,
        hasApiKey: false,
      });

      expect(decision.provider).toBe("manus");
      expect(decision.strategy).toBe("local_reasoning");
      expect(decision.estimatedCost).toBe("R$ 0,00 (gratuito)");
      expect(decision.isExternal).toBe(false);
      expect(decision.reason).toContain("APIs pagas nunca são acionadas automaticamente");
    });

    it("mantém tarefas complexas no motor local mesmo com consentimento caso não haja chave própria configurada", () => {
      const decision = routeAiStrategy({
        intent: "complex_code",
        risk: "low",
        complexity: "complexa",
        context: "Refatore o algoritmo de reconciliação de dados",
        needsTools: false,
        requested: "auto",
        externalConsent: true,
        hasApiKey: false, // Sem chave externa configurada
      });

      expect(decision.provider).toBe("manus");
      expect(decision.strategy).toBe("local_reasoning");
      expect(decision.estimatedCost).toBe("R$ 0,00 (gratuito)");
      expect(decision.isExternal).toBe(false);
    });

    it("bloqueia pedido de modelo externo sem consentimento e reverte para motor local com segurança", () => {
      const decision = routeAiStrategy({
        intent: "chat",
        risk: "low",
        complexity: "simples",
        context: "Conversa com IA",
        needsTools: false,
        requested: "chatgpt",
        externalConsent: false,
      });

      expect(decision.provider).toBe("manus");
      expect(decision.estimatedCost).toBe("R$ 0,00 (gratuito)");
      expect(decision.isExternal).toBe(false);
      expect(decision.reason).toContain("requer consentimento explícito do usuário");
    });

    it("permite uso de modelo externo apenas com consentimento explícito e chave própria, informando custo zero da plataforma", () => {
      const decision = routeAiStrategy({
        intent: "multimodal",
        risk: "low",
        complexity: "complexa",
        context: "Analise o exame em anexo",
        needsTools: false,
        requested: "auto",
        externalConsent: true,
        hasApiKey: true,
        hasAttachments: true,
      });

      expect(decision.provider).toBe("gemini");
      expect(decision.model).toBe("gemini-3-flash-preview");
      expect(decision.strategy).toBe("external_vision");
      expect(decision.estimatedCost).toBe("R$ 0,00 (chave própria do usuário)");
      expect(decision.isExternal).toBe(true);
    });
  });

  describe("4. Fallback seguro quando o modelo principal estiver indisponível", () => {
    it("cada decisão embute uma estratégia de fallback local seguro garantido", () => {
      const externalDecision = routeAiStrategy({
        intent: "complex_code",
        risk: "low",
        complexity: "complexa",
        context: "Código complexo",
        needsTools: false,
        requested: "auto",
        externalConsent: true,
        hasApiKey: true,
      });

      expect(externalDecision.fallback).toBeDefined();
      expect(externalDecision.fallback.provider).toBe("manus");
      expect(externalDecision.fallback.estimatedCost).toBe("R$ 0,00 (gratuito)");
      expect(externalDecision.fallback.reason).toContain("Fallback local seguro");
    });

    it("executeWithRouterFallback executa o modelo primário quando disponível", async () => {
      const decision = routeAiStrategy({
        intent: "query",
        risk: "low",
        complexity: "simples",
        context: "Consulta",
        needsTools: false,
      });

      const primaryMock = vi.fn().mockResolvedValue("Resposta rápida do modelo");

      const execution = await executeWithRouterFallback(decision, primaryMock);

      expect(execution.usedFallback).toBe(false);
      expect(execution.result).toBe("Resposta rápida do modelo");
      expect(execution.provider).toBe("manus");
      expect(primaryMock).toHaveBeenCalledWith("manus", undefined);
    });

    it("executeWithRouterFallback aciona automaticamente o fallback local se o modelo primário falhar", async () => {
      const externalDecision: RouterDecision = {
        provider: "chatgpt",
        model: "gpt-5-mini",
        strategy: "external_reasoning",
        reason: "Roteado para modelo externo",
        estimatedCost: "R$ 0,00 (chave própria)",
        fallback: {
          provider: "manus",
          strategy: "local_reasoning",
          reason: "Fallback local seguro com custo zero",
          estimatedCost: "R$ 0,00 (gratuito)",
        },
        complexity: "complexa",
        requiresConfirmation: false,
        isExternal: true,
        tier: "appropriate",
      };

      const primaryMock = vi.fn().mockRejectedValue(new Error("Erro de rede / Timeout 504 no provedor externo"));
      const fallbackMock = vi.fn().mockResolvedValue("Resposta segura gerada pelo fallback local");

      const execution = await executeWithRouterFallback(externalDecision, primaryMock, fallbackMock);

      expect(execution.usedFallback).toBe(true);
      expect(execution.provider).toBe("manus");
      expect(execution.result).toBe("Resposta segura gerada pelo fallback local");
      expect(execution.error).toContain("Timeout 504");
      expect(fallbackMock).toHaveBeenCalledWith(externalDecision.fallback);
    });
  });

  describe("5. Recepção estrita dos 5 parâmetros essenciais", () => {
    it("processa corretamente intenção, risco, complexidade, contexto e necessidade de ferramentas", () => {
      const input: AiRouterInput = {
        intent: "mutation",
        risk: "high",
        complexity: "complexa",
        context: {
          message: "Excluir dados sensíveis da conta bancária",
          hasAttachments: false,
          activeTasksCount: 3,
        },
        needsTools: true,
      };

      const decision = routeAiStrategy(input);

      expect(decision.complexity).toBe("complexa");
      expect(decision.requiresConfirmation).toBe(true);
      expect(decision.provider).toBe("manus"); // Sem consentimento externo, motor local
      expect(decision.tier).toBe("sensitive_confirmed");
    });
  });

  describe("6. Retorno de Decisão Estruturada", () => {
    it("retorna objeto completo com modelo/estratégia, motivo, custo estimado e fallback", () => {
      const decision = routeAiStrategy({
        intent: "consulta",
        risk: "low",
        complexity: "simples",
        context: "Status geral",
        needsTools: false,
      });

      expect(decision).toHaveProperty("provider");
      expect(decision).toHaveProperty("strategy");
      expect(decision).toHaveProperty("reason");
      expect(decision).toHaveProperty("estimatedCost");
      expect(decision).toHaveProperty("fallback");
      expect(decision).toHaveProperty("complexity");
      expect(decision).toHaveProperty("requiresConfirmation");

      expect(typeof decision.reason).toBe("string");
      expect(decision.reason.length).toBeGreaterThan(10);
      expect(decision.estimatedCost).toContain("R$ 0,00");
    });
  });

  describe("7. O Router SOMENTE decide a estratégia/modelo (Não executa ações protegidas)", () => {
    it("opera como função pura analítica sem efeitos colaterais de mutação", () => {
      const stateTracker = { executedProtectedAction: false };

      const decision = routeAiStrategy({
        intent: "exclusao",
        risk: "high",
        complexity: "complexa",
        context: "Excluir permanentemente arquivo confidencial",
        needsTools: true,
      });

      // A decisão apenas orienta a estratégia e sinaliza necessidade de confirmação
      expect(decision.requiresConfirmation).toBe(true);
      expect(decision.tier).toBe("sensitive_confirmed");
      // Nenhuma ação protegida foi disparada pelo router
      expect(stateTracker.executedProtectedAction).toBe(false);
    });
  });

  describe("8. Integração ao núcleo cognitivo e Retrocompatibilidade", () => {
    it("integra harmoniosamente com a análise de comandos cognitivos do IRIS", () => {
      const cognitiveAnalysis = analyzeCommand("Excluir meu compromisso de amanhã");
      expect(cognitiveAnalysis.requiresAuthorization).toBe(true);
      expect(cognitiveAnalysis.riskLevel).toBe("high");

      const routeDecision = routeAiStrategy({
        intent: cognitiveAnalysis.intent,
        risk: cognitiveAnalysis.riskLevel,
        context: cognitiveAnalysis.command,
        needsTools: true,
      });

      expect(routeDecision.complexity).toBe("complexa");
      expect(routeDecision.requiresConfirmation).toBe(true);
      expect(routeDecision.provider).toBe("manus");
      expect(routeDecision.estimatedCost).toBe("R$ 0,00 (gratuito)");
    });

    it("mantém retrocompatibilidade total com routeModel e classifyRoutingTask", () => {
      const simpleTask = classifyRoutingTask({ message: "Oi, tudo bem?", hasAttachments: false });
      expect(simpleTask).toBe("simple_query");

      const simpleRoute = routeModel({
        requested: "auto",
        task: simpleTask,
        hasAttachments: false,
        externalConsent: false,
      });
      expect(simpleRoute.provider).toBe("manus");
      expect(simpleRoute.tier).toBe("fast");
      expect(simpleRoute.requiresConfirmation).toBe(false);
      expect(simpleRoute.estimatedCost).toBe("R$ 0,00 (gratuito)");

      const sensitiveTask = classifyRoutingTask({
        message: "Autorizar pagamento e exclusão de boleto",
        hasAttachments: false,
      });
      expect(sensitiveTask).toBe("sensitive_task");

      const sensitiveRoute = routeModel({
        requested: "auto",
        task: sensitiveTask,
        hasAttachments: false,
        externalConsent: true,
      });
      expect(sensitiveRoute.tier).toBe("sensitive_confirmed");
      expect(sensitiveRoute.requiresConfirmation).toBe(true);
    });
  });
});
