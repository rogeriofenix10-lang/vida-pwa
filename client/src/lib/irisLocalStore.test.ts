import { afterEach, describe, expect, it, vi } from "vitest";
import { zipSync } from "fflate";
import {
  assertLocalFileSize,
  csvCell,
  inspectBackupFile,
  MAX_BACKUP_UNCOMPRESSED_BYTES,
  MAX_LOCAL_FILE_BYTES,
  restoreLocalBackup,
  unzipBackupArchive,
} from "./irisLocalStore";

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
