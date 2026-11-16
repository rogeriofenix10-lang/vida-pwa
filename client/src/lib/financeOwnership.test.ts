import { describe, expect, it } from "vitest";
import {
  financeHolderLabel,
  matchesFinanceHolder,
  parseFinanceHolder,
  propagateDocumentHolder,
  type FinanceHolder,
} from "./financeOwnership";

describe("finance ownership helpers", () => {
  it("parses only supported select values and labels each holder", () => {
    expect(parseFinanceHolder("rogerio")).toBe("rogerio");
    expect(parseFinanceHolder("aline")).toBe("aline");
    expect(parseFinanceHolder("")).toBeUndefined();
    expect(parseFinanceHolder("unknown")).toBeUndefined();
    expect(parseFinanceHolder("Rogério")).toBeUndefined();

    expect(financeHolderLabel("rogerio")).toBe("Rogério");
    expect(financeHolderLabel("aline")).toBe("Aline");
    expect(financeHolderLabel()).toBe("Titular não definido");
  });

  it("matches all, Rogério, Aline and unassigned filters", () => {
    const rogerio = { holder: "rogerio" as const };
    const aline = { holder: "aline" as const };
    const unassigned: { holder?: FinanceHolder } = {};

    expect([rogerio, aline, unassigned].every((record) => matchesFinanceHolder(record, "all"))).toBe(true);
    expect(matchesFinanceHolder(rogerio, "rogerio")).toBe(true);
    expect(matchesFinanceHolder(aline, "rogerio")).toBe(false);
    expect(matchesFinanceHolder(aline, "aline")).toBe(true);
    expect(matchesFinanceHolder(rogerio, "aline")).toBe(false);
    expect(matchesFinanceHolder(unassigned, "unassigned")).toBe(true);
    expect(matchesFinanceHolder(rogerio, "unassigned")).toBe(false);
  });

  it("propagates to document rows and legacy expense IDs but preserves manual overrides", () => {
    const inheritedRow = {
      id: "entry-1",
      sourceDocumentId: "doc-1",
      holder: "rogerio" as const,
      description: "Compra vinculada",
    };
    const unassignedRow = {
      id: "entry-2",
      sourceDocumentId: "doc-1",
      description: "Linha sem titular",
    };
    const legacyRow = {
      id: "doc-1:expense:legacy-line",
      holder: "rogerio" as const,
      amount: 42,
    };
    const manualOverride = {
      id: "entry-manual",
      sourceDocumentId: "doc-1",
      holder: "aline" as const,
      description: "Titular alterado manualmente",
    };
    const otherDocumentRow = {
      id: "entry-other-document",
      sourceDocumentId: "doc-2",
      holder: "rogerio" as const,
    };
    const documentRecord = { id: "doc-1", holder: "rogerio" as const };
    const similarButNotLegacyId = {
      id: "doc-1:expenseful:line",
      holder: "rogerio" as const,
    };
    const entries = [
      inheritedRow,
      unassignedRow,
      legacyRow,
      manualOverride,
      otherDocumentRow,
      documentRecord,
      similarButNotLegacyId,
    ];

    const updated = propagateDocumentHolder(entries, "doc-1", "rogerio", "aline");

    expect(updated).not.toBe(entries);
    expect(updated[0]).toMatchObject({ holder: "aline", description: "Compra vinculada" });
    expect(updated[1]).toMatchObject({ holder: "aline", description: "Linha sem titular" });
    expect(updated[2]).toMatchObject({ holder: "aline", amount: 42 });
    expect(updated[3]).toBe(manualOverride);
    expect(updated[4]).toBe(otherDocumentRow);
    expect(updated[5]).toBe(documentRecord);
    expect(updated[6]).toBe(similarButNotLegacyId);

    expect(updated[0]).not.toBe(inheritedRow);
    expect(updated[1]).not.toBe(unassignedRow);
    expect(updated[2]).not.toBe(legacyRow);
    expect(inheritedRow.holder).toBe("rogerio");
    expect(unassignedRow.holder).toBeUndefined();
    expect(legacyRow.holder).toBe("rogerio");
  });

  it("removes the holder with an explicit undefined value without mutating entries", () => {
    const assignedRow = { id: "entry-1", sourceDocumentId: "doc-1", holder: "rogerio" as const };
    const entries = [assignedRow];

    const updated = propagateDocumentHolder(entries, "doc-1", "rogerio", undefined);

    expect(updated).not.toBe(entries);
    expect(updated[0]).not.toBe(assignedRow);
    expect(updated[0]).toHaveProperty("holder", undefined);
    expect(assignedRow.holder).toBe("rogerio");
  });

  it("preserves an explicit manual unassigned override and marks inherited ownership", () => {
    const inheritedRow = {
      id: "entry-inherited",
      sourceDocumentId: "doc-1",
      holder: "rogerio" as const,
      holderSource: "invoice" as const,
    };
    const manualUnassigned = {
      id: "entry-manual-unassigned",
      sourceDocumentId: "doc-1",
      holderSource: "manual" as const,
    };

    const updated = propagateDocumentHolder([inheritedRow, manualUnassigned], "doc-1", "rogerio", "aline");

    expect(updated[0]).toMatchObject({ holder: "aline", holderSource: "invoice" });
    expect(updated[1]).toBe(manualUnassigned);
    expect(updated[1].holder).toBeUndefined();
    expect(updated[1].holderSource).toBe("manual");
  });

  it("returns the original array when no eligible holder would change", () => {
    const alreadyNext = { id: "entry-next", sourceDocumentId: "doc-1", holder: "aline" as const };
    const manualOverride = { id: "entry-manual", sourceDocumentId: "doc-1", holder: "aline" as const };
    const unrelated = { id: "entry-other", sourceDocumentId: "doc-2", holder: "rogerio" as const };
    const entries = [alreadyNext, manualOverride, unrelated];

    const updated = propagateDocumentHolder(entries, "doc-1", "rogerio", "aline");

    expect(updated).toBe(entries);
    expect(updated[0]).toBe(alreadyNext);
    expect(updated[1]).toBe(manualOverride);
    expect(updated[2]).toBe(unrelated);
  });
});
