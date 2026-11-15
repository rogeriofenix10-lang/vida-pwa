import { readDocumentText, type DocumentReadResult, type OcrProgress } from "./localOcr";
import { parseCardStatement, redactFinancialIdentifiers } from "@shared/cardStatement";
import { EXPENSE_CATEGORIES, type ExpenseCategory, type ParsedExpense } from "@shared/expenseParser";

export const INCOME_CATEGORIES = [
  "Salário",
  "Vendas",
  "Serviços",
  "Comissões",
  "Reembolso",
  "Rendimentos",
  "Outros",
] as const;

export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];
export type FinanceCategory = ExpenseCategory | IncomeCategory;

export type FinancialEntry = {
  id: string;
  type: "expense" | "income";
  description: string;
  amount: number;
  category?: FinanceCategory;
  status: "open" | "paid" | "overdue";
  createdAt: string;
  dueAt: string;
  referenceDate?: string;
  source?: string;
  sourceDocumentId?: string;
  purchaseDate?: string;
  sourceLineKey?: string;
  institution?: string;
  brand?: string;
};

type StatementDocument = {
  id: string; name: string; createdAt: string; kind?: string;
  money: ParsedExpense[]; institution?: string; brand?: string;
};

const isReliable = (reading: DocumentReadResult) =>
  Boolean(reading.text.trim()) && (reading.method !== "ocr" || reading.confidence >= 45);

/** Local text first; retry the actual PDF images if no transaction could be read. */
export async function readFinancialDocument(
  file: File,
  onProgress?: (progress: OcrProgress) => void,
  forceOcr = false,
) {
  let reading = await readDocumentText(file, onProgress, { forceOcr });
  let statement = parseCardStatement(reading.text);
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (isPdf && !forceOcr && (!statement.expenses.length || !isReliable(reading))) {
    onProgress?.({ status: "Conferindo a imagem das páginas para encontrar transações", progress: 0 });
    try {
      const fallback = await readDocumentText(file, onProgress, { forceOcr: true });
      const retried = parseCardStatement(fallback.text);
      if (isReliable(fallback) && (!isReliable(reading) || retried.expenses.length > statement.expenses.length)) {
        reading = fallback;
        statement = retried;
      } else if (fallback.warning) {
        reading = { ...reading, warning: [reading.warning, fallback.warning].filter(Boolean).join(" ") };
      }
    } catch {
      reading = { ...reading, warning: [reading.warning, "A segunda leitura por imagem não concluiu; confira o documento ou tente OCR novamente."].filter(Boolean).join(" ") };
    }
  }
  return { reading, statement, reliable: isReliable(reading) };
}

/** Digest contains no filename, account or card identifier. */
export async function financialFileHash(file: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

const lineKey = (date: string | undefined, source: string, amount: number) =>
  JSON.stringify([date ?? "", redactFinancialIdentifiers(source).replace(/\s+/g, " ").trim(), amount.toFixed(2)]);

/** Reparse replaces only this document's rows when every prior row is safely matched. */
export function buildStatementEntries<T extends FinancialEntry>(document: StatementDocument, current: T[]): T[] {
  const prefix = `${document.id}:expense:`;
  const previous = current.filter((entry) => entry.sourceDocumentId === document.id || entry.id.startsWith(prefix));
  const retained = current.filter((entry) => entry.sourceDocumentId !== document.id && !entry.id.startsWith(prefix));
  const unmatched = [...previous];
  const usedIds = new Set(current.map((entry) => entry.id));
  const lines = document.kind === "financeiro" ? document.money : [];
  const generated = lines.map((line): T => {
    const signature = lineKey(line.date, line.source, line.amount);
    let matchIndex = unmatched.findIndex((entry) => entry.sourceLineKey === signature);
    if (matchIndex < 0) matchIndex = unmatched.findIndex((entry) => lineKey(entry.purchaseDate, entry.description, entry.amount) === signature);
    // Legacy entries did not store a purchase date.
    if (matchIndex < 0) matchIndex = unmatched.findIndex((entry) => !entry.purchaseDate &&
      redactFinancialIdentifiers(entry.description) === redactFinancialIdentifiers(line.source) && entry.amount === line.amount);
    const old = matchIndex >= 0 ? unmatched.splice(matchIndex, 1)[0] : undefined;
    let id = old?.id;
    if (!id) {
      let index = 0;
      while (usedIds.has(`${prefix}${index}`)) index++;
      id = `${prefix}${index}`;
      usedIds.add(id);
    }
    return {
      ...old,
      id, type: old?.type ?? "expense", description: old?.description ?? redactFinancialIdentifiers(line.source),
      amount: old?.amount ?? line.amount, category: old?.category ?? line.category,
      status: old?.status ?? "open", createdAt: old?.createdAt ?? document.createdAt,
      dueAt: old?.dueAt ?? "", source: redactFinancialIdentifiers(document.name),
      sourceDocumentId: document.id, purchaseDate: old?.purchaseDate ?? line.date,
      sourceLineKey: signature,
      institution: old?.institution ?? document.institution, brand: old?.brand ?? document.brand,
    } as T;
  });
  // If any old row cannot be reconciled, leave the ledger untouched for manual review.
  if (unmatched.length > 0) return current;
  return [...generated, ...retained];
}

export function groupExpenses(entries: FinancialEntry[]) {
  const map = new Map<ExpenseCategory, { category: ExpenseCategory; total: number; count: number; entries: FinancialEntry[] }>();
  for (const entry of entries.filter((item) => item.type === "expense")) {
    const category = entry.category && EXPENSE_CATEGORIES.includes(entry.category as ExpenseCategory)
      ? entry.category as ExpenseCategory
      : "Outros";
    const group = map.get(category) ?? { category, total: 0, count: 0, entries: [] };
    group.total = Math.round((group.total + entry.amount) * 100) / 100;
    group.count++;
    group.entries.push(entry);
    map.set(category, group);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}
