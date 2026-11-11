import { describe, expect, it } from "vitest";
import {
  assertOcrCanvasBounds,
  assertPdfPageCount,
  LocalDocumentLimitError,
  MAX_OCR_CANVAS_PIXELS,
  MAX_PDF_PAGES,
  readDocumentText,
} from "./localOcr";

describe("local OCR resource limits", () => {
  it("allows ordinary PDFs up to the explicit page limit and rejects larger ones clearly", () => {
    expect(() => assertPdfPageCount(MAX_PDF_PAGES)).not.toThrow();
    expect(() => assertPdfPageCount(MAX_PDF_PAGES + 1)).toThrow(
      `PDF acima do limite local de ${MAX_PDF_PAGES} páginas`,
    );
    expect(() => assertPdfPageCount(0)).toThrow(LocalDocumentLimitError);
  });

  it("allows a canvas at the pixel limit and rejects oversized or invalid dimensions", () => {
    expect(() => assertOcrCanvasBounds(4000, 4000, 1)).not.toThrow();
    expect(MAX_OCR_CANVAS_PIXELS).toBe(16_000_000);
    expect(() => assertOcrCanvasBounds(4001, 4000, 7)).toThrow(
      "A página 7 excede o limite de renderização OCR",
    );
    expect(() => assertOcrCanvasBounds(Number.POSITIVE_INFINITY, 1, 2)).toThrow(
      LocalDocumentLimitError,
    );
  });

  it("rejects Excel workbooks with a safe CSV conversion message", async () => {
    const file = new File(["untrusted workbook"], "expenses.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const result = await readDocumentText(file);
    expect(result.method).toBe("empty");
    expect(result.warning).toContain("exporte o arquivo como CSV");
  });
});
