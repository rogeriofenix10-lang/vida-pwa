import { describe, expect, it, vi, beforeEach } from "vitest";
vi.mock("./localOcr", () => ({ readDocumentText: vi.fn() }));
import { readDocumentText } from "./localOcr";
import { buildStatementEntries, groupExpenses, preserveBlockedStatementData, readFinancialDocument, type FinancialEntry } from "./financeDocuments";

const doc = { id: "doc-a", name: "fatura.pdf", kind: "financeiro", createdAt: "2028-05-01", institution: "Nubank", brand: "Mastercard", money: [{ source: "14/05 HOTEL ALFA R$ 80,00", date: "14/05", amount: 80, category: "Hotel" as const }, { source: "15/05 POSTO BETA R$ 40,00", date: "15/05", amount: 40, category: "Posto de combustível" as const }] };
beforeEach(() => vi.clearAllMocks());
describe("statement ledger integration", () => {
  it("reprocesses without duplicates and preserves manually reviewed category/status", () => {
    const first = buildStatementEntries<FinancialEntry>(doc, []);
    expect(first[0].sourceLineKey).toEqual(expect.any(String));
    first[0].status = "paid";
    first[0].category = "Outros";
    const next = buildStatementEntries({ ...doc, money: [...doc.money].reverse() }, first);
    expect(next).toHaveLength(2);
    expect(next.find((item) => item.amount === 80)).toMatchObject({ status: "paid", category: "Outros", id: first[0].id });
    expect(next[0]).toMatchObject({ institution: "Nubank", brand: "Mastercard", purchaseDate: "15/05" });
  });
  it("applies an identified invoice holder to its expenses and preserves a reviewed expense override", () => {
    const imported = buildStatementEntries<FinancialEntry>({ ...doc, holder: "aline" }, []);
    expect(imported.map((entry) => entry.holder)).toEqual(["aline", "aline"]);
    expect(imported.map((entry) => entry.holderSource)).toEqual(["invoice", "invoice"]);

    imported[0].holder = "rogerio";
    imported[0].holderSource = "manual";
    const reread = buildStatementEntries({ ...doc, holder: "aline", money: [...doc.money].reverse() }, imported);
    expect(reread.find((entry) => entry.amount === 80)?.holder).toBe("rogerio");
    expect(reread.find((entry) => entry.amount === 40)?.holder).toBe("aline");
  });
  it("does not reassign an expense that was explicitly left without a holder", () => {
    const imported = buildStatementEntries<FinancialEntry>({ ...doc, holder: "rogerio" }, []);
    imported[0].holder = undefined;
    imported[0].holderSource = "manual";

    const reread = buildStatementEntries({ ...doc, holder: "aline" }, imported);

    expect(reread.find((entry) => entry.amount === 80)).toMatchObject({ holder: undefined, holderSource: "manual" });
    expect(reread.find((entry) => entry.amount === 40)).toMatchObject({ holder: "aline", holderSource: "invoice" });
  });
  it("preserves prior period metadata and ownership after an empty or blocked reparse", () => {
    const previous = {
      money: doc.money,
      total: 120,
      institution: "Nubank",
      brand: "Mastercard",
      statementTotal: 160,
      statementDueAt: "2028-05-17",
      holder: "rogerio" as const,
      holderSource: "manual" as const,
      extractedText: "Titular: Rogério",
      analysis: "texto extraído",
      confidence: 0.96,
      warnings: ["Aviso anterior"],
    };
    const attempted = {
      ...previous,
      money: [doc.money[1]],
      total: 40,
      institution: undefined,
      brand: undefined,
      statementTotal: 40,
      statementDueAt: "2028-06-18",
      holder: "aline" as const,
      holderSource: "statement" as const,
      extractedText: "Titular: Aline",
      analysis: "OCR novo",
      confidence: 0.22,
      warnings: ["Aviso novo"],
    };

    const preserved = preserveBlockedStatementData(attempted, previous, "Releitura não conciliada");

    expect(preserved).toMatchObject({
      money: previous.money,
      total: 120,
      institution: "Nubank",
      brand: "Mastercard",
      statementTotal: 160,
      statementDueAt: "2028-05-17",
      holder: "rogerio",
      holderSource: "manual",
      extractedText: "Titular: Rogério",
      confidence: 0.96,
      warnings: ["Aviso anterior", "Releitura não conciliada"],
    });

    expect(preserveBlockedStatementData({ ...attempted, statementDueAt: "2028-07-01" }, { ...previous, statementDueAt: undefined }, "Sem vencimento anterior").statementDueAt).toBeUndefined();
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
  it("returns the same array without dropping rows when a reparse is partial", () => {
    const original = buildStatementEntries<FinancialEntry>(doc, []);
    const unrelated = { ...original[0], id: "manual", sourceDocumentId: undefined };
    const current = [...original, unrelated];
    const next = buildStatementEntries({ ...doc, money: [doc.money[0]] }, current);
    expect(next).toBe(current);
    expect(next.map((item) => item.id)).toEqual([original[0].id, original[1].id, "manual"]);
  });
  it("matches signed source lines after description and amount edits, preserving those edits", () => {
    const original = buildStatementEntries<FinancialEntry>(doc, []);
    Object.assign(original[0], {
      description: "Minha descrição revisada",
      amount: 91.25,
      category: "Outros",
      status: "paid",
      referenceDate: "2028-06-02",
    });
    const refreshed = buildStatementEntries(doc, original);
    expect(refreshed).not.toBe(original);
    expect(refreshed.find((entry) => entry.id === original[0].id)).toMatchObject({
      description: "Minha descrição revisada",
      amount: 91.25,
      category: "Outros",
      status: "paid",
      referenceDate: "2028-06-02",
    });
  });
  it("aborts safely when an unsigned legacy row was manually edited", () => {
    const original = buildStatementEntries<FinancialEntry>(doc, []);
    const legacy = original.map(({ sourceLineKey: _sourceLineKey, ...entry }) => entry);
    legacy[0].description = "Descrição manual desconhecida";
    legacy[0].amount = 99;
    const next = buildStatementEntries(doc, legacy);
    expect(next).toBe(legacy);
    expect(next[0]).toMatchObject({ description: "Descrição manual desconhecida", amount: 99 });
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
