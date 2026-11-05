/**
 * IRIS 6.0 — FASE 9: WHATSAPP ARCHITECTURAL INTEGRATION
 *
 * Arquitetura desacoplada e segura para integração com WhatsApp.
 *
 * REGRAS INVIOLÁVEIS:
 * 1. NÃO implementar envio real nesta fase (apenas arquitetura e interface).
 * 2. NÃO utilizar API paga (sem custos, mantendo Cost Guard Free-First).
 * 3. NÃO colocar credenciais ou tokens no código.
 * 4. Preservar a regra existente da IRIS para palavras-chave:
 *    - nota, notas, nota fiscal, notas fiscais, copias de pedidos, duplicata, duplicatas, boleto, boletos.
 * 5. Essa automação só poderá enviar a resposta configurada quando a integração real estiver autorizada e disponível.
 */

export const WHATSAPP_KEYWORDS = [
  "nota",
  "notas",
  "nota fiscal",
  "notas fiscais",
  "copias de pedidos",
  "duplicata",
  "duplicatas",
  "boleto",
  "boletos",
] as const;

export const WHATSAPP_AUTO_REPLY_TEMPLATE =
  "Olá,\n" +
  "(Tudo bem?\n" +
  "Gostaria de pedir, por favor, que você entre em contato com a Aline pelo WhatsApp no número (43) 3039-3112. Ela é a responsável por essa parte.)";

export interface WhatsAppIncomingMessage {
  messageId: string;
  from: string;
  text: string;
  timestamp: string;
}

export interface WhatsAppOutgoingMessage {
  to: string;
  text: string;
  isAutomatedReply?: boolean;
}

export interface WhatsAppSendResult {
  success: boolean;
  status: "sent" | "blocked" | "queued" | "pending_auth";
  messageId?: string;
  error?: string;
  requiresAuthorization?: boolean;
}

export interface WhatsAppIntegrationConfig {
  phoneNumberId?: string;
  businessAccountId?: string;
  isConfigured: boolean;
  isConnected: boolean;
  requiresAuthorization: boolean;
}

function normalizeText(text: string): string {
  return (text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Valida se o texto recebido contém as palavras-chave financeiras/faturamento da IRIS
 */
export function matchesWhatsappFinancialKeywords(text: string): boolean {
  const normalized = normalizeText(text);
  return WHATSAPP_KEYWORDS.some((kw) => normalized.includes(normalizeText(kw)));
}

/**
 * Retorna a mensagem de resposta automática se as palavras-chave forem detectadas
 */
export function getWhatsappKeywordAutoReply(text: string): string | null {
  return matchesWhatsappFinancialKeywords(text) ? WHATSAPP_AUTO_REPLY_TEMPLATE : null;
}

/**
 * Adaptador Arquitetural de Integração do WhatsApp
 */
export class WhatsAppIntegrationAdapter {
  private config: WhatsAppIntegrationConfig;

  constructor(config?: Partial<WhatsAppIntegrationConfig>) {
    this.config = {
      phoneNumberId: config?.phoneNumberId,
      businessAccountId: config?.businessAccountId,
      isConfigured: Boolean(config?.phoneNumberId && config?.phoneNumberId.length > 0),
      isConnected: Boolean(config?.isConnected),
      requiresAuthorization: true, // Toda ação de envio externo exige autorização
    };
  }

  public isConfigured(): boolean {
    return this.config.isConfigured;
  }

  public isConnected(): boolean {
    return this.config.isConnected;
  }

  public getStatus(): {
    configured: boolean;
    connected: boolean;
    message: string;
  } {
    if (!this.config.isConfigured) {
      return {
        configured: false,
        connected: false,
        message: "integração não configurada",
      };
    }
    if (!this.config.isConnected) {
      return {
        configured: true,
        connected: false,
        message: "WhatsApp desconectado ou aguardando autenticação",
      };
    }
    return {
      configured: true,
      connected: true,
      message: "WhatsApp conectado e operacional",
    };
  }

  /**
   * Processa mensagem recebida verificando automação de palavras-chave
   */
  public processIncomingMessage(
    incoming: WhatsAppIncomingMessage,
    context?: { isAuthorized?: boolean }
  ): {
    matchedKeyword: boolean;
    autoReplyContent: string | null;
    actionResult: WhatsAppSendResult;
  } {
    const matched = matchesWhatsappFinancialKeywords(incoming.text);
    const replyText = getWhatsappKeywordAutoReply(incoming.text);

    if (!matched || !replyText) {
      return {
        matchedKeyword: false,
        autoReplyContent: null,
        actionResult: {
          success: true,
          status: "queued",
        },
      };
    }

    // Regra inviolável da Fase 9:
    // "Essa automação só poderá enviar a resposta configurada quando a integração real estiver autorizada e disponível."
    if (!this.config.isConnected) {
      return {
        matchedKeyword: true,
        autoReplyContent: replyText,
        actionResult: {
          success: false,
          status: "blocked",
          error: "Envio bloqueado: WhatsApp não está conectado.",
        },
      };
    }

    if (!context?.isAuthorized) {
      return {
        matchedKeyword: true,
        autoReplyContent: replyText,
        actionResult: {
          success: false,
          status: "pending_auth",
          requiresAuthorization: true,
          error: "Envio automático de resposta de WhatsApp exige autorização explícita.",
        },
      };
    }

    // Preparado para envio sem API paga nesta fase
    return {
      matchedKeyword: true,
      autoReplyContent: replyText,
      actionResult: {
        success: true,
        status: "sent",
        messageId: `wa-mock-${Date.now()}`,
      },
    };
  }

  /**
   * Envio de mensagem controlado por autorização explícita
   */
  public async sendMessage(
    outgoing: WhatsAppOutgoingMessage,
    context?: { isAuthorized?: boolean }
  ): Promise<WhatsAppSendResult> {
    if (!this.config.isConfigured) {
      return {
        success: false,
        status: "blocked",
        error: "integração não configurada",
      };
    }

    if (!this.config.isConnected) {
      return {
        success: false,
        status: "blocked",
        error: "WhatsApp desconectado.",
      };
    }

    if (!context?.isAuthorized) {
      return {
        success: false,
        status: "blocked",
        requiresAuthorization: true,
        error: "Segurança IRIS: Disparo de mensagem no WhatsApp exige autorização explícita do usuário.",
      };
    }

    // Mock seguro de arquitetura sem disparar requisição externa paga
    return {
      success: true,
      status: "sent",
      messageId: `wa-${Date.now()}`,
    };
  }
}
