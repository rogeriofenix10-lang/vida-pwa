import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

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
  approvals?: IrisApproval[];
  language?: string;
  mediaHistory?: unknown[];
  products?: unknown[];
  offlineWorkspace?: unknown[];
  businessContacts?: unknown[];
  irisDocuments?: BackupDocument[];
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
  if (!("indexedDB" in window)) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(STORE, "readwrite")
      .objectStore(STORE)
      .put(value, key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
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

async function serializeDocument(
  item: BackupDocument,
  includeFiles: boolean,
): Promise<BackupDocument> {
  const copy: BackupDocument = { ...item };
  delete copy.blob;
  if (includeFiles && item.blob instanceof Blob) {
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
    irisDocuments: await Promise.all(
      documents.map((item) => serializeDocument(item, includeFiles)),
    ),
    mode: localStorage.getItem("iris.mode") ?? "demo",
  };
}

function downloadBlob(filename: string, value: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadJson(filename: string, value: unknown) {
  downloadBlob(filename, JSON.stringify(value, null, 2), "application/json");
  localStorage.setItem("iris.lastBackupAt", new Date().toISOString());
}

export async function downloadCompleteBackupZip(filename: string) {
  const backup = await buildLocalBackup({ includeFiles: true });
  const files: Record<string, Uint8Array> = {};
  const manifest: BackupPayload = { ...backup, irisDocuments: [] };
  const integrity: Record<string, string> = {};
  for (const item of backup.irisDocuments as BackupDocument[]) {
    const copy: BackupDocument = { ...item };
    if (copy.blobBase64) {
      const safeName = String(copy.name ?? "documento").replace(
        /[^\w.-]+/g,
        "_",
      );
      const archivePath = `documents/${String(copy.id ?? Date.now())}-${safeName}`;
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
  downloadBlob(filename, zipSync(files, { level: 6 }), "application/zip");
  localStorage.setItem("iris.lastBackupAt", new Date().toISOString());
}

async function payloadFromFile(file: File): Promise<BackupPayload> {
  if (/\.zip$/i.test(file.name) || file.type === "application/zip") {
    const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const manifest = JSON.parse(
      strFromU8(archive["manifest.json"] ?? new Uint8Array()),
    ) as BackupPayload;
    for (const [path, expected] of Object.entries(manifest.integrity ?? {})) {
      const bytes = archive[path];
      if (!bytes || (await sha256(bytes)) !== expected)
        throw new Error(`Integridade inválida no arquivo ${path}.`);
    }
    for (const item of manifest.irisDocuments ?? []) {
      if (item.archivePath && archive[item.archivePath]) {
        item.blobBase64 = bytesToBase64(archive[item.archivePath]);
        item.blobType =
          typeof item.mime === "string"
            ? item.mime
            : "application/octet-stream";
      }
    }
    return manifest;
  }
  return JSON.parse(await file.text()) as BackupPayload;
}

export async function inspectBackupFile(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = await sha256(bytes);
  if (/\.zip$/i.test(file.name) || file.type === "application/zip") {
    const archive = unzipSync(bytes);
    const manifest = JSON.parse(
      strFromU8(archive["manifest.json"] ?? new Uint8Array()),
    ) as BackupPayload;
    return {
      hash,
      type: "ZIP completo",
      documents: manifest.irisDocuments?.length ?? 0,
      size: file.size,
    };
  }
  const payload = JSON.parse(new TextDecoder().decode(bytes)) as BackupPayload;
  return {
    hash,
    type: "JSON leve",
    documents: payload.irisDocuments?.length ?? 0,
    size: file.size,
  };
}

export async function restoreLocalBackup(file: File): Promise<void> {
  const backup = await payloadFromFile(file);
  if (backup.format !== "iris-local-backup")
    throw new Error("Arquivo de backup Iris inválido.");
  const documents = (backup.irisDocuments ?? []).map((item) => {
    if (!item.blobBase64) return item;
    const restored: BackupDocument = {
      ...item,
      blob: new Blob([base64ToBytes(item.blobBase64)], {
        type: item.blobType || "application/octet-stream",
      }),
    };
    delete restored.blobBase64;
    delete restored.blobType;
    delete restored.archivePath;
    return restored;
  });
  await writeLocal("approvals", backup.approvals ?? []);
  await writeLocal("language", backup.language ?? "pt-BR");
  await writeLocal("mediaHistory", backup.mediaHistory ?? []);
  await writeLocal("products", backup.products ?? []);
  await writeLocal("offlineWorkspace", backup.offlineWorkspace ?? []);
  await writeLocal("businessContacts", backup.businessContacts ?? []);
  await writeLocal("irisDocuments", documents);
  if (backup.mode === "demo" || backup.mode === "connected")
    localStorage.setItem("iris.mode", backup.mode);
}
