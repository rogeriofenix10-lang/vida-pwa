import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("navigation consolidated by module", () => {
  it("keeps one financial entry and no redundant Analysis, Files or Tools modal in Home", () => {
    const home = read("client/src/components/CommandCenter54.tsx");
    expect(home).not.toMatch(/activeView\s*===\s*["'](?:analises|arquivos|ferramentas)["']/);
    expect(home).not.toContain("Análises da Iris");
    expect(home).not.toContain("Finanças carregadas");
    expect(home).not.toContain("Arquivo catalogado");
    expect(home.match(/navigate\(["']\/financas["']\)/g)).toHaveLength(1);
    expect(home).toContain("Documentos e contratos");
    expect(home).toContain("Tarefas");
    expect(home).not.toContain("Radar do Iris");
  });

  it("keeps Documents a library, never a second financial ledger writer", () => {
    const docs = read("client/src/pages/DocumentVault.tsx");
    expect(docs).not.toMatch(/["']irisFinances["']/);
    expect(docs).not.toContain("Resumo financeiro");
    expect(docs).not.toContain("Reprocessar fatura");
    expect(docs).not.toContain("readFinancialDocument");
    expect(docs).toContain("Documentos e contratos");
    expect(docs).toContain("Contratos");
    expect(docs).toContain("Baixar arquivo original");
  });

  it("retains route compatibility and does not erase the existing financial storage", () => {
    const app = read("client/src/App.tsx");
    for (const route of ["/financas", "/financeiro", "/documentos", "/offline", "/google"]) expect(app).toContain(`path="${route}"`);
    const finance = read("client/src/pages/FinanceHub.tsx");
    expect(finance).toContain("irisFinances");
    expect(finance).toContain("FinanceMonthlyChart");
  });

  it("leaves only note creation in Offline while preserving legacy tasks for consultation", () => {
    const offline = read("client/src/pages/OfflineWorkspace.tsx");
    expect(offline).not.toContain('<option value="task">');
    expect(offline).toContain('kind: "note"');
    expect(offline).toContain('entry.kind === "task"');
    expect(offline).toContain("Tarefas antigas deste espaço");
    expect(offline).toContain('"offlineWorkspace"');
    expect(offline).toContain("não foram migrados nem excluídos");
  });
});
