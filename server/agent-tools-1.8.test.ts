import { describe, expect, it } from "vitest";
import { listAgentTools, selectAgentTools } from "./agent-tools";

describe("IRIS 1.8 tool registry", () => {
  it("exposes integrations without allowing arbitrary tools", () => {
    const names = listAgentTools().map(tool => tool.name);
    expect(names).toEqual(expect.arrayContaining(["documents.search", "external.search", "calendar.create", "communication.prepare"]));
    expect(names).not.toContain("shell.exec");
  });

  it("selects document search and communication preparation from explicit intent", () => {
    const docs = selectAgentTools({ intent:"buscar documentos", objective:"encontrar contrato", message:"buscar meu contrato pdf", riskLevel:"low" });
    expect(docs.map(t => t.name)).toContain("documents.search");

    const comm = selectAgentTools({ intent:"preparar mensagem", objective:"avisar cliente", message:"prepare um email para cliente", riskLevel:"medium" });
    expect(comm.map(t => t.name)).toContain("communication.prepare");
  });
});
