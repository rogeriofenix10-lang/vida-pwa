export type FinanceHolder = "rogerio" | "aline";

export type FinanceHolderFilter = "all" | "combined" | FinanceHolder | "unassigned";

export function parseFinanceHolder(value: string): FinanceHolder | undefined {
  if (value === "rogerio" || value === "aline") return value;
  return undefined;
}

export function financeHolderLabel(holder?: FinanceHolder): string {
  if (holder === "rogerio") return "Rogério";
  if (holder === "aline") return "Aline";
  return "Titular não definido";
}

export function matchesFinanceHolder(
  record: { holder?: FinanceHolder },
  filter: FinanceHolderFilter,
): boolean {
  if (filter === "all" || filter === "combined") return true;
  if (filter === "unassigned") return record.holder === undefined;
  return record.holder === filter;
}

export function propagateDocumentHolder<
  T extends { id: string; sourceDocumentId?: string; holder?: FinanceHolder; holderSource?: "invoice" | "manual" },
>(
  entries: T[],
  documentId: string,
  previousHolder: FinanceHolder | undefined,
  nextHolder: FinanceHolder | undefined,
): T[] {
  let updatedEntries: T[] | undefined;
  const legacyExpensePrefix = `${documentId}:expense:`;

  entries.forEach((entry, index) => {
    const belongsToDocument =
      entry.sourceDocumentId === documentId || entry.id.startsWith(legacyExpensePrefix);
    const canInheritHolder =
      belongsToDocument && entry.holderSource !== "manual" && (entry.holder === undefined || entry.holder === previousHolder);

    if (!canInheritHolder || entry.holder === nextHolder) return;

    updatedEntries ??= entries.slice();
    updatedEntries[index] = { ...entry, holder: nextHolder, holderSource: "invoice" } as T;
  });

  return updatedEntries ?? entries;
}
