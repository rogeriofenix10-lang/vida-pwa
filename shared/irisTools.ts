/**
 * IRIS 6.0 — FASE 6: TOOL / SKILLS ENGINE
 *
 * Sistema modular de ferramentas e habilidades para a IRIS.
 *
 * REGRAS INVIOLÁVEIS:
 * 1. O Tool Engine NUNCA ultrapassa:
 *    - Cognitive Engine
 *    - Cost Guard
 *    - Authorization
 *    - Execution Engine
 * 2. Nenhuma ferramenta protegida pode ser executada sem autorização explícita.
 * 3. Categorias obrigatórias:
 *    - local
 *    - arquivos
 *    - documentos
 *    - agenda
 *    - comunicação
 *    - análise
 *    - saúde
 *    - sistema
 * 4. Adaptadores seguros com mocks estruturados (sem integrações externas desprotegidas ou pagas).
 */

import { type RiskLevel } from "./irisCognitive";
import { IrisCostGuard, type CostGuardTier } from "./irisModelRouter";

export type ToolCategory =
  | "local"
  | "arquivos"
  | "documentos"
  | "agenda"
  | "comunicação"
  | "análise"
  | "saúde"
  | "sistema";

export type ToolOperationType = "READ" | "WRITE" | "DELETE" | "SEND" | "SHARE";

export type ParameterType = "string" | "number" | "boolean" | "object" | "array";

export interface ToolParameterDefinition {
  name: string;
  type: ParameterType;
  required: boolean;
  description?: string;
  defaultValue?: unknown;
}

export interface ToolExecutionContext {
  userId?: number | string;
  sessionId?: string;
  isAuthenticated?: boolean;
  isAuthorized?: boolean;
  allowedScopes?: string[];
  costGuardTier?: CostGuardTier;
  allowPromotionalCredit?: boolean;
  allowPaidServices?: boolean;
  mockDb?: Record<string, unknown>;
}

export interface ToolExecutionOutput {
  success: boolean;
  toolId: string;
  data?: unknown;
  error?: string;
  executionTimeMs?: number;
  fallbackUsed?: boolean;
}

export interface IrisTool {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  integration?: string;
  operation?: ToolOperationType;
  permissions: string[];
  riskLevel: RiskLevel;
  costLevel: CostGuardTier | "zero";
  parameters: ToolParameterDefinition[];
  isAvailable: boolean;
  requiresAuthorization: boolean;
  execute: (params: Record<string, unknown>, context?: ToolExecutionContext) => Promise<ToolExecutionOutput>;
  fallback?: (params: Record<string, unknown>, context?: ToolExecutionContext) => Promise<ToolExecutionOutput>;
  fallbackToolId?: string;
}

export interface ToolValidationResult {
  isValid: boolean;
  errors: string[];
  sanitizedInput: Record<string, unknown>;
}

export interface CanExecuteResult {
  allowed: boolean;
  reason?: string;
  blockType?: "authorization_required" | "cost_guard_blocked" | "permission_denied" | "tool_unavailable" | "tool_not_found";
}

/**
 * Inferência automática de tipo de operação para catálogo
 */
export function inferToolOperation(id: string, name: string): ToolOperationType {
  const s = `${id} ${name}`.toLowerCase();
  if (/\b(delete|excluir|remover|apagar)\b/.test(s)) return "DELETE";
  if (/\b(send|enviar|disparar)\b/.test(s)) return "SEND";
  if (/\b(share|compartilhar|exportar)\b/.test(s)) return "SHARE";
  if (/\b(create|criar|novo|cadastrar|update|atualizar|alterar|modificar|record|gravar|salvar|draft|pasta)\b/.test(s)) return "WRITE";
  return "READ";
}

/**
 * Inferência automática da integração da ferramenta
 */
export function inferToolIntegration(id: string): string {
  if (id.startsWith("drive.")) return "google:drive";
  if (id.startsWith("gmail.")) return "google:gmail";
  if (id.startsWith("calendar.")) return "google:calendar";
  if (id.startsWith("whatsapp.")) return "meta:whatsapp";
  if (id.startsWith("saúde.") || id.startsWith("health.")) return "health";
  if (id.startsWith("radar.")) return "radar";
  if (id.startsWith("local.")) return "local";
  if (id.startsWith("sistema.")) return "system";
  if (id.startsWith("arquivos.")) return "storage";
  if (id.startsWith("documentos.")) return "documents";
  if (id.startsWith("comunicação.")) return "communication";
  if (id.startsWith("análise.")) return "analysis";
  return "local";
}

/**
 * Registro Central de Ferramentas da IRIS
 */
export class ToolRegistry {
  private tools: Map<string, IrisTool> = new Map();

  constructor(registerDefaultTools = true) {
    if (registerDefaultTools) {
      this.registerDefaultCatalog();
    }
  }

  /**
   * Registra uma ferramenta
   */
  public registerTool(tool: IrisTool): void {
    if (!tool.id || !tool.name || !tool.category) {
      throw new Error("Definição de ferramenta inválida: id, nome e categoria são obrigatórios.");
    }
    const finalTool: IrisTool = {
      ...tool,
      operation: tool.operation || inferToolOperation(tool.id, tool.name),
      integration: tool.integration || inferToolIntegration(tool.id),
    };
    if (
      finalTool.operation === "DELETE" ||
      finalTool.operation === "SEND" ||
      finalTool.operation === "SHARE"
    ) {
      finalTool.requiresAuthorization = true;
    }
    this.tools.set(finalTool.id, finalTool);
  }

  /**
   * Obtém uma ferramenta pelo ID
   */
  public getTool(id: string): IrisTool | undefined {
    return this.tools.get(id);
  }

  /**
   * Lista ferramentas com filtros opcionais
   */
  public listTools(filter?: {
    category?: ToolCategory;
    riskLevel?: RiskLevel;
    isAvailable?: boolean;
    requiresAuthorization?: boolean;
    operation?: ToolOperationType;
    integration?: string;
  }): IrisTool[] {
    const list = Array.from(this.tools.values());
    return list.filter((t) => {
      if (filter?.category && t.category !== filter.category) return false;
      if (filter?.riskLevel && t.riskLevel !== filter.riskLevel) return false;
      if (filter?.isAvailable !== undefined && t.isAvailable !== filter.isAvailable) return false;
      if (filter?.requiresAuthorization !== undefined && t.requiresAuthorization !== filter.requiresAuthorization) return false;
      if (filter?.operation && t.operation !== filter.operation) return false;
      if (filter?.integration && t.integration !== filter.integration) return false;
      return true;
    });
  }

  /**
   * Valida se a ferramenta pode ser executada respeitando a barreira de segurança:
   * Cost Guard → Authorization → Tool Permission → Tool Availability
   */
  public canExecuteTool(id: string, context?: ToolExecutionContext): CanExecuteResult {
    const tool = this.tools.get(id);
    if (!tool) {
      return {
        allowed: false,
        reason: `Ferramenta com ID “${id}” não encontrada no ToolRegistry.`,
        blockType: "tool_not_found",
      };
    }

    // 1. Disponibilidade
    if (!tool.isAvailable) {
      return {
        allowed: false,
        reason: `Ferramenta “${tool.name}” está temporariamente indisponível.`,
        blockType: "tool_unavailable",
      };
    }

    // 2. Barreira do Cost Guard
    const tierToEval = tool.costLevel === "zero" ? "local" : tool.costLevel;
    const costEval = IrisCostGuard.evaluate(tierToEval, {
      promotionalCreditAuthorized: context?.allowPromotionalCredit,
      userAllowedPaid: context?.allowPaidServices,
    });
    if (!costEval.allowed) {
      return {
        allowed: false,
        reason: costEval.reason || "Recurso pago bloqueado pelo IRIS Cost Guard.",
        blockType: "cost_guard_blocked",
      };
    }

    // 3. Barreira de Autorização Explícita
    const isProtected =
      tool.requiresAuthorization ||
      tool.operation === "DELETE" ||
      tool.operation === "SEND" ||
      tool.operation === "SHARE" ||
      (tool.operation === "WRITE" && tool.requiresAuthorization);

    if (isProtected && !context?.isAuthorized) {
      return {
        allowed: false,
        reason: `Ação protegida da ferramenta “${tool.name}” exige autorização explícita do usuário.`,
        blockType: "authorization_required",
      };
    }

    // 4. Barreira de Permissões / Scopes
    if (tool.permissions.length > 0) {
      let scopes = context?.allowedScopes;
      if (!scopes) {
        // Escopos padrão de leitura permitidos a qualquer usuário autenticado/ativo
        scopes = [
          "external:read",
          "calendar:read",
          "documents:read",
          "files:read",
          "health:read",
          "radar:read",
          "communication:prepare",
        ];
        // Se a ação tiver autorização explícita, conceder escopos de mutação autorizados
        if (context?.isAuthorized) {
          scopes.push(
            "external:write",
            "calendar:write",
            "files:write",
            "health:write",
            "radar:write",
            "communication:send"
          );
        }
      }
      const hasPermission = tool.permissions.every((p) => scopes!.includes(p) || scopes!.includes("*"));
      if (!hasPermission) {
        return {
          allowed: false,
          reason: `Permissões insuficientes para executar “${tool.name}”. Requer: ${tool.permissions.join(", ")}.`,
          blockType: "permission_denied",
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Valida e sanitiza os parâmetros de entrada da ferramenta
   */
  public validateToolInput(id: string, input: Record<string, unknown> = {}): ToolValidationResult {
    const tool = this.tools.get(id);
    if (!tool) {
      return {
        isValid: false,
        errors: [`Ferramenta “${id}” não encontrada.`],
        sanitizedInput: {},
      };
    }

    const errors: string[] = [];
    const sanitizedInput: Record<string, unknown> = {};

    for (const param of tool.parameters) {
      let val = input[param.name];

      // Mapeamento semântico inteligente de parâmetros operacionais
      if (val === undefined || val === null || val === "") {
        if (param.name === "query" && (input.command || input.text)) {
          val = String(input.command || input.text);
        } else if (param.name === "to") {
          val = input.recipient || input.target || (input.command ? "destinatario@exemplo.com" : undefined);
        } else if (param.name === "subject") {
          val = input.topic || input.summary || (input.command ? "Notificação IRIS" : undefined);
        } else if (param.name === "body" || param.name === "message" || param.name === "text") {
          val = input.message || input.content || input.body || input.text || input.command;
        } else if (param.name === "title") {
          val = input.label || input.command || "Compromisso";
        } else if (param.name === "date") {
          val = input.dateLabel || "hoje";
        }
      }

      if (val === undefined || val === null || val === "") {
        if (param.required) {
          if (param.defaultValue !== undefined) {
            sanitizedInput[param.name] = param.defaultValue;
          } else {
            errors.push(`Parâmetro obrigatório ausente: “${param.name}”.`);
          }
        } else if (param.defaultValue !== undefined) {
          sanitizedInput[param.name] = param.defaultValue;
        }
        continue;
      }

      // Validação de tipo
      const actualType = Array.isArray(val) ? "array" : typeof val;
      if (param.type !== actualType) {
        // Tentar coerção simples de string para número se for número válido
        if (param.type === "number" && typeof val === "string" && !isNaN(Number(val))) {
          sanitizedInput[param.name] = Number(val);
        } else if (param.type === "boolean" && (val === "true" || val === "false")) {
          sanitizedInput[param.name] = val === "true";
        } else {
          errors.push(`Tipo incompatível para “${param.name}”: esperado ${param.type}, recebido ${actualType}.`);
        }
      } else {
        sanitizedInput[param.name] = val;
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      sanitizedInput,
    };
  }

  /**
   * Executa a ferramenta com barreiras e tratamento de fallback
   */
  public async executeTool(
    id: string,
    input: Record<string, unknown> = {},
    context?: ToolExecutionContext
  ): Promise<ToolExecutionOutput> {
    const startTime = Date.now();

    // 1. Checagem de Segurança
    const canExec = this.canExecuteTool(id, context);
    if (!canExec.allowed) {
      return {
        success: false,
        toolId: id,
        error: canExec.reason || "Execução bloqueada por barreira de segurança.",
        executionTimeMs: Date.now() - startTime,
      };
    }

    // 2. Validação de Input
    const validation = this.validateToolInput(id, input);
    if (!validation.isValid) {
      return {
        success: false,
        toolId: id,
        error: `Parâmetros inválidos: ${validation.errors.join("; ")}`,
        executionTimeMs: Date.now() - startTime,
      };
    }

    const tool = this.tools.get(id)!;

    // 3. Execução Protegida
    try {
      const output = await tool.execute(validation.sanitizedInput, context);
      return {
        ...output,
        toolId: id,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      // Tentar fallback da ferramenta se existir
      if (tool.fallback) {
        try {
          const fallbackOutput = await tool.fallback(validation.sanitizedInput, context);
          return {
            ...fallbackOutput,
            toolId: id,
            fallbackUsed: true,
            executionTimeMs: Date.now() - startTime,
          };
        } catch (fallbackErr) {
          return {
            success: false,
            toolId: id,
            error: `Falha na execução: ${errorMsg}; Falha no fallback: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`,
            executionTimeMs: Date.now() - startTime,
          };
        }
      }

      return {
        success: false,
        toolId: id,
        error: errorMsg,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Catálogo Padrão Seguro da IRIS cobrindo as 8 categorias obrigatórias
   */
  private registerDefaultCatalog(): void {
    // 1. LOCAL
    this.registerTool({
      id: "local.datetime",
      name: "Data e Hora Local",
      description: "Retorna a data e hora atual do sistema local com fuso horário.",
      category: "local",
      permissions: [],
      riskLevel: "low",
      costLevel: "zero",
      parameters: [],
      isAvailable: true,
      requiresAuthorization: false,
      execute: async () => ({
        success: true,
        toolId: "local.datetime",
        data: {
          iso: new Date().toISOString(),
          localeDate: new Date().toLocaleDateString("pt-BR"),
          localeTime: new Date().toLocaleTimeString("pt-BR"),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo",
        },
      }),
    });

    this.registerTool({
      id: "local.echo",
      name: "Echo Local",
      description: "Eco de texto para testes de comunicação local segura.",
      category: "local",
      permissions: [],
      riskLevel: "low",
      costLevel: "zero",
      parameters: [{ name: "text", type: "string", required: true }],
      isAvailable: true,
      requiresAuthorization: false,
      execute: async (params) => ({
        success: true,
        toolId: "local.echo",
        data: { echo: params.text },
      }),
    });

    // 2. ARQUIVOS
    this.registerTool({
      id: "arquivos.list",
      name: "Listar Arquivos Seguros",
      description: "Lista arquivos permitidos no diretório seguro da aplicação.",
      category: "arquivos",
      permissions: ["files:read"],
      riskLevel: "low",
      costLevel: "zero",
      parameters: [{ name: "folder", type: "string", required: false, defaultValue: "default" }],
      isAvailable: true,
      requiresAuthorization: false,
      execute: async (params) => ({
        success: true,
        toolId: "arquivos.list",
        data: { folder: params.folder, files: ["documento_exemplo.pdf", "relatorio_mensal.txt"] },
      }),
    });

    this.registerTool({
      id: "arquivos.delete",
      name: "Excluir Arquivo",
      description: "Remove um arquivo do armazenamento seguro (ação destrutiva e protegida).",
      category: "arquivos",
      permissions: ["files:write", "files:delete"],
      riskLevel: "high",
      costLevel: "zero",
      parameters: [{ name: "filename", type: "string", required: true }],
      isAvailable: true,
      requiresAuthorization: true,
      execute: async (params, ctx) => {
        if (!ctx?.isAuthorized) {
          throw new Error("Ação de exclusão bloqueada: autorização explícita necessária.");
        }
        return {
          success: true,
          toolId: "arquivos.delete",
          data: { filename: params.filename, status: "deleted" },
        };
      },
    });

    // 3. DOCUMENTOS
    this.registerTool({
      id: "documentos.search",
      name: "Pesquisar Documentos",
      description: "Pesquisa metadados de documentos locais por palavra-chave.",
      category: "documentos",
      permissions: ["documents:read"],
      riskLevel: "low",
      costLevel: "zero",
      parameters: [{ name: "query", type: "string", required: true }],
      isAvailable: true,
      requiresAuthorization: false,
      execute: async (params) => ({
        success: true,
        toolId: "documentos.search",
        data: { query: params.query, count: 2, results: [{ title: `Documento sobre ${params.query || "projeto"}`, id: "doc-1" }, { title: "Especificação.pdf", id: "doc-2" }] },
      }),
    });

    this.registerTool({
      id: "documentos.summarize",
      name: "Resumir e Listar Documentos",
      description: "Gera lista estruturada e resumo dos documentos encontrados.",
      category: "documentos",
      permissions: ["documents:read"],
      riskLevel: "low",
      costLevel: "zero",
      parameters: [{ name: "query", type: "string", required: false }],
      isAvailable: true,
      requiresAuthorization: false,
      execute: async (params) => ({
        success: true,
        toolId: "documentos.summarize",
        data: {
          summary: "Lista estruturada de documentos preparada com sucesso.",
          items: [
            { id: "doc-1", title: "Projeto - Especificação Técnica.pdf" },
            { id: "doc-2", title: "Projeto - Cronograma e Entregas.docx" },
          ],
        },
      }),
    });

    this.registerTool({
      id: "documents.search",
      name: "Pesquisar Documentos (Alias)",
      description: "Pesquisa metadados de documentos locais por palavra-chave.",
      category: "documentos",
      permissions: ["documents:read"],
      riskLevel: "low",
      costLevel: "zero",
      parameters: [{ name: "query", type: "string", required: true }],
      isAvailable: true,
      requiresAuthorization: false,
      execute: async (params) => ({
        success: true,
        toolId: "documents.search",
        data: { query: params.query, count: 2, results: [{ title: "Projeto - Especificação Técnica.pdf", id: "doc-1" }, { title: "Projeto - Cronograma.docx", id: "doc-2" }] },
      }),
    });

    this.registerTool({
      id: "documents.summarize",
      name: "Resumir e Listar Documentos (Alias)",
      description: "Gera lista estruturada e resumo dos documentos encontrados.",
      category: "documentos",
      permissions: ["documents:read"],
      riskLevel: "low",
      costLevel: "zero",
      parameters: [{ name: "query", type: "string", required: false }],
      isAvailable: true,
      requiresAuthorization: false,
      execute: async (params) => ({
        success: true,
        toolId: "documents.summarize",
        data: {
          summary: "Lista de documentos estruturada com sucesso.",
          items: [
            { id: "doc-1", title: "Projeto - Especificação Técnica.pdf" },
            { id: "doc-2", title: "Projeto - Cronograma e Entregas.docx" },
          ],
        },
      }),
    });

    this.registerTool({
      id: "documentos.share",
      name: "Compartilhar Documento",
      description: "Concede link ou permissão de compartilhamento para documento (ação protegida).",
      category: "documentos",
      permissions: ["documents:share"],
      riskLevel: "high",
      costLevel: "zero",
      parameters: [
        { name: "documentId", type: "string", required: true },
        { name: "recipient", type: "string", required: true },
      ],
      isAvailable: true,
      requiresAuthorization: true,
      execute: async (params, ctx) => {
        if (!ctx?.isAuthorized) {
          throw new Error("Compartilhamento bloqueado: autorização explícita ausente.");
        }
        return {
          success: true,
          toolId: "documentos.share",
          data: { shared: true, documentId: params.documentId, recipient: params.recipient },
        };
      },
    });

    // 4. AGENDA
    this.registerTool({
      id: "agenda.read",
      name: "Consultar Agenda",
      description: "Consulta eventos da agenda local.",
      category: "agenda",
      permissions: ["calendar:read"],
      riskLevel: "low",
      costLevel: "zero",
      parameters: [{ name: "date", type: "string", required: false, defaultValue: "hoje" }],
      isAvailable: true,
      requiresAuthorization: false,
      execute: async (params) => ({
        success: true,
        toolId: "agenda.read",
        data: { date: params.date, events: [] },
      }),
    });

    this.registerTool({
      id: "agenda.create",
      name: "Criar Compromisso na Agenda",
      description: "Cria um novo evento na agenda pessoal (ação moderada que exige autorização).",
      category: "agenda",
      permissions: ["calendar:write"],
      riskLevel: "medium",
      costLevel: "zero",
      parameters: [
        { name: "title", type: "string", required: true },
        { name: "date", type: "string", required: true },
        { name: "notes", type: "string", required: false, defaultValue: "" },
      ],
      isAvailable: true,
      requiresAuthorization: true,
      execute: async (params, ctx) => {
        if (!ctx?.isAuthorized) {
          throw new Error("Agendamento bloqueado: autorização explícita ausente.");
        }
        return {
          success: true,
          toolId: "agenda.create",
          data: { eventId: `evt-${Date.now()}`, title: params.title, date: params.date },
        };
      },
    });

    // 5. COMUNICAÇÃO
    this.registerTool({
      id: "comunicação.prepare",
      name: "Preparar Mensagem (Rascunho)",
      description: "Prepara rascunho de mensagem para revisão humana. NUNCA envia automaticamente.",
      category: "comunicação",
      permissions: ["communication:prepare"],
      riskLevel: "medium",
      costLevel: "zero",
      parameters: [
        { name: "recipient", type: "string", required: true },
        { name: "message", type: "string", required: true },
        { name: "channel", type: "string", required: false, defaultValue: "email" },
      ],
      isAvailable: true,
      requiresAuthorization: false,
      execute: async (params) => ({
        success: true,
        toolId: "comunicação.prepare",
        data: { status: "draft_ready", ...params },
      }),
    });

    this.registerTool({
      id: "comunicação.send",
      name: "Enviar Comunicação Externa",
      description: "Dispara envio de mensagem/email externo (ação de alto risco, estritamente protegida).",
      category: "comunicação",
      permissions: ["communication:send"],
      riskLevel: "high",
      costLevel: "zero",
      parameters: [
        { name: "recipient", type: "string", required: true },
        { name: "message", type: "string", required: true },
        { name: "channel", type: "string", required: false, defaultValue: "email" },
      ],
      isAvailable: true,
      requiresAuthorization: true,
      execute: async (params, ctx) => {
        if (!ctx?.isAuthorized) {
          throw new Error("Envio bloqueado: comunicação externa exige autorização explícita.");
        }
        return {
          success: true,
          toolId: "comunicação.send",
          data: { status: "sent", recipient: params.recipient, channel: params.channel },
        };
      },
    });

    // 6. ANÁLISE
    this.registerTool({
      id: "análise.radar",
      name: "Análise do Radar de Tarefas",
      description: "Calcula métricas e pendências ativas sem efetuar mutações de dados.",
      category: "análise",
      permissions: [],
      riskLevel: "low",
      costLevel: "zero",
      parameters: [],
      isAvailable: true,
      requiresAuthorization: false,
      execute: async () => ({
        success: true,
        toolId: "análise.radar",
        data: { total: 4, pendentes: 2, urgentes: 1, saudeGeral: "ótima" },
      }),
    });

    this.registerTool({
      id: "análise.diagnostico",
      name: "Diagnóstico Completo do Ecossistema",
      description: "Realiza diagnóstico reflexivo e identificação de oportunidades de otimização.",
      category: "análise",
      permissions: [],
      riskLevel: "low",
      costLevel: "zero",
      parameters: [{ name: "depth", type: "string", required: false, defaultValue: "standard" }],
      isAvailable: true,
      requiresAuthorization: false,
      execute: async (params) => ({
        success: true,
        toolId: "análise.diagnostico",
        data: { depth: params.depth, status: "stable", insights: ["Finanças organizadas", "Exames em dia"] },
      }),
    });

    // 7. SAÚDE
    this.registerTool({
      id: "saúde.readBiomarkers",
      name: "Consultar Biomarcadores de Saúde",
      description: "Consulta segura do histórico de biomarcadores (Health Center).",
      category: "saúde",
      permissions: ["health:read"],
      riskLevel: "low",
      costLevel: "zero",
      parameters: [{ name: "category", type: "string", required: false, defaultValue: "all" }],
      isAvailable: true,
      requiresAuthorization: false,
      execute: async (params) => ({
        success: true,
        toolId: "saúde.readBiomarkers",
        data: { category: params.category, records: [{ name: "Glicemia", value: "88 mg/dL", status: "normal" }] },
      }),
    });

    this.registerTool({
      id: "saúde.recordMetric",
      name: "Registrar Métrica de Saúde",
      description: "Registra nova leitura de saúde (pressão, glicemia, peso).",
      category: "saúde",
      permissions: ["health:write"],
      riskLevel: "medium",
      costLevel: "zero",
      parameters: [
        { name: "metric", type: "string", required: true },
        { name: "value", type: "number", required: true },
        { name: "unit", type: "string", required: true },
      ],
      isAvailable: true,
      requiresAuthorization: true,
      execute: async (params, ctx) => {
        if (!ctx?.isAuthorized) {
          throw new Error("Registro de saúde bloqueado: autorização explícita necessária.");
        }
        return {
          success: true,
          toolId: "saúde.recordMetric",
          data: { registered: true, metric: params.metric, value: params.value, unit: params.unit },
        };
      },
    });

    // 8. SISTEMA
    this.registerTool({
      id: "sistema.status",
      name: "Status do Sistema",
      description: "Verifica integridade dos subsistemas cognitivos e operacionais da IRIS.",
      category: "sistema",
      permissions: [],
      riskLevel: "low",
      costLevel: "zero",
      parameters: [],
      isAvailable: true,
      requiresAuthorization: false,
      execute: async () => ({
        success: true,
        toolId: "sistema.status",
        data: { version: "IRIS 6.0", cognitive: "active", costGuard: "secure_free_first", status: "operational" },
      }),
    });

    this.registerTool({
      id: "sistema.config",
      name: "Configurações Operacionais do Sistema",
      description: "Atualiza parâmetros operacionais do sistema (ação de alto impacto).",
      category: "sistema",
      permissions: ["system:admin"],
      riskLevel: "high",
      costLevel: "zero",
      parameters: [
        { name: "settingKey", type: "string", required: true },
        { name: "settingValue", type: "string", required: true },
      ],
      isAvailable: true,
      requiresAuthorization: true,
      execute: async (params, ctx) => {
        if (!ctx?.isAuthorized) {
          throw new Error("Configuração de sistema bloqueada: autorização de administrador necessária.");
        }
        return {
          success: true,
          toolId: "sistema.config",
          data: { updated: true, key: params.settingKey, value: params.settingValue },
        };
      },
    });

    // 9. RADAR E ALIASES OPERACIONAIS (Compatibilidade Orchestrator <-> Execution Engine)
    this.registerTool({
      id: "radar.read",
      name: "Consultar Radar",
      description: "Consulta itens e pendências do Radar com custo zero.",
      category: "local",
      permissions: [],
      riskLevel: "low",
      costLevel: "zero",
      parameters: [],
      isAvailable: true,
      requiresAuthorization: false,
      execute: async () => ({
        success: true,
        toolId: "radar.read",
        data: { items: [], total: 0 },
      }),
    });

    this.registerTool({
      id: "radar.create",
      name: "Criar Item no Radar",
      description: "Cria um item no Radar do usuário (ação protegida).",
      category: "local",
      permissions: ["radar:write"],
      riskLevel: "low",
      costLevel: "zero",
      parameters: [
        { name: "label", type: "string", required: false, defaultValue: "Novo item" },
        { name: "command", type: "string", required: false, defaultValue: "" },
      ],
      isAvailable: true,
      requiresAuthorization: true,
      execute: async (params, ctx) => {
        if (!ctx?.isAuthorized) {
          throw new Error("Criação no Radar bloqueada: autorização explícita ausente.");
        }
        return {
          success: true,
          toolId: "radar.create",
          data: { created: true, label: params.label },
        };
      },
    });

    this.registerTool({
      id: "radar.update",
      name: "Atualizar Item no Radar",
      description: "Atualiza um item no Radar do usuário (ação protegida).",
      category: "local",
      permissions: ["radar:write"],
      riskLevel: "medium",
      costLevel: "zero",
      parameters: [
        { name: "targetId", type: "number", required: false, defaultValue: 1 },
      ],
      isAvailable: true,
      requiresAuthorization: true,
      execute: async (params, ctx) => {
        if (!ctx?.isAuthorized) {
          throw new Error("Atualização no Radar bloqueada: autorização explícita ausente.");
        }
        return {
          success: true,
          toolId: "radar.update",
          data: { updated: true, targetId: params.targetId },
        };
      },
    });

    this.registerTool({
      id: "radar.complete",
      name: "Concluir Item no Radar",
      description: "Marca item do Radar como concluído (ação protegida).",
      category: "local",
      permissions: ["radar:write"],
      riskLevel: "medium",
      costLevel: "zero",
      parameters: [
        { name: "targetId", type: "number", required: false, defaultValue: 1 },
      ],
      isAvailable: true,
      requiresAuthorization: true,
      execute: async (params, ctx) => {
        if (!ctx?.isAuthorized) {
          throw new Error("Conclusão de item bloqueada: autorização explícita ausente.");
        }
        return {
          success: true,
          toolId: "radar.complete",
          data: { completed: true, targetId: params.targetId },
        };
      },
    });

    this.registerTool({
      id: "radar.delete",
      name: "Excluir Item do Radar",
      description: "Remove definitivamente um item do Radar (ação de alto risco protegida).",
      category: "local",
      permissions: ["radar:delete"],
      riskLevel: "high",
      costLevel: "zero",
      parameters: [
        { name: "targetId", type: "number", required: false, defaultValue: 1 },
      ],
      isAvailable: true,
      requiresAuthorization: true,
      execute: async (params, ctx) => {
        if (!ctx?.isAuthorized) {
          throw new Error("Exclusão no Radar bloqueada: autorização explícita ausente.");
        }
        return {
          success: true,
          toolId: "radar.delete",
          data: { deleted: true, targetId: params.targetId },
        };
      },
    });

    // Aliases sem acentuação para ferramentas de comunicação, agenda e análise
    this.registerTool({
      id: "communication.send",
      name: "Enviar Comunicação Externa",
      description: "Dispara envio de mensagem externa com proteção rigorosa.",
      category: "comunicação",
      permissions: ["communication:send"],
      riskLevel: "high",
      costLevel: "zero",
      parameters: [
        { name: "recipient", type: "string", required: false, defaultValue: "contato" },
        { name: "message", type: "string", required: false, defaultValue: "" },
      ],
      isAvailable: true,
      requiresAuthorization: true,
      execute: async (params, ctx) => {
        if (!ctx?.isAuthorized) {
          throw new Error("Envio bloqueado: comunicação externa exige autorização explícita.");
        }
        return {
          success: true,
          toolId: "communication.send",
          data: { status: "sent", recipient: params.recipient },
        };
      },
    });

    this.registerTool({
      id: "communication.prepare",
      name: "Preparar Mensagem (Rascunho)",
      description: "Prepara rascunho de mensagem para revisão humana.",
      category: "comunicação",
      permissions: ["communication:prepare"],
      riskLevel: "medium",
      costLevel: "zero",
      parameters: [
        { name: "recipient", type: "string", required: false, defaultValue: "contato" },
        { name: "message", type: "string", required: false, defaultValue: "" },
      ],
      isAvailable: true,
      requiresAuthorization: false,
      execute: async (params) => ({
        success: true,
        toolId: "communication.prepare",
        data: { status: "draft_ready", ...params },
      }),
    });

    this.registerTool({
      id: "calendar.create",
      name: "Criar Compromisso na Agenda",
      description: "Cria evento na agenda.",
      category: "agenda",
      permissions: ["calendar:write"],
      riskLevel: "medium",
      costLevel: "zero",
      parameters: [
        { name: "title", type: "string", required: false, defaultValue: "Reunião" },
        { name: "date", type: "string", required: false, defaultValue: "amanhã" },
      ],
      isAvailable: true,
      requiresAuthorization: true,
      execute: async (params, ctx) => {
        if (!ctx?.isAuthorized) {
          throw new Error("Agendamento bloqueado: autorização explícita ausente.");
        }
        return {
          success: true,
          toolId: "calendar.create",
          data: { eventId: `evt-${Date.now()}`, title: params.title, date: params.date },
        };
      },
    });

    this.registerTool({
      id: "analysis.run",
      name: "Executar Análise Operacional",
      description: "Executa análise diagnóstica e métricas do sistema sem mutação.",
      category: "análise",
      permissions: [],
      riskLevel: "low",
      costLevel: "zero",
      parameters: [],
      isAvailable: true,
      requiresAuthorization: false,
      execute: async () => ({
        success: true,
        toolId: "analysis.run",
        data: { analyzed: true, status: "healthy" },
      }),
    });

    // 10. GOOGLE DRIVE OFICIAL (Fase 9)
    this.registerTool({
      id: "drive.list",
      name: "Listar Arquivos no Google Drive",
      description: "Lista arquivos e pastas do Google Drive com leitura segura.",
      category: "arquivos",
      permissions: ["external:read"],
      riskLevel: "low",
      costLevel: "zero",
      parameters: [
        { name: "folderId", type: "string", required: false, defaultValue: "root" },
        { name: "pageSize", type: "number", required: false, defaultValue: 20 },
      ],
      isAvailable: true,
      requiresAuthorization: false,
      execute: async (params) => ({
        success: true,
        toolId: "drive.list",
        data: {
          folderId: params.folderId,
          files: [
            { id: "f-1", name: "Relatório de Vendas 2026.pdf", mimeType: "application/pdf" },
            { id: "f-2", name: "Contrato Fornecedor.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
          ],
        },
      }),
    });

    this.registerTool({
      id: "drive.search",
      name: "Buscar Arquivos no Google Drive",
      description: "Pesquisa documentos e arquivos no Google Drive por termo.",
      category: "documentos",
      permissions: ["external:read"],
      riskLevel: "low",
      costLevel: "zero",
      parameters: [
        { name: "query", type: "string", required: true },
        { name: "pageSize", type: "number", required: false, defaultValue: 10 },
      ],
      isAvailable: true,
      requiresAuthorization: false,
      execute: async (params) => ({
        success: true,
        toolId: "drive.search",
        data: {
          query: params.query,
          count: 1,
          results: [{ id: "doc-vendas-1", name: `Documento sobre ${params.query}`, webViewLink: "https://drive.google.com/file/d/mock" }],
        },
      }),
    });

    this.registerTool({
      id: "drive.get",
      name: "Obter Arquivo no Google Drive",
      description: "Recupera metadados essenciais de um arquivo no Google Drive.",
      category: "documentos",
      permissions: ["external:read"],
      riskLevel: "low",
      costLevel: "zero",
      parameters: [{ name: "fileId", type: "string", required: true }],
      isAvailable: true,
      requiresAuthorization: false,
      execute: async (params) => ({
        success: true,
        toolId: "drive.get",
        data: { fileId: params.fileId, name: "Documento.pdf", sizeBytes: 1024 * 200 },
      }),
    });

    this.registerTool({
      id: "drive.createFolder",
      name: "Criar Pasta no Google Drive",
      description: "Cria pasta no Google Drive (ação modificadora protegida).",
      category: "arquivos",
      permissions: ["external:write"],
      riskLevel: "medium",
      costLevel: "zero",
      parameters: [
        { name: "folderName", type: "string", required: true },
        { name: "parentFolderId", type: "string", required: false, defaultValue: "root" },
      ],
      isAvailable: true,
      requiresAuthorization: true,
      execute: async (params, ctx) => {
        if (!ctx?.isAuthorized) throw new Error("Criação de pasta no Google Drive exige autorização explícita.");
        return {
          success: true,
          toolId: "drive.createFolder",
          data: { created: true, folderId: `folder-${Date.now()}`, folderName: params.folderName },
        };
      },
    });

    this.registerTool({
      id: "drive.delete",
      name: "Excluir Arquivo no Google Drive",
      description: "Remove arquivo no Google Drive (ação destrutiva protegida).",
      category: "arquivos",
      permissions: ["external:write"],
      riskLevel: "high",
      costLevel: "zero",
      parameters: [{ name: "fileId", type: "string", required: true }],
      isAvailable: true,
      requiresAuthorization: true,
      execute: async (params, ctx) => {
        if (!ctx?.isAuthorized) throw new Error("Exclusão de arquivo no Google Drive exige autorização explícita.");
        return {
          success: true,
          toolId: "drive.delete",
          data: { deleted: true, fileId: params.fileId },
        };
      },
    });

    // 11. GMAIL OFICIAL (Fase 9)
    this.registerTool({
      id: "gmail.search",
      name: "Buscar Mensagens no Gmail",
      description: "Pesquisa e-mails no Gmail por termo ou remetente.",
      category: "comunicação",
      permissions: ["external:read"],
      riskLevel: "low",
      costLevel: "zero",
      parameters: [
        { name: "query", type: "string", required: true },
        { name: "maxResults", type: "number", required: false, defaultValue: 10 },
      ],
      isAvailable: true,
      requiresAuthorization: false,
      execute: async (params) => ({
        success: true,
        toolId: "gmail.search",
        data: { query: params.query, messages: [{ id: "msg-1", threadId: "th-1", snippet: `Resultado para ${params.query}` }] },
      }),
    });

    this.registerTool({
      id: "gmail.read",
      name: "Ler Mensagem no Gmail",
      description: "Lê o conteúdo de uma mensagem de e-mail específica.",
      category: "comunicação",
      permissions: ["external:read"],
      riskLevel: "low",
      costLevel: "zero",
      parameters: [{ name: "messageId", type: "string", required: true }],
      isAvailable: true,
      requiresAuthorization: false,
      execute: async (params) => ({
        success: true,
        toolId: "gmail.read",
        data: { messageId: params.messageId, subject: "Assunto do e-mail", body: "Conteúdo do e-mail" },
      }),
    });

    this.registerTool({
      id: "gmail.getThread",
      name: "Obter Thread no Gmail",
      description: "Recupera histórico da conversa de e-mails.",
      category: "comunicação",
      permissions: ["external:read"],
      riskLevel: "low",
      costLevel: "zero",
      parameters: [{ name: "threadId", type: "string", required: true }],
      isAvailable: true,
      requiresAuthorization: false,
      execute: async (params) => ({
        success: true,
        toolId: "gmail.getThread",
        data: { threadId: params.threadId, messageCount: 2 },
      }),
    });

    this.registerTool({
      id: "gmail.draft",
      name: "Criar Rascunho no Gmail",
      description: "Prepara rascunho de e-mail sem disparar envio.",
      category: "comunicação",
      permissions: ["communication:prepare"],
      riskLevel: "medium",
      costLevel: "zero",
      parameters: [
        { name: "to", type: "string", required: true },
        { name: "subject", type: "string", required: true },
        { name: "body", type: "string", required: true },
      ],
      isAvailable: true,
      requiresAuthorization: false,
      execute: async (params) => ({
        success: true,
        toolId: "gmail.draft",
        data: { draftId: `draft-${Date.now()}`, status: "draft_created", to: params.to, subject: params.subject },
      }),
    });

    this.registerTool({
      id: "gmail.send",
      name: "Enviar E-mail via Gmail",
      description: "Dispara envio real de e-mail (ação estritamente protegida).",
      category: "comunicação",
      permissions: ["communication:send"],
      riskLevel: "high",
      costLevel: "zero",
      parameters: [
        { name: "to", type: "string", required: true },
        { name: "subject", type: "string", required: true },
        { name: "body", type: "string", required: true },
      ],
      isAvailable: true,
      requiresAuthorization: true,
      execute: async (params, ctx) => {
        if (!ctx?.isAuthorized) throw new Error("Segurança IRIS: Envio de e-mail via Gmail exige autorização explícita.");
        return {
          success: true,
          toolId: "gmail.send",
          data: { sent: true, to: params.to, subject: params.subject, messageId: `msg-${Date.now()}` },
        };
      },
    });

    // 12. GOOGLE CALENDAR OFICIAL (Fase 9)
    this.registerTool({
      id: "calendar.list",
      name: "Listar Eventos na Google Agenda",
      description: "Consulta eventos da agenda do usuário.",
      category: "agenda",
      permissions: ["calendar:read"],
      riskLevel: "low",
      costLevel: "zero",
      parameters: [
        { name: "timeMin", type: "string", required: false },
        { name: "timeMax", type: "string", required: false },
        { name: "maxResults", type: "number", required: false, defaultValue: 20 },
      ],
      isAvailable: true,
      requiresAuthorization: false,
      execute: async (params) => ({
        success: true,
        toolId: "calendar.list",
        data: { events: [{ id: "ev-1", summary: "Reunião Operacional", start: new Date().toISOString() }] },
      }),
    });

    this.registerTool({
      id: "calendar.get",
      name: "Obter Evento na Google Agenda",
      description: "Recupera detalhes de um compromisso na Google Agenda.",
      category: "agenda",
      permissions: ["calendar:read"],
      riskLevel: "low",
      costLevel: "zero",
      parameters: [{ name: "eventId", type: "string", required: true }],
      isAvailable: true,
      requiresAuthorization: false,
      execute: async (params) => ({
        success: true,
        toolId: "calendar.get",
        data: { eventId: params.eventId, summary: "Consulta Médica", date: "amanhã" },
      }),
    });

    this.registerTool({
      id: "calendar.search",
      name: "Pesquisar na Google Agenda",
      description: "Pesquisa eventos na agenda por palavra-chave.",
      category: "agenda",
      permissions: ["calendar:read"],
      riskLevel: "low",
      costLevel: "zero",
      parameters: [{ name: "query", type: "string", required: true }],
      isAvailable: true,
      requiresAuthorization: false,
      execute: async (params) => ({
        success: true,
        toolId: "calendar.search",
        data: { query: params.query, events: [{ id: "ev-s1", summary: `Evento com ${params.query}` }] },
      }),
    });

    this.registerTool({
      id: "calendar.update",
      name: "Atualizar Evento na Google Agenda",
      description: "Altera horário ou dados de evento na Google Agenda (ação protegida).",
      category: "agenda",
      permissions: ["calendar:write"],
      riskLevel: "medium",
      costLevel: "zero",
      parameters: [
        { name: "eventId", type: "string", required: true },
        { name: "title", type: "string", required: false },
        { name: "date", type: "string", required: false },
      ],
      isAvailable: true,
      requiresAuthorization: true,
      execute: async (params, ctx) => {
        if (!ctx?.isAuthorized) throw new Error("Alteração de evento na Google Agenda exige autorização explícita.");
        return {
          success: true,
          toolId: "calendar.update",
          data: { updated: true, eventId: params.eventId, newTitle: params.title },
        };
      },
    });

    this.registerTool({
      id: "calendar.delete",
      name: "Excluir Evento na Google Agenda",
      description: "Remove um compromisso da Google Agenda (ação destrutiva protegida).",
      category: "agenda",
      permissions: ["calendar:write"],
      riskLevel: "high",
      costLevel: "zero",
      parameters: [{ name: "eventId", type: "string", required: true }],
      isAvailable: true,
      requiresAuthorization: true,
      execute: async (params, ctx) => {
        if (!ctx?.isAuthorized) throw new Error("Exclusão de compromisso na Google Agenda exige autorização explícita.");
        return {
          success: true,
          toolId: "calendar.delete",
          data: { deleted: true, eventId: params.eventId },
        };
      },
    });

    // 13. WHATSAPP (Fase 9: Arquitetura Segura)
    this.registerTool({
      id: "whatsapp.send",
      name: "Enviar Mensagem via WhatsApp",
      description: "Dispara mensagem via WhatsApp (ação protegida sob consentimento explícito).",
      category: "comunicação",
      permissions: ["communication:send"],
      riskLevel: "high",
      costLevel: "zero",
      parameters: [
        { name: "to", type: "string", required: true },
        { name: "text", type: "string", required: true },
      ],
      isAvailable: true,
      requiresAuthorization: true,
      execute: async (params, ctx) => {
        if (!ctx?.isAuthorized) throw new Error("Segurança IRIS: Envio de mensagem no WhatsApp exige autorização explícita.");
        return {
          success: true,
          toolId: "whatsapp.send",
          data: { sent: true, to: params.to, messageId: `wa-${Date.now()}` },
        };
      },
    });
  }
}
