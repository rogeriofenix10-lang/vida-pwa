import { describe, expect, it } from "vitest";
import {
  ToolRegistry,
  type IrisTool,
} from "./irisTools";

describe("IRIS 6.0 — FASE 6: TOOL / SKILLS ENGINE", () => {
  describe("1. Catálogo Padrão e Categorias Obrigatórias", () => {
    it("inicializa com as 8 categorias obrigatórias cobertas", () => {
      const registry = new ToolRegistry(true);
      const tools = registry.listTools();

      expect(tools.length).toBeGreaterThanOrEqual(10);
      const categories = new Set(tools.map((t) => t.category));

      expect(categories.has("local")).toBe(true);
      expect(categories.has("arquivos")).toBe(true);
      expect(categories.has("documentos")).toBe(true);
      expect(categories.has("agenda")).toBe(true);
      expect(categories.has("comunicação")).toBe(true);
      expect(categories.has("análise")).toBe(true);
      expect(categories.has("saúde")).toBe(true);
      expect(categories.has("sistema")).toBe(true);
    });
  });

  describe("2. Registro, Busca e Listagem", () => {
    it("registra uma nova ferramenta customizada e a recupera por ID", () => {
      const registry = new ToolRegistry(false);
      const customTool: IrisTool = {
        id: "local.calc",
        name: "Calculadora Local",
        description: "Calcula operações aritméticas simples.",
        category: "local",
        permissions: [],
        riskLevel: "low",
        costLevel: "zero",
        parameters: [
          { name: "a", type: "number", required: true },
          { name: "b", type: "number", required: true },
        ],
        isAvailable: true,
        requiresAuthorization: false,
        execute: async (p) => ({
          success: true,
          toolId: "local.calc",
          data: { sum: Number(p.a) + Number(p.b) },
        }),
      };

      registry.registerTool(customTool);
      const retrieved = registry.getTool("local.calc");
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe("Calculadora Local");
    });

    it("filtra ferramentas por categoria e risco", () => {
      const registry = new ToolRegistry(true);
      const healthTools = registry.listTools({ category: "saúde" });
      expect(healthTools.every((t) => t.category === "saúde")).toBe(true);

      const highRiskTools = registry.listTools({ riskLevel: "high" });
      expect(highRiskTools.every((t) => t.riskLevel === "high")).toBe(true);
    });
  });

  describe("3. Validação de Parâmetros e Tipos", () => {
    it("valida campos obrigatórios ausentes", () => {
      const registry = new ToolRegistry(true);
      const validation = registry.validateToolInput("documentos.search", {});

      expect(validation.isValid).toBe(false);
      expect(validation.errors.some((e) => e.includes("query"))).toBe(true);
    });

    it("aceita parâmetros válidos e preenche valores default", () => {
      const registry = new ToolRegistry(true);
      const validation = registry.validateToolInput("documentos.search", { query: "contrato de aluguel" });

      expect(validation.isValid).toBe(true);
      expect(validation.sanitizedInput.query).toBe("contrato de aluguel");
    });
  });

  describe("4. Barreira de Autorização para Ações Protegidas", () => {
    it("bloqueia execução de comunicação.send quando isAuthorized = false", async () => {
      const registry = new ToolRegistry(true);
      const result = await registry.executeTool(
        "comunicação.send",
        { recipient: "contato@empresa.com", message: "Olá" },
        { isAuthorized: false }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("autorização explícita");
    });

    it("permite execução de comunicação.send quando isAuthorized = true e permissão concedida", async () => {
      const registry = new ToolRegistry(true);
      const result = await registry.executeTool(
        "comunicação.send",
        { recipient: "contato@empresa.com", message: "Olá" },
        { isAuthorized: true, allowedScopes: ["communication:send"] }
      );

      expect(result.success).toBe(true);
      expect((result.data as any).status).toBe("sent");
    });
  });

  describe("5. Barreira de Permissões e Scopes", () => {
    it("bloqueia ferramenta quando o contexto não tem os scopes necessários", async () => {
      const registry = new ToolRegistry(true);
      const canExec = registry.canExecuteTool("arquivos.list", {
        allowedScopes: ["unrelated:scope"],
      });

      expect(canExec.allowed).toBe(false);
      expect(canExec.blockType).toBe("permission_denied");
      expect(canExec.reason).toContain("Permissões insuficientes");
    });

    it("permite ferramenta quando o escopo necessário está presente", async () => {
      const registry = new ToolRegistry(true);
      const canExec = registry.canExecuteTool("arquivos.list", {
        allowedScopes: ["files:read"],
      });

      expect(canExec.allowed).toBe(true);
    });
  });

  describe("6. Ferramenta Inexistente ou Indisponível", () => {
    it("retorna tool_not_found para ferramenta inexistente", () => {
      const registry = new ToolRegistry(true);
      const canExec = registry.canExecuteTool("ferramenta.fantasma");

      expect(canExec.allowed).toBe(false);
      expect(canExec.blockType).toBe("tool_not_found");
    });

    it("bloqueia ferramenta com isAvailable = false", () => {
      const registry = new ToolRegistry(false);
      registry.registerTool({
        id: "offline.tool",
        name: "Offline Tool",
        description: "Em manutenção",
        category: "sistema",
        permissions: [],
        riskLevel: "low",
        costLevel: "zero",
        parameters: [],
        isAvailable: false,
        requiresAuthorization: false,
        execute: async () => ({ success: true, toolId: "offline.tool" }),
      });

      const canExec = registry.canExecuteTool("offline.tool");
      expect(canExec.allowed).toBe(false);
      expect(canExec.blockType).toBe("tool_unavailable");
    });
  });

  describe("7. Bloqueio pelo Cost Guard", () => {
    it("bloqueia ferramenta com custo pago se context não permitir recursos pagos", async () => {
      const registry = new ToolRegistry(false);
      registry.registerTool({
        id: "premium.tool",
        name: "Ferramenta Paga",
        description: "Requer API paga",
        category: "sistema",
        permissions: [],
        riskLevel: "medium",
        costLevel: "paid",
        parameters: [],
        isAvailable: true,
        requiresAuthorization: false,
        execute: async () => ({ success: true, toolId: "premium.tool" }),
      });

      const canExec = registry.canExecuteTool("premium.tool", { allowPaidServices: false });
      expect(canExec.allowed).toBe(false);
      expect(canExec.blockType).toBe("cost_guard_blocked");
      expect(canExec.reason).toContain("Cost Guard");
    });
  });

  describe("8. Fallback de Ferramenta", () => {
    it("executa fallback quando a execução principal falha e fallback está configurado", async () => {
      const registry = new ToolRegistry(false);
      registry.registerTool({
        id: "resilient.tool",
        name: "Ferramenta Resiliente",
        description: "Possui fallback seguro",
        category: "local",
        permissions: [],
        riskLevel: "low",
        costLevel: "zero",
        parameters: [],
        isAvailable: true,
        requiresAuthorization: false,
        execute: async () => {
          throw new Error("Falha primária no serviço");
        },
        fallback: async () => ({
          success: true,
          toolId: "resilient.tool",
          data: { fromFallback: true },
        }),
      });

      const result = await registry.executeTool("resilient.tool", {});
      expect(result.success).toBe(true);
      expect(result.fallbackUsed).toBe(true);
      expect((result.data as any).fromFallback).toBe(true);
    });
  });
});
