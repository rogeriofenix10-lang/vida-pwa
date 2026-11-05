import { describe, expect, it, vi } from "vitest";
import {
  interpretOperationalCommand,
  IrisCognitiveEngine,
  ExecutionPlan,
  PlanExecutionStep,
  CognitiveContext,
} from "./irisCognitive";

const mockContext: CognitiveContext = {
  items: [
    { id: 101, label: "Seguro do carro", detail: "vence em 12 dias", date: "12 dias", priority: "importante", status: "pending", category: "Finanças" },
    { id: 102, label: "Conta de internet", detail: "vence amanhã · R$ 129,90", date: "amanhã", priority: "urgente", status: "pending", category: "Finanças" },
    { id: 103, label: "Exame de sangue", detail: "agendado para sexta", date: "sexta", priority: "normal", status: "pending", category: "Saúde" },
  ],
  isAuthenticated: true,
};

describe("IRIS 5.4 - Inteligência Operacional (Comandos Naturais e Planos Seguros)", () => {
  describe("1. Interpretação de Intenção e Identificação de Entidades/Parâmetros", () => {
    it("extrai corretamente valores monetários, datas, categorias e rótulos de comandos naturais", () => {
      const plan = interpretOperationalCommand(
        "cadastrar nova conta de energia dia 25 R$ 340,50",
        mockContext
      );

      expect(plan.intent).toContain("Criar");
      expect(plan.actionType).toBe("criacao");
      expect(plan.entities.label).toContain("Conta de energia");
      expect(plan.entities.amount).toBe(340.5);
      expect(plan.entities.amountFormatted).toBe("R$ 340,50");
      expect(plan.entities.date).toContain("25");
      expect(plan.entities.category).toBe("Finanças");
      expect(plan.isAmbiguous).toBe(false);
    });

    it("identifica alvo existente no contexto para alteração com data relativa", () => {
      const plan = interpretOperationalCommand(
        "adiar seguro do carro para próxima semana",
        mockContext
      );

      expect(plan.actionType).toBe("alteracao");
      expect(plan.entities.targetId).toBe(101);
      expect(plan.entities.targetItem).toBe("Seguro do carro");
      expect(plan.entities.date).toBe("próxima semana");
      expect(plan.riskLevel).toBe("medium");
      expect(plan.requiresAuthorization).toBe(true);
    });

    it("identifica destinatário e canal em comando de envio/compartilhamento", () => {
      const plan = interpretOperationalCommand(
        "enviar email para meu contador com o comprovante de pagamento",
        mockContext
      );

      expect(plan.actionType).toBe("envio/compartilhamento");
      expect(plan.entities.recipient).toContain("contador");
      expect(plan.entities.channel).toBe("email");
      expect(plan.riskLevel).toBe("high");
      expect(plan.requiresAuthorization).toBe(true);
    });
  });

  describe("2. Classificação das 7 Ações e Nível de Risco", () => {
    it("classifica consulta com risco low", () => {
      const plan = interpretOperationalCommand("quais são meus compromissos de hoje?", mockContext);
      expect(plan.actionType).toBe("consulta");
      expect(plan.riskLevel).toBe("low");
      expect(plan.requiresAuthorization).toBe(false);
    });

    it("classifica análise diagnóstica com risco low", () => {
      const plan = interpretOperationalCommand("faça um diagnóstico completo dos meus gastos e saúde", mockContext);
      expect(plan.actionType).toBe("analise");
      expect(plan.riskLevel).toBe("low");
      expect(plan.requiresAuthorization).toBe(false);
    });

    it("classifica criação de compromisso com risco low", () => {
      const plan = interpretOperationalCommand("novo lembrete comprar medicamento amanhã", mockContext);
      expect(plan.actionType).toBe("criacao");
      expect(plan.riskLevel).toBe("low");
      expect(plan.requiresAuthorization).toBe(true);
    });

    it("classifica alteração com risco medium", () => {
      const plan = interpretOperationalCommand("concluir conta de internet", mockContext);
      expect(plan.actionType).toBe("alteracao");
      expect(plan.riskLevel).toBe("medium");
      expect(plan.requiresAuthorization).toBe(true);
      expect(plan.entities.targetId).toBe(102);
    });

    it("classifica exclusão com risco high", () => {
      const plan = interpretOperationalCommand("excluir seguro do carro", mockContext);
      expect(plan.actionType).toBe("exclusao");
      expect(plan.riskLevel).toBe("high");
      expect(plan.requiresAuthorization).toBe(true);
      expect(plan.entities.targetId).toBe(101);
    });

    it("classifica organização com risco low/medium", () => {
      const plan = interpretOperationalCommand("organizar minhas contas do mês dia 10", mockContext);
      expect(plan.actionType).toBe("organizacao");
      expect(plan.requiresAuthorization).toBe(true);
      expect(plan.proposal).toBeDefined();
    });

    it("classifica envio e compartilhamento com risco high", () => {
      const planCompartilhar = interpretOperationalCommand(
        "compartilhar exame de sangue com meu médico",
        mockContext
      );
      expect(planCompartilhar.actionType).toBe("envio/compartilhamento");
      expect(planCompartilhar.riskLevel).toBe("high");
      expect(planCompartilhar.requiresAuthorization).toBe(true);
    });
  });

  describe("3. Detecção de Casos Ambíguos e Solicitação de Esclarecimento", () => {
    it("detecta comando de exclusão ambíguo sem alvo e solicita esclarecimento", () => {
      const plan = interpretOperationalCommand("excluir", mockContext);
      expect(plan.isAmbiguous).toBe(true);
      expect(plan.clarificationPrompt).toContain("especifique qual item");
      expect(plan.steps[0].type).toBe("clarify");
      expect(plan.entities.missingParameters).toContain("targetItem");
    });

    it("detecta comando de alteração vago e solicita informações faltantes", () => {
      const plan = interpretOperationalCommand("alterar o prazo", mockContext);
      expect(plan.isAmbiguous).toBe(true);
      expect(plan.clarificationPrompt).toContain("Qual compromisso");
      expect(plan.entities.missingParameters).toContain("targetItem");
    });

    it("detecta comando genérico 'faça aquilo' e impede qualquer execução desgovernada", () => {
      const plan = interpretOperationalCommand("faça aquilo para mim", mockContext);
      expect(plan.isAmbiguous).toBe(true);
      expect(plan.clarificationPrompt).toContain("especifique qual tarefa");
      expect(plan.steps[0].type).toBe("clarify");
    });

    it("detecta envio vago sem destinatário ou conteúdo", () => {
      const plan = interpretOperationalCommand("enviar", mockContext);
      expect(plan.isAmbiguous).toBe(true);
      expect(plan.clarificationPrompt).toContain("Para quem você deseja enviar");
    });
  });

  describe("4. Geração do Plano Estruturado de Execução e Ciclo Operacional", () => {
    it("gera plano com etapas estruturadas: validate -> prepare -> authorize -> execute -> audit", () => {
      const plan = interpretOperationalCommand("cadastrar seguro de vida dia 30 R$ 90", mockContext);

      expect(plan.steps).toHaveLength(5);
      expect(plan.steps.map((s) => s.type)).toEqual([
        "validate",
        "prepare",
        "authorize",
        "execute",
        "audit",
      ]);
      expect(plan.steps[1].toolName).toBe("radar.create");
      expect(plan.steps[3].toolName).toBe("radar.create");
    });

    it("bloqueia estritamente a execução de plano protegido sem autorização explícita", async () => {
      const engine = new IrisCognitiveEngine();
      const plan = engine.generateOperationalPlan("excluir conta de internet", mockContext);
      expect(engine.getState()).toBe("awaiting_authorization");

      // Se o estado não for confirmado para autorização explícita
      const unauthEngine = new IrisCognitiveEngine(); // em idle
      const mockStepExecutor = vi.fn();

      await expect(
        unauthEngine.executeOperationalPlan(plan, mockStepExecutor)
      ).rejects.toThrow("Segurança IRIS: nenhuma ação protegida pode ser executada sem autorização explícita");
      expect(mockStepExecutor).not.toHaveBeenCalled();
    });

    it("encaminha plano autorizado ao executor, confirma o resultado e atualiza histórico", async () => {
      const engine = new IrisCognitiveEngine();
      const plan = engine.generateOperationalPlan("adiar seguro do carro para amanhã", mockContext);
      expect(engine.getState()).toBe("awaiting_authorization");

      const executedStepPayloads: any[] = [];
      const mockStepExecutor = vi.fn().mockImplementation(async (step: PlanExecutionStep) => {
        executedStepPayloads.push(step);
        return { success: true, updatedId: 101 };
      });

      const execResult = await engine.executeOperationalPlan(plan, mockStepExecutor);

      expect(mockStepExecutor).toHaveBeenCalledTimes(1);
      expect(execResult.success).toBe(true);
      expect(execResult.message).toContain("executado com sucesso");
      expect(execResult.completedSteps).toBe(plan.steps.length);
      expect(engine.getState()).toBe("completed");

      // Registro e rastreabilidade gravados
      const lastExecution = engine.getLastExecution();
      expect(lastExecution).not.toBeNull();
      expect(lastExecution?.success).toBe(true);
    });

    it("em erro durante a execução do plano, não repete automaticamente e transiciona para error", async () => {
      const engine = new IrisCognitiveEngine();
      const plan = engine.generateOperationalPlan("excluir seguro do carro", mockContext);
      expect(engine.getState()).toBe("awaiting_authorization");

      const failingExecutor = vi.fn().mockRejectedValue(new Error("Falha ao remover registro do banco"));

      const execResult = await engine.executeOperationalPlan(plan, failingExecutor);

      expect(execResult.success).toBe(false);
      expect(execResult.error).toBe("Falha ao remover registro do banco");
      expect(engine.getState()).toBe("error");

      // Tentativa de re-executar sem autorização nova deve ser bloqueada
      await expect(
        engine.executeOperationalPlan(plan, failingExecutor)
      ).rejects.toThrow("Segurança IRIS: nenhuma ação protegida pode ser executada sem autorização explícita");
    });
  });
});
