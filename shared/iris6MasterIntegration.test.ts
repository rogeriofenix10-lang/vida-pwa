import { describe, expect, it } from "vitest";
import {
  runIris6Pipeline,
  IrisExecutionEngine,
} from "./irisExecutionEngine";
import { IrisAgentOrchestrator } from "./irisAgentOrchestrator";
import { ToolRegistry } from "./irisTools";
import { IrisContextManager } from "./irisContext";
import { IrisMemoryManager } from "./irisMemory";
import { IrisModelRouter, IrisCostGuard, routeAiModel } from "./irisModelRouter";
import { interpretOperationalCommand, IrisCognitiveEngine } from "./irisCognitive";

describe("IRIS 6.0 — TESTES DE INTEGRAÇÃO COMPLETA E SEGURANÇA MESTRE", () => {
  describe("I. Pipeline Completo Integrado (Cognitive → Router → Cost Guard → Orchestrator → Tools → Memory → Auth → Execution)", () => {
    it("executa fluxo completo de consulta com sucesso, custo zero e gravação de memória", async () => {
      const contextManager = new IrisContextManager({ userId: 1, sessionId: "sess-1" });
      const memoryManager = new IrisMemoryManager({ userId: 1, sessionId: "sess-1" });

      const output = await runIris6Pipeline({
        command: "Qual a data e hora atual do sistema?",
        userId: 1,
        sessionId: "sess-1",
        contextManager,
        memoryManager,
      });

      expect(output.success).toBe(true);
      expect(output.state).toBe("completed");
      expect(output.requiresAuthorization).toBe(false);

      // Verifica se o contexto da conversa foi registrado
      expect(contextManager.getContext("lastUserCommand", "conversation")).toBe(
        "Qual a data e hora atual do sistema?"
      );

      // Verifica se a memória efêmera foi atualizada com o resultado
      const memories = memoryManager.recall("executada com sucesso", { userId: 1 });
      expect(memories.length).toBeGreaterThan(0);
    });

    it("interrompe o fluxo para ação de mutação protegida exigindo autorização do usuário", async () => {
      const output = await runIris6Pipeline({
        command: "excluir fatura antiga do sistema",
        userId: 1,
        isAuthorized: false,
      });

      expect(output.success).toBe(false);
      expect(output.state).toBe("awaiting_authorization");
      expect(output.requiresAuthorization).toBe(true);
    });

    it("completa a execução de ação protegida após autorização explícita do usuário", async () => {
      const output = await runIris6Pipeline({
        command: "cadastrar lembrete de exame de sangue dia 22",
        userId: 1,
        isAuthorized: true,
        authorizationToken: "auth-user-token-777",
        allowedScopes: ["radar:write"],
      });

      expect(output.success).toBe(true);
      expect(output.state).toBe("completed");
    });
  });

  describe("II. 10 TESTES DE SEGURANÇA EXPLÍCITOS", () => {
    // 1. Tentativa de bypass do Router
    it("1. Bloqueia tentativa de bypass do Router: Router classifica complexidade e impõe diretriz Free-First", () => {
      const router = new IrisModelRouter();
      const decision = router.route({
        command: "executar tarefa simples com modelo pago não autorizado",
        intent: "consulta",
        risk: "low",
        hasApiKey: false,
      });

      // Nunca permite modelo pago na ausência de permissão explícita
      expect(decision.strategy).toBe("local_fast");
      expect(decision.estimatedCost).toBe(0);
      expect(decision.status).toBe("allowed");
    });

    // 2. Tentativa de bypass do Cost Guard
    it("2. Bloqueia tentativa de bypass do Cost Guard: modelo pago é estritamente bloqueado", () => {
      const evaluation = IrisCostGuard.evaluate("gpt-4o", {
        userAllowedPaid: false,
      });

      expect(evaluation.allowed).toBe(false);
      expect(evaluation.status).toBe("blocked");
      expect(evaluation.tier).toBe("paid");
      expect(evaluation.reason).toContain("Recurso pago bloqueado pelo IRIS Cost Guard.");
    });

    // 3. Tentativa de bypass da autorização
    it("3. Bloqueia tentativa de bypass da autorização: ação de alto risco sem aprovação não executa", async () => {
      const orchestrator = new IrisAgentOrchestrator();
      const plan = orchestrator.planTask({
        command: "excluir todos os registros do usuário",
      });

      const engine = new IrisExecutionEngine();
      const result = await engine.executePlan(plan, { isAuthorized: false });

      expect(result.success).toBe(false);
      expect(result.status).toBe("blocked");
      expect(result.error).toContain("Segurança IRIS: Execução bloqueada");
    });

    // 4. Ferramenta sem permissão (escopo)
    it("4. Bloqueia ferramenta sem permissão: falta de escopo bloqueia execução", async () => {
      const registry = new ToolRegistry(true);
      const canExec = registry.canExecuteTool("arquivos.list", {
        allowedScopes: ["apenas:leitura_basica"],
      });

      expect(canExec.allowed).toBe(false);
      expect(canExec.blockType).toBe("permission_denied");
    });

    // 5. Ferramenta inexistente
    it("5. Bloqueia ferramenta inexistente: registro seguro rejeita ferramentas desconhecidas", async () => {
      const registry = new ToolRegistry(true);
      const canExec = registry.canExecuteTool("ferramenta.maliciosa.desconhecida");

      expect(canExec.allowed).toBe(false);
      expect(canExec.blockType).toBe("tool_not_found");
    });

    // 6. Modelo pago bloqueado por padrão
    it("6. Bloqueia modelo pago: Cost Guard não permite faturamento automático", () => {
      const eval1 = IrisCostGuard.evaluate("claude-3-opus");
      const eval2 = IrisCostGuard.evaluate("gpt-4o");

      expect(eval1.allowed).toBe(false);
      expect(eval2.allowed).toBe(false);
      expect(eval1.status).toBe("blocked");
      expect(eval2.status).toBe("blocked");
    });

    // 7. Fallback pago proibido: fallback da IRIS sempre prioriza custo zero
    it("7. Bloqueia fallback pago: fallback seleciona modelo gratuito/local com custo zero", () => {
      const decision = routeAiModel({
        command: "análise com motor principal offline",
        intent: "analise",
        risk: "low",
        availableModels: { "iris-local-fast": false },
      });

      expect(decision.fallback).toBeDefined();
      expect(decision.fallback.estimatedCost).toBe(0);
      expect(decision.fallback.costLevel).toMatch(/free|zero/i);
    });

    // 8. Execução sem autorização: comunicação externa
    it("8. Bloqueia execução sem autorização: envio de e-mail/mensagem externa é bloqueado", async () => {
      const registry = new ToolRegistry(true);
      const result = await registry.executeTool(
        "comunicação.send",
        { recipient: "financeiro@empresa.com", message: "Disparo automático não autorizado" },
        { isAuthorized: false }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("autorização explícita");
    });

    // 9. Dados sensíveis nos logs de observabilidade
    it("9. Bloqueia dados sensíveis nos logs: tokens e senhas são mascarados", () => {
      const orchestrator = new IrisAgentOrchestrator();
      orchestrator.planTask({
        command: "consultar faturas com password=superSecretPassword123 e Bearer mySecretToken456",
      });

      const logs = orchestrator.getAuditLogs();
      const combined = logs.map((l) => `${l.command} ${l.message}`).join(" ");

      expect(combined).not.toContain("superSecretPassword123");
      expect(combined).not.toContain("mySecretToken456");
      expect(combined).toContain("[REDACTED]");
    });

    // 10. Memória tentando executar ação (Memória é puramente passiva)
    it("10. Bloqueia memória tentando executar ação: a camada de memória é passiva e não executa", () => {
      const memory = new IrisMemoryManager();
      expect(memory.isExecutable).toBe(false);
      expect(memory.canExecuteActions()).toBe(false);
      expect((memory as any).execute).toBeUndefined();
      expect((memory as any).executeAction).toBeUndefined();
    });
  });
});
