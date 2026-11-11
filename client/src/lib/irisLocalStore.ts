import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

// Limite defensivo por arquivo local; mantém faturas usuais e evita leituras sem limite.
export const MAX_LOCAL_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_BACKUP_ZIP_ENTRIES = 1000;
export const MAX_BACKUP_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

export function assertLocalFileSize(file: Pick<Blob, "size">, label = "Arquivo") {
  if (!Number.isSafeInteger(file.size) || file.size < 0) {
    throw new Error(`${label}: tamanho de arquivo inválido.`);
  }
  if (file.size > MAX_LOCAL_FILE_BYTES) {
    throw new Error(`${label} excede o limite local de 50 MB; não foi lido nem arquivado.`);
  }
}

/** CSV spreadsheet formula neutralization; quote and double embedded quotes after prefixing. */
export function csvCell(value: unknown) {
  const text = String(value ?? "").replace(
    /^([\s\p{Cc}\p{Cf}]*)([=+\-@])/u,
    "'$1$2",
  );
  return `"${text.replaceAll('"', '""')}"`;
}

export type IrisApproval = {
  id: string;
  action: string;
  detail: string;
  status: "pending" | "approved" | "cancelled";
  createdAt: string;
};

const DB_NAME = "iris-local-workspace";
const DB_VERSION = 1;
const STORE = "records";

type BackupDocument = Record<string, unknown> & {
  blob?: Blob | File;
  blobBase64?: string;
  blobType?: string;
  archivePath?: string;
};

type BackupPayload = {
  format?: string;
  version?: number;
  backupType?: string;
  exportedAt?: string;
  approvals?: IrisApproval[];
  language?: string;
  mediaHistory?: unknown[];
  products?: unknown[];
  offlineWorkspace?: unknown[];
  businessContacts?: unknown[];
  irisDocuments?: BackupDocument[];
  irisFinances?: unknown[];
  mode?: string;
  integrity?: Record<string, string>;
};

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(bytes).buffer as ArrayBuffer,
  );
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () =>
      reject(
        request.error ??
          new Error("Não foi possível abrir o armazenamento local."),
      );
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export async function readLocal<T>(key: string, fallback: T): Promise<T> {
  if (!("indexedDB" in window)) return fallback;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(STORE, "readonly")
      .objectStore(STORE)
      .get(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () =>
      resolve((request.result as T | undefined) ?? fallback);
  });
}

export async function writeLocal<T>(key: string, value: T): Promise<void> {
  if (!("indexedDB" in window)) throw new Error("Armazenamento local indisponível. O arquivo não foi salvo.");
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(value, key);
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error("Gravação local interrompida.")); };
    transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error("Falha no armazenamento local.")); };
    transaction.oncomplete = () => { db.close(); window.dispatchEvent(new Event("iris-local-changed")); resolve(); };
  });
}

export async function writeLocalBatch(values: Record<string, unknown>): Promise<void> {
  if (!Object.keys(values).length) return;
  if (!("indexedDB" in window)) throw new Error("Armazenamento local indisponível. O backup não foi restaurado.");
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    for (const [key, value] of Object.entries(values)) store.put(value, key);
    transaction.onabort = () => {
      db.close();
      reject(transaction.error ?? new Error("Restauração local interrompida; nenhum dado foi substituído."));
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Falha ao restaurar o armazenamento local."));
    };
    transaction.oncomplete = () => {
      db.close();
      window.dispatchEvent(new Event("iris-local-changed"));
      resolve();
    };
  });
}

export async function clearLocalWorkspace(): Promise<void> {
  if (!("indexedDB" in window)) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(STORE, "readwrite")
      .objectStore(STORE)
      .clear();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk)
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

type ZipBudget = { maxEntries?: number; maxUncompressedBytes?: number };

/**
 * fflate 0.8.3 invokes unzipSync's filter with central-directory sizes before
 * inflating that entry. A first, reject-only pass checks every entry; only then
 * does a second pass allocate decompressed contents.
 */
export function unzipBackupArchive(
  bytes: Uint8Array,
  budget: ZipBudget = {},
): Record<string, Uint8Array> {
  if (bytes.byteLength > MAX_LOCAL_FILE_BYTES) {
    throw new Error("O ZIP excede o limite local de 50 MB.");
  }
  const maxEntries = budget.maxEntries ?? MAX_BACKUP_ZIP_ENTRIES;
  const maxUncompressedBytes = budget.maxUncompressedBytes ?? MAX_BACKUP_UNCOMPRESSED_BYTES;
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 ||
      !Number.isSafeInteger(maxUncompressedBytes) || maxUncompressedBytes < 1) {
    throw new Error("Limites do ZIP inválidos.");
  }

  let entries = 0;
  let expandedBytes = 0;
  let hasManifest = false;
  const names = new Set<string>();
  unzipSync(bytes, {
    filter: (entry) => {
      entries += 1;
      if (entries > maxEntries) {
        throw new Error(`O ZIP excede o limite de ${maxEntries} entradas; não foi expandido.`);
      }
      if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > bytes.byteLength ||
          !Number.isSafeInteger(entry.originalSize) || entry.originalSize < 0) {
        throw new Error("O ZIP contém tamanhos de entrada inválidos; não foi expandido.");
      }
      expandedBytes += entry.originalSize;
      if (!Number.isSafeInteger(expandedBytes) || expandedBytes > maxUncompressedBytes) {
        throw new Error(`O ZIP excede o limite seguro de ${Math.floor(maxUncompressedBytes / 1048576)} MB descompactados; não foi expandido.`);
      }
      if (entry.name === "manifest.json") {
        hasManifest = true;
      } else if (!/^documents\/[^/\\]+$/.test(entry.name)) {
        throw new Error("O ZIP contém um caminho de arquivo inesperado; não foi expandido.");
      }
      if (names.has(entry.name)) throw new Error("O ZIP contém nomes de entrada duplicados.");
      names.add(entry.name);
      if (entry.name.startsWith("documents/") && entry.originalSize > MAX_LOCAL_FILE_BYTES) {
        throw new Error("Um documento do ZIP excede o limite local de 50 MB.");
      }
      return false;
    },
  });
  if (!hasManifest) throw new Error("O ZIP não contém manifest.json.");

  return unzipSync(bytes);
}

function invalidBackup(detail: string): never {
  throw new Error(`Backup incompleto ou inválido: ${detail} Nenhum dado local foi alterado.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function requireString(record: Record<string, unknown>, key: string) {
  return typeof record[key] === "string";
}

function base64DecodedLength(value: string) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    invalidBackup("anexo Base64 malformado.");
  }
  return Math.floor((value.length * 3) / 4) - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0);
}

function validateBackupPayload(value: unknown, zipped: boolean): asserts value is BackupPayload {
  if (!isRecord(value) || value.format !== "iris-local-backup") {
    invalidBackup("formato Iris ausente ou desconhecido.");
  }
  const payload = value;
  const collections = [
    "approvals", "mediaHistory", "products", "offlineWorkspace",
    "businessContacts", "irisDocuments",
  ] as const;
  for (const key of collections) {
    if (!Array.isArray(payload[key])) invalidBackup(`coleção obrigatória “${key}” ausente ou inválida.`);
  }
  if (typeof payload.language !== "string" || !payload.language.trim()) {
    invalidBackup("idioma ausente ou inválido.");
  }
  if (payload.version !== undefined && payload.version !== 1 && payload.version !== 2) {
    invalidBackup("versão não suportada.");
  }
  if (payload.irisFinances !== undefined && !Array.isArray(payload.irisFinances)) {
    invalidBackup("a coleção “irisFinances” é inválida.");
  }
  if (payload.irisFinances === undefined && (zipped || payload.version === 2)) {
    invalidBackup("a coleção obrigatória “irisFinances” está ausente.");
  }
  if (payload.backupType !== undefined && payload.backupType !== "light" && payload.backupType !== "complete") {
    invalidBackup("tipo de backup não suportado.");
  }
  if (zipped && (payload.version !== 2 || payload.backupType !== "complete")) {
    invalidBackup("um ZIP deve ser um backup completo versão 2.");
  }
  if (payload.mode !== undefined && payload.mode !== "demo" && payload.mode !== "connected") {
    invalidBackup("modo de execução não suportado.");
  }

  for (const key of ["mediaHistory", "offlineWorkspace", "businessContacts"] as const) {
    if ((payload[key] as unknown[]).some((item) => !isRecord(item))) {
      invalidBackup(`a coleção “${key}” contém registros inválidos.`);
    }
  }
  for (const item of payload.approvals as unknown[]) {
    if (!isRecord(item) || !requireString(item, "id") || !requireString(item, "action") ||
        !requireString(item, "detail") || !requireString(item, "createdAt") ||
        !["pending", "approved", "cancelled"].includes(String(item.status))) {
      invalidBackup("a coleção “approvals” contém registros inválidos.");
    }
  }
  for (const item of payload.products as unknown[]) {
    if (!isRecord(item) || !requireString(item, "id") || !requireString(item, "name") ||
        !requireString(item, "createdAt") ||
        ["code", "price", "stock", "category", "description", "image"].some(
          (key) => item[key] !== undefined && typeof item[key] !== "string",
        )) {
      invalidBackup("a coleção “products” contém registros inválidos.");
    }
  }
  let base64Bytes = 0;
  for (const item of payload.irisDocuments as unknown[]) {
    if (!isRecord(item) || !requireString(item, "id") || !requireString(item, "name") ||
        !requireString(item, "mime") || !requireString(item, "createdAt") ||
        (item.blobType !== undefined && typeof item.blobType !== "string") ||
        (item.blob !== undefined) ||
        (item.blobBase64 !== undefined && typeof item.blobBase64 !== "string") ||
        (item.archivePath !== undefined && typeof item.archivePath !== "string")) {
      invalidBackup("a coleção “irisDocuments” contém registros ou anexos inválidos.");
    }
    if (!zipped && item.archivePath !== undefined) invalidBackup("um JSON não pode referenciar arquivos ZIP.");
    if (zipped && item.archivePath !== undefined &&
        (typeof item.archivePath !== "string" || !/^documents\/[^/\\]+$/.test(item.archivePath))) {
      invalidBackup("o caminho de um anexo ZIP está ausente ou inválido.");
    }
    if (zipped && item.blobBase64 !== undefined) invalidBackup("o manifest ZIP não pode conter anexos Base64 embutidos.");
    if (typeof item.blobBase64 === "string") {
      const size = base64DecodedLength(item.blobBase64);
      if (size > MAX_LOCAL_FILE_BYTES) invalidBackup("um anexo excede o limite local de 50 MB.");
      base64Bytes += size;
    }
  }
  if (base64Bytes > MAX_BACKUP_UNCOMPRESSED_BYTES) invalidBackup("os anexos excedem o limite seguro total.");
  for (const item of (payload.irisFinances ?? []) as unknown[]) {
    if (!isRecord(item) || !requireString(item, "id") || !requireString(item, "description") ||
        !requireString(item, "createdAt") || !requireString(item, "dueAt") ||
        !["income", "expense"].includes(String(item.type)) ||
        !["open", "paid", "overdue"].includes(String(item.status)) ||
        typeof item.amount !== "number" || !Number.isFinite(item.amount) || item.amount < 0) {
      invalidBackup("a coleção “irisFinances” contém registros inválidos.");
    }
  }

  if (zipped) {
    if (!isRecord(payload.integrity)) invalidBackup("o mapa de integridade ZIP está ausente.");
    for (const [path, digest] of Object.entries(payload.integrity)) {
      if (!/^documents\/[^/\\]+$/.test(path) || typeof digest !== "string" || !/^[a-f0-9]{64}$/i.test(digest)) {
        invalidBackup("o mapa de integridade ZIP contém referências inválidas.");
      }
    }
  } else if (payload.integrity !== undefined) {
    invalidBackup("um backup JSON não deve conter mapa de integridade ZIP.");
  }
}

async function parseBackupBytes(bytes: Uint8Array, file: File) {
  const zipped = /\.zip$/i.test(file.name) || file.type === "application/zip";
  if (!zipped) {
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      invalidBackup("JSON ilegível.");
    }
    validateBackupPayload(payload, false);
    return { payload, type: "JSON leve" };
  }

  const archive = unzipBackupArchive(bytes);
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(strFromU8(archive["manifest.json"]));
  } catch {
    invalidBackup("manifest.json ilegível.");
  }
  validateBackupPayload(manifestValue, true);
  const manifest = manifestValue;
  const referencedPaths = new Set<string>();
  for (const item of manifest.irisDocuments as BackupDocument[]) {
    if (item.archivePath !== undefined) {
      if (!/^documents\/[^/\\]+$/.test(item.archivePath) || referencedPaths.has(item.archivePath)) {
        invalidBackup("referência de documento ZIP inválida ou duplicada.");
      }
      referencedPaths.add(item.archivePath);
    }
  }
  const integrityPaths = Object.keys(manifest.integrity ?? {});
  if (integrityPaths.length !== referencedPaths.size || integrityPaths.some((path) => !referencedPaths.has(path))) {
    invalidBackup("há arquivos ZIP ausentes ou sem referência no manifest.");
  }
  const archivePaths = Object.keys(archive).filter((path) => path !== "manifest.json");
  if (archivePaths.length !== referencedPaths.size || archivePaths.some((path) => !referencedPaths.has(path))) {
    invalidBackup("o ZIP contém arquivos de documento ausentes ou inesperados.");
  }
  for (const [path, expected] of Object.entries(manifest.integrity ?? {})) {
    const content = archive[path];
    if (!content || (await sha256(content)) !== expected) {
      invalidBackup(`integridade inválida no arquivo ${path}.`);
    }
  }
  for (const item of manifest.irisDocuments as BackupDocument[]) {
    if (item.archivePath !== undefined) {
      const content = archive[item.archivePath];
      if (!content) invalidBackup(`o arquivo referenciado “${item.archivePath}” está ausente.`);
      item.blobBase64 = bytesToBase64(content);
      item.blobType = typeof item.mime === "string" ? item.mime : "application/octet-stream";
    }
  }
  return { payload: manifest, type: "ZIP completo" };
}

async function serializeDocument(
  item: BackupDocument,
  includeFiles: boolean,
): Promise<BackupDocument> {
  const copy: BackupDocument = { ...item };
  delete copy.blob;
  if (includeFiles && item.blob instanceof Blob) {
    assertLocalFileSize(item.blob, `Documento ${String(item.name ?? "local")}`);
    copy.blobBase64 = bytesToBase64(
      new Uint8Array(await item.blob.arrayBuffer()),
    );
    copy.blobType = item.blob.type || "application/octet-stream";
  }
  return copy;
}

export async function buildLocalBackup(
  options: { includeFiles?: boolean } = {},
) {
  const includeFiles = options.includeFiles === true;
  const documents = await readLocal<BackupDocument[]>("irisDocuments", []);
  if (!Array.isArray(documents)) throw new Error("Não foi possível criar o backup: a coleção de documentos locais é inválida.");
  if (includeFiles) {
    if (documents.length + 1 > MAX_BACKUP_ZIP_ENTRIES) {
      throw new Error(`O backup completo excede o limite de ${MAX_BACKUP_ZIP_ENTRIES - 1} documentos.`);
    }
    let expandedBytes = 0;
    for (const document of documents) {
      const blobBytes = document.blob instanceof Blob
        ? document.blob.size
        : typeof document.blobBase64 === "string"
          ? base64DecodedLength(document.blobBase64)
          : 0;
      if (blobBytes > MAX_LOCAL_FILE_BYTES) {
        throw new Error(`O documento ${String(document.name ?? "local")} excede o limite de 50 MB.`);
      }
      expandedBytes += blobBytes;
      if (expandedBytes > MAX_BACKUP_UNCOMPRESSED_BYTES) {
        throw new Error("O backup completo excede o limite de 100 MB descompactados.");
      }
    }
  }
  return {
    format: "iris-local-backup",
    version: includeFiles ? 2 : 1,
    backupType: includeFiles ? "complete" : "light",
    exportedAt: new Date().toISOString(),
    approvals: await readLocal<IrisApproval[]>("approvals", []),
    language: await readLocal("language", "pt-BR"),
    mediaHistory: await readLocal("mediaHistory", []),
    products: await readLocal("products", []),
    offlineWorkspace: await readLocal("offlineWorkspace", []),
    businessContacts: await readLocal("businessContacts", []),
    irisFinances: await readLocal("irisFinances", []),
    irisDocuments: await Promise.all(
      documents.map((item) => serializeDocument(item, includeFiles)),
    ),
    mode: localStorage.getItem("iris.mode") ?? "demo",
  };
}

export function downloadBlob(filename: string, value: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function downloadJson(filename: string, value: unknown) {
  downloadBlob(filename, JSON.stringify(value, null, 2), "application/json");
  if (value && typeof value === "object" && "format" in value && value.format === "iris-local-backup")
    localStorage.setItem("iris.lastBackupAt", new Date().toISOString());
}

export async function downloadCompleteBackupZip(filename: string) {
  const backup = await buildLocalBackup({ includeFiles: true });
  const files: Record<string, Uint8Array> = {};
  const manifest: BackupPayload = { ...backup, irisDocuments: [] };
  const integrity: Record<string, string> = {};
  for (const [index, item] of (backup.irisDocuments as BackupDocument[]).entries()) {
    const copy: BackupDocument = { ...item };
    if (typeof copy.blobBase64 === "string") {
      const safeName = String(copy.name ?? "documento").replace(
        /[^\w.-]+/g,
        "_",
      );
      const archivePath = `documents/${index}-${safeName || "documento"}`;
      files[archivePath] = base64ToBytes(copy.blobBase64);
      integrity[archivePath] = await sha256(files[archivePath]);
      copy.archivePath = archivePath;
      delete copy.blobBase64;
    }
    delete copy.blobType;
    (manifest.irisDocuments as BackupDocument[]).push(copy);
  }
  manifest.integrity = integrity;
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  let expandedBytes = 0;
  for (const value of Object.values(files)) expandedBytes += value.byteLength;
  if (Object.keys(files).length > MAX_BACKUP_ZIP_ENTRIES || expandedBytes > MAX_BACKUP_UNCOMPRESSED_BYTES) {
    throw new Error("O backup completo excede os limites seguros de entradas ou 100 MB descompactados.");
  }
  const archive = zipSync(files, { level: 6 });
  assertLocalFileSize({ size: archive.byteLength }, "Backup ZIP");
  downloadBlob(filename, archive, "application/zip");
  localStorage.setItem("iris.lastBackupAt", new Date().toISOString());
}

async function readBackupFileBytes(file: File) {
  assertLocalFileSize(file, "Backup");
  return new Uint8Array(await file.arrayBuffer());
}

export async function inspectBackupFile(file: File) {
  const bytes = await readBackupFileBytes(file);
  const { payload, type } = await parseBackupBytes(bytes, file);
  return {
    hash: await sha256(bytes),
    type,
    documents: payload.irisDocuments!.length,
    size: file.size,
  };
}

export async function restoreLocalBackup(file: File): Promise<void> {
  const bytes = await readBackupFileBytes(file);
  const { payload: backup } = await parseBackupBytes(bytes, file);
  const documents = backup.irisDocuments!.map((item) => {
    const restored: BackupDocument = { ...item };
    if (typeof item.blobBase64 === "string") {
      restored.blob = new Blob([base64ToBytes(item.blobBase64)], {
        type: item.blobType || "application/octet-stream",
      });
    }
    delete restored.blobBase64;
    delete restored.blobType;
    delete restored.archivePath;
    return restored;
  });

  // Nothing is written until the complete payload and every document attachment pass validation.
  const restoreValues: Record<string, unknown> = {
    approvals: backup.approvals!,
    language: backup.language!,
    mediaHistory: backup.mediaHistory!,
    products: backup.products!,
    offlineWorkspace: backup.offlineWorkspace!,
    businessContacts: backup.businessContacts!,
    irisDocuments: documents,
  };
  // Version-1 backups predating the finance ledger omit this collection; leave new local entries untouched.
  if (Array.isArray(backup.irisFinances)) restoreValues.irisFinances = backup.irisFinances;
  await writeLocalBatch(restoreValues);
  if (backup.mode === "demo" || backup.mode === "connected") {
    localStorage.setItem("iris.mode", backup.mode);
  }
}
