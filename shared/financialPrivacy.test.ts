import { describe, expect, it } from "vitest";
import { sanitizeFinancialRecords } from "./financialPrivacy";

describe("derived financial privacy", () => {
  it("scrubs full and masked card numbers, account fields and nested sources", () => {
    const data = { name: "fatura-cartao-4111111111111111.pdf", cardNumber: "4111111111111111", accountNumber: "12345-6", institution: "Banco Inter conta 12345-6", money: [{ source: "14 MAI •••• 4321 HOTEL CENTRAL R$ 80,00", amount: 80, date: "14/05/2028" }], extractedText: "Agência: 1234 Conta: 12345-6\nMastercard •••• 4321\n14/05 HOTEL CENTRAL R$ 80,00" };
    const safe = sanitizeFinancialRecords(data);
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain("4111111111111111");
    expect(serialized).not.toContain("4321");
    expect(serialized).not.toContain("12345-6");
    expect(serialized).not.toContain('"cardNumber"');
    expect(safe.money[0].amount).toBe(80);
    expect(safe.money[0].date).toBe("14/05/2028");
    expect(serialized).toContain("80,00");
    expect(serialized).toContain("HOTEL CENTRAL");
  });
  it("preserves the original local file independently and is idempotent", () => {
    const blob = new Blob(["original local document"]);
    const safe = sanitizeFinancialRecords({ name: "fatura.pdf", blob, description: "Cartão final 4321" });
    expect(safe.blob).toBe(blob);
    expect(sanitizeFinancialRecords(safe)).toBe(safe);
  });
  it("keeps the literal institution C6 Bank but not masked suffixes without a space", () => {
    const safe = sanitizeFinancialRecords({ institution: "C6 Bank", source: "15 MAI ••••4321 Restaurante Central R$ 70,00" });
    expect(safe.institution).toBe("C6 Bank");
    expect(safe.source).not.toContain("4321");
    expect(safe.source).toContain("70,00");
  });
  it("removes the suffix in named card metadata without deleting the known brand", () => {
    const safe = sanitizeFinancialRecords({ brand: "Visa", description: "Cartão Visa final 4321 · Hotel Exemplo" });
    expect(safe.brand).toBe("Visa");
    expect(safe.description).not.toContain("4321");
    expect(safe.description).toContain("Hotel Exemplo");
  });
});
