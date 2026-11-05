import { describe, expect, it } from "vitest";
import {
  WhatsAppIntegrationAdapter,
  matchesWhatsappFinancialKeywords,
  getWhatsappKeywordAutoReply,
  WHATSAPP_AUTO_REPLY_TEMPLATE,
} from "./whatsapp.integration";

describe("IRIS 6.0 — FASE 9: WHATSAPP ARCHITECTURAL INTEGRATION", () => {
  describe("1. Detecção de Palavras-Chave Obrigatórias", () => {
    it("detecta todas as palavras-chave obrigatórias (nota, boleto, duplicata, copias de pedidos)", () => {
      expect(matchesWhatsappFinancialKeywords("preciso da minha nota fiscal")).toBe(true);
      expect(matchesWhatsappFinancialKeywords("segunda via do boleto")).toBe(true);
      expect(matchesWhatsappFinancialKeywords("tem como enviar as notas?")).toBe(true);
      expect(matchesWhatsappFinancialKeywords("duplicata em aberto")).toBe(true);
      expect(matchesWhatsappFinancialKeywords("preciso de copias de pedidos")).toBe(true);
      expect(matchesWhatsappFinancialKeywords("onde estão os boletos?")).toBe(true);

      // Não deve disparar para mensagens gerais
      expect(matchesWhatsappFinancialKeywords("bom dia, qual o horário de atendimento?")).toBe(false);
      expect(matchesWhatsappFinancialKeywords("agendar reunião amanhã")).toBe(false);
    });

    it("gera o texto de resposta padrão correto", () => {
      const reply = getWhatsappKeywordAutoReply("Por favor me envie a nota fiscal");
      expect(reply).toBe(WHATSAPP_AUTO_REPLY_TEMPLATE);
      expect(reply).toContain("Aline");
      expect(reply).toContain("(43) 3039-3112");
    });
  });

  describe("2. Estado da Integração e Tratamento Não Configurado", () => {
    it("retorna 'integração não configurada' quando não houver phoneNumberId", () => {
      const adapter = new WhatsAppIntegrationAdapter();
      expect(adapter.isConfigured()).toBe(false);
      expect(adapter.isConnected()).toBe(false);
      expect(adapter.getStatus().message).toBe("integração não configurada");
    });

    it("bloqueia envio direto quando a integração não está configurada", async () => {
      const adapter = new WhatsAppIntegrationAdapter();
      const result = await adapter.sendMessage({
        to: "5511999999999",
        text: "Mensagem de teste",
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe("blocked");
      expect(result.error).toBe("integração não configurada");
    });
  });

  describe("3. Segurança e Barreira de Autorização para Envio Automático", () => {
    it("bloqueia resposta automática se a integração não estiver conectada", () => {
      const adapter = new WhatsAppIntegrationAdapter({
        phoneNumberId: "100200300",
        isConnected: false,
      });

      const response = adapter.processIncomingMessage({
        messageId: "msg-in-1",
        from: "5511988887777",
        text: "preciso do boleto",
        timestamp: new Date().toISOString(),
      });

      expect(response.matchedKeyword).toBe(true);
      expect(response.actionResult.status).toBe("blocked");
      expect(response.actionResult.error).toContain("não está conectado");
    });

    it("retorna pending_auth se a mensagem exigir envio e não houver autorização prévia", () => {
      const adapter = new WhatsAppIntegrationAdapter({
        phoneNumberId: "100200300",
        isConnected: true,
      });

      const response = adapter.processIncomingMessage(
        {
          messageId: "msg-in-2",
          from: "5511988887777",
          text: "por favor enviar nota fiscal",
          timestamp: new Date().toISOString(),
        },
        { isAuthorized: false }
      );

      expect(response.matchedKeyword).toBe(true);
      expect(response.actionResult.status).toBe("pending_auth");
      expect(response.actionResult.requiresAuthorization).toBe(true);
    });

    it("permite o processamento quando conectado e explicitamente autorizado", () => {
      const adapter = new WhatsAppIntegrationAdapter({
        phoneNumberId: "100200300",
        isConnected: true,
      });

      const response = adapter.processIncomingMessage(
        {
          messageId: "msg-in-3",
          from: "5511988887777",
          text: "onde está o boleto",
          timestamp: new Date().toISOString(),
        },
        { isAuthorized: true }
      );

      expect(response.matchedKeyword).toBe(true);
      expect(response.actionResult.success).toBe(true);
      expect(response.actionResult.status).toBe("sent");
    });
  });
});
