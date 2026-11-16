import { describe, expect, it } from "vitest";
import { sanitizeFinancialRecords } from "@shared/financialPrivacy";
import {
  classifyDocument,
  folderForClassification,
  isContractDocument,
  isFinancialDocument,
  kindForClassification,
} from "./documentLibrary";

describe("document library classification", () => {
  it("classifies a contract as Contratos even when it contains invoice terms, dates, and amounts", () => {
    const text = [
      "CONTRATO DE PRESTAÇÃO DE SERVIÇOS",
      "Valor contratado: R$ 1.250,00. Vencimento: 15/05/2028.",
      "Fatura, cartão e transações mencionados como condições contratuais.",
      "Transações",
      "14/05 HOTEL ALFA R$ 80,00",
    ].join("\n");

    const classification = classifyDocument(
      { name: "acordo-servicos.pdf" },
      text,
    );

    expect(classification).toBe("contrato");
    expect(folderForClassification(classification)).toBe("Contratos");
    expect(kindForClassification(classification)).toBe("geral");
  });

  it("does not infer a financial document from a contract amount or date alone", () => {
    expect(
      classifyDocument(
        { name: "contrato-locacao.pdf" },
        "Contrato de locação residencial. Valor: R$ 1.250,00. Data: 15/05/2028.",
      ),
    ).toBe("contrato");
  });

  it("keeps ordinary card statements classified as financial documents", () => {
    expect(
      classifyDocument(
        { name: "fatura-cartao.pdf" },
        "Fatura do cartão. Vencimento 20/06/2028. Transações: compra no mercado.",
      ),
    ).toBe("financeiro");
  });

  it("uses safe folder metadata for contracts without treating them as finance", () => {
    const contract = { kind: "geral", folder: "Contratos" };
    expect(isContractDocument(contract)).toBe(true);
    expect(isFinancialDocument(contract)).toBe(false);
    expect(isFinancialDocument({ kind: "financeiro", folder: "Financeiro" })).toBe(true);
  });

  it("retains the contract folder and legacy Blob/storage key through privacy sanitization", () => {
    const blob = new Blob(["original"], { type: "application/pdf" });
    const document = {
      id: "legacy-document",
      name: "contrato.pdf",
      mime: "application/pdf",
      createdAt: "2026-11-15T00:00:00.000Z",
      kind: "geral",
      folder: "Contratos",
      blob,
      storageKey: "legacy/object/key",
      statementTotal: 300,
      money: [{ category: "Outros", amount: 300, source: "parcela contratual" }],
    };

    const [safe] = sanitizeFinancialRecords([document]);

    expect(safe.folder).toBe("Contratos");
    expect(safe.blob).toBe(blob);
    expect(safe.storageKey).toBe("legacy/object/key");
    expect(safe.statementTotal).toBe(300);
    expect(safe.money).toEqual(document.money);
  });
});
