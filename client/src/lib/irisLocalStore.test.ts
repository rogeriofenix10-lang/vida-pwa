import { afterEach, describe, expect, it, vi } from "vitest";
import { zipSync } from "fflate";
import {
  assertLocalFileSize,
  clearFinancialDocumentsIfCount,
  clearFinancialLedgerIfCount,
  csvCell,
  inspectBackupFile,
  MAX_BACKUP_UNCOMPRESSED_BYTES,
  MAX_LOCAL_FILE_BYTES,
  restoreLocalBackup,
  unzipBackupArchive,
} from "./irisLocalStore";

function fakeLocalRecords(initial: Record<string, unknown>) {
  const records = new Map(Object.entries(initial));
  const database = {
    objectStoreNames: { contains: () => true },
    createObjectStore: vi.fn(),
    close: vi.fn(),
    transaction: () => {
      const transaction: {
        oncomplete: (() => void) | null;
        onabort: (() => void) | null;
        onerror: (() => void) | null;
        error: DOMException | null;
        objectStore: () => unknown;
        abort: () => void;
      } = {
        oncomplete: null,
        onabort: null,
        onerror: null,
        error: null,
        objectStore: () => store,
        abort: () => queueMicrotask(() => transaction.onabort?.()),
      };
      const store = {
        get: (key: string) => {
          const request: { result?: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null } = { onsuccess: null, onerror: null };
          queueMicrotask(() => { request.result = records.get(key); request.onsuccess?.(); });
          return request as unknown as IDBRequest<unknown>;
        },
        put: (value: unknown, key: string) => {
          records.set(key, structuredClone(value));
          const request = { result: key, onsuccess: null, onerror: null };
          setTimeout(() => transaction.oncomplete?.(), 0);
          return request as unknown as IDBRequest<IDBValidKey>;
        },
      };
      return transaction as unknown as IDBTransaction;
    },
  } as unknown as IDBDatabase;
  const factory = {
    open: () => {
      const request: Record<string, unknown> = { result: database };
      queueMicrotask(() => (request.onsuccess as (() => void) | null)?.());
      return request as unknown as IDBOpenDBRequest;
    },
  };
  return { factory, records, database };
}

describe("local file and CSV guards", () => {
  it("accepts the documented 50 MiB boundary and rejects larger files", () => {
    expect(() => assertLocalFileSize({ size: MAX_LOCAL_FILE_BYTES })).not.toThrow();
    expect(() => assertLocalFileSize({ size: MAX_LOCAL_FILE_BYTES + 1 }, "Fatura"))
      .toThrow("limite local de 50 MB");
  });

  it("rejects an oversized backup before calling arrayBuffer", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    const file = {
      name: "too-large.json",
      type: "application/json",
      size: MAX_LOCAL_FILE_BYTES + 1,
      arrayBuffer,
    } as unknown as File;
    await expect(inspectBackupFile(file)).rejects.toThrow("limite local de 50 MB");
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("neutralizes formulas after whitespace/control prefixes and keeps CSV quoting", () => {
    for (const value of ["=1+1", "+SUM(A1:A2)", "-10", "@SUM(A1)", "\t\r\n=1+1"]) {
      expect(csvCell(value).startsWith("\"'")).toBe(true);
    }
    expect(csvCell('descrição "com aspas"')).toBe('"descrição ""com aspas"""');
    expect(csvCell("texto normal")).toBe('"texto normal"');
  });
});

describe("financial history deletion", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("clears only irisFinances when the confirmed count still matches", async () => {
    const documents = [{ id: "doc-kept", blob: new Blob(["original"]) }];
    const { factory, records, database } = fakeLocalRecords({
      irisFinances: [{ id: "one" }, { id: "two" }],
      irisDocuments: documents,
    });
    const localWindow = { indexedDB: factory, dispatchEvent: vi.fn() };
    vi.stubGlobal("indexedDB", factory);
    vi.stubGlobal("window", localWindow);

    await expect(clearFinancialLedgerIfCount(2)).resolves.toBe(2);

    expect(records.get("irisFinances")).toEqual([]);
    expect(records.get("irisDocuments")).toBe(documents);
    expect(database.close).toHaveBeenCalledOnce();
    expect(localWindow.dispatchEvent).toHaveBeenCalledOnce();
  });

  it("does not modify either collection if the count changed after confirmation", async () => {
    const finances = [{ id: "one" }, { id: "two" }];
    const documents = [{ id: "doc-kept" }];
    const { factory, records } = fakeLocalRecords({ irisFinances: finances, irisDocuments: documents });
    vi.stubGlobal("indexedDB", factory);
    vi.stubGlobal("window", { indexedDB: factory, dispatchEvent: vi.fn() });

    await expect(clearFinancialLedgerIfCount(3)).rejects.toThrow("nenhum registro foi apagado");

    expect(records.get("irisFinances")).toBe(finances);
    expect(records.get("irisDocuments")).toBe(documents);
  });

  it("removes only archived finance files and preserves ledger entries and contracts", async () => {
    const financeOriginal = { id: "invoice", kind: "financeiro", folder: "Financeiro", blob: new Blob(["original pdf"]) };
    const generalDocument = { id: "general", kind: "geral", folder: "Documentos" };
    const contract = { id: "contract", kind: "financeiro", folder: "Financeiro", classificationKind: "contrato" };
    const finances = [{ id: "entry-from-invoice" }];
    const { factory, records, database } = fakeLocalRecords({
      irisDocuments: [financeOriginal, generalDocument, contract],
      irisFinances: finances,
    });
    const localWindow = { indexedDB: factory, dispatchEvent: vi.fn() };
    vi.stubGlobal("indexedDB", factory);
    vi.stubGlobal("window", localWindow);

    await expect(clearFinancialDocumentsIfCount(1)).resolves.toBe(1);

    expect(records.get("irisDocuments")).toEqual([generalDocument, contract]);
    expect(records.get("irisFinances")).toBe(finances);
    expect(database.close).toHaveBeenCalledOnce();
    expect(localWindow.dispatchEvent).toHaveBeenCalledOnce();
  });

  it("preserves every document when its confirmed financial-document count has changed", async () => {
    const documents = [{ id: "invoice", kind: "financeiro", folder: "Financeiro" }];
    const finances = [{ id: "entry" }];
    const { factory, records } = fakeLocalRecords({ irisDocuments: documents, irisFinances: finances });
    vi.stubGlobal("indexedDB", factory);
    vi.stubGlobal("window", { indexedDB: factory, dispatchEvent: vi.fn() });

    await expect(clearFinancialDocumentsIfCount(2)).rejects.toThrow("A quantidade de documentos mudou");

    expect(records.get("irisDocuments")).toBe(documents);
    expect(records.get("irisFinances")).toBe(finances);
  });
});

describe("ZIP preflight limits", () => {
  it("rejects entry-count overflow before extracting archive contents", () => {
    const archive = zipSync({
      "manifest.json": new TextEncoder().encode("{}"),
      "documents/a.pdf": new Uint8Array([1, 2, 3]),
    });
    expect(() => unzipBackupArchive(archive, { maxEntries: 1 }))
      .toThrow("limite de 1 entradas");
  });

  it("rejects an oversized declared uncompressed size in the metadata-only pass", () => {
    const archive = zipSync({ "manifest.json": new TextEncoder().encode("{}") });
    const mutated = archive.slice();
    const view = new DataView(mutated.buffer, mutated.byteOffset, mutated.byteLength);
    let centralDirectoryOffset = -1;
    for (let offset = 0; offset < mutated.length - 4; offset += 1) {
      if (view.getUint32(offset, true) === 0x02014b50) {
        centralDirectoryOffset = offset;
        break;
      }
    }
    expect(centralDirectoryOffset).toBeGreaterThanOrEqual(0);
    view.setUint32(centralDirectoryOffset + 24, MAX_BACKUP_UNCOMPRESSED_BYTES + 1, true);
    expect(() => unzipBackupArchive(mutated)).toThrow("não foi expandido");
  });
});

describe("backup validation before writes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects a backup missing a required collection before accessing local storage", async () => {
    const localWindow = { dispatchEvent: vi.fn() };
    vi.stubGlobal("window", localWindow);
    const bytes = new TextEncoder().encode(JSON.stringify({
      format: "iris-local-backup",
      version: 2,
      backupType: "complete",
      language: "pt-BR",
      approvals: [],
      mediaHistory: [],
      products: [],
      offlineWorkspace: [],
      businessContacts: [],
      irisDocuments: [],
      // irisFinances intentionally absent
    }));
    const fakeFile = {
      name: "backup-incompleto.json",
      type: "application/json",
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.slice().buffer,
    } as unknown as File;

    await expect(restoreLocalBackup(fakeFile)).rejects.toThrow("coleção obrigatória “irisFinances”");
    expect(localWindow.dispatchEvent).not.toHaveBeenCalled();
  });
});
