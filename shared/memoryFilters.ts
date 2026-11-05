export type MemoryRecord = { id: number; content: string; source: string };

export function filterAndSortMemories(memories: MemoryRecord[], query: string, source: string, sort: "recent" | "alpha") {
  return memories.filter((memory) => memory.content.toLowerCase().includes(query.toLowerCase()) && (source === "all" || memory.source === source)).sort((a, b) => sort === "alpha" ? a.content.localeCompare(b.content, "pt-BR") : b.id - a.id);
}
