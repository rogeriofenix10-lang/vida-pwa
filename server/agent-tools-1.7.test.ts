import { describe, expect, it } from "vitest";
import { listAgentTools, selectAgentTools, canToolExecute } from "./agent-tools";

describe("IRIS 1.7 real tools",()=>{
 it("registra tools reais",()=>{const names=listAgentTools().map(t=>t.name); expect(names).toEqual(expect.arrayContaining(["radar.create","memory.create","radar.complete"]));
  expect(names).toHaveLength(8);});
 it("seleciona memória para intenção explícita",()=>{expect(selectAgentTools({intent:"memory",objective:"guardar preferência",message:"guarde isto na memória",riskLevel:"low"}).map(t=>t.name)).toContain("memory.create");});
 it("seleciona conclusão do radar",()=>{expect(selectAgentTools({intent:"task",objective:"concluir tarefa",message:"marcar como concluída",riskLevel:"low"}).map(t=>t.name)).toContain("radar.complete");});
 it("exige scope para execução",()=>{expect(canToolExecute("memory.create",["radar:write"])).toBe(false); expect(canToolExecute("memory.create",["memory:write"])).toBe(true);});
});
