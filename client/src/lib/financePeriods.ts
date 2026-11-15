import type { FinancialEntry } from "./financeDocuments";

export type FinancePeriodDocument = {
  id: string;
  createdAt: string;
  statementDueAt?: string;
};

type CalendarDate = {
  year: number;
  month: number;
  day: number;
  date: string;
};

type FullDateParse =
  | { kind: "valid"; value: CalendarDate }
  | { kind: "invalid" }
  | { kind: "unknown" };
type PurchaseDateParse =
  | { kind: "full"; value: CalendarDate }
  | { kind: "partial"; day: number; month: number }
  | { kind: "invalid" }
  | { kind: "unknown" };

const monthNumbers: Record<string, number> = {
  jan: 1,
  janeiro: 1,
  january: 1,
  fev: 2,
  fevereiro: 2,
  feb: 2,
  february: 2,
  mar: 3,
  marco: 3,
  march: 3,
  abr: 4,
  abril: 4,
  apr: 4,
  april: 4,
  mai: 5,
  maio: 5,
  may: 5,
  jun: 6,
  junho: 6,
  june: 6,
  jul: 7,
  julho: 7,
  july: 7,
  ago: 8,
  agosto: 8,
  aug: 8,
  august: 8,
  set: 9,
  setembro: 9,
  sep: 9,
  september: 9,
  out: 10,
  outubro: 10,
  oct: 10,
  october: 10,
  nov: 11,
  novembro: 11,
  november: 11,
  dez: 12,
  dezembro: 12,
  dec: 12,
  december: 12,
};

function normalizeMonthName(name: string): number | undefined {
  const key = name
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\.$/, "");
  return monthNumbers[key];
}

function makeCalendarDate(
  year: number,
  month: number,
  day: number,
): CalendarDate | undefined {
  if (
    !Number.isInteger(year) ||
    year < 1 ||
    year > 9999 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    !Number.isInteger(day) ||
    day < 1
  ) {
    return undefined;
  }
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (day > daysInMonth[month - 1]) return undefined;
  return {
    year,
    month,
    day,
    date: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

function parseFullDate(value: string): FullDateParse {
  const text = value.trim();
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const date = makeCalendarDate(
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
    );
    return date ? { kind: "valid", value: date } : { kind: "invalid" };
  }

  match = text.match(/^(\d{1,2})([/.\-])(\d{1,2})\2(\d{4})$/);
  if (match) {
    const date = makeCalendarDate(
      Number(match[4]),
      Number(match[3]),
      Number(match[1]),
    );
    return date ? { kind: "valid", value: date } : { kind: "invalid" };
  }

  const separatedMonth = text.match(
    /^(\d{1,2})\s*[/.-]\s*([\p{L}.]+)\s*[/.-]\s*(\d{4})$/u,
  );
  const writtenMonth = text.match(
    /^(\d{1,2})\s+(?:de\s+)?([\p{L}.]+)\s+(?:de\s+)?(\d{4})$/iu,
  );
  match = separatedMonth ?? writtenMonth;
  if (match) {
    const month = normalizeMonthName(match[2]);
    if (!month) return { kind: "invalid" };
    const date = makeCalendarDate(Number(match[3]), month, Number(match[1]));
    return date ? { kind: "valid", value: date } : { kind: "invalid" };
  }

  return { kind: "unknown" };
}

function parsePartialPurchaseDate(
  value: string,
): { day: number; month: number } | undefined {
  let match = value.trim().match(/^(\d{1,2})\s*[/.-]\s*(\d{1,2})$/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    return day >= 1 && day <= 31 && month >= 1 && month <= 12
      ? { day, month }
      : undefined;
  }

  const separatedMonth = value
    .trim()
    .match(/^(\d{1,2})\s*[/.-]\s*([\p{L}.]+)$/u);
  const writtenMonth = value
    .trim()
    .match(/^(\d{1,2})\s+(?:de\s+)?([\p{L}.]+)$/iu);
  match = separatedMonth ?? writtenMonth;
  if (!match) return undefined;
  const day = Number(match[1]);
  const month = normalizeMonthName(match[2]);
  return month && day >= 1 && day <= 31 ? { day, month } : undefined;
}

function parsePurchaseDate(value: string): PurchaseDateParse {
  const full = parseFullDate(value);
  if (full.kind === "valid") return { kind: "full", value: full.value };
  if (full.kind === "invalid") return { kind: "invalid" };
  const partial = parsePartialPurchaseDate(value);
  if (partial) return { kind: "partial", ...partial };

  // A date-shaped token with an unknown month is not safe to reinterpret.
  if (/^\d{1,2}\s*(?:[/.-]|\s)\s*[\p{L}.]+/iu.test(value.trim()))
    return { kind: "invalid" };
  return { kind: "unknown" };
}

function parseStoredDate(value: string): CalendarDate | undefined {
  const text = value.trim();
  const timestamp = text.match(/^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/i);
  if (timestamp) {
    if (parseFullDate(timestamp[1]).kind !== "valid") return undefined;
    const instant = new Date(text);
    if (Number.isNaN(instant.getTime())) return undefined;
    return makeCalendarDate(instant.getFullYear(), instant.getMonth() + 1, instant.getDate());
  }
  const parsed = parseFullDate(text);
  return parsed.kind === "valid" ? parsed.value : undefined;
}

function periodForDate(date: CalendarDate, basis: string, inferred: boolean) {
  return { date: date.date, month: date.date.slice(0, 7), basis, inferred };
}

function periodWithoutDate(basis: string, inferred = false) {
  return { basis, inferred };
}

/** Resolve the best defensible date for a ledger entry, without guessing upload months. */
export function getEntryPeriod(
  entry: FinancialEntry,
  documents: FinancePeriodDocument[],
): { date?: string; month?: string; basis: string; inferred: boolean } {
  const referenceDate = entry.referenceDate?.trim();
  if (referenceDate) {
    const parsed = parseFullDate(referenceDate);
    if (parsed.kind === "valid")
      return periodForDate(parsed.value, "Data de referência", false);
    return periodWithoutDate("Data de referência inválida");
  }

  if (entry.sourceDocumentId) {
    const purchaseDate = entry.purchaseDate?.trim();
    if (!purchaseDate) return periodWithoutDate("Data da compra não informada");

    const parsedPurchase = parsePurchaseDate(purchaseDate);
    if (parsedPurchase.kind === "full")
      return periodForDate(parsedPurchase.value, "Data da compra", false);
    if (parsedPurchase.kind === "invalid")
      return periodWithoutDate("Data da compra inválida");
    if (parsedPurchase.kind === "unknown")
      return periodWithoutDate("Ano da compra não identificado");

    const document = documents.find(
      (item) => item.id === entry.sourceDocumentId,
    );
    const dueDateText = document?.statementDueAt?.trim();
    const dueDate = dueDateText ? parseFullDate(dueDateText) : undefined;
    if (!dueDate || dueDate.kind !== "valid")
      return periodWithoutDate("Ano da compra não identificado");

    const year =
      dueDate.value.year - (parsedPurchase.month > dueDate.value.month ? 1 : 0);
    const inferredDate = makeCalendarDate(
      year,
      parsedPurchase.month,
      parsedPurchase.day,
    );
    if (!inferredDate)
      return periodWithoutDate("Ano da fatura (data da compra inválida)", true);
    return periodForDate(inferredDate, "Ano da fatura", true);
  }

  const dueAt = entry.dueAt?.trim();
  if (dueAt) {
    const parsed = parseFullDate(dueAt);
    if (parsed.kind === "valid")
      return periodForDate(parsed.value, "Data de vencimento", false);
    return periodWithoutDate("Data de vencimento inválida");
  }

  const createdAt = entry.createdAt?.trim();
  if (createdAt) {
    const parsed = parseStoredDate(createdAt);
    if (parsed) return periodForDate(parsed, "Data de cadastro", false);
    return periodWithoutDate("Data de cadastro inválida");
  }
  return periodWithoutDate("Data não informada");
}

/** Prefer the explicit invoice due date; use document registration date only as fallback. */
export function getDocumentMonth(
  doc: FinancePeriodDocument,
): string | undefined {
  const dueAt = doc.statementDueAt?.trim();
  if (dueAt) {
    const dueDate = parseFullDate(dueAt);
    if (dueDate.kind === "valid") return dueDate.value.date.slice(0, 7);
  }
  const createdAt = doc.createdAt?.trim();
  if (!createdAt) return undefined;
  return parseStoredDate(createdAt)?.date.slice(0, 7);
}

function amountInCents(amount: number): number | undefined {
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  const cents = Math.round((amount + Number.EPSILON) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : undefined;
}

export function summarizeEntries(entries: FinancialEntry[]): {
  income: number;
  expense: number;
  balance: number;
  incomeCount: number;
  expenseCount: number;
  openIncome: number;
  openExpense: number;
} {
  let incomeCents = 0;
  let expenseCents = 0;
  let openIncomeCents = 0;
  let openExpenseCents = 0;
  let incomeCount = 0;
  let expenseCount = 0;

  for (const entry of entries) {
    const cents = amountInCents(entry.amount);
    if (cents === undefined) continue;
    if (entry.type === "income") {
      incomeCents += cents;
      incomeCount++;
      if (entry.status === "open") openIncomeCents += cents;
    } else if (entry.type === "expense") {
      expenseCents += cents;
      expenseCount++;
      if (entry.status === "open") openExpenseCents += cents;
    }
  }

  return {
    income: incomeCents / 100,
    expense: expenseCents / 100,
    balance: (incomeCents - expenseCents) / 100,
    incomeCount,
    expenseCount,
    openIncome: openIncomeCents / 100,
    openExpense: openExpenseCents / 100,
  };
}

/** Build one row per calendar month; only ledger entries contribute, never invoice totals. */
export function buildMonthlySeries(
  entries: FinancialEntry[],
  documents: FinancePeriodDocument[],
  year: number,
): Array<{
  month: string;
  label: string;
  income: number;
  expense: number;
  balance: number;
  count: number;
}> {
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new RangeError("O ano precisa ser um inteiro entre 1 e 9999.");
  }

  const rows = Array.from({ length: 12 }, (_, index) => {
    const month = `${String(year).padStart(4, "0")}-${String(index + 1).padStart(2, "0")}`;
    return { month, incomeCents: 0, expenseCents: 0, count: 0 };
  });
  const rowByMonth = new Map(rows.map((row) => [row.month, row]));

  for (const entry of entries) {
    const period = getEntryPeriod(entry, documents);
    if (!period.month?.startsWith(`${String(year).padStart(4, "0")}-`))
      continue;
    const row = rowByMonth.get(period.month);
    const cents = amountInCents(entry.amount);
    if (!row || cents === undefined) continue;
    if (entry.type === "income") row.incomeCents += cents;
    else if (entry.type === "expense") row.expenseCents += cents;
    else continue;
    row.count++;
  }

  return rows.map(({ month, incomeCents, expenseCents, count }) => ({
    month,
    label: formatPeriodLabel(month),
    income: incomeCents / 100,
    expense: expenseCents / 100,
    balance: (incomeCents - expenseCents) / 100,
    count,
  }));
}

export function filterEntriesByMonth(
  entries: FinancialEntry[],
  documents: FinancePeriodDocument[],
  month: string,
): FinancialEntry[] {
  if (month === "all") return [...entries];
  if (month === "undated")
    return entries.filter((entry) => !getEntryPeriod(entry, documents).month);
  return entries.filter(
    (entry) => getEntryPeriod(entry, documents).month === month,
  );
}

export function formatPeriodLabel(month: string): string {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (
    !match ||
    Number(match[1]) < 1 ||
    Number(match[2]) < 1 ||
    Number(match[2]) > 12
  )
    return "Período inválido";
  const date = new Date(`${month}-01T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "Período inválido";
  return new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function localToday(): string {
  const today = new Date();
  return `${String(today.getFullYear()).padStart(4, "0")}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}
