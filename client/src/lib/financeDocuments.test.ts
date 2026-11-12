import { describe, expect, it, vi, beforeEach } from "vitest";
vi.mock("./localOcr", () => ({ readDocumentText: vi.fn() }));
import { readDocumentText } from "./localOcr";
import { buildStatementEntries, groupExpenses, readFinancialDocument, type FinancialEntry } from "./financeDocuments";

const doc = { id: "doc-a", name: "fatura.pdf", kind: "financeiro", createdAt: "2028-05-01", institution: "Nubank", brand: "Mastercard", money: [{ source: "14/05 HOTEL ALFA R$ 80,00", date: "14/05", amount: 80, category: "Hotel" as const }, { source: "15/05 POSTO BETA R$ 40,00", date: "15/05", amount: 40, category: "Posto de combustível" as const }] };
beforeEach(() => vi.clearAllMocks());
describe("statement ledger integration", () => {
  it("reprocesses without duplicates and preserves manually reviewed category/status", () => {
    const first = buildStatementEntries<FinancialEntry>(doc, []);
    first[0].status = "paid";
    first[0].category = "Outros";
    const next = buildStatementEntries({ ...doc, money: [...doc.money].reverse() }, first);
    expect(next).toHaveLength(2);
    expect(next.find((item) => item.amount === 80)).toMatchObject({ status: "paid", category: "Outros", id: first[0].id });
    expect(next[0]).toMatchObject({ institution: "Nubank", brand: "Mastercard", purchaseDate: "15/05" });
  });
  it("does not merge legitimately repeated purchases and groups amounts in cents", () => {
    const entries = buildStatementEntries<FinancialEntry>({ ...doc, money: [doc.money[0], doc.money[0], doc.money[1]] }, []);
    expect(new Set(entries.map((item) => item.id)).size).toBe(3);
    expect(groupExpenses(entries).find((item) => item.category === "Hotel")).toMatchObject({ total: 160, count: 2 });
  });
  it("keeps the invoice due date separate from purchases while preserving manually edited due dates", () => {
    const datedDocument = { ...doc, statementDueAt: "2028-05-17" };
    const original = buildStatementEntries<FinancialEntry>(datedDocument, []);
    original[0].dueAt = "2026-11-02";
    original[0].status = "paid";
    original[0].category = "Outros";
    original[1].dueAt = "";

    const refreshed = buildStatementEntries(datedDocument, original);
    expect(refreshed.find((entry) => entry.amount === 80)).toMatchObject({
      id: original[0].id, dueAt: "2026-11-02", status: "paid", category: "Outros",
    });
    expect(refreshed.find((entry) => entry.amount === 40)).toMatchObject({
      id: original[1].id, dueAt: "",
    });
    const added = buildStatementEntries({ ...datedDocument, money: [doc.money[0]] }, []);
    expect(added[0].dueAt).toBe("");
  });
  it("keeps unrelated entries while removing obsolete rows from a successful reparse", () => {
    const original = buildStatementEntries<FinancialEntry>(doc, []);
    const unrelated = { ...original[0], id: "manual", sourceDocumentId: undefined };
    const next = buildStatementEntries({ ...doc, money: [doc.money[0]] }, [...original, unrelated]);
    expect(next.map((item) => item.id)).toEqual([original[0].id, "manual"]);
  });
  it("retries image OCR when the text layer has no transactions", async () => {
    vi.mocked(readDocumentText).mockResolvedValueOnce({ text: "FATURA SEM TABELA", method: "text-layer", confidence: 100, pages: 1 });
    vi.mocked(readDocumentText).mockResolvedValueOnce({ text: "14/05 HOTEL ALFA R$ 80,00", method: "ocr", confidence: 92, pages: 1 });
    const result = await readFinancialDocument(new File(["fake"], "fatura.pdf", { type: "application/pdf" }));
    expect(result.statement.expenses).toHaveLength(1);
    expect(readDocumentText).toHaveBeenLastCalledWith(expect.anything(), undefined, { forceOcr: true });
  });
  it("returns an explicitly labeled statement due date from the document text", async () => {
    vi.mocked(readDocumentText).mockResolvedValueOnce({
      text: "Vencimento: 17 MAI 2028\nTRANSAÇÕES\n14/05 HOTEL ALFA R$ 80,00",
      method: "text-layer", confidence: 100, pages: 1,
    });
    const result = await readFinancialDocument(new File(["fake"], "fatura.pdf", { type: "application/pdf" }));
    expect(result.statement.statementDueAt).toBe("2028-05-17");
  });
  it("does not substitute a reliable text layer with low-confidence OCR", async () => {
    vi.mocked(readDocumentText).mockResolvedValueOnce({ text: "FATURA SEM TABELA", method: "text-layer", confidence: 100, pages: 1 });
    vi.mocked(readDocumentText).mockResolvedValueOnce({ text: "14/05 HOTEL ALFA R$ 80,00", method: "ocr", confidence: 15, pages: 1 });
    const result = await readFinancialDocument(new File(["fake"], "fatura.pdf", { type: "application/pdf" }));
    expect(result.statement.expenses).toHaveLength(0);
    expect(result.reading.method).toBe("text-layer");
  });
});
