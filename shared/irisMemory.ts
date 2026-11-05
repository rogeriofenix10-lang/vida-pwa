/**
 * IRIS 6.0 — FASE 7: MEMORY INTELLIGENCE
 *
 * Camada estruturada de memória cognitiva para a IRIS.
 *
 * REGRAS INVIOLÁVEIS:
 * 1. Não armazenar credenciais, tokens, senhas ou dados sensíveis desnecessários.
 * 2. A memória é estritamente passiva:
 *    - NUNCA executa ações diretamente.
 *    - NUNCA altera dados externos.
 * 3. Controle rigoroso de origem:
 *    - memorySource
 *    - createdAt
 *    - updatedAt
 *    - confidence (0.0 a 1.0)
 *    - scope (session | task | user | system)
 * 4. Isolamento explícito entre usuários e sessões.
 * 5. Tipos de memória:
 *    - Ephemeral (temporária de sessão/tarefa)
 *    - Persistent (conhecimento durável do usuário)
 *    - Preference (preferências explícitas declaradas)
 */

export type MemoryScope = "session" | "task" | "user" | "system";

export type MemoryType = "ephemeral" | "persistent" | "preference";

export type MemorySource =
  | "user_stated"
  | "system_inferred"
  | "task_result"
  | "conversation"
  | "manual";

export interface IrisMemoryItem {
  id: string;
  content: string;
  type: MemoryType;
  scope: MemoryScope;
  source: MemorySource;
  confidence: number;
  userId?: number | string;
  sessionId?: string;
  category?: string;
  tags?: string[];
  importance?: number;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface RememberInput {
  content: string;
  type?: MemoryType;
  scope?: MemoryScope;
  source?: MemorySource;
  confidence?: number;
  userId?: number | string;
  sessionId?: string;
  category?: string;
  tags?: string[];
  importance?: number;
  ttlMs?: number;
}

export interface RecallOptions {
  scope?: MemoryScope;
  type?: MemoryType;
  category?: string;
  userId?: number | string;
  sessionId?: string;
  limit?: number;
  minConfidence?: number;
}

/**
 * Padrões de credenciais e dados sensíveis que JAMAIS devem ser persistidos
 */
const FORBIDDEN_CREDENTIAL_PATTERNS = [
  /\bpassword\s*[:=]\s*\S+/i,
  /\bsenha\s*[:=]\s*\S+/i,
  /\bbearer\s+[a-zA-Z0-9_\-\.]+/i,
  /\bapi[_-]?key\s*[:=]\s*\S+/i,
  /\bsecret\s*[:=]\s*\S+/i,
  /\bprivate[_-]?key\b/i,
  /\btoken\s*[:=]\s*["']?[a-zA-Z0-9_\-\.]{16,}["']?/i,
  /\bcard\s*number\b/i,
  /\bcvv\b/i,
];

/**
 * Verifica se o conteúdo contém credenciais ou segredos proibidos
 */
export function containsSensitiveCredentials(content: string): boolean {
  return FORBIDDEN_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(content));
}

/**
 * Gerenciador Central de Memória da IRIS
 */
export class IrisMemoryManager {
  private memories: Map<string, IrisMemoryItem> = new Map();
  private defaultUserId?: number | string;
  private defaultSessionId?: string;

  constructor(options?: { userId?: number | string; sessionId?: string }) {
    this.defaultUserId = options?.userId;
    this.defaultSessionId = options?.sessionId;
  }

  /**
   * Guarda uma lembrança na memória respeitando regras de segurança
   */
  public remember(input: RememberInput): IrisMemoryItem {
    const rawContent = (input.content || "").trim();
    if (!rawContent) {
      throw new Error("Conteúdo da memória não pode ser vazio.");
    }

    // REGRA 1: Proibição estrita de credenciais e tokens
    if (containsSensitiveCredentials(rawContent)) {
      throw new Error(
        "Segurança IRIS: tentativa de armazenar credenciais, senhas ou tokens sensíveis rejeitada pelo Memory Manager."
      );
    }

    const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    const confidence = Math.max(0, Math.min(1, input.confidence ?? 1.0));
    const scope = input.scope || "session";
    const type = input.type || (scope === "session" || scope === "task" ? "ephemeral" : "persistent");
    const source = input.source || "user_stated";

    const item: IrisMemoryItem = {
      id,
      content: rawContent,
      type,
      scope,
      source,
      confidence,
      userId: input.userId ?? this.defaultUserId,
      sessionId: input.sessionId ?? this.defaultSessionId,
      category: input.category || "geral",
      tags: input.tags || [],
      importance: input.importance ?? 1,
      createdAt: now,
      updatedAt: now,
      expiresAt: input.ttlMs ? new Date(Date.now() + input.ttlMs).toISOString() : undefined,
    };

    this.memories.set(id, item);
    return item;
  }

  /**
   * Recupera memórias relevantes com filtros e busca semântica simples
   */
  public recall(query: string, options?: RecallOptions): IrisMemoryItem[] {
    const rawQuery = (query || "").trim().toLowerCase();
    const queryTokens = rawQuery.split(/\s+/).filter((t) => t.length >= 2);
    const now = Date.now();

    const targetUserId = options?.userId ?? this.defaultUserId;
    const targetSessionId = options?.sessionId ?? this.defaultSessionId;

    const matched: Array<{ item: IrisMemoryItem; score: number }> = [];

    for (const [id, item] of this.memories.entries()) {
      // 1. Checar expiração de TTL
      if (item.expiresAt && new Date(item.expiresAt).getTime() < now) {
        this.memories.delete(id);
        continue;
      }

      // 2. Isolamento de Usuário
      if (item.userId !== undefined && targetUserId !== undefined && item.userId !== targetUserId) {
        continue;
      }

      // 3. Isolamento de Sessão (para escopo session/task)
      if (
        (item.scope === "session" || item.scope === "task") &&
        item.sessionId !== undefined &&
        targetSessionId !== undefined &&
        item.sessionId !== targetSessionId
      ) {
        continue;
      }

      // 4. Filtro por Escopo
      if (options?.scope && item.scope !== options.scope) {
        continue;
      }

      // 5. Filtro por Tipo
      if (options?.type && item.type !== options.type) {
        continue;
      }

      // 6. Filtro por Categoria
      if (options?.category && item.category !== options.category) {
        continue;
      }

      // 7. Confiança mínima
      if (options?.minConfidence !== undefined && item.confidence < options.minConfidence) {
        continue;
      }

      // 8. Relevância por palavras-chave
      const lowerContent = item.content.toLowerCase();
      let score = 0;

      if (!rawQuery) {
        score = (item.importance ?? 1) * 0.5 + item.confidence;
      } else {
        let textMatched = false;
        if (lowerContent.includes(rawQuery)) {
          score += 5;
          textMatched = true;
        }
        for (const token of queryTokens) {
          if (lowerContent.includes(token)) {
            score += 2;
            textMatched = true;
          }
        }
        if (textMatched) {
          score += (item.importance ?? 1) * 0.5 + item.confidence;
        }
      }

      if (score > 0) {
        matched.push({ item, score });
      }
    }

    matched.sort((a, b) => b.score - a.score || b.item.createdAt.localeCompare(a.item.createdAt));

    const limit = options?.limit ?? 10;
    return matched.slice(0, limit).map((m) => m.item);
  }

  /**
   * Esquece memória por ID ou filtro
   */
  public forget(idOrFilter: string | { id?: string; scope?: MemoryScope; type?: MemoryType }): boolean {
    if (typeof idOrFilter === "string") {
      return this.memories.delete(idOrFilter);
    }

    let deletedAny = false;
    for (const [id, item] of this.memories.entries()) {
      if (idOrFilter.id && item.id !== idOrFilter.id) continue;
      if (idOrFilter.scope && item.scope !== idOrFilter.scope) continue;
      if (idOrFilter.type && item.type !== idOrFilter.type) continue;
      this.memories.delete(id);
      deletedAny = true;
    }
    return deletedAny;
  }

  /**
   * Limpa todas as memórias da sessão atual (memórias temporárias/ephemeral)
   */
  public clearSessionMemory(sessionId?: string): void {
    const targetSession = sessionId ?? this.defaultSessionId;
    for (const [id, item] of this.memories.entries()) {
      if (item.scope === "session" || item.scope === "task") {
        if (!targetSession || item.sessionId === targetSession) {
          this.memories.delete(id);
        }
      }
    }
  }

  /**
   * Define uma preferência durável do usuário
   */
  public setPreference(key: string, value: string, userId?: number | string): IrisMemoryItem {
    return this.remember({
      content: `Preferência do usuário: ${key} = ${value}`,
      type: "preference",
      scope: "user",
      source: "user_stated",
      userId: userId ?? this.defaultUserId,
      category: "preference",
      tags: ["preference", key],
      importance: 3,
    });
  }

  /**
   * Lista preferências do usuário
   */
  public getPreferences(userId?: number | string): IrisMemoryItem[] {
    return this.recall("", {
      type: "preference",
      scope: "user",
      userId: userId ?? this.defaultUserId,
    });
  }

  /**
   * Regra 2: A memória NUNCA executa ações diretamente.
   * Método de garantia arquitetural de imutabilidade de execução.
   */
  public readonly isExecutable = false;

  public canExecuteActions(): false {
    return false;
  }

  public canGrantAuthorization(): false {
    return false;
  }

  public canBypassPermissions(): false {
    return false;
  }

  /**
   * Registra histórico de tarefa concluída preservando contexto útil sem credenciais
   */
  public recordTaskHistory(
    task: { command: string; resultSummary: string },
    userId?: number | string
  ): IrisMemoryItem {
    return this.remember({
      content: `Tarefa executada: “${task.command}” → ${task.resultSummary}`,
      type: "ephemeral",
      scope: "session",
      source: "task_result",
      userId: userId ?? this.defaultUserId,
      category: "task_history",
      tags: ["task", "history"],
    });
  }

  /**
   * Recupera histórico de tarefas do usuário
   */
  public getTaskHistory(userId?: number | string): IrisMemoryItem[] {
    return this.recall("", {
      category: "task_history",
      userId: userId ?? this.defaultUserId,
    });
  }

  public size(): number {
    return this.memories.size;
  }
}
