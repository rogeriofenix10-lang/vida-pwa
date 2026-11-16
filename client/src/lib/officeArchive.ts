import { Unzip, UnzipInflate } from "fflate";
import { assertLocalFileSize } from "./irisLocalStore";

const MAX_ENTRIES = 5_000;
const MAX_TOTAL = 100 * 1024 * 1024;
const MAX_ENTRY = 25 * 1024 * 1024;
const failureMessage = "Arquivo Office excede os limites seguros de descompactação (100 MB no total, 25 MB por entrada ou 5.000 entradas). Divida o arquivo antes de importar.";

/** Checks both declared ZIP metadata and actual decompressed bytes, in bounded chunks. */
export function validateOfficeArchiveBytes(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0) throw new Error("Arquivo Office inválido: estrutura ZIP não reconhecida.");
  const entries = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true);
  if (entries === 65_535 || size === 0xffffffff || offset === 0xffffffff ||
      view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) {
    throw new Error("Office ZIP64 ou dividido em volumes não é suportado nesta importação segura.");
  }
  if (entries > MAX_ENTRIES || offset + size > end) throw new Error(failureMessage);
  let declaredTotal = 0;
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error("Arquivo Office com índice ZIP inválido.");
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const unpacked = view.getUint32(offset + 24, true);
    const length = 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    if (flags & 1 || (method !== 0 && method !== 8)) throw new Error("Office criptografado ou com compactação não suportada.");
    declaredTotal += unpacked;
    if (unpacked > MAX_ENTRY || declaredTotal > MAX_TOTAL || unpacked > Math.max(1, compressed) * 1000 || offset + length > end) throw new Error(failureMessage);
    offset += length;
  }

  let actualTotal = 0;
  let actualEntries = 0;
  let completed = 0;
  let failure: Error | undefined;
  const unzip = new Unzip((entry) => {
    actualEntries += 1;
    if (actualEntries > MAX_ENTRIES) { failure = new Error(failureMessage); return; }
    let actualSize = 0;
    entry.ondata = (error, data, final) => {
      if (error) { failure = error; return; }
      actualSize += data.length;
      actualTotal += data.length;
      if (actualSize > MAX_ENTRY || actualTotal > MAX_TOTAL) {
        failure = new Error(failureMessage);
        entry.terminate();
      }
      if (final) completed += 1;
    };
    entry.start();
  });
  unzip.register(UnzipInflate);
  for (let i = 0; i < bytes.length; i += 8192) {
    unzip.push(bytes.subarray(i, Math.min(i + 8192, bytes.length)), i + 8192 >= bytes.length);
    if (failure) throw failure;
  }
  if (actualEntries !== entries || completed !== entries) throw new Error("Arquivo Office incompleto ou com entradas ZIP inconsistentes.");
}

export async function validateOfficeArchive(file: File) {
  assertLocalFileSize(file, "Arquivo Office");
  validateOfficeArchiveBytes(new Uint8Array(await file.arrayBuffer()));
}
