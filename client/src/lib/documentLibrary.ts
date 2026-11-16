export type DocumentKind = "saude" | "financeiro" | "geral";
export type DocumentClassification = DocumentKind | "contrato";

const healthTerms =
  /exame|laudo|hemoglobina|glicose|colesterol|triglicer|press[aã]o|consulta|laborat[oó]rio/i;
const contractTerms =
  /\bcontratos?\b|\baditivos?\b|\bcl[aá]usulas?\b|\binstrumento\s+particular\b|\btermo\s+de\s+(?:loca[cç][aã]o|presta[cç][aã]o|servi[cç]os?|confidencialidade|ades[aã]o|rescis[aã]o|acordo)\b|\blocac[aã]o\s+residencial\b|\bpresta[cç][aã]o\s+de\s+servi[cç]os\b/i;
const financeTerms =
  /fatura|cart[aã]o|vencimento|parcela|estabelecimento|compra|lan[cç]amento|banco|visa|mastercard|elo|amex|extrato|transa[cç][oõ]es?/i;
const explicitFinanceTerms =
  /fatura|cart[aã]o|transa[cç][oõ]es?|extrato|lan[cç]amentos?/i;
const statementSectionTerms =
  /^\s*(?:transa[cç][oõ]es\b|compras\s*(?:\/\s*pagamentos?)?\b)/im;

/** Classifies only from wording; contracts win before any financial hints. */
export function classifyDocument(
  file: Pick<File, "name">,
  text: string,
): DocumentClassification {
  const combined = `${file.name} ${text}`;
  if (contractTerms.test(combined)) return "contrato";
  if (statementSectionTerms.test(text) && explicitFinanceTerms.test(combined)) {
    return "financeiro";
  }
  if (healthTerms.test(combined)) return "saude";
  if (financeTerms.test(combined)) return "financeiro";
  return "geral";
}

/** Keep the established kind values; contracts use a dedicated, backup-safe folder. */
export function kindForClassification(
  classification: DocumentClassification,
): DocumentKind {
  return classification === "contrato" ? "geral" : classification;
}

export function folderForClassification(
  classification: DocumentClassification,
): string {
  if (classification === "contrato") return "Contratos";
  if (classification === "saude") return "Exames";
  if (classification === "financeiro") return "Financeiro";
  return "Documentos";
}

export function isContractDocument(document: {
  folder?: string;
  classificationKind?: string;
}): boolean {
  return document.folder === "Contratos" || document.classificationKind === "contrato";
}

/** Folder fallback includes legacy records listed by FinanceHub as financial documents. */
export function isFinancialDocument(document: {
  kind?: string;
  folder?: string;
}): boolean {
  return document.kind === "financeiro" || document.folder === "Financeiro";
}

/** A content-only digest used for local duplicate detection; it includes no filename. */
export async function documentFileHash(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}
