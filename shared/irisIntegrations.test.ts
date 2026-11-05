import { describe, expect, it } from "vitest";
import {
  IntegrationRegistry,
  SecureOAuthManager,
  registerGoogleWorkspaceTools,
} from "./irisIntegrations";
import { ToolRegistry } from "./irisTools";
import { IrisAgentOrchestrator } from "./irisAgentOrchestrator";
import { IrisExecutionEngine } from "./irisExecutionEngine";

describe("IRIS 6.0 — FASE 9: INTEGRAÇÕES REAIS + OAUTH + GOOGLE WORKSPACE", () => {
  describe("1. IntegrationRegistry (Registro e Saúde de Integrações)", () => {
    it("inicializa com as integrações padrão (Drive, Gmail, Calendar, WhatsApp)", () => {
      const registry = new IntegrationRegistry(true);
      const list = registry.listIntegrations();

      expect(list.length).toBeGreaterThanOrEqual(4);
      expect(registry.getIntegration("google:drive")).toBeDefined();
      expect(registry.getIntegration("google:gmail")).toBeDefined();
      expect(registry.getIntegration("google:calendar")).toBeDefined();
      expect(registry.getIntegration("meta:whatsapp")).toBeDefined();
    });

    it("gerencia status de conexão por usuário e expiração de token", () => {
      const registry = new IntegrationRegistry(true);
      const userId = 101;

      expect(registry.isIntegrationConnected("google:drive", userId)).toBe(false);

      // Conectar usuário com token válido
      registry.setUserConnected(userId, "google:drive", {
        accessToken: "valid-token-123",
        expiresAt: Date.now() + 3600_000,
      });

      expect(registry.isIntegrationConnected("google:drive", userId)).toBe(true);

      // Conectar com token expirado
      registry.setUserConnected(userId, "google:gmail", {
        accessToken: "expired-token-456",
        expiresAt: Date.now() - 1000,
      });

      expect(registry.isIntegrationConnected("google:gmail", userId)).toBe(false);

      // Desconectar usuário
      registry.disconnectUser(userId, "google:drive");
      expect(registry.isIntegrationConnected("google:drive", userId)).toBe(false);
    });
  });

  describe("2. SecureOAuthManager (Fluxo OAuth e State)", () => {
    it("retorna 'integração não configurada' sem quebrar se client_id não estiver definido", () => {
      const oauth = new SecureOAuthManager({ clientId: "" });
      const result = oauth.startOAuth("google:drive", 1);

      expect(result.configured).toBe(false);
      expect(result.message).toBe("integração não configurada");
      expect(result.url).toBeUndefined();
    });

    it("gera URL OAuth válida com state e PKCE quando configurado", () => {
      const oauth = new SecureOAuthManager({
        clientId: "mock-google-client-id-123.apps.googleusercontent.com",
        clientSecret: "mock-secret",
        redirectUri: "https://iris.local/api/oauth/callback",
      });

      const result = oauth.startOAuth("google:drive", 42);

      expect(result.configured).toBe(true);
      expect(result.url).toBeDefined();
      expect(result.state).toBeDefined();
      expect(result.url).toContain("accounts.google.com");
      expect(result.url).toContain("mock-google-client-id-123");
      expect(result.url).toContain("drive.readonly");
    });

    it("valida callback com state correto e rejeita state inválido ou expirado", () => {
      const oauth = new SecureOAuthManager({
        clientId: "test-client-id",
        redirectUri: "https://iris.local/callback",
      });

      const start = oauth.startOAuth("google:gmail", 42);
      const validState = start.state!;

      // State inválido
      const invalidRes = oauth.handleCallback("state-falso", "code-xyz");
      expect(invalidRes.success).toBe(false);
      expect(invalidRes.error).toContain("OAuth inválido");

      // State válido
      const validRes = oauth.handleCallback(validState, "valid-auth-code-123");
      expect(validRes.success).toBe(true);
      expect(validRes.session?.userId).toBe(42);
      expect(validRes.session?.provider).toBe("google:gmail");

      // State não pode ser reutilizado (consumido)
      const reuseRes = oauth.handleCallback(validState, "valid-auth-code-123");
      expect(reuseRes.success).toBe(false);
    });
  });

  describe("3. Google Drive Tools (Leitura vs Modificação/Destruição)", () => {
    it("permite leitura e busca no Drive quando conectado", async () => {
      const intRegistry = new IntegrationRegistry(true);
      intRegistry.setUserConnected(1, "google:drive", {
        accessToken: "token-drive",
        expiresAt: Date.now() + 3600_000,
      });

      const toolRegistry = new ToolRegistry(false);
      registerGoogleWorkspaceTools(toolRegistry, intRegistry);

      const listRes = await toolRegistry.executeTool("drive.list", {}, { userId: 1 });
      expect(listRes.success).toBe(true);
      expect((listRes.data as any).files.length).toBeGreaterThan(0);

      const searchRes = await toolRegistry.executeTool(
        "drive.search",
        { query: "vendas" },
        { userId: 1 }
      );
      expect(searchRes.success).toBe(true);
      expect((searchRes.data as any).results.length).toBeGreaterThan(0);
    });

    it("bloqueia criação de pasta e exclusão no Drive sem autorização explícita", async () => {
      const intRegistry = new IntegrationRegistry(true);
      intRegistry.setUserConnected(1, "google:drive", {
        accessToken: "token-drive",
        expiresAt: Date.now() + 3600_000,
      });

      const toolRegistry = new ToolRegistry(false);
      registerGoogleWorkspaceTools(toolRegistry, intRegistry);

      // Criação de pasta sem autorização
      const folderRes = await toolRegistry.executeTool(
        "drive.createFolder",
        { folderName: "Nova Pasta" },
        { userId: 1, isAuthorized: false }
      );
      expect(folderRes.success).toBe(false);
      expect(folderRes.error).toContain("autorização explícita");

      // Exclusão sem autorização
      const delRes = await toolRegistry.executeTool(
        "drive.delete",
        { fileId: "file-99" },
        { userId: 1, isAuthorized: false }
      );
      expect(delRes.success).toBe(false);
      expect(delRes.error).toContain("autorização explícita");

      // Criação e exclusão com autorização
      const folderAuthRes = await toolRegistry.executeTool(
        "drive.createFolder",
        { folderName: "Nova Pasta Autorizada" },
        { userId: 1, isAuthorized: true, allowedScopes: ["external:write"] }
      );
      expect(folderAuthRes.success).toBe(true);
    });

    it("bloqueia ferramentas do Drive se a integração estiver desconectada", async () => {
      const intRegistry = new IntegrationRegistry(true);
      const toolRegistry = new ToolRegistry(false);
      registerGoogleWorkspaceTools(toolRegistry, intRegistry);

      const res = await toolRegistry.executeTool("drive.list", {}, { userId: 2 });
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/não conectado|integração não configurada/i);
    });
  });

  describe("4. Gmail Tools (Leitura, Rascunho e Envio Estritamente Protegido)", () => {
    it("permite leitura e rascunho no Gmail sem autorização prévia", async () => {
      const intRegistry = new IntegrationRegistry(true);
      intRegistry.setUserConnected(1, "google:gmail", {
        accessToken: "token-gmail",
        expiresAt: Date.now() + 3600_000,
      });

      const toolRegistry = new ToolRegistry(false);
      registerGoogleWorkspaceTools(toolRegistry, intRegistry);

      const searchRes = await toolRegistry.executeTool(
        "gmail.search",
        { query: "fatura" },
        { userId: 1 }
      );
      expect(searchRes.success).toBe(true);

      const draftRes = await toolRegistry.executeTool(
        "gmail.draft",
        { to: "cliente@empresa.com", subject: "Proposta", body: "Segue proposta" },
        { userId: 1 }
      );
      expect(draftRes.success).toBe(true);
      expect((draftRes.data as any).status).toBe("draft_created");
    });

    it("bloqueia rigorosamente envio de e-mail (gmail.send) sem autorização explícita", async () => {
      const intRegistry = new IntegrationRegistry(true);
      intRegistry.setUserConnected(1, "google:gmail", {
        accessToken: "token-gmail",
        expiresAt: Date.now() + 3600_000,
      });

      const toolRegistry = new ToolRegistry(false);
      registerGoogleWorkspaceTools(toolRegistry, intRegistry);

      const sendUnauthorized = await toolRegistry.executeTool(
        "gmail.send",
        { to: "chefe@empresa.com", subject: "Relatório", body: "Documento anexo" },
        { userId: 1, isAuthorized: false }
      );

      expect(sendUnauthorized.success).toBe(false);
      expect(sendUnauthorized.error).toContain("autorização explícita");

      // Com autorização explícita
      const sendAuthorized = await toolRegistry.executeTool(
        "gmail.send",
        { to: "chefe@empresa.com", subject: "Relatório", body: "Documento anexo" },
        { userId: 1, isAuthorized: true, allowedScopes: ["communication:send"] }
      );

      expect(sendAuthorized.success).toBe(true);
      expect((sendAuthorized.data as any).sent).toBe(true);
    });
  });

  describe("5. Google Calendar Tools (Consulta vs Criação/Alteração/Exclusão)", () => {
    it("permite consulta de compromissos da agenda", async () => {
      const intRegistry = new IntegrationRegistry(true);
      intRegistry.setUserConnected(1, "google:calendar", {
        accessToken: "token-cal",
        expiresAt: Date.now() + 3600_000,
      });

      const toolRegistry = new ToolRegistry(false);
      registerGoogleWorkspaceTools(toolRegistry, intRegistry);

      const listRes = await toolRegistry.executeTool("calendar.list", {}, { userId: 1 });
      expect(listRes.success).toBe(true);
    });

    it("exige autorização explícita para criação, alteração e exclusão de eventos", async () => {
      const intRegistry = new IntegrationRegistry(true);
      intRegistry.setUserConnected(1, "google:calendar", {
        accessToken: "token-cal",
        expiresAt: Date.now() + 3600_000,
      });

      const toolRegistry = new ToolRegistry(false);
      registerGoogleWorkspaceTools(toolRegistry, intRegistry);

      // Criação sem autorização
      const createBlocked = await toolRegistry.executeTool(
        "calendar.create",
        { title: "Reunião de Diretoria", date: "2026-10-15" },
        { userId: 1, isAuthorized: false }
      );
      expect(createBlocked.success).toBe(false);
      expect(createBlocked.error).toContain("autorização explícita");

      // Alteração sem autorização
      const updateBlocked = await toolRegistry.executeTool(
        "calendar.update",
        { eventId: "ev-1", title: "Novo Horário" },
        { userId: 1, isAuthorized: false }
      );
      expect(updateBlocked.success).toBe(false);
      expect(updateBlocked.error).toContain("autorização explícita");

      // Exclusão sem autorização
      const deleteBlocked = await toolRegistry.executeTool(
        "calendar.delete",
        { eventId: "ev-1" },
        { userId: 1, isAuthorized: false }
      );
      expect(deleteBlocked.success).toBe(false);
      expect(deleteBlocked.error).toContain("autorização explícita");

      // Criação com autorização
      const createAuthorized = await toolRegistry.executeTool(
        "calendar.create",
        { title: "Reunião Autorizada", date: "2026-10-15" },
        { userId: 1, isAuthorized: true, allowedScopes: ["calendar:write"] }
      );
      expect(createAuthorized.success).toBe(true);
    });
  });

  describe("6. Integração com Agent Orchestrator e Execution Engine", () => {
    it("orquestra comando 'Encontre no meu Drive o relatório de vendas' como leitura segura", async () => {
      const orchestrator = new IrisAgentOrchestrator();
      const plan = orchestrator.planTask({
        command: "Encontre no meu Drive o relatório de vendas",
      });

      expect(plan.toolsRequired).toContain("drive.search");
      expect(plan.requiresAuthorization).toBe(false);
      expect(plan.costGuardEvaluation.allowed).toBe(true);

      const engine = new IrisExecutionEngine();
      const execRes = await engine.executePlan(plan);
      expect(execRes.success).toBe(true);
      expect(execRes.status).toBe("success");
    });

    it("orquestra comando 'Envie esse relatório por e-mail' exigindo autorização antes do envio", async () => {
      const orchestrator = new IrisAgentOrchestrator();
      const plan = orchestrator.planTask({
        command: "Envie esse relatório por e-mail para diretoria",
      });

      expect(plan.toolsRequired).toContain("gmail.send");
      expect(plan.requiresAuthorization).toBe(true);
      expect(orchestrator.getState()).toBe("awaiting_authorization");

      const engine = new IrisExecutionEngine();

      // Tentativa sem autorização -> bloqueado
      const blockedRes = await engine.executePlan(plan, { isAuthorized: false });
      expect(blockedRes.success).toBe(false);
      expect(blockedRes.status).toBe("blocked");

      // Com autorização concedida
      orchestrator.authorize("token-confirmacao-envio");
      const authRes = await engine.executePlan(plan, {
        isAuthorized: true,
        allowedScopes: ["communication:send"],
      });
      expect(authRes.success).toBe(true);
      expect(authRes.status).toBe("success");
    });
  });
});
