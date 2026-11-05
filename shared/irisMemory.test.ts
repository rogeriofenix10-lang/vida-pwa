import { describe, expect, it } from "vitest";
import {
  IrisMemoryManager,
  containsSensitiveCredentials,
} from "./irisMemory";

describe("IRIS 6.0 — FASE 7: MEMORY INTELLIGENCE", () => {
  describe("1. Operações Básicas: remember, recall, forget", () => {
    it("guarda memórias com controle de confiança, escopo e recupera por similaridade", () => {
      const memory = new IrisMemoryManager();

      const item = memory.remember({
        content: "Prefiro receber resumos de relatórios sempre às segundas-feiras pela manhã",
        type: "preference",
        scope: "user",
        confidence: 0.95,
        category: "rotina",
      });

      expect(item.id).toBeDefined();
      expect(item.confidence).toBe(0.95);
      expect(item.type).toBe("preference");

      const recalled = memory.recall("relatórios segundas-feiras");
      expect(recalled.length).toBeGreaterThan(0);
      expect(recalled[0].content).toContain("segundas-feiras");

      // Teste forget
      const deleted = memory.forget(item.id);
      expect(deleted).toBe(true);
      expect(memory.recall("relatórios segundas-feiras").length).toBe(0);
    });
  });

  describe("2. Memória Temporária (Session/Task) vs Persistente e Limpeza de Sessão", () => {
    it("limpa apenas memórias efêmeras da sessão ao chamar clearSessionMemory", () => {
      const memory = new IrisMemoryManager();

      memory.remember({
        content: "Valor intermediário da fatura calculada = R$ 340,50",
        scope: "session",
        type: "ephemeral",
        sessionId: "session-abc",
      });

      memory.remember({
        content: "Nome do animal de estimação é Rex",
        scope: "user",
        type: "persistent",
      });

      expect(memory.recall("fatura", { sessionId: "session-abc" }).length).toBe(1);
      expect(memory.recall("Rex").length).toBe(1);

      // Limpar memória da sessão
      memory.clearSessionMemory("session-abc");

      expect(memory.recall("fatura", { sessionId: "session-abc" }).length).toBe(0);
      expect(memory.recall("Rex").length).toBe(1); // Persistente intacta
    });
  });

  describe("3. Preferências do Usuário", () => {
    it("permite registrar e consultar preferências duráveis", () => {
      const memory = new IrisMemoryManager({ userId: 42 });

      memory.setPreference("idioma", "pt-BR");
      memory.setPreference("formato_data", "DD/MM/YYYY");

      const prefs = memory.getPreferences();
      expect(prefs.length).toBe(2);
      expect(prefs.some((p) => p.content.includes("idioma = pt-BR"))).toBe(true);
    });
  });

  describe("4. Isolamento Entre Usuários e Sessões", () => {
    it("impede que o Usuário A acesse memórias privadas do Usuário B", () => {
      const memory = new IrisMemoryManager();

      memory.remember({
        content: "Consulta médica confidencial de cardiologia",
        userId: 10,
        scope: "user",
      });

      memory.remember({
        content: "Comprar suprimentos para escritório",
        userId: 20,
        scope: "user",
      });

      const user10Memories = memory.recall("médica", { userId: 10 });
      expect(user10Memories.length).toBe(1);

      const user20Memories = memory.recall("médica", { userId: 20 });
      expect(user20Memories.length).toBe(0); // Totalmente isolado
    });
  });

  describe("5. Proteção Absoluta Contra Dados Sensíveis e Credenciais", () => {
    it("rejeita armazenamento de senhas, chaves de API e tokens", () => {
      const memory = new IrisMemoryManager();

      expect(() => {
        memory.remember({ content: "Minha senha de acesso é password=superSecret123" });
      }).toThrow(/Segurança IRIS/);

      expect(() => {
        memory.remember({ content: "api_key=sk-proj-9999888877776666" });
      }).toThrow(/Segurança IRIS/);

      expect(() => {
        memory.remember({ content: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz" });
      }).toThrow(/Segurança IRIS/);
    });

    it("função containsSensitiveCredentials detecta segredos", () => {
      expect(containsSensitiveCredentials("senha = 123456")).toBe(true);
      expect(containsSensitiveCredentials("token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz")).toBe(true);
      expect(containsSensitiveCredentials("minha comida preferida é lasanha")).toBe(false);
    });
  });

  describe("6. Imutabilidade e Barreira de Ação (A memória NUNCA executa ações)", () => {
    it("garante que a memória é estritamente passiva e não possui métodos de execução", () => {
      const memory = new IrisMemoryManager();
      expect(memory.isExecutable).toBe(false);
      expect(memory.canExecuteActions()).toBe(false);
      expect((memory as any).execute).toBeUndefined();
      expect((memory as any).run).toBeUndefined();
    });
  });
});
