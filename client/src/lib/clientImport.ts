import { assertLocalFileSize } from "@/lib/irisLocalStore";
import { validateOfficeArchive } from "@/lib/officeArchive";
import {
  BUSINESS_CLIENT_FIELDS,
  BUSINESS_CLIENT_FIELD_LABELS,
  type BusinessClientCandidate,
  type BusinessClientField,
  type BusinessClientValues,
} from "@/lib/businessRecords";

export type ClientImportFormat = "CSV" | "JSON" | "XLSX" | "DOCX" | "TXT" | "PDF";
export type ClientImportResult = {
  format: ClientImportFormat;
  candidates: BusinessClientCandidate[];
  warnings: string[];
  method: "structured" | "text-layer" | "ocr";
  text?: string;
};

type RawRow = Record<string, unknown>;

const MAX_IMPORT_ROWS = 50_000;
const MAX_IMPORT_CLIENTS = 10_000;
const MAX_IMPORT_COLUMNS = 300;

function normalizeLabel(value: unknown) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const aliases: Record<BusinessClientField, string[]> = {
  name: ["nome", "cliente", "nome cliente", "nome do cliente", "nome completo", "pessoa", "pessoa de contato", "contact name", "customer name"],
  legalName: ["razao social", "nome empresarial", "nome legal", "empresa", "company", "legal name", "legalname", "nome razao social", "razao social nome"],
  tradeName: ["nome fantasia", "fantasia", "nome comercial", "trade name", "tradename", "nome de exibicao"],
  document: ["cnpj", "cpf", "cnpj cpf", "cpf cnpj", "documento", "documento fiscal", "tax id", "document"],
  economicGroup: ["grupo economico", "grupo empresarial", "grupo", "holding", "economic group", "economicgroup"],
  address: ["endereco", "logradouro", "rua", "avenida", "street", "address"],
  neighborhood: ["bairro", "neighborhood", "district"],
  number: ["numero", "número", "n", "no", "address number"],
  postalCode: ["cep", "codigo postal", "postal code", "zip", "zipcode", "postalcode"],
  city: ["cidade", "municipio", "município", "city", "town"],
  state: ["estado", "uf", "estado uf", "provincia", "state", "province"],
  country: ["pais", "país", "country"],
  contact: ["contato", "pessoa contato", "responsavel", "responsável", "contact", "representante"],
  phone: ["telefone", "tel", "fone", "telefone comercial", "telefone fixo", "phone", "mobile", "celular", "telefone celular"],
  whatsapp: ["whatsapp", "whats app", "numero whatsapp", "telefone whatsapp", "whatsapp phone"],
  email: ["email", "e mail", "correio eletronico", "correio eletrônico", "email address", "e mail address"],
  stateRegistration: ["inscricao estadual", "inscrição estadual", "ie", "registro estadual", "state registration", "stateregistration"],
  status: ["status", "situacao", "situação", "estado do cadastro", "cadastro status"],
  notes: ["observacoes", "observação", "observacoes adicionais", "notas", "anotacoes", "notes", "remarks", "comentarios", "comentários"],
};

const aliasLookup = new Map<string, BusinessClientField>();
for (const field of BUSINESS_CLIENT_FIELDS) {
  aliasLookup.set(normalizeLabel(field), field);
  aliasLookup.set(normalizeLabel(BUSINESS_CLIENT_FIELD_LABELS[field]), field);
  for (const alias of aliases[field]) aliasLookup.set(normalizeLabel(alias), field);
}

export function businessFieldForHeader(header: unknown): BusinessClientField | undefined {
  const normalized = normalizeLabel(header);
  const exact = aliasLookup.get(normalized);
  if (exact) return exact;
  if (normalized.includes("razao social")) return "legalName";
  if (normalized.includes("nome fantasia")) return "tradeName";
  if (normalized.includes("grupo economico")) return "economicGroup";
  if (/\b(?:cnpj|cpf)\b/.test(normalized)) return "document";
  if (normalized.includes("whatsapp")) return "whatsapp";
  if (normalized.includes("email") || normalized.includes("e mail")) return "email";
  if (normalized.includes("telefone") || normalized === "celular") return "phone";
  if (normalized.includes("inscricao estadual")) return "stateRegistration";
  if (normalized === "endereco completo") return "address";
  return undefined;
}

function valueToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function newCandidate(
  values: BusinessClientValues,
  extraFields: Record<string, string>,
  sourceLine?: number,
): BusinessClientCandidate {
  const name = values.name?.trim() || values.legalName?.trim() || values.tradeName?.trim();
  if (name && !values.name) values.name = name;
  return { values, extraFields, warnings: [], selected: true, sourceLine };
}

function candidateFromObject(row: RawRow, sourceLine?: number): BusinessClientCandidate {
  const values: BusinessClientValues = {};
  const extraFields: Record<string, string> = Object.create(null);
  for (const [originalKey, rawValue] of Object.entries(row)) {
    if (rawValue === null || rawValue === undefined) continue;
    if (["extraFields", "clientFields", "values"].includes(originalKey) &&
        typeof rawValue === "object" && !Array.isArray(rawValue)) {
      for (const [nestedKey, nestedValue] of Object.entries(rawValue as RawRow)) {
        const text = typeof nestedValue === "object" && nestedValue !== null
          ? JSON.stringify(nestedValue)
          : valueToText(nestedValue);
        const field = originalKey === "extraFields" ? undefined : businessFieldForHeader(nestedKey);
        if (field && text && !values[field]) values[field] = text;
        else if (text) extraFields[originalKey === "extraFields" ? nestedKey : `${originalKey}.${nestedKey}`] = text;
      }
      continue;
    }
    const text = typeof rawValue === "object" ? JSON.stringify(rawValue) : valueToText(rawValue);
    if (!text) continue;
    const field = businessFieldForHeader(originalKey);
    if (field && !values[field]) values[field] = text;
    else extraFields[String(originalKey).trim() || "Campo adicional"] = text;
  }
  return newCandidate(values, extraFields, sourceLine);
}

function rowCellsToObject(header: readonly unknown[], cells: readonly unknown[]): RawRow {
  const row: RawRow = Object.create(null);
  header.forEach((column, index) => {
    const title = valueToText(column);
    if (title) row[title] = cells[index];
  });
  return row;
}

function headerFieldCount(row: readonly unknown[]) {
  return row.filter((cell) => businessFieldForHeader(cell)).length;
}

export function parseBusinessRows(rows: readonly (readonly unknown[])[]): BusinessClientCandidate[] {
  const nonEmpty = rows.filter((row) => row.some((cell) => valueToText(cell)));
  if (!nonEmpty.length) return [];
  if (nonEmpty.length > MAX_IMPORT_ROWS) throw new Error(`O arquivo ultrapassa ${MAX_IMPORT_ROWS.toLocaleString("pt-BR")} linhas. Divida-o em lotes; nenhuma linha foi descartada silenciosamente.`);
  const headers = nonEmpty[0];
  if (headers.length > MAX_IMPORT_COLUMNS) throw new Error("O arquivo ultrapassa 300 colunas. Divida-o antes de importar.");
  const headerNames = headers.map(valueToText);
  if (headerNames.some((name) => !name) || new Set(headerNames.map(normalizeLabel)).size !== headerNames.length) {
    throw new Error("O cabeçalho contém colunas vazias ou repetidas. Corrija-o para preservar todos os campos.");
  }
  const recognized = headerFieldCount(headers);
  if (recognized < 1) return [];
  if (nonEmpty.length - 1 > MAX_IMPORT_CLIENTS) throw new Error("O lote ultrapassa 10.000 clientes. Divida-o; nenhum cliente foi importado parcialmente.");
  return nonEmpty.slice(1).map((row, index) => {
    if (row.length > headers.length) throw new Error(`A linha ${index + 2} tem mais colunas que o cabeçalho. Corrija o arquivo antes de salvar.`);
    return candidateFromObject(rowCellsToObject(headers, row), index + 2);
  }).filter((candidate) => BUSINESS_CLIENT_FIELDS.some((field) => candidate.values[field]) || Object.keys(candidate.extraFields).length > 0);
}

export function parseDelimitedRows(text: string, delimiter: string): string[][] {
  text = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let quoteClosed = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        if (!quoted && (cell.length > 0 || quoteClosed)) throw new Error("CSV inválido: aspas no meio de um campo. Nenhum cliente foi importado.");
        quoted = !quoted;
        quoteClosed = !quoted;
      }
    } else if (!quoted && character === delimiter) {
      row.push(cell.trim());
      cell = "";
      quoteClosed = false;
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some((value) => value)) rows.push(row);
      row = [];
      cell = "";
      quoteClosed = false;
    } else {
      if (quoteClosed && !/\s/.test(character)) throw new Error("CSV inválido: conteúdo após aspas fechadas. Corrija antes de importar.");
      cell += character;
    }
    if (rows.length > MAX_IMPORT_ROWS) throw new Error("CSV acima de 50.000 linhas. Divida o arquivo; nenhum cliente foi importado parcialmente.");
  }
  if (quoted) throw new Error("CSV inválido: campo com aspas sem fechamento. Corrija antes de importar.");
  row.push(cell.trim());
  if (row.some((value) => value)) rows.push(row);
  return rows;
}

function parseKnownLabelLine(line: string) {
  const words = [...line.matchAll(/\S+/gu)];
  let best: { label: string; field: BusinessClientField; value: string } | undefined;
  for (const word of words.slice(0, 6)) {
    const end = (word.index ?? 0) + word[0].length;
    const label = line.slice(0, end).trim();
    const field = aliasLookup.get(normalizeLabel(label));
    const value = line.slice(end).replace(/^[\s:=–—-]+/u, "").trim();
    if (field && value && (!best || normalizeLabel(label).length > normalizeLabel(best.label).length)) {
      best = { label, field, value };
    }
  }
  return best;
}

function chooseTextDelimiter(lines: string[]) {
  const candidateLines = lines.filter((line) => line.trim());
  const possible = [";", "\t", "|", ","];
  return possible
    .map((delimiter) => ({
      delimiter,
      score: candidateLines.filter((line) => line.includes(delimiter)).length,
    }))
    .filter((entry) => entry.score >= Math.min(2, candidateLines.length))
    .sort((left, right) => right.score - left.score)[0]?.delimiter;
}

function hasUsefulCandidate(candidate: BusinessClientCandidate) {
  return BUSINESS_CLIENT_FIELDS.some((field) => Boolean(candidate.values[field]?.trim())) || Object.keys(candidate.extraFields).length > 0;
}

export function parseBusinessText(text: string): BusinessClientCandidate[] {
  const cleanText = text.replace(/^\uFEFF/, "");
  const lines = cleanText.split(/\r?\n/);
  const delimiter = chooseTextDelimiter(lines);
  const firstNonEmpty = lines.find((line) => line.trim()) ?? "";
  if (delimiter && !/[:=]/.test(firstNonEmpty)) {
    const table = parseDelimitedRows(cleanText, delimiter);
    if (table.length > 1 && headerFieldCount(table[0]) > 0) {
      const parsed = parseBusinessRows(table);
      if (parsed.length) return parsed;
    }
  }

  const results: BusinessClientCandidate[] = [];
  let values: BusinessClientValues = {};
  let extraFields: Record<string, string> = {};
  let firstLine = 1;
  const flush = () => {
    const candidate = newCandidate({ ...values }, { ...extraFields }, firstLine);
    if (hasUsefulCandidate(candidate)) results.push(candidate);
    values = {};
    extraFields = {};
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    // DOCX parsers and some PDF text layers insert blank paragraphs between
    // every field. A new explicit client identity, not whitespace, separates rows.
    if (!line) return;
    const match = line.match(/^(?:[-*•]\s*)?([^:=]{1,80}?)\s*[:=]\s*(.*)$/);
    const loose = match ? undefined : parseKnownLabelLine(line);
    if (!match && !loose) return;
    const label = match ? match[1].trim() : loose!.label;
    const value = match ? match[2].trim() : loose!.value;
    const field = match ? businessFieldForHeader(label) : loose!.field;
    if ((field === "name" && values.name) || (field === "legalName" && values.legalName)) {
      flush();
      firstLine = index + 1;
    }
    if (field && values[field]) {
      if (field === "legalName" || field === "tradeName") {
        extraFields[label] = value;
      } else {
        extraFields[`${label} (adicional)`] = value;
      }
    } else if (field) {
      values[field] = value;
    } else if (value) {
      extraFields[label] = value;
    }
  });
  flush();
  return results;
}

function candidatesFromJsonValue(value: unknown, depth = 0): BusinessClientCandidate[] {
  if (depth > 12) throw new Error("JSON com estrutura muito profunda. Use uma lista de clientes simples.");
  if (Array.isArray(value)) {
    if (value.length > MAX_IMPORT_CLIENTS) throw new Error("O JSON ultrapassa 10.000 clientes por lote. Divida o arquivo antes de importar.");
    if (value.every((entry) => entry === null || typeof entry !== "object" || Array.isArray(entry))) return [];
    return value.flatMap((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const candidate = candidateFromObject(entry as RawRow, index + 1);
      return hasUsefulCandidate(candidate) ? [candidate] : [];
    });
  }
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const preferred = ["clientes", "clients", "customers", "contatos", "contacts", "records", "items", "data", "result"];
  for (const key of preferred) {
    if (key in record) {
      const nested = candidatesFromJsonValue(record[key], depth + 1);
      if (nested.length) return nested;
    }
  }
  const scalarEntries = Object.values(record).some((entry) => entry === null || ["string", "number", "boolean"].includes(typeof entry));
  if (scalarEntries) {
    const candidate = candidateFromObject(record);
    if (BUSINESS_CLIENT_FIELDS.some((field) => candidate.values[field])) return [candidate];
  }
  for (const nested of Object.values(record)) {
    const candidates = candidatesFromJsonValue(nested, depth + 1);
    if (candidates.length) return candidates;
  }
  return [];
}

export function parseBusinessJson(text: string): BusinessClientCandidate[] {
  const parsed = JSON.parse(text.replace(/^\uFEFF/, "")) as unknown;
  return candidatesFromJsonValue(parsed);
}

function combineCandidates(groups: readonly BusinessClientCandidate[][]) {
  return groups.flatMap((group) => group);
}

function formatForFile(file: Pick<File, "name" | "type">): ClientImportFormat {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "csv" || file.type === "text/csv") return "CSV";
  if (extension === "json" || file.type === "application/json") return "JSON";
  if (extension === "xlsx" || /spreadsheet|excel/.test(file.type)) return "XLSX";
  if (extension === "docx" || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "DOCX";
  if (extension === "pdf" || file.type === "application/pdf") return "PDF";
  if (extension === "txt" || file.type.startsWith("text/")) return "TXT";
  throw new Error("Formato não suportado. Use PDF, CSV, JSON, TXT, XLSX ou DOCX.");
}

export function createTextImportResult(
  format: ClientImportFormat,
  text: string,
  method: ClientImportResult["method"],
  warnings: string[] = [],
): ClientImportResult {
  const candidates = parseBusinessText(text);
  if (!candidates.length) warnings.push("Nenhum registro de cliente com campos identificáveis foi encontrado. Confira o arquivo e os rótulos; nenhum campo foi inventado.");
  if (method === "ocr") {
    warnings.push("Texto lido por OCR: confira nomes, CNPJ/CPF, endereços e contatos antes de salvar.");
    for (const candidate of candidates) candidate.warnings.push("Leitura OCR: revise este registro antes de confirmar.");
  }
  if (warnings.some((warning) => /ambígu|baixa confiança|corrompido/i.test(warning))) {
    for (const candidate of candidates) candidate.warnings.push("Leitura potencialmente ambígua; revise os campos extraídos.");
  }
  return { format, candidates, warnings: [...new Set(warnings)], method, text };
}

export async function readClientImportFile(
  file: File,
  onProgress?: (message: string) => void,
): Promise<ClientImportResult> {
  assertLocalFileSize(file, "Arquivo de clientes");
  const format = formatForFile(file);
  if (format === "CSV") {
    const text = await file.text();
    const rows = parseDelimitedRows(text, chooseTextDelimiter(text.split(/\r?\n/)) ?? ",");
    const candidates = parseBusinessRows(rows);
    return {
      format,
      candidates,
      warnings: candidates.length ? [] : ["Não foi encontrado um cabeçalho reconhecível com campos de cliente no CSV."],
      method: "structured",
      text,
    };
  }
  if (format === "JSON") {
    const text = await file.text();
    let candidates: BusinessClientCandidate[] = [];
    try {
      candidates = parseBusinessJson(text);
    } catch {
      throw new Error("O JSON não pôde ser interpretado. Verifique a sintaxe e tente novamente.");
    }
    return {
      format,
      candidates,
      warnings: candidates.length ? [] : ["O JSON foi lido, mas não contém objetos de clientes com campos reconhecíveis."],
      method: "structured",
      text,
    };
  }
  if (format === "XLSX") {
    onProgress?.("Lendo todas as planilhas XLSX localmente…");
    await validateOfficeArchive(file);
    const excelModule = await import("read-excel-file/browser");
    const sheets = await excelModule.default(file);
    const groups = sheets.map((sheet) => parseBusinessRows(sheet.data as readonly (readonly unknown[])[]));
    const candidates = combineCandidates(groups);
    if (!candidates.length) return {
      format,
      candidates,
      warnings: ["As planilhas foram abertas, mas nenhuma linha tinha cabeçalhos identificáveis de cliente."],
      method: "structured",
    };
    const counts = sheets.length;
    return {
      format,
      candidates,
      warnings: counts > 1 ? [`Lidas ${counts} planilhas; confira cada registro antes de confirmar.`] : [],
      method: "structured",
    };
  }
  if (format === "DOCX") {
    onProgress?.("Extraindo o texto do DOCX neste dispositivo…");
    await validateOfficeArchive(file);
    const mammothModule = await import("mammoth/mammoth.browser.js");
    const mammothApi = (mammothModule.default ?? mammothModule) as unknown as {
      extractRawText: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string; messages?: Array<{ type?: string; message?: string }> }>;
    };
    const extracted = await mammothApi.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    const warnings = (extracted.messages ?? []).map((item) => item.message).filter((message): message is string => Boolean(message));
    return createTextImportResult(format, extracted.value, "text-layer", warnings);
  }
  if (format === "PDF") {
    onProgress?.("Lendo PDF e tentando OCR local, se necessário…");
    const { readDocumentText } = await import("@/lib/localOcr");
    const result = await readDocumentText(file, (progress) => {
      onProgress?.(`${progress.status}${progress.status.toLowerCase().includes("ocr") ? ` · ${Math.round(progress.progress * 100)}%` : ""}`);
    });
    const warnings = result.warning ? [result.warning] : [];
    if (result.text.length >= 300000) warnings.push("O leitor local atingiu seu limite explícito de 300.000 caracteres; confirme os dados no PDF original.");
    if (result.method === "empty") warnings.push("O PDF não contém texto reconhecível. Nenhum cliente foi preenchido automaticamente.");
    if (result.method === "ocr" && result.confidence < 85) warnings.push(`Confiança de OCR baixa (${Math.round(result.confidence)}%); os campos exigem revisão manual.`);
    return createTextImportResult(format, result.text, result.method === "ocr" ? "ocr" : "text-layer", warnings);
  }
  const text = await file.text();
  return createTextImportResult(format, text, "text-layer");
}
