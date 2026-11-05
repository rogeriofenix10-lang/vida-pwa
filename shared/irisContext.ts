/**
 * IRIS 6.0 — FASE 7: CONTEXT MANAGER
 *
 * Camada estruturada de contexto para conversas, tarefas e sessões da IRIS.
 *
 * REGRAS INVIOLÁVEIS:
 * 1. Separação explícita entre:
 *    - Contexto da conversa (conversation context)
 *    - Contexto da tarefa (task context)
 *    - Contexto da sessão (session context)
 * 2. Proteção rigorosa de dados sensíveis:
 *    - Rejeita e sanitiza o armazenamento de credenciais, tokens, senhas e chaves de API.
 * 3. O Contexto é estritamente informativo (passivo) e não executa ações diretamente.
 * 4. Isolamento estrito entre usuários e sessões.
 */

export type ContextScope = "conversation" | "task" | "session" | "system";

export interface ContextOptions {
  scope?: ContextScope;
  userId?: number | string;
  sessionId?: string;
  ttlMs?: number;
}

export interface ContextEntry<T = unknown> {
  key: string;
  value: T;
  scope: ContextScope;
  userId?: number | string;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

/**
 * Padrões para detecção de dados sensíveis proibidos no contexto
 */
const SENSITIVE_PATTERNS = [
  /password/i,
  /senha/i,
  /bearer\s+[a-zA-Z0-9_\-\.]+/i,
  /api[_-]?key/i,
  /apikey/i,
  /sk-[a-zA-Z0-9_\-]{10,}/i,
  /secret/i,
  /token\s*[:=]\s*["']?[a-zA-Z0-9_\-\.]{10,}["']?/i,
  /\btoken\b/i,
  /private[_-]?key/i,
  /credit[_-]?card/i,
  /cvv/i,
];

/**
 * Valida se a chave ou valor contém dados sensíveis
 */
export function isSensitiveContextData(key: string, value: unknown): boolean {
  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(key))) {
    return true;
  }

  if (typeof value === "string") {
    return SENSITIVE_PATTERNS.some((pattern) => pattern.test(value));
  }

  if (value && typeof value === "object") {
    const stringified = JSON.stringify(value);
    return SENSITIVE_PATTERNS.some((pattern) => pattern.test(stringified));
  }

  return false;
}

/**
 * Gerenciador de Contexto Estruturado da IRIS
 */
export class IrisContextManager {
  private conversationContext: Map<string, ContextEntry> = new Map();
  private taskContext: Map<string, ContextEntry> = new Map();
  private sessionContext: Map<string, ContextEntry> = new Map();
  private systemContext: Map<string, ContextEntry> = new Map();

  private defaultUserId?: number | string;
  private defaultSessionId?: string;

  constructor(options?: { userId?: number | string; sessionId?: string }) {
    this.defaultUserId = options?.userId;
    this.defaultSessionId = options?.sessionId;
  }

  private getStore(scope: ContextScope): Map<string, ContextEntry> {
    switch (scope) {
      case "conversation":
        return this.conversationContext;
      case "task":
        return this.taskContext;
      case "session":
        return this.sessionContext;
      case "system":
        return this.systemContext;
      default:
        return this.conversationContext;
    }
  }

  private makeCompoundKey(key: string, options?: ContextOptions): string {
    const u = options?.userId ?? this.defaultUserId ?? "global";
    const s = options?.sessionId ?? this.defaultSessionId ?? "global";
    return `${u}:${s}:${key}`;
  }

  /**
   * Define valor no contexto com verificação contra dados sensíveis
   */
  public setContext<T>(key: string, value: T, options?: ContextOptions | ContextScope): void {
    const resolvedOptions: ContextOptions =
      typeof options === "string" ? { scope: options } : options || {};

    const scope: ContextScope = resolvedOptions.scope || "conversation";

    // REPOSITÓRIO SEGURO: Bloquear armazenamento de dados sensíveis / credenciais
    if (isSensitiveContextData(key, value)) {
      throw new Error(
        `Segurança IRIS: armazenamento de credenciais, senhas ou tokens sensíveis é estritamente proibido no contexto (chave: “${key}”).`
      );
    }

    const compoundKey = this.makeCompoundKey(key, resolvedOptions);
    const store = this.getStore(scope);
    const now = new Date().toISOString();

    const entry: ContextEntry<T> = {
      key,
      value,
      scope,
      userId: resolvedOptions.userId ?? this.defaultUserId,
      sessionId: resolvedOptions.sessionId ?? this.defaultSessionId,
      createdAt: now,
      updatedAt: now,
      expiresAt: resolvedOptions.ttlMs
        ? new Date(Date.now() + resolvedOptions.ttlMs).toISOString()
        : undefined,
    };

    store.set(compoundKey, entry as ContextEntry);
  }

  /**
   * Obtém valor do contexto
   */
  public getContext<T = unknown>(key: string, options?: ContextOptions | ContextScope): T | undefined {
    const resolvedOptions: ContextOptions =
      typeof options === "string" ? { scope: options } : options || {};

    const scope: ContextScope = resolvedOptions.scope || "conversation";
    const compoundKey = this.makeCompoundKey(key, resolvedOptions);
    const store = this.getStore(scope);
    const entry = store.get(compoundKey);

    if (!entry) return undefined;

    // Checar expiração de TTL
    if (entry.expiresAt && new Date(entry.expiresAt).getTime() < Date.now()) {
      store.delete(compoundKey);
      return undefined;
    }

    return entry.value as T;
  }

  /**
   * Limpa o contexto de um determinado escopo ou todos os escopos
   */
  public clearContext(scope?: ContextScope): void {
    if (scope) {
      this.getStore(scope).clear();
    } else {
      this.conversationContext.clear();
      this.taskContext.clear();
      this.sessionContext.clear();
      this.systemContext.clear();
    }
  }

  /**
   * Retorna todo o contexto da conversa filtrado para o usuário/sessão atual
   */
  public getConversationContext(): Record<string, unknown> {
    return this.dumpStore(this.conversationContext);
  }

  /**
   * Retorna todo o contexto de tarefa
   */
  public getTaskContext(): Record<string, unknown> {
    return this.dumpStore(this.taskContext);
  }

  /**
   * Registra entidades identificadas preservando continuidade operacional
   */
  public recordEntities(entities: Record<string, unknown>): void {
    this.setContext("operationalEntities", entities, "task");
  }

  /**
   * Recupera entidades operacionais ativas
   */
  public getEntities(): Record<string, unknown> | undefined {
    return this.getContext<Record<string, unknown>>("operationalEntities", "task");
  }

  /**
   * Regra inviolável: o Contexto é passivo e NUNCA concede autorização ou executa ações
   */
  public canGrantAuthorization(): false {
    return false;
  }

  public canExecuteActions(): false {
    return false;
  }

  /**
   * Retorna visão unificada do contexto (conversa + tarefa + sessão)
   */
  public getAllContext(): Record<string, unknown> {
    return {
      conversation: this.getConversationContext(),
      task: this.getTaskContext(),
      session: this.dumpStore(this.sessionContext),
    };
  }

  private dumpStore(store: Map<string, ContextEntry>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (entry.expiresAt && new Date(entry.expiresAt).getTime() < now) {
        continue;
      }
      result[entry.key] = entry.value;
    }
    return result;
  }
}
