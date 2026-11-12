import {
  parseBrazilianAmount,
  parseExpenseLines,
  redactFinancialIdentifiers,
  type ParsedExpense,
} from "./expenseParser";

export { redactFinancialIdentifiers } from "./expenseParser";

export const CARD_BRANDS = ["Visa", "Mastercard", "Elo", "American Express", "Hipercard", "Diners Club", "Discover"] as const;
export type CardBrand = (typeof CARD_BRANDS)[number];

export const CARD_INSTITUTIONS = [
  "Banco do Brasil",
  "Itaú",
  "Bradesco",
  "Santander",
  "Nubank",
  "Inter",
  "Caixa",
  "Sicredi",
  "Sicoob",
  "C6 Bank",
  "BTG Pactual",
  "Banrisul",
  "Banco PAN",
  "Original",
  "Safra",
  "Daycoval",
  "Banco BMG",
  "Banco BV",
  "Mercantil do Brasil",
  "Banco Votorantim",
  "Neon",
  "PagBank",
  "PicPay",
] as const;
export type CardInstitution = (typeof CARD_INSTITUTIONS)[number];

export type ParsedCardStatement = {
  expenses: ParsedExpense[];
  institution?: CardInstitution;
  brand?: CardBrand;
  statementTotal?: number;
  warnings: string[];
};

const monthNames = "JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ";
const datedRowPattern = new RegExp(`^\\s*(?:\\d{1,2}\\s+(?:${monthNames})\\b|\\d{2}\\/\\d{2}(?:\\/\\d{2,4})?\\b)`, "i");
const sectionStartPattern = /^\s*(?:transa[cç][õo]es\b|compras\b)/i;
const sectionEndPattern = /^\s*(?:resumo\b|pr[oó]ximas\s+faturas\b|limites\s+dispon[ií]veis\b|valor\s+m[aá]ximo\s+para\s+transa[cç][õo]es\b|alternativas\s+de\s+pagamento\b)/i;
const sectionMarkerPattern = /^\s*(?:transa[cç][õo]es\b|compras\s*(?:\/\s*pagamentos?)?\b)/i;

const institutionRules: Array<[CardInstitution, RegExp]> = [
  ["Banco do Brasil", /\bbanco\s+do\s+brasil\b|\bbanco\s+brasil\b/],
  ["Itaú", /\b(?:banco\s+)?itau(?:\s+unibanco)?\b/],
  ["Bradesco", /\b(?:banco\s+)?bradesco\b/],
  ["Santander", /\b(?:banco\s+)?santander\b/],
  ["Nubank", /\bnubank\b|\bnu\s+pagamentos(?:\s+s\s*a)?\b/],
  ["Inter", /\b(?:banco\s+)?inter\b/],
  ["Caixa", /\bcaixa(?:\s+econ[oô]mica(?:\s+federal)?)?\b/],
  ["Sicredi", /\bsicredi\b/],
  ["Sicoob", /\bsicoob\b/],
  ["C6 Bank", /\bc6\s*bank\b/],
  ["BTG Pactual", /\bbtg\s+pactual\b/],
  ["Banrisul", /\bbanrisul\b/],
  ["Banco PAN", /\bbanco\s+pan\b|\bpanamericano\b/],
  ["Original", /\bbanco\s+original\b|\boriginal\b/],
  ["Safra", /\b(?:banco\s+)?safra\b/],
  ["Daycoval", /\b(?:banco\s+)?daycoval\b/],
  ["Banco BMG", /\bbanco\s+bmg\b|\bbmg\b/],
  ["Banco BV", /\bbanco\s+bv\b|\bbv\s+financeira\b/],
  ["Mercantil do Brasil", /\bbanco\s+mercantil\s+do\s+brasil\b|\bmercantil\s+do\s+brasil\b/],
  ["Banco Votorantim", /\bbanco\s+votorantim\b/],
  ["Neon", /\bneon\s+pagamentos\b|\bbanco\s+neon\b/],
  ["PagBank", /\bpagbank\b|\bpags(?:eguro)?\s+internet\b/],
  ["PicPay", /\bpicpay\b/],
];

const brandRules: Array<[CardBrand, RegExp]> = [
  ["American Express", /\bamerican\s+express\b|\bamex\b/],
  ["Mastercard", /\bmaster\s*card\b|\bmastercard\b/],
  ["Diners Club", /\bdiners\s+club\b/],
  ["Hipercard", /\bhipercard\b/],
  ["Discover", /\bdiscover\b/],
  ["Elo", /\belo\b/],
  ["Visa", /\bvisa\b/],
];

function normalizeForLookup(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function extractHeaderMetadata(header: string): { institution?: CardInstitution; brand?: CardBrand } {
  const normalized = normalizeForLookup(header);
  const institution = institutionRules.find(([, rule]) => rule.test(normalized))?.[0];
  const brand = brandRules.find(([, rule]) => rule.test(normalized))?.[0];
  return { ...(institution ? { institution } : {}), ...(brand ? { brand } : {}) };
}

function transactionSectionText(text: string): { text: string; header: string; hasSections: boolean } {
  const lines = text.split(/\r?\n/);
  const firstMarker = lines.findIndex(line => sectionMarkerPattern.test(line));
  if (firstMarker < 0) return { text, header: "", hasSections: false };

  const transactions: string[] = [];
  let active = false;
  for (const line of lines) {
    if (sectionStartPattern.test(line)) {
      active = true;
      continue;
    }
    if (active && sectionEndPattern.test(line)) {
      active = false;
      continue;
    }
    if (active && datedRowPattern.test(line)) transactions.push(line);
  }
  return { text: transactions.join("\n"), header: lines.slice(0, firstMarker).join("\n"), hasSections: true };
}

const summaryTotalLabel = /^\s*(?:(?:valor\s+total\s+(?:da\s+)?fatura|total\s+(?:da\s+)?fatura|total\s+a\s+pagar|valor\s+a\s+pagar)\b)/i;
const currencyAmountPattern = /(?:[-−]\s*)?(?:R\$|BRL)\s*(?:[-−]\s*)?\d{1,3}(?:\.\d{3})*(?:,\s?\d{1,2})?|(?:[-−]\s*)?\d{1,3}(?:\.\d{3})*(?:,\s?\d{1,2})?/gi;

function extractStatementTotal(text: string): number | undefined {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!summaryTotalLabel.test(line)) continue;
    const matches = [...line.matchAll(currencyAmountPattern)];
    // Linhas de opções de parcelamento podem ter várias colunas e não representam o total da fatura.
    if (matches.length !== 1) continue;
    const amount = parseBrazilianAmount(matches[0][0]);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  return undefined;
}

function firstAmountLineIndex(text: string): number {
  const lines = text.split(/\r?\n/);
  return lines.findIndex(line => {
    if (/^\s*(?:total|valor|saldo|limite|resumo|pagamento\s+m[ií]nimo|fatura)\b/i.test(line)) return false;
    if (/^\s*(?:pagamento|pagamentos|cr[eé]dito|estorno|devolu[cç][aã]o|saldo\s+em\s+atraso|encerramento\s+de\s+d[ií]vida)\b/i.test(line)) return false;
    return /(?:R\$|BRL)\s*[-−]?\s*\d|\d{1,3}(?:\.\d{3})*,\s?\d{1,2}/i.test(line);
  });
}

/** Extrai candidatos determinísticos de uma fatura; dados brutos sensíveis não são devolvidos. */
export function parseCardStatement(text: string): ParsedCardStatement {
  const selection = transactionSectionText(text);
  const expenses = parseExpenseLines(selection.text);
  const firstTransactionIndex = selection.hasSections
    ? text.split(/\r?\n/).findIndex(line => sectionMarkerPattern.test(line))
    : firstAmountLineIndex(text);
  const header = selection.hasSections
    ? selection.header
    : firstTransactionIndex >= 0
      ? text.split(/\r?\n/).slice(0, firstTransactionIndex).join("\n")
      : text;
  const metadata = extractHeaderMetadata(redactFinancialIdentifiers(header));
  const statementTotal = extractStatementTotal(redactFinancialIdentifiers(text));
  const warnings: string[] = [];

  if (redactFinancialIdentifiers(text) !== text) warnings.push("Identificadores financeiros foram removidos antes de devolver os lançamentos.");
  if (selection.hasSections) warnings.push("Foram consideradas somente linhas datadas nas seções de transações/compras; pagamentos e continuações não são despesas.");
  if (expenses.length === 0) warnings.push("Nenhuma despesa de compra reconhecível foi encontrada para revisão.");

  return {
    expenses,
    ...(metadata.institution ? { institution: metadata.institution } : {}),
    ...(metadata.brand ? { brand: metadata.brand } : {}),
    ...(statementTotal !== undefined ? { statementTotal } : {}),
    warnings,
  };
}
