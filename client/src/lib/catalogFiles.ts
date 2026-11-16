import {
  assertLocalFileSize,
  readLocal,
  writeLocal,
} from "@/lib/irisLocalStore";

export const PRODUCT_CATALOG_FILES_KEY = "productCatalogFiles";
const MAX_CATALOG_FILENAME_LENGTH = 180;
const INVALID_FILENAME_CHARACTERS =
  /[\\/\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

export type ProductCatalogFile = {
  id: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
  blob: Blob;
};

export function sanitizeCatalogFilename(value: string) {
  let filename = value
    .replace(INVALID_FILENAME_CHARACTERS, "_")
    .trim()
    .replace(/[. ]+$/g, "")
    .replace(/^\.+/, "");
  if (!filename) filename = "arquivo";
  if (filename.length <= MAX_CATALOG_FILENAME_LENGTH) return filename;

  const extensionIndex = filename.lastIndexOf(".");
  const extension =
    extensionIndex > 0
      ? filename.slice(extensionIndex, extensionIndex + 32)
      : "";
  const basename = extension ? filename.slice(0, extensionIndex) : filename;
  return `${basename.slice(0, MAX_CATALOG_FILENAME_LENGTH - extension.length)}${extension}`;
}

function catalogMimeType(file: File) {
  const value = file.type.trim().toLowerCase();
  return value &&
    value.length <= 128 &&
    /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(value)
    ? value
    : "application/octet-stream";
}

export function makeProductCatalogFileRecord(
  file: File,
  createdAt = new Date().toISOString(),
  createId = () => crypto.randomUUID(),
): ProductCatalogFile {
  assertLocalFileSize(file, file.name || "Arquivo");
  if (typeof file.name !== "string" || file.name.length > 4_096) {
    throw new Error(
      "O nome do arquivo é inválido ou excessivamente longo; ele não foi arquivado.",
    );
  }
  const name = sanitizeCatalogFilename(file.name);
  const blob = file.slice(0, file.size, catalogMimeType(file));
  return {
    id: createId(),
    name,
    mime: blob.type || "application/octet-stream",
    size: blob.size,
    createdAt,
    blob,
  };
}

function isCatalogFileRecord(value: unknown): value is ProductCatalogFile {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ProductCatalogFile>;
  return (
    typeof record.id === "string" &&
    record.id.length > 0 &&
    record.id.length <= 200 &&
    typeof record.name === "string" &&
    record.name === sanitizeCatalogFilename(record.name) &&
    typeof record.mime === "string" &&
    record.mime.length <= 128 &&
    Number.isSafeInteger(record.size) &&
    (record.size as number) >= 0 &&
    (record.size as number) <= 50 * 1024 * 1024 &&
    typeof record.createdAt === "string" &&
    Number.isFinite(Date.parse(record.createdAt)) &&
    typeof Blob !== "undefined" &&
    record.blob instanceof Blob &&
    record.blob.size === record.size &&
    record.blob.size <= 50 * 1024 * 1024
  );
}

export async function readProductCatalogFiles(): Promise<ProductCatalogFile[]> {
  const stored = await readLocal<unknown>(PRODUCT_CATALOG_FILES_KEY, []);
  if (
    !Array.isArray(stored) ||
    stored.some((item) => !isCatalogFileRecord(item))
  ) {
    throw new Error(
      "A coleção local de arquivos do catálogo está inválida. Nenhum produto foi alterado.",
    );
  }
  return stored;
}

export async function addProductCatalogFiles(files: File[]) {
  const additions = files.map((file) => makeProductCatalogFileRecord(file));
  const current = await readProductCatalogFiles();
  const next = [...additions, ...current];
  await writeLocal(PRODUCT_CATALOG_FILES_KEY, next);
  return next;
}

export async function removeProductCatalogFile(id: string) {
  const current = await readProductCatalogFiles();
  const next = current.filter((file) => file.id !== id);
  if (next.length === current.length)
    throw new Error("O arquivo selecionado não está mais no catálogo local.");
  await writeLocal(PRODUCT_CATALOG_FILES_KEY, next);
  return next;
}
