export type IntegrationStatus = "configured" | "not_configured";
export type IntegrationAdapter<TConfig = unknown> = { id: string; label: string; status: IntegrationStatus; capabilities: string[]; config?: TConfig };

export function getIntegrationAdapters(): IntegrationAdapter[] {
  return [
    { id: "calendar", label: "Agenda", status: "not_configured", capabilities: ["calendar.create", "calendar.read"] },
    { id: "search", label: "Pesquisa externa", status: process.env.IRIS_SEARCH_API_URL ? "configured" : "not_configured", capabilities: ["external.search"] },
    { id: "documents", label: "Documentos IRIS", status: "configured", capabilities: ["documents.search"] },
    { id: "communication", label: "Comunicação", status: "not_configured", capabilities: ["communication.prepare", "communication.send"] },
  ];
}

export async function externalSearch(query: string) {
  const endpoint = process.env.IRIS_SEARCH_API_URL;
  if (!endpoint) throw new Error("Pesquisa externa não configurada. Defina IRIS_SEARCH_API_URL no ambiente de produção.");
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", ...(process.env.IRIS_SEARCH_API_KEY ? { Authorization: `Bearer ${process.env.IRIS_SEARCH_API_KEY}` } : {}) }, body: JSON.stringify({ query }), signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Pesquisa externa indisponível (${response.status})`);
  return { query, data: await response.json() };
}
