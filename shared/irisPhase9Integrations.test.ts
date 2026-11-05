/**
 * TESTES COMPLETOS DA FASE 9 — INTEGRAÇÕES + TOOL REGISTRY + AGENT ORCHESTRATOR
 */

import { describe, expect, it } from "vitest";
import {
  ToolRegistry,
  type IrisTool,
} from "./irisTools";
import {
  IntegrationRegistry,
  SecureOAuthManager,
  registerGoogleWorkspaceTools,
} from "./irisIntegrations";
import {
  IrisAgentOrchestrator,
  isOrchestratorProtectedAction,
  inferOrchestratorTools,
} from "./irisAgentOrchestrator";
import { IrisCostGuard } from "./irisModelRouter";

describe("FASE 9 — TOOL REGISTRY + INTEGRAÇÕES + OAUTH + COST GUARD + ORCHESTRATOR", () => {
  describe("9.1 Tool Registry Central & Classificação de Operações", () => {
    it("garante atributos completos em todas as ferramentas registradas", () => {
      const registry = new ToolRegistry(true);
      const tools = registry.listTools();

      expect(tools.length).toBeGreaterThanOrEqual(15);
      for (const tool of tools) {
        expect(tool.id).toBeDefined();
        expect(tool.name).toBeDefined();
        expect(tool.category).toBeDefined();
        expect(tool.integration).toBeDefined();
        expect(["READ", "WRITE", "DELETE", "SEND", "SHARE"]).toContain(tool.operation);
        expect(tool.permissions).toBeInstanceOf(Array);
        expect(["low", "medium", "high"]).toContain(tool.riskLevel);
        expect(typeof tool.requiresAuthorization).toBe("boolean");
        expect(typeof tool.isAvailable).toBe("boolean");
      }
    });

    it("classifica operações protegidas como exigindo autorização", () => {
      const registry = new ToolRegistry(true);
      const deleteTools = registry.listTools({ operation: "DELETE" });
      const sendTools = registry.listTools({ operation: "SEND" });

      expect(deleteTools.length).toBeGreaterThan(0);
      expect(sendTools.length).toBeGreaterThan(0);

      for (const t of deleteTools) {
        expect(t.requiresAuthorization).toBe(true);
      }
      for (const t of sendTools) {
        expect(t.requiresAuthorization).toBe(true);
      }
    });

    it("filtra ferramentas por operação e integração", () => {
      const registry = new ToolRegistry(true);
      const readTools = registry.listTools({ operation: "READ" });
      expect(readTools.every((t) => t.operation === "READ")).toBe(true);

      const storageTools = registry.listTools({ integration: "storage" });
      expect(storageTools.every((t) => t.integration === "storage")).toBe(true);
    });
  });

  describe("9.2 Google Drive Adapter", () => {
    it("registra ferramentas do Drive com classificação correta", () => {
      const toolRegistry = new ToolRegistry(false);
      const integrationRegistry = new IntegrationRegistry();
      registerGoogleWorkspaceTools(toolRegistry, integrationRegistry);

      const driveList = toolRegistry.getTool("drive.list");
      const driveSearch = toolRegistry.getTool("drive.search");
      const driveGet = toolRegistry.getTool("drive.get");
      const driveFolder = toolRegistry.getTool("drive.createFolder");
      const driveRename = toolRegistry.getTool("drive.rename");
      const driveMove = toolRegistry.getTool("drive.move");
      const driveDelete = toolRegistry.getTool("drive.delete");
      const driveShare = toolRegistry.getTool("drive.share");

      expect(driveList?.operation).toBe("READ");
      expect(driveSearch?.operation).toBe("READ");
      expect(driveGet?.operation).toBe("READ");
      expect(driveFolder?.operation).toBe("WRITE");
      expect(driveRename?.operation).toBe("WRITE");
      expect(driveMove?.operation).toBe("WRITE");
      expect(driveDelete?.operation).toBe("DELETE");
      expect(driveShare?.operation).toBe("SHARE");

      // Operações protegidas exigem autorização
      expect(driveFolder?.requiresAuthorization).toBe(true);
      expect(driveRename?.requiresAuthorization).toBe(true);
      expect(driveMove?.requiresAuthorization).toBe(true);
      expect(driveDelete?.requiresAuthorization).toBe(true);
      expect(driveShare?.requiresAuthorization).toBe(true);
    });

    it("bloqueia operações protegidas do Drive sem autorização explícita", async () => {
      const toolRegistry = new ToolRegistry(false);
      const integrationRegistry = new IntegrationRegistry();
      integrationRegistry.registerUserToken(1, "google:drive", {
        accessToken: "test-token",
        expiresAt: Date.now() + 3600_000,
      });
      registerGoogleWorkspaceTools(toolRegistry, integrationRegistry);

      // Sem autorização
      const renameRes = await toolRegistry.executeTool("drive.rename", { fileId: "123", newName: "teste.pdf" }, { userId: 1, isAuthorized: false });
      expect(renameRes.success).toBe(false);
      expect(renameRes.error).toMatch(/autorização explícita/i);

      const moveRes = await toolRegistry.executeTool("drive.move", { fileId: "123", targetFolderId: "f456" }, { userId: 1, isAuthorized: false });
      expect(moveRes.success).toBe(false);
      expect(moveRes.error).toMatch(/autorização explícita/i);

      const shareRes = await toolRegistry.executeTool("drive.share", { fileId: "123", email: "user@exemplo.com" }, { userId: 1, isAuthorized: false });
      expect(shareRes.success).toBe(false);
      expect(shareRes.error).toMatch(/autorização explícita/i);

      const deleteRes = await toolRegistry.executeTool("drive.delete", { fileId: "123" }, { userId: 1, isAuthorized: false });
      expect(deleteRes.success).toBe(false);
      expect(deleteRes.error).toMatch(/autorização explícita/i);
    });

    it("executa operações protegidas do Drive quando explicitamente autorizado", async () => {
      const toolRegistry = new ToolRegistry(false);
      const integrationRegistry = new IntegrationRegistry();
      integrationRegistry.registerUserToken(1, "google:drive", {
        accessToken: "test-token",
        expiresAt: Date.now() + 3600_000,
      });
      registerGoogleWorkspaceTools(toolRegistry, integrationRegistry);

      const renameRes = await toolRegistry.executeTool(
        "drive.rename",
        { fileId: "123", newName: "novo.pdf" },
        { userId: 1, isAuthorized: true }
      );
      expect(renameRes.success).toBe(true);
      expect((renameRes.data as any).renamed).toBe(true);

      const moveRes = await toolRegistry.executeTool(
        "drive.move",
        { fileId: "123", targetFolderId: "pasta-b" },
        { userId: 1, isAuthorized: true }
      );
      expect(moveRes.success).toBe(true);
      expect((moveRes.data as any).moved).toBe(true);

      const shareRes = await toolRegistry.executeTool(
        "drive.share",
        { fileId: "123", email: "colega@exemplo.com" },
        { userId: 1, isAuthorized: true }
      );
      expect(shareRes.success).toBe(true);
      expect((shareRes.data as any).shared).toBe(true);
    });
  });

  describe("9.3 Gmail Adapter", () => {
    it("garante leitura e rascunho sem autorização, mas envio NUNCA automático", async () => {
      const toolRegistry = new ToolRegistry(false);
      const integrationRegistry = new IntegrationRegistry();
      integrationRegistry.registerUserToken(1, "google:gmail", {
        accessToken: "test-token",
        expiresAt: Date.now() + 3600_000,
      });
      registerGoogleWorkspaceTools(toolRegistry, integrationRegistry);

      // Leitura permitida
      const readRes = await toolRegistry.executeTool("gmail.read", { messageId: "msg-1" }, { userId: 1 });
      expect(readRes.success).toBe(true);

      // Rascunho permitido (preparação apenas)
      const draftRes = await toolRegistry.executeTool(
        "gmail.draft",
        { to: "joao@empresa.com", subject: "Reunião", body: "Olá João" },
        { userId: 1 }
      );
      expect(draftRes.success).toBe(true);

      // Envio bloqueado sem autorização explícita
      const sendBlocked = await toolRegistry.executeTool(
        "gmail.send",
        { to: "joao@empresa.com", subject: "Reunião", body: "Olá João" },
        { userId: 1, isAuthorized: false }
      );
      expect(sendBlocked.success).toBe(false);
      expect(sendBlocked.error).toMatch(/autorização explícita/i);

      // Envio permitido após autorização explícita
      const sendRes = await toolRegistry.executeTool(
        "gmail.send",
        { to: "joao@empresa.com", subject: "Reunião", body: "Olá João" },
        { userId: 1, isAuthorized: true }
      );
      expect(sendRes.success).toBe(true);
      expect((sendRes.data as any).sent).toBe(true);
    });
  });

  describe("9.4 Google Calendar Adapter", () => {
    it("permite consulta de eventos e exige autorização para criar, alterar e excluir", async () => {
      const toolRegistry = new ToolRegistry(false);
      const integrationRegistry = new IntegrationRegistry();
      integrationRegistry.registerUserToken(1, "google:calendar", {
        accessToken: "test-token",
        expiresAt: Date.now() + 3600_000,
      });
      registerGoogleWorkspaceTools(toolRegistry, integrationRegistry);

      // Consulta de eventos permitida
      const listRes = await toolRegistry.executeTool("calendar.list", {}, { userId: 1 });
      expect(listRes.success).toBe(true);

      // Operações de mutação exigem autorização
      const createRes = await toolRegistry.executeTool("calendar.create", { title: "Consulta médica", date: "2026-10-15" }, { userId: 1, isAuthorized: false });
      expect(createRes.success).toBe(false);
      expect(createRes.error).toMatch(/autorização explícita/i);

      const updateRes = await toolRegistry.executeTool("calendar.update", { eventId: "ev-1", title: "Novo título" }, { userId: 1, isAuthorized: false });
      expect(updateRes.success).toBe(false);
      expect(updateRes.error).toMatch(/autorização explícita/i);

      const deleteRes = await toolRegistry.executeTool("calendar.delete", { eventId: "ev-1" }, { userId: 1, isAuthorized: false });
      expect(deleteRes.success).toBe(false);
      expect(deleteRes.error).toMatch(/autorização explícita/i);
    });
  });

  describe("9.5 WhatsApp Adapter", () => {
    it("opera estritamente como adapter mock sem disparos reais nem APIs pagas", async () => {
      const toolRegistry = new ToolRegistry(false);
      registerGoogleWorkspaceTools(toolRegistry);

      const tool = toolRegistry.getTool("whatsapp.send");
      expect(tool).toBeDefined();
      expect(tool?.operation).toBe("SEND");
      expect(tool?.requiresAuthorization).toBe(true);

      // Sem autorização
      const blockedRes = await toolRegistry.executeTool("whatsapp.send", { to: "+551199999999", message: "Olá" }, { isAuthorized: false });
      expect(blockedRes.success).toBe(false);
      expect(blockedRes.error).toMatch(/autorização explícita/i);

      // Com autorização
      const res = await toolRegistry.executeTool(
        "whatsapp.send",
        { to: "+551199999999", message: "Olá" },
        { isAuthorized: true }
      );
      expect(res.success).toBe(true);
      expect((res.data as any).adapterOnly).toBe(true);
      expect((res.data as any).sent).toBe(false);
    });
  });

  describe("9.6 Arquitetura OAuth Segura", () => {
    it("informa claramente integração não configurada quando credenciais ausentes", () => {
      const oauth = new SecureOAuthManager({ clientId: "", clientSecret: "" });
      expect(oauth.isConfigured()).toBe(false);

      const start = oauth.startOAuth("google:drive", 1);
      expect(start.configured).toBe(false);
      expect(start.message).toBe("integração não configurada");
    });

    it("gerencia ciclo de vida completo: start, session, refresh e disconnect", async () => {
      const oauth = new SecureOAuthManager({
        clientId: "fake-client-id.apps.googleusercontent.com",
        clientSecret: "fake-secret",
        redirectUri: "http://localhost:3000/callback",
      });

      expect(oauth.isConfigured()).toBe(true);
      const start = oauth.startOAuth("google:drive", 1);
      expect(start.configured).toBe(true);
      expect(start.state).toBeDefined();

      // Callback
      const cb = oauth.handleCallback(start.state!, "mock-code-123");
      expect(cb.success).toBe(true);

      // Refresh token
      const refreshed = await oauth.refreshToken({
        accessToken: "old-token",
        refreshToken: "valid-refresh-token",
        expiresAt: Date.now() - 1000,
      });
      expect(refreshed.success).toBe(true);
      expect(refreshed.tokens?.accessToken).toBeDefined();

      // Disconnect
      const reg = new IntegrationRegistry();
      reg.registerUserToken(1, "google:drive", { accessToken: "tok", expiresAt: Date.now() + 3600_000 });
      expect(reg.isIntegrationConnected("google:drive", 1)).toBe(true);
      oauth.disconnect(1, "google:drive", reg);
      expect(reg.isIntegrationConnected("google:drive", 1)).toBe(false);
    });
  });

  describe("9.7 e 9.8 Cost Guard", () => {
    it("permite FREE e FREE_TIER, bloqueia PROMOTIONAL por padrão e BLOQUEIA PAID", () => {
      // FREE / LOCAL
      const localEval = IrisCostGuard.evaluate("iris-local-fast");
      expect(localEval.allowed).toBe(true);
      expect(localEval.tier).toBe("local");

      // FREE TIER
      const freeTierEval = IrisCostGuard.evaluate("gemini-1.5-flash-free");
      expect(freeTierEval.allowed).toBe(true);
      expect(freeTierEval.tier).toBe("free_tier");

      // PROMOTIONAL (bloqueado por padrão)
      const promoDefault = IrisCostGuard.evaluate("promotional_credit");
      expect(promoDefault.allowed).toBe(false);
      expect(promoDefault.status).toBe("blocked");

      // PROMOTIONAL (permitido quando explicitamente autorizado)
      const promoAuth = IrisCostGuard.evaluate("promotional_credit", { promotionalCreditAuthorized: true });
      expect(promoAuth.allowed).toBe(true);

      // PAID (BLOQUEADO SEMPRE POR PADRÃO)
      const paidEval = IrisCostGuard.evaluate("gpt-4o");
      expect(paidEval.allowed).toBe(false);
      expect(paidEval.tier).toBe("paid");
    });
  });

  describe("9.9 Auditoria Sem Segredos", () => {
    it("higieniza senhas, tokens e chaves de API nos logs de auditoria do Orchestrator", () => {
      const orchestrator = new IrisAgentOrchestrator();
      orchestrator.planTask({
        command: "Enviar email com senha: SecretPassword123 e bearer sk-1234567890abcdef",
      });

      const logs = orchestrator.getAuditLogs();
      expect(logs.length).toBeGreaterThan(0);
      for (const log of logs) {
        expect(log.command).not.toContain("SecretPassword123");
        expect(log.command).not.toContain("sk-1234567890abcdef");
        expect(log.message).not.toContain("SecretPassword123");
      }
    });
  });
});
