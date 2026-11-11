export type ExpenseCategory = "Hotel" | "Posto de combustível" | "Supermercado" | "Restaurante" | "Farmácia" | "Transporte" | "Serviços" | "Outros";
export type ParsedExpense = { category: ExpenseCategory; amount: number; source: string; date?: string };

const categories: Array<[ExpenseCategory, RegExp]> = [
  ["Hotel", /hotel|hosped|pousada|booking|airbnb/i],
  ["Posto de combustível", /posto|combust[ií]vel|gasolin|diesel|shell|ipiranga/i],
  ["Supermercado", /supermerc|carrefour|atacad|mercado|p[aã]o de a[cç][uú]car/i],
  ["Restaurante", /restaurante|lanch|ifood|outback|\bbar\b/i],
  ["Farmácia", /farm[aá]cia|droga|pharma/i],
  ["Transporte", /uber|\b99\b|t[aá]xi|ped[aá]gio|estacion/i],
  ["Serviços", /internet|telefone|energia|seguro|academia|servi[cç]o/i],
];
const summaryLine = /^(?:(?:valor|saldo)\s+(?:total|anterior|atual)|(?:sub\s*total|total|limite(?:\s+dispon[ií]vel)?|saldo(?:\s+anterior)?|pagamento\s+m[ií]nimo|resumo|troco))\b/i;

export function parseBrazilianAmount(raw: string): number {
  const value = raw.trim().replace(/^(?:R\$|BRL)\s*/i, "");
  return Number(value.includes(",") ? value.replace(/\./g, "").replace(",", ".") : value);
}

/** Candidates for review, not an accounting opinion. One final amount per transaction row. */
export function parseExpenseLines(text: string): ParsedExpense[] {
  const rows = text.split(/\r?\n/).map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const result: ParsedExpense[] = [];
  let previous = "";
  for (const row of rows) {
    if (summaryLine.test(row)) { previous = ""; continue; }
    const matches = [...row.matchAll(/(?:R\$|BRL)?\s*(-?(?:\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2}|\d+\.\d{2}))(?!\d)/gi)];
    if (!matches.length) { previous = row; continue; }
    const match = matches[matches.length - 1];
    const amount = parseBrazilianAmount(match[1]);
    if (!Number.isFinite(amount) || amount <= 0) { previous = ""; continue; }
    const context = /^[\sR$\d.,;\t-]+$/.test(row) && previous ? `${previous} ${row}` : row;
    // A line containing several establishments cannot be safely split without layout.
    const found = categories.filter(([, rule]) => rule.test(context));
    result.push({ category: found.length === 1 ? found[0][0] : "Outros", amount, source: context,
      ...(context.match(/\b(\d{2}\/\d{2}(?:\/\d{2,4})?)\b/) ? { date: context.match(/\b(\d{2}\/\d{2}(?:\/\d{2,4})?)\b/)![1] } : {}),
    });
    previous = "";
  }
  return result;
}
