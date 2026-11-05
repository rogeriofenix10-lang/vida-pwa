import { describe, expect, it } from "vitest";
import {
  IrisContextManager,
  isSensitiveContextData,
} from "./irisContext";

describe("IRIS 6.0 — FASE 7: CONTEXT MANAGER", () => {
  describe("1. Separação de Escopos: Conversa, Tarefa e Sessão", () => {
    it("isola dados entre conversa, tarefa e sessão", () => {
      const manager = new IrisContextManager();

      manager.setContext("lastUserQuery", "Como organizar minhas contas?", "conversation");
      manager.setContext("activeStep", "preparar_faturas", "task");
      manager.setContext("theme", "dark", "session");

      expect(manager.getContext("lastUserQuery", "conversation")).toBe("Como organizar minhas contas?");
      expect(manager.getContext("activeStep", "task")).toBe("preparar_faturas");
      expect(manager.getContext("theme", "session")).toBe("dark");

      // Uma chave em um escopo não deve vazar para outro
      expect(manager.getContext("lastUserQuery", "task")).toBeUndefined();
    });

    it("limpa escopos individualmente ou coletivamente", () => {
      const manager = new IrisContextManager();

      manager.setContext("k1", "v1", "conversation");
      manager.setContext("k2", "v2", "task");

      manager.clearContext("task");
      expect(manager.getContext("k2", "task")).toBeUndefined();
      expect(manager.getContext("k1", "conversation")).toBe("v1");

      manager.clearContext();
      expect(manager.getContext("k1", "conversation")).toBeUndefined();
    });
  });

  describe("2. Isolamento Entre Usuários e Sessões", () => {
    it("não vaza contexto entre diferentes IDs de usuário", () => {
      const manager = new IrisContextManager();

      manager.setContext("draftEmail", "Email confidencial do User 1", {
        scope: "task",
        userId: 101,
      });

      manager.setContext("draftEmail", "Email do User 2", {
        scope: "task",
        userId: 202,
      });

      expect(manager.getContext("draftEmail", { scope: "task", userId: 101 })).toBe("Email confidencial do User 1");
      expect(manager.getContext("draftEmail", { scope: "task", userId: 202 })).toBe("Email do User 2");
      expect(manager.getContext("draftEmail", { scope: "task", userId: 303 })).toBeUndefined();
    });
  });

  describe("3. Proteção Contra Dados Sensíveis e Credenciais", () => {
    it("rejeita chaves ou valores contendo senhas, chaves de api ou tokens", () => {
      const manager = new IrisContextManager();

      expect(() => {
        manager.setContext("password", "123456");
      }).toThrow(/Segurança IRIS/);

      expect(() => {
        manager.setContext("userApiKey", "sk-proj-1234567890abcdef123456");
      }).toThrow(/Segurança IRIS/);

      expect(() => {
        manager.setContext("authHeader", "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz");
      }).toThrow(/Segurança IRIS/);
    });

    it("função isSensitiveContextData detecta padrões de segredos", () => {
      expect(isSensitiveContextData("password", "abc")).toBe(true);
      expect(isSensitiveContextData("api_key", "secret123")).toBe(true);
      expect(isSensitiveContextData("normalKey", "Bearer my-secret-token-value")).toBe(true);
      expect(isSensitiveContextData("username", "rogerio")).toBe(false);
      expect(isSensitiveContextData("userTheme", "dark")).toBe(false);
    });
  });
});
