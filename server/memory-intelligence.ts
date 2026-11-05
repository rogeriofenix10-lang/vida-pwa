import type { MySql2Database } from "drizzle-orm/mysql2";
import { aiMemories } from "../drizzle/schema";
import { and, desc, eq, or, like } from "drizzle-orm";

export type MemoryCategory = "preference" | "person" | "business" | "project" | "routine" | "fact" | "instruction" | "other";

function normalize(s: string) { return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
function tokens(s: string) { return [...new Set(normalize(s).split(/[^a-z0-9]+/).filter(t => t.length >= 3))]; }

export function inferMemoryCategory(content: string): MemoryCategory {
  const t = normalize(content);
  if (/prefir|gosto|prefer|nao gosto|evit/.test(t)) return "preference";
  if (/empresa|cliente|venda|negocio|comercial|representa/.test(t)) return "business";
  if (/projeto|aplicativo|sistema|iris|software/.test(t)) return "project";
  if (/sempre|rotina|toda semana|todo dia|horario/.test(t)) return "routine";
  if (/meu nome|minha equipe|minha familia|meu contato/.test(t)) return "person";
  if (/deve|nao deve|instrucao|regra/.test(t)) return "instruction";
  return "fact";
}

export function memoryScore(content: string, query: string, importance = 0) {
  const q = tokens(query); if (!q.length) return 0;
  const c = normalize(content); let score = 0;
  for (const token of q) { if (c.includes(token)) score += 1 + Math.min(token.length / 20, .5); }
  return score + Math.max(0, Math.min(importance, 5)) * .15;
}

export async function retrieveRelevantMemories(db: MySql2Database<any>, userId: number, query: string, limit = 8) {
  const q = tokens(query);
  const conditions = q.length ? q.slice(0, 6).map(t => like(aiMemories.content, `%${t}%`)) : [];
  const rows = await db.select({ id: aiMemories.id, content: aiMemories.content, source: aiMemories.source, category: aiMemories.category, importance: aiMemories.importance, lastAccessedAt: aiMemories.lastAccessedAt })
    .from(aiMemories).where(and(eq(aiMemories.userId, userId), eq(aiMemories.archived, false), ...(conditions.length ? [or(...conditions)] : [])))
    .orderBy(desc(aiMemories.importance), desc(aiMemories.updatedAt)).limit(Math.max(limit * 4, 20));
  const ranked = rows.map(r => ({ ...r, score: memoryScore(r.content, query, r.importance) })).sort((a,b) => b.score - a.score || b.importance - a.importance).slice(0, limit);
  if (ranked.length) await db.update(aiMemories).set({ lastAccessedAt: new Date() }).where(and(eq(aiMemories.userId, userId), or(...ranked.map(r => eq(aiMemories.id, r.id)))));
  return ranked;
}
