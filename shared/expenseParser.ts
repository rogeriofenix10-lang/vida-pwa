export const EXPENSE_CATEGORIES = [
  "Hotel",
  "Posto de combustível",
  "Supermercado",
  "Restaurante",
  "Farmácia",
  "Transporte",
  "Serviços",
  "Saúde",
  "Compras",
  "Viagens",
  "Assinaturas",
  "Educação",
  "Lazer",
  "Tarifas e juros",
  "Outros",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type ParsedExpense = { category: ExpenseCategory; amount: number; source: string; date?: string };

const categoryRules: Array<[ExpenseCategory, RegExp]> = [
  ["Hotel", /hotel|hosped|pousada|booking|airbnb/i],
  ["Posto de combustível", /posto|combustiv|gasolin|diesel|shell|ipiranga/i],
  ["Supermercado", /supermerc|supermuffato|\bmuffato\b|\bcondor\b.*\bhiper\b|carrefour|atacad|mercado(?!\s+livre)|p[aã]o de a[cç][uú]car/i],
  ["Restaurante", /restaurante|lanch|ifood|outback|\bbar\b|cafeteria|padaria/i],
  ["Farmácia", /farm[aá]cia|droga|pharma/i],
  ["Transporte", /uber|\b99\b|t[aá]xi|ped[aá]gio|estacion|localiza|movida/i],
  ["Serviços", /internet|telefone|energia|seguro|academia|servi[cç]o|\bconta\s+vivo\b/i],
  ["Saúde", /sa[uú]de|hospital|cl[ií]nica|m[eé]dic|dentista|odont|laborat[oó]rio|consulta/i],
  ["Compras", /\b(loja(?!\s+sem\s+categoria\b)|shopping|compra|e-?commerce|varejo|marketplace|mercado livre|roupa|vestu[aá]rio|parafusos?)\b/i],
  ["Viagens", /viagem|passagem|a[eé]rea|companhia a[eé]rea|\b(latam|gol|azul|decolar|cvc)\b/i],
  ["Assinaturas", /assinatura|spotify|netflix|disney\s*\+?|prime video|youtube premium|icloud|deezer/i],
  ["Educação", /educa[cç][aã]o|escola|faculdade|universidade|curso|idioma|mensalidade escolar/i],
  ["Lazer", /lazer|cinema|teatro|parque|show|ingresso|boliche|videogame|games?/i],
  ["Tarifas e juros", /tarifa|anuidade|juros|\biof\b|multa|encargo financeiro|taxa de manuten[cç][aã]o/i],
];

const removedIdentifier = "[identificador financeiro removido]";
const redactedCnpjToken = "__CNPJ_PRESERVADO__";

/** Remove números de cartão e identificadores bancários rotulados sem alterar datas, valores ou parcelas. */
export function redactFinancialIdentifiers(text: string): string {
  const preservedCnpjs: string[] = [];
  let result = text.replace(/\b(CNPJ\s*[:#]?\s*)(\d[\d./\s-]{10,28}\d)\b/gi, (_match, label: string, digits: string) => {
    const token = `${redactedCnpjToken}${preservedCnpjs.length}__`;
    preservedCnpjs.push(`${label}${digits}`);
    return token;
  });

  const bankLabels = /\b(?:conta(?:\s+corrente|\s+poupan[cç]a)?|c\s*\/\s*c|ag[eê]ncia|ag\.?|c[oó]digo\s+(?:do\s+)?banco|n[uú]mero\s+(?:da\s+)?conta)\s*(?:n[º°.]?\s*)?[:#=\-]?\s*[0-9*Xx•●][0-9*Xx•● .-]{0,25}/gi;
  result = result.replace(bankLabels, match => match.replace(/[0-9*Xx•●][0-9*Xx•● .-]{0,25}$/, removedIdentifier));

  const cardLabels = /\b(?:n[uú]mero\s+do\s+)?cart[aã]o(?:\s+de\s+cr[eé]dito)?(?:\s+(?:final|termina(?:do)?\s+em|com\s+final))?\s*(?:final\s*)?[:#=\-]?\s*[0-9*Xx•●][0-9*Xx•● .-]{0,30}/gi;
  result = result.replace(cardLabels, match => match.replace(/[0-9*Xx•●][0-9*Xx•● .-]{0,30}$/, removedIdentifier));
  const namedFinal = /\b((?:(?:visa|master\s*card|mastercard|elo|amex|american\s+express|hipercard|diners\s+club|discover|nubank)\b[^\n]{0,24}?)?\b(?:cart[aã]o\b[^\n]{0,40}?)?\b(?:final|termina(?:do)?\s+em|ends?\s+in)\s*[:#=\-]?\s*)([*Xx•●]*\s*\d{1,8})\b/gi;
  result = result.replace(namedFinal, (_match, label: string) => `${label}${removedIdentifier}`);
  result = result.replace(/\bfinal\s+do\s+cart[aã]o\s*[:#=\-]?\s*[0-9*Xx•●][0-9*Xx•● .-]{0,24}/gi, match => match.replace(/[0-9*Xx•●][0-9*Xx•● .-]{0,24}$/, removedIdentifier));
  result = result.replace(/\b(?:banco\s*(?:n[º°.]?\s*)?[:#=\-]?\s*)\d{1,4}\b/gi, removedIdentifier);

  // Padrões de cartão parcialmente mascarados, com ou sem rótulo explícito.
  result = result.replace(/(^|[^\w])(?:\d{4}[ -]){1,3}(?:\d{4}|[*Xx•●]{4})(?!\w)/g, (_match, prefix: string) => `${prefix}${removedIdentifier}`);
  result = result.replace(/(^|[^\w])(?:[*Xx•●]{4}[ -]){1,3}\d{1,4}(?!\w)/g, (_match, prefix: string) => `${prefix}${removedIdentifier}`);
  result = result.replace(/[*Xx•●]{2,}[\s-]*\d{1,8}(?!\d)/g, removedIdentifier);

  // PAN de 13 a 19 dígitos, contínuos ou separados por espaços/hífens.
  result = result.replace(/(^|[^\d])((?:\d[ -]?){12,}\d)(?!\d)/g, (_match, prefix: string) => `${prefix}${removedIdentifier}`);

  // Códigos bancários numéricos podem vir sem o rótulo do campo em linhas de resumo.
  result = result.replace(/\b(?:c[oó]digo\s+)?banco\s*[:#=\-]?\s*\d{1,4}\b/gi, removedIdentifier);
  result = result.replace(new RegExp(`(?:${removedIdentifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*){2,}`, "g"), removedIdentifier);
  return result.replace(new RegExp(`${redactedCnpjToken}(\\d+)__`, "g"), (_token, index: string) => preservedCnpjs[Number(index)] ?? "");
}

function normalizeForMatching(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Categoriza somente quando há evidência determinística; descrições ambíguas permanecem como Outros. */
export function inferExpenseCategory(description: string): ExpenseCategory {
  const normalized = normalizeForMatching(description);
  if (categoryRules.find(([category]) => category === "Tarifas e juros")?.[1].test(normalized)) return "Tarifas e juros";
  const found = categoryRules.filter(([, rule]) => rule.test(normalized));
  return found.length === 1 ? found[0][0] : "Outros";
}

const summaryLine = /^\s*(?:(?:valor|saldo)\s+(?:total|anterior|atual)\b|(?:sub\s*total|total(?:\s+(?:da\s+)?fatura|\s+de\b|\s+das\b|\s+a\s+pagar\b)?|limite(?:\s+dispon[ií]vel)?|saldo(?:\s+anterior|\s+em\s+atraso)?|pagamento\s+m[ií]nimo|troco\b|resumo\b|pr[oó]ximas\s+faturas|fatura\b|valor\s+a\s+pagar)\b)/i;
const nonExpenseLine = /^\s*(?:(?:\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{1,2}\s+(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez))\s+)?(?:pagamentos?\b|cr[eé]dito\b|estorno\b|devolu[cç][aã]o\b|saldo\s+em\s+atraso\b|encerramento\s+de\s+d[ií]vida\b|transfer[eê]ncia\s+(?:de\s+)?saldo\b)/i;
const monthPattern = "jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez";
const datePattern = new RegExp(`\\b(\\d{2}\\/\\d{2}(?:\\/\\d{2,4})?|\\d{1,2}\\s+(?:${monthPattern})\\.?)\\b`, "i");
const allDatesPattern = new RegExp(`\\b\\d{2}\\/\\d{2}(?:\\/\\d{2,4})?\\b|\\b\\d{1,2}\\s+(?:${monthPattern})\\.?\\b`, "gi");
const amountPattern = /(?<![\w])((?:(?:[-−]\s*)?(?:R\$|BRL)\s*(?:[-−]\s*)?|(?:R\$|BRL)\s*(?:[-−]\s*)?|[-−]\s*)?)(\d{1,3}(?:\.\d{3})+(?:,\s?\d{1,2})?|\d+(?:[,.]\s?\d{1,2})?)(?![\d/.,])/gi;

export function parseBrazilianAmount(raw: string): number {
  let value = raw.trim().replace(/^(?:[-−]\s*)?(?:R\$|BRL)\s*/i, "").replace(/^(?:[-−]\s*)/, "").replace(/\s/g, "");
  const isNegative = /^[-−]/.test(raw.trim()) || /[-−]\s*$/.test(raw.trim().replace(/\d[\d.,\s]*$/, ""));
  value = value.replace(/^[+\-−]/, "");
  if (!value) return Number.NaN;

  const groupedBrazilian = /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(value);
  if (groupedBrazilian) {
    value = value.includes(",") ? value.replace(/\./g, "").replace(",", ".") : value.replace(/\./g, "");
  } else if (value.includes(",")) {
    if (!/^\d+,\d{1,2}$/.test(value)) return Number.NaN;
    value = value.replace(",", ".");
  } else if (value.includes(".")) {
    if (!/^\d+\.\d{1,2}$/.test(value)) return Number.NaN;
  } else if (!/^\d+$/.test(value)) {
    return Number.NaN;
  }

  const amount = Number(value);
  return isNegative ? -amount : amount;
}

type InternalParse = { expenses: ParsedExpense[]; firstSourceIndex?: number };

function amountMatches(row: string): Array<{ amount: number; index: number; end: number }> {
  const withoutDates = row
    .replace(allDatesPattern, " ")
    .replace(/\bparcela\s*:?\s*\d{1,2}\s*\/\s*\d{1,2}\b/gi, " [parcela] ")
    .replace(/([\p{L}\]])\s+-\s+(?=(?:R\$|BRL)\s*\d)/gu, "$1 · ");
  const result: Array<{ amount: number; index: number; end: number }> = [];
  amountPattern.lastIndex = 0;
  for (const match of withoutDates.matchAll(amountPattern)) {
    const prefix = match[1] ?? "";
    const amountText = match[2] ?? "";
    const end = (match.index ?? 0) + match[0].length;
    if (withoutDates.slice(end).trimStart().startsWith("%")) continue;
    const amount = parseBrazilianAmount(`${prefix}${amountText}`);
    if (Number.isFinite(amount)) result.push({ amount, index: match.index ?? 0, end });
  }
  return result;
}

function isInterestPercentageLine(row: string): boolean {
  return /\b(?:juros|taxa de juros|encargos)\b/i.test(row) && /%|\bpor\s+cento\b/i.test(row);
}

function normalizedRows(text: string): Array<{ text: string; index: number }> {
  return text.split(/\r?\n/).map((line, index) => ({
    text: redactFinancialIdentifiers(line).replace(/\s+/g, " ").trim(),
    index,
  })).filter(({ text: row }) => row.length > 0);
}

function parseExpenseLinesInternal(text: string): InternalParse {
  const rows = normalizedRows(text);
  const result: ParsedExpense[] = [];
  let previous = "";
  let previousIndex = -1;
  let firstSourceIndex: number | undefined;

  for (const { text: row, index } of rows) {
    if (row.replace(removedIdentifier, "").trim() === "") continue;
    if (summaryLine.test(row) || nonExpenseLine.test(row) || isInterestPercentageLine(row)) {
      previous = "";
      previousIndex = -1;
      continue;
    }

    const matches = amountMatches(row);
    if (!matches.length) {
      previous = row;
      previousIndex = index;
      continue;
    }

    const match = matches[matches.length - 1];
    if (match.amount <= 0) {
      previous = "";
      previousIndex = -1;
      continue;
    }
    const amountOnly = /^[\sR$+\-−0-9.,;:]+$/i.test(row);
    const context = amountOnly && previous ? `${previous} ${row}` : row;
    const sourceIndex = amountOnly && previousIndex >= 0 ? previousIndex : index;
    if (firstSourceIndex === undefined) firstSourceIndex = sourceIndex;
    const date = context.match(datePattern)?.[1];
    result.push({
      category: inferExpenseCategory(context),
      amount: match.amount,
      source: context,
      ...(date ? { date } : {}),
    });
    previous = "";
    previousIndex = -1;
  }
  return { expenses: result, firstSourceIndex };
}

/** Candidates for review, not an accounting opinion. One final amount per transaction row. */
export function parseExpenseLines(text: string): ParsedExpense[] {
  return parseExpenseLinesInternal(text).expenses;
}
