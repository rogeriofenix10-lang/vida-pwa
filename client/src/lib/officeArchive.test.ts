import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { validateOfficeArchiveBytes } from "./officeArchive";

function centralOffset(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < bytes.length - 4; i++) if (view.getUint32(i, true) === 0x02014b50) return i;
  throw new Error("synthetic central directory not found");
}

describe("bounded Office ZIP validation", () => {
  it("accepts complete small Office-style archives without retaining inflated content", () => {
    const bytes = zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": strToU8("<document>Cliente sintético</document>") });
    expect(() => validateOfficeArchiveBytes(bytes)).not.toThrow();
  });
  it("rejects forged huge declared sizes before inflation", () => {
    const bytes = zipSync({ "sheet.xml": strToU8("small") });
    new DataView(bytes.buffer).setUint32(centralOffset(bytes) + 24, 200 * 1024 * 1024, true);
    expect(() => validateOfficeArchiveBytes(bytes)).toThrow("limites seguros");
  });
  it("bounds actual decoded output even when the central size is forged", () => {
    const bytes = zipSync({ "sheet.xml": new Uint8Array(26 * 1024 * 1024).fill(65) });
    new DataView(bytes.buffer).setUint32(centralOffset(bytes) + 24, 1, true);
    expect(() => validateOfficeArchiveBytes(bytes)).toThrow("limites seguros");
  });
  it("rejects incomplete or unrecognized archives", () => {
    expect(() => validateOfficeArchiveBytes(strToU8("not a ZIP"))).toThrow("estrutura ZIP");
    const valid = zipSync({ "word/document.xml": strToU8("test") });
    expect(() => validateOfficeArchiveBytes(valid.slice(0, -5))).toThrow("estrutura ZIP");
  });
});
