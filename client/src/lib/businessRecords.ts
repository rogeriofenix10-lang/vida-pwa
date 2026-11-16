import { csvCell } from "@/lib/irisLocalStore";

export const BUSINESS_CLIENT_FIELDS = [
  "name",
  "legalName",
  "tradeName",
  "document",
  "economicGroup",
  "address",
  "neighborhood",
  "number",
  "postalCode",
  "city",
  "state",
  "country",
  "contact",
  "phone",
  "whatsapp",
  "email",
  "stateRegistration",
  "status",
  "notes",
] as const;

export type BusinessClientField = (typeof BUSINESS_CLIENT_FIELDS)[number];
export type BusinessClientValues = Partial<Record<BusinessClientField, string>>;
export type BusinessKind = "cliente" | "fornecedor" | "pedido" | "comissao" | "meta" | "inadimplencia";

export const BUSINESS_CLIENT_FIELD_LABELS: Record<BusinessClientField, string> = {
  name: "Nome / pessoa de contato",
  legalName: "Razão social",
  tradeName: "Nome fantasia",
  document: "CNPJ / CPF",
  economicGroup: "Grupo econômico",
  address: "Endereço",
  neighborhood: "Bairro",
  number: "Número",
  postalCode: "CEP",
  city: "Cidade",
  state: "Estado / UF",
  country: "País",
  contact: "Contato",
  phone: "Telefone",
  whatsapp: "WhatsApp",
  email: "Email",
  stateRegistration: "Inscrição estadual",
  status: "Status",
  notes: "Observações",
};

export type BusinessRecord = BusinessClientValues & {
  id: string;
  kind: BusinessKind;
  name: string;
  company: string;
  amount: number;
  status: string;
  notes: string;
  createdAt: string;
  storageKey?: string;
  fileName?: string;
  fileMime?: string;
  localFileId?: string;
  remoteSyncedAt?: string;
  needsSync?: boolean;
  extraFields?: Record<string, string>;
  [key: string]: unknown;
};

export type BusinessClientLike = Partial<BusinessClientValues> & {
  id?: string;
  kind?: string;
  name?: string;
  company?: string;
  extraFields?: Record<string, string>;
  clientFields?: BusinessClientValues;
};

export type BusinessClientCandidate = {
  values: BusinessClientValues;
  extraFields: Record<string, string>;
  warnings: string[];
  selected: boolean;
  duplicateReason?: string;
  duplicateOf?: { id?: string; name: string; sourceIndex?: number };
  sourceLine?: number;
};

export type BusinessImportFile = {
  id: string;
  name: string;
  mime: string;
  size: number;
  hash: string;
  createdAt: string;
  blob: Blob;
  purpose: "client-import" | "record-attachment";
  relatedRecordIds?: string[];
};

function normalizedText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function clientValue(record: BusinessClientLike, field: BusinessClientField): string {
  const nested = record.clientFields?.[field];
  const direct = record[field];
  const value = typeof direct === "string" && direct.trim()
    ? direct
    : typeof nested === "string"
      ? nested
      : "";
  if (value.trim()) return value.trim();
  if (field === "legalName" && typeof record.company === "string") return record.company.trim();
  if (field === "name" && typeof record.name === "string") return record.name.trim();
  return "";
}

function clientDocumentKey(record: BusinessClientLike) {
  const digits = clientValue(record, "document").replace(/\D/g, "");
  return digits.length >= 8 ? digits : "";
}

function clientEmailKey(record: BusinessClientLike) {
  const value = clientValue(record, "email").trim().toLocaleLowerCase("pt-BR");
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : "";
}

function clientAddressKey(record: BusinessClientLike) {
  const explicit = clientValue(record, "address");
  const parts = [
    explicit,
    clientValue(record, "number"),
    clientValue(record, "neighborhood"),
    clientValue(record, "postalCode"),
  ].filter(Boolean);
  const address = normalizedText(parts.join(" "));
  const city = normalizedText(clientValue(record, "city"));
  const name = normalizedText(
    clientValue(record, "name") || clientValue(record, "legalName") || clientValue(record, "tradeName"),
  );
  return address.length >= 5 && city && name.length >= 3 ? { address, city, name } : null;
}

export function findBusinessClientDuplicate(
  candidate: BusinessClientLike,
  existing: readonly BusinessClientLike[],
): { record?: BusinessClientLike; reason: string } | undefined {
  const document = clientDocumentKey(candidate);
  const email = clientEmailKey(candidate);
  const address = clientAddressKey(candidate);
  for (const record of existing) {
    if (record.kind && record.kind !== "cliente") continue;
    if (document && document === clientDocumentKey(record)) {
      return { record, reason: "CNPJ/CPF igual" };
    }
    if (email && email === clientEmailKey(record)) {
      return { record, reason: "email igual" };
    }
    const otherAddress = clientAddressKey(record);
    if (address && otherAddress && address.name === otherAddress.name &&
        address.city === otherAddress.city && address.address === otherAddress.address) {
      return { record, reason: "nome e endereço/cidade iguais" };
    }
  }
  return undefined;
}

export function annotateBusinessClientDuplicates(
  candidates: readonly BusinessClientCandidate[],
  existing: readonly BusinessClientLike[],
): BusinessClientCandidate[] {
  const previous: Array<BusinessClientLike & { sourceIndex: number }> = [];
  return candidates.map((candidate, sourceIndex) => {
    const match = findBusinessClientDuplicate(candidate.values, existing) ??
      findBusinessClientDuplicate(candidate.values, previous);
    const result: BusinessClientCandidate = {
      ...candidate,
      duplicateReason: match?.reason,
      duplicateOf: match?.record
        ? { id: match.record.id, name: clientValue(match.record, "name") || clientValue(match.record, "legalName") || "Cliente existente" }
        : undefined,
    };
    previous.push({ ...candidate.values, kind: "cliente", sourceIndex });
    return result;
  });
}

export function businessClientMissingFields(values: BusinessClientValues): BusinessClientField[] {
  return BUSINESS_CLIENT_FIELDS.filter((field) => !String(values[field] ?? "").trim());
}

export function businessClientDisplayName(record: BusinessClientLike) {
  return clientValue(record, "name") || clientValue(record, "legalName") ||
    clientValue(record, "tradeName") || "Cliente sem nome";
}

export function mergeBusinessRecords(
  local: readonly BusinessRecord[],
  remote: readonly BusinessRecord[],
): BusinessRecord[] {
  const localById = new Map(local.map((item) => [item.id, item]));
  const remoteById = new Map(remote.map((item) => [item.id, item]));
  const ids = [...new Set([...local.map((item) => item.id), ...remote.map((item) => item.id)])];
  return ids.map((id) => {
    const localItem = localById.get(id);
    const remoteItem = remoteById.get(id);
    if (!localItem) return remoteItem!;
    if (!remoteItem) return localItem;
    const merged: BusinessRecord = { ...remoteItem, ...localItem };
    merged.extraFields = { ...(remoteItem.extraFields ?? {}), ...(localItem.extraFields ?? {}) };
    for (const field of BUSINESS_CLIENT_FIELDS) {
      const localValue = localItem[field];
      const remoteValue = remoteItem[field];
      if (localValue === undefined && remoteValue !== undefined) merged[field] = remoteValue;
    }
    merged.remoteSyncedAt = localItem.remoteSyncedAt ?? remoteItem.remoteSyncedAt;
    merged.needsSync = localItem.needsSync ?? remoteItem.needsSync;
    return merged;
  });
}

export function parseBusinessRemoteRow(row: Record<string, unknown>): BusinessRecord {
  let payload: Record<string, unknown> = {};
  if (row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)) {
    payload = row.payload as Record<string, unknown>;
  } else if (typeof row.payload === "string") {
    try {
      const parsed = JSON.parse(row.payload) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
    } catch {
      payload = {};
    }
  }
  const record: Record<string, unknown> = {
    ...payload,
    id: String(row.id ?? payload.id ?? ""),
    kind: ["cliente", "fornecedor", "pedido", "comissao", "meta", "inadimplencia"].includes(String(row.kind ?? payload.kind))
      ? String(row.kind ?? payload.kind)
      : "cliente",
    name: String(row.name ?? payload.name ?? ""),
    company: String(row.company ?? payload.company ?? ""),
    email: String(row.email ?? payload.email ?? ""),
    phone: String(row.phone ?? payload.phone ?? ""),
    notes: String(row.notes ?? payload.notes ?? ""),
    amount: Number(payload.amount ?? 0),
    status: String(payload.status ?? ""),
    createdAt: String(payload.createdAt ?? row.created_at ?? new Date().toISOString()),
    remoteSyncedAt: String(row.updated_at ?? payload.remoteSyncedAt ?? new Date().toISOString()),
    needsSync: false,
  };
  if (typeof record.extraFields !== "object" || !record.extraFields || Array.isArray(record.extraFields)) {
    record.extraFields = {};
  } else {
    record.extraFields = Object.fromEntries(
      Object.entries(record.extraFields as Record<string, unknown>).map(([key, value]) => [key, String(value ?? "")]),
    );
  }
  return record as BusinessRecord;
}

const REMOTE_CORE_FIELDS = new Set([
  "id", "kind", "name", "company", "email", "phone", "notes", "amount", "status",
  "createdAt", "remoteSyncedAt", "needsSync", "storageKey", "fileName", "fileMime", "localFileId",
  "localAttachment", "blob", "importFileHash", "importFileName",
]);

export function toBusinessRemoteRow(record: BusinessRecord, storageKey = record.storageKey) {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (REMOTE_CORE_FIELDS.has(key) || key.startsWith("local")) continue;
    if (value !== undefined) payload[key] = value;
  }
  payload.email = String(record.email ?? "");
  payload.phone = String(record.phone ?? "");
  payload.amount = record.amount;
  payload.status = record.status;
  payload.createdAt = record.createdAt;
  if (storageKey) {
    payload.storageKey = storageKey;
    payload.fileName = record.fileName;
    payload.fileMime = record.fileMime;
  }
  return {
    id: record.id,
    kind: record.kind,
    name: record.name,
    company: record.company,
    email: String(record.email ?? ""),
    phone: String(record.phone ?? ""),
    notes: record.notes,
    payload,
  };
}

export function filterBusinessClients(
  records: readonly BusinessRecord[],
  filters: { name?: string; group?: string; city?: string; state?: string },
) {
  const match = (value: unknown, query?: string) => !query?.trim() ||
    normalizedText(value).includes(normalizedText(query));
  return records.filter((record) => record.kind === "cliente" &&
    match([record.name, record.legalName, record.tradeName, record.company].filter(Boolean).join(" "), filters.name) &&
    match(record.economicGroup, filters.group) &&
    match(record.city, filters.city) &&
    match(record.state, filters.state));
}

export function businessClientExportRows(records: readonly BusinessRecord[]) {
  return records.filter((record) => record.kind === "cliente").map((record) => {
    const row: Record<string, string> = {};
    for (const field of BUSINESS_CLIENT_FIELDS) {
      const value = record[field];
      row[field] = typeof value === "string" ? value : "";
    }
    row.name = row.name || record.name || "";
    row.legalName = row.legalName || record.company || "";
    for (const [field, value] of Object.entries(record.extraFields ?? {})) {
      row[field] = String(value ?? "");
    }
    return row;
  });
}

export function businessClientExportCsv(records: readonly BusinessRecord[]) {
  const rows = businessClientExportRows(records);
  const extraColumns = [...new Set(rows.flatMap((row) => Object.keys(row).filter((key) =>
    !BUSINESS_CLIENT_FIELDS.includes(key as BusinessClientField),
  )))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const columns = [...BUSINESS_CLIENT_FIELDS, ...extraColumns];
  return `\uFEFF${[columns.map((field) => csvCell(BUSINESS_CLIENT_FIELD_LABELS[field as BusinessClientField] ?? field)).join(","),
    ...rows.map((row) => columns.map((field) => csvCell(row[field] ?? "")).join(",")),
  ].join("\r\n")}`;
}

export function businessClientExportJson(
  records: readonly BusinessRecord[],
  filters: { name?: string; group?: string; city?: string; state?: string } = {},
) {
  return {
    format: "iris-business-clients",
    version: 1,
    exportedAt: new Date().toISOString(),
    filters,
    clients: records.filter((record) => record.kind === "cliente").map((record) => ({ ...record })),
  };
}
