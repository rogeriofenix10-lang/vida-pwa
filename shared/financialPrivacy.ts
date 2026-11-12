import { CARD_INSTITUTIONS, CARD_BRANDS, redactFinancialIdentifiers } from "./cardStatement";

const privateField = /^(?:card_?number|account_?number|pan|last_?4|card_?last_?digits|account_?id|numero_?(?:cartao|conta)|agencia|agency_?number)$/i;
const freeTextField = /^(?:description|source|name|filename|extractedText|text|institution|brand|processingError|hash|warning|warnings|detail)$/i;

/** Only derived records are scrubbed. Original document Blobs remain separate and local. */
export function sanitizeFinancialRecords<T>(value: T): T {
  if (Array.isArray(value)) {
    const next = value.map((item) => sanitizeFinancialRecords(item));
    return (next.some((item, index) => item !== value[index]) ? next : value) as T;
  }
  if (!value || typeof value !== "object" ||
      (typeof Blob !== "undefined" && value instanceof Blob) || value instanceof Date) return value;
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (privateField.test(key)) { changed = true; continue; }
    let sanitized: unknown = item;
    if (typeof item === "string" && freeTextField.test(key)) {
      sanitized = redactFinancialIdentifiers(item);
      const knownInstitution = key === "institution" && (CARD_INSTITUTIONS as readonly string[]).includes(String(sanitized));
      const knownBrand = key === "brand" && (CARD_BRANDS as readonly string[]).includes(String(sanitized));
      if ((key === "institution" || key === "brand") && !knownInstitution && !knownBrand && /\d/.test(String(sanitized))) {
        sanitized = String(sanitized).replace(/\d[\d.\-/ ]*/g, "").trim() || undefined;
      }
    } else if (item && typeof item === "object") sanitized = sanitizeFinancialRecords(item);
    changed ||= sanitized !== item;
    next[key] = sanitized;
  }
  return (changed ? next : value) as T;
}
