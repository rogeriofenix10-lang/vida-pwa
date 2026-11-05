import { describe, expect, it, vi } from "vitest";
import {
  analyzeCommand,
  IrisCognitiveEngine,
  IrisState,
  ActionClassification,
  CommandIntent,
  RiskLevel,
} from "./irisCognitive";

const mockContext = {
  items: [
    { id: 1, label: "Seguro do carro", detail: "vence em 12 dias", date: "12 dias", priority: "importante", status: "pending" },
    { id: 2, label: "Conta de internet", detail: "vence amanhã · R$ 129,90", date: "amanhã", priority: "urgente", status: "pending" },
    { id: 3, label: "Documentos pessoais", detail: "tudo em dia", date: "em dia", priority: "normal", status: "completed" },
  ],
  isAuthenticated: true,
};

describe("IRIS 5.4 - Validação Funcional Completa dos 10 Cenários Cognitivos", () => {
  // Cenário 1: Consulta simples → responder sem autorização
  it("Cenário 1: Consulta simples → responder sem autorização", () => {
    const engine = new IrisCognitiveEngine();
    const recordedStates: IrisState[] = [];
    const observerEngine = new IrisCognitiveEngine({
      onStateChange: (s) => recordedStates.push(s),
    });

    const analysis = observerEngine.processCommand("o que tenho para hoje?", mockContext);

    // Intenção e classificação
    expect(analysis.intent).toBe("query");
    expect(analysis.actionType).toBe("consulta");
    // Não exige autorização
    expect(analysis.requiresAuthorization).toBe(false);
    expect(analysis.riskLevel).toBe("low");
    // Possui resposta direta informativa
    expect(analysis.directResponse).toBeDefined();
    expect(analysis.directResponse?.length).toBeGreaterThan(5);
    // Nenhuma proposta de mutação é gerada
    expect(analysis.proposal).toBeUndefined();
    // Transições de estado: analyzing -> completed (nunca awaiting_authorization)
    expect(recordedStates).toEqual(["analyzing", "completed"]);
    expect(observerEngine.getState()).toBe("completed");
    expect(observerEngine.getPendingProposal()).toBeNull();
  });

  // Cenário 2: Análise de informação → responder sem autorização
  it("Cenário 2: Análise de informação → responder sem autorização", () => {
    const recordedStates: IrisState[] = [];
    const engine = new IrisCognitiveEngine({
      onStateChange: (s) => recordedStates.push(s),
    });

    const analysis = engine.processCommand("faça um diagnóstico e análise geral das pendências", mockContext);

    expect(analysis.intent).toBe("query");
    expect(analysis.actionType).toBe("analise");
    expect(analysis.requiresAuthorization).toBe(false);
    expect(analysis.riskLevel).toBe("low");
    expect(analysis.directResponse).toContain("Realizei a análise");
    expect(analysis.proposal).toBeUndefined();
    expect(recordedStates).toEqual(["analyzing", "completed"]);
    expect(engine.getState()).toBe("completed");
  });

  // Cenário 3: Ação que altera dados → exigir autorização
  it("Cenário 3: Ação que altera dados → exigir autorização", () => {
    const recordedStates: IrisState[] = [];
    const engine = new IrisCognitiveEngine({
      onStateChange: (s) => recordedStates.push(s),
    });

    const analysis = engine.processCommand("adiar seguro do carro para amanhã", mockContext);

    expect(analysis.intent).toBe("mutation");
    expect(analysis.actionType).toBe("alteracao");
    expect(analysis.requiresAuthorization).toBe(true);
    expect(analysis.riskLevel).toBe("medium");
    expect(analysis.proposal).toBeDefined();
    expect(analysis.proposal?.targetId).toBe(1);
    expect(recordedStates).toEqual(["analyzing", "awaiting_authorization"]);
    expect(engine.getState()).toBe("awaiting_authorization");
    expect(engine.getPendingProposal()).not.toBeNull();
  });

  // Cenário 4: Exclusão → exigir autorização
  it("Cenário 4: Exclusão → exigir autorização com risco alto", () => {
    const recordedStates: IrisState[] = [];
    const engine = new IrisCognitiveEngine({
      onStateChange: (s) => recordedStates.push(s),
    });

    const analysis = engine.processCommand("excluir conta de internet", mockContext);

    expect(analysis.intent).toBe("mutation");
    expect(analysis.actionType).toBe("exclusao");
    expect(analysis.requiresAuthorization).toBe(true);
    expect(analysis.riskLevel).toBe("high");
    expect(analysis.proposal).toBeDefined();
    expect(analysis.proposal?.action).toBe("Confirmar exclusão");
    expect(analysis.proposal?.targetId).toBe(2);
    expect(recordedStates).toEqual(["analyzing", "awaiting_authorization"]);
    expect(engine.getState()).toBe("awaiting_authorization");
  });

  // Cenário 5: Envio/compartilhamento → exigir autorização
  it("Cenário 5: Envio e compartilhamento → exigir autorização com risco alto", () => {
    // 5.1 Envio externo
    const engineEnvio = new IrisCognitiveEngine();
    const analysisEnvio = engineEnvio.processCommand("enviar email com relatório de pendências", mockContext);
    expect(analysisEnvio.intent).toBe("mutation");
    expect(analysisEnvio.actionType).toBe("envio");
    expect(analysisEnvio.requiresAuthorization).toBe(true);
    expect(analysisEnvio.riskLevel).toBe("high");
    expect(engineEnvio.getState()).toBe("awaiting_authorization");

    // 5.2 Compartilhamento de dados
    const engineComp = new IrisCognitiveEngine();
    const analysisComp = engineComp.processCommand("compartilhar meus documentos de seguro com o contador", mockContext);
    expect(analysisComp.intent).toBe("mutation");
    expect(analysisComp.actionType).toBe("compartilhamento");
    expect(analysisComp.requiresAuthorization).toBe(true);
    expect(analysisComp.riskLevel).toBe("high");
    expect(engineComp.getState()).toBe("awaiting_authorization");
  });

  // Cenário 6: Organização de dados → exigir autorização
  it("Cenário 6: Organização de dados → exigir autorização", () => {
    const recordedStates: IrisState[] = [];
    const engine = new IrisCognitiveEngine({
      onStateChange: (s) => recordedStates.push(s),
    });

    const analysis = engine.processCommand("minha conta de luz vence dia 20 R$ 180", mockContext);

    expect(analysis.intent).toBe("mutation");
    expect(analysis.actionType).toBe("organizacao");
    expect(analysis.requiresAuthorization).toBe(true);
    expect(analysis.proposal).toBeDefined();
    expect(analysis.proposal?.label).toContain("Conta de luz");
    expect(analysis.proposal?.detail).toContain("20");
    expect(analysis.proposal?.detail).toContain("180");
    expect(recordedStates).toEqual(["analyzing", "awaiting_authorization"]);
    expect(engine.getState()).toBe("awaiting_authorization");
  });

  // Cenário 7: Usuário autoriza → executar e confirmar
  it("Cenário 7: Usuário autoriza → executar e confirmar", async () => {
    const recordedStates: IrisState[] = [];
    const engine = new IrisCognitiveEngine({
      onStateChange: (s) => recordedStates.push(s),
    });

    // 1. Processa comando de mutação
    engine.processCommand("cadastrar seguro residencial para amanhã", mockContext);
    expect(engine.getState()).toBe("awaiting_authorization");

    // 2. Executa a ação mockada após autorização
    const executorMock = vi.fn().mockImplementation(async (prop) => {
      expect(prop.label).toBeDefined();
    });

    const result = await engine.authorize(executorMock);

    // Validações
    expect(executorMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.message).toContain("autorizada e executada com sucesso");
    expect(engine.getState()).toBe("completed");
    expect(engine.getPendingProposal()).toBeNull();
    // Transições completas: analyzing -> awaiting_authorization -> executing -> completed
    expect(recordedStates).toEqual(["analyzing", "awaiting_authorization", "executing", "completed"]);
  });

  // Cenário 8: Usuário cancela → não executar
  it("Cenário 8: Usuário cancela → não executar", async () => {
    const recordedStates: IrisState[] = [];
    const engine = new IrisCognitiveEngine({
      onStateChange: (s) => recordedStates.push(s),
    });

    // 1. Processa comando de mutação
    engine.processCommand("excluir seguro do carro", mockContext);
    expect(engine.getState()).toBe("awaiting_authorization");

    const executorMock = vi.fn();

    // 2. Usuário cancela
    const cancelResult = engine.cancel();

    expect(cancelResult.success).toBe(true);
    expect(cancelResult.message).toContain("cancelada pelo usuário");
    expect(cancelResult.message).toContain("Nenhuma alteração foi realizada");
    // Executor NUNCA foi chamado
    expect(executorMock).not.toHaveBeenCalled();
    // Estado retorna para idle
    expect(engine.getState()).toBe("idle");
    expect(engine.getPendingProposal()).toBeNull();
    expect(recordedStates).toEqual(["analyzing", "awaiting_authorization", "idle"]);
  });

  // Cenário 9: Erro durante execução → estado ERROR e informar o usuário
  it("Cenário 9: Erro durante execução → estado ERROR e informar o usuário", async () => {
    const recordedStates: IrisState[] = [];
    const engine = new IrisCognitiveEngine({
      onStateChange: (s) => recordedStates.push(s),
    });

    // 1. Processa comando
    engine.processCommand("adiar seguro do carro", mockContext);
    expect(engine.getState()).toBe("awaiting_authorization");

    // 2. Executor falha com erro
    const failingExecutor = vi.fn().mockRejectedValue(new Error("Falha na comunicação com o banco de dados"));

    const result = await engine.authorize(failingExecutor);

    // Validações de erro
    expect(result.success).toBe(false);
    expect(result.message).toBe("Falha na comunicação com o banco de dados");
    expect(engine.getState()).toBe("error");
    expect(recordedStates).toEqual(["analyzing", "awaiting_authorization", "executing", "error"]);
  });

  // Cenário 10: Garantir que nenhuma ação protegida seja executada sem autorização explícita
  it("Cenário 10: Garantir que nenhuma ação protegida seja executada sem autorização explícita", async () => {
    const engine = new IrisCognitiveEngine();
    const executorMock = vi.fn();

    // Tentativa 1: Em estado 'idle' sem proposta
    expect(engine.getState()).toBe("idle");
    await expect(engine.authorize(executorMock)).rejects.toThrow("Nenhuma proposta aguardando autorização");
    expect(executorMock).not.toHaveBeenCalled();

    // Tentativa 2: Após consulta simples (estado 'completed')
    engine.processCommand("o que tenho para hoje?", mockContext);
    expect(engine.getState()).toBe("completed");
    await expect(engine.authorize(executorMock)).rejects.toThrow("Nenhuma proposta aguardando autorização");
    expect(executorMock).not.toHaveBeenCalled();

    // Tentativa 3: Após cancelamento explícito
    engine.processCommand("excluir conta de internet", mockContext);
    expect(engine.getState()).toBe("awaiting_authorization");
    engine.cancel();
    expect(engine.getState()).toBe("idle");
    await expect(engine.authorize(executorMock)).rejects.toThrow("Nenhuma proposta aguardando autorização");
    expect(executorMock).not.toHaveBeenCalled();
  });

  describe("IRIS 5.4 - Regras da Execução Controlada", () => {
    // Regra 1: Consultas e análises podem executar diretamente
    it("Regra 1: Consultas e análises executam diretamente sem autorização", async () => {
      const engine = new IrisCognitiveEngine();
      const mockQueryRunner = vi.fn().mockResolvedValue("Você tem 2 tarefas ativas no Radar.");

      const result = await engine.executeDirectQuery("o que tenho para hoje?", mockContext, mockQueryRunner);

      expect(result.success).toBe(true);
      expect(result.result).toBe("Você tem 2 tarefas ativas no Radar.");
      expect(mockQueryRunner).toHaveBeenCalledTimes(1);
      expect(engine.getState()).toBe("completed");

      // Se tentar passar um comando protegido em executeDirectQuery, deve recusar
      await expect(
        engine.executeDirectQuery("excluir conta de internet", mockContext, mockQueryRunner)
      ).rejects.toThrow("Esta ação exige autorização explícita");
      expect(engine.getState()).toBe("awaiting_authorization");
    });

    // Regra 2: Alterações, exclusões, organização, envio e compartilhamento exigem autorização explícita
    it("Regra 2: Qualquer ação protegida exige autorização explícita", () => {
      const engine = new IrisCognitiveEngine();
      const protectedCommands = [
        "adiar seguro do carro",
        "excluir conta de internet",
        "organizar contas do mês dia 10",
        "enviar email de cobrança",
        "compartilhar pasta de exames",
      ];

      for (const cmd of protectedCommands) {
        const analysis = engine.processCommand(cmd, mockContext);
        expect(analysis.requiresAuthorization).toBe(true);
        expect(engine.getState()).toBe("awaiting_authorization");
      }
    });

    // Regra 3: Sem autorização, nenhuma ação protegida pode ser executada
    it("Regra 3: Sem autorização, nenhuma ação protegida pode ser executada", async () => {
      const engine = new IrisCognitiveEngine();
      const executor = vi.fn();

      // Tentativa de execução sem proposta pendente
      await expect(engine.authorize(executor)).rejects.toThrow("Nenhuma proposta aguardando autorização");
      expect(executor).not.toHaveBeenCalled();
    });

    // Regra 4: Após autorização, executar somente a ação previamente aprovada
    it("Regra 4: Executa estritamente a ação previamente aprovada", async () => {
      const engine = new IrisCognitiveEngine();
      engine.processCommand("cadastrar seguro residencial dia 25 R$ 120", mockContext);
      expect(engine.getState()).toBe("awaiting_authorization");

      let executedProposal: any = null;
      const executor = vi.fn().mockImplementation((prop) => {
        executedProposal = prop;
      });

      const res = await engine.authorize(executor);
      expect(res.success).toBe(true);
      expect(executedProposal).not.toBeNull();
      expect(executedProposal.label).toContain("Seguro residencial");
      expect(executedProposal.detail).toContain("25");
      expect(executedProposal.detail).toContain("120");
    });

    // Regra 5: Registrar resultado e confirmar conclusão
    it("Regra 5: Registra o resultado da execução e confirma conclusão", async () => {
      const engine = new IrisCognitiveEngine();
      engine.processCommand("concluir conta de internet", mockContext);

      await engine.authorize(async () => {});

      const lastExecution = engine.getLastExecution();
      expect(lastExecution).not.toBeNull();
      expect(lastExecution?.success).toBe(true);
      expect(lastExecution?.message).toContain("autorizada e executada com sucesso");
      expect(lastExecution?.timestamp).toBeDefined();
      expect(engine.getState()).toBe("completed");
    });

    // Regra 6: Em erro, não repetir automaticamente ações protegidas
    it("Regra 6: Em caso de erro, não repete automaticamente ações protegidas", async () => {
      const engine = new IrisCognitiveEngine();
      engine.processCommand("excluir conta de internet", mockContext);

      const failingExecutor = vi.fn().mockRejectedValue(new Error("Falha no serviço externo"));
      const res = await engine.authorize(failingExecutor);

      expect(res.success).toBe(false);
      expect(engine.getState()).toBe("error");

      // Tentativa de repetir automaticamente sem novo comando do usuário deve falhar
      const retryExecutor = vi.fn();
      await expect(engine.authorize(retryExecutor)).rejects.toThrow("Nenhuma proposta aguardando autorização");
      expect(retryExecutor).not.toHaveBeenCalled();

      // Registro de falha gravado
      const lastExecution = engine.getLastExecution();
      expect(lastExecution?.success).toBe(false);
      expect(lastExecution?.error).toBe("Falha no serviço externo");
    });
  });
});
