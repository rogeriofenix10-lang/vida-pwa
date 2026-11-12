import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  createWorker: vi.fn(),
}));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: mocks.getDocument,
}));
vi.mock("tesseract.js", () => ({ createWorker: mocks.createWorker }));
vi.mock("@/lib/irisLocalStore", () => ({
  assertLocalFileSize: vi.fn(),
}));

import {
  assertOcrCanvasBounds,
  assertPdfPageCount,
  extractPdfLines,
  LocalDocumentLimitError,
  MAX_OCR_CANVAS_PIXELS,
  MAX_PDF_PAGES,
  readDocumentText,
} from "./localOcr";

type PdfItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
};

function item(
  str: string,
  x: number,
  y: number,
  width = str.length * 5,
): PdfItem {
  return {
    str,
    transform: [1, 0, 0, 10, x, y],
    width,
    height: 10,
    hasEOL: false,
  };
}

function makePdfFile(): File {
  return Object.assign(
    new Blob(["mock PDF bytes"], { type: "application/pdf" }),
    {
      name: "statement.pdf",
    },
  ) as File;
}

function mockPdfPages(pageItems: PdfItem[][]) {
  const pageMocks = pageItems.map((items) => ({
    getTextContent: vi.fn().mockResolvedValue({ items }),
    getViewport: vi.fn().mockReturnValue({ width: 100, height: 100 }),
    render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
  }));
  const pdf = {
    numPages: pageMocks.length,
    getPage: vi.fn(async (pageNumber: number) => pageMocks[pageNumber - 1]),
  };
  const loadingTask = {
    promise: Promise.resolve(pdf),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
  mocks.getDocument.mockReturnValue(loadingTask);
  return { pdf, pageMocks, loadingTask };
}

function mockCanvas() {
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn().mockReturnValue({}),
    toBlob: vi.fn((callback: (blob: Blob) => void) =>
      callback(new Blob(["rendered page"])),
    ),
  };
  vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
  return canvas;
}

function mockOcr(text: string, confidence = 92) {
  const worker = {
    recognize: vi.fn().mockResolvedValue({ data: { text, confidence } }),
    terminate: vi.fn().mockResolvedValue(undefined),
  };
  mocks.createWorker.mockResolvedValue(worker);
  return worker;
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

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

describe("coordinate-based PDF text reconstruction", () => {
  it("sorts realistic out-of-order date, merchant, and amount items into aligned rows", () => {
    const items = [
      item("Farmácia Boa", 105, 700, 68),
      item("R$ 28,90", 470, 700, 48),
      item("Mercado Central", 104, 720, 86),
      item("21 OUT", 35, 700, 45),
      item("R$ 33,20", 470, 720, 48),
      item("20 OUT", 35, 720, 45),
    ];

    expect(extractPdfLines(items)).toBe(
      "20 OUT Mercado Central R$ 33,20\n21 OUT Farmácia Boa R$ 28,90",
    );
  });

  it("splits adjacent transaction columns after an amount and before the next date", () => {
    const items = [
      item("Loja Um", 425, 680, 52),
      item("02/11/2026", 360, 680, 55),
      item("R$ 42,50", 215, 680, 48),
      item("01/11/2026", 30, 680, 55),
      item("Padaria", 95, 680, 48),
      item("R$ 18,90", 545, 680, 48),
    ];

    expect(extractPdfLines(items)).toBe(
      "01/11/2026 Padaria R$ 42,50\n02/11/2026 Loja Um R$ 18,90",
    );
  });
});

describe("PDF OCR selection", () => {
  it("forceOcr scans each page even with a long text layer and selects OCR without duplication", async () => {
    const layerText =
      "NATIVE LAYER - transaction 01/10/2026 merchant with value R$ 45,20 ".repeat(
        3,
      );
    mockPdfPages([[item(layerText, 30, 700, layerText.length * 4)]]);
    mockCanvas();
    const worker = mockOcr("OCR RESULT - 01/10/2026 Merchant R$ 45,20", 94);

    const result = await readDocumentText(makePdfFile(), undefined, {
      forceOcr: true,
    });

    expect(mocks.createWorker).toHaveBeenCalledTimes(1);
    expect(worker.recognize).toHaveBeenCalledTimes(1);
    expect(result.method).toBe("ocr");
    expect(result.text).toBe("OCR RESULT - 01/10/2026 Merchant R$ 45,20");
    expect(result.text).not.toContain("NATIVE LAYER");
    expect(result.confidence).toBe(94);
  });

  it("uses OCR by default for a long transaction-like layer with no money values", async () => {
    const layerText =
      "Lançamentos: 21 OUT mercado central 22 OUT farmácia bairro " +
      "compras identificadas pelo histórico do extrato, sem valores monetários extraídos da camada nativa.";
    mockPdfPages([[item(layerText, 30, 700, layerText.length * 4)]]);
    mockCanvas();
    mockOcr(
      "01/10/2026 Mercado Central R$ 24,00\n02/10/2026 Farmácia R$ 8,00",
      88,
    );

    const result = await readDocumentText(makePdfFile());

    expect(mocks.createWorker).toHaveBeenCalledTimes(1);
    expect(result.method).toBe("ocr");
    expect(result.text).toContain("R$ 24,00");
    expect(result.text).not.toContain("sem valores monetários");
  });

  it("keeps a long monetary text layer by default to avoid unnecessary OCR", async () => {
    const layerText =
      "Extrato detalhado de compras de outubro com informações de conta e cartão. " +
      "21/10/2026 Mercado Central R$ 34,97. Histórico completo da movimentação e demais informações.";
    mockPdfPages([[item(layerText, 30, 700, layerText.length * 4)]]);

    const result = await readDocumentText(makePdfFile());

    expect(mocks.createWorker).not.toHaveBeenCalled();
    expect(result.method).toBe("text-layer");
    expect(result.text).toContain("R$ 34,97");
  });

  it("falls back to the text layer and reports low confidence when forced OCR is unreliable", async () => {
    const layerText =
      "Native account statement layer contains a complete transaction with R$ 34,97 and merchant data.";
    mockPdfPages([[item(layerText, 30, 700, layerText.length * 4)]]);
    mockCanvas();
    mockOcr("??", 20);

    const result = await readDocumentText(makePdfFile(), undefined, {
      forceOcr: true,
    });

    expect(result.method).toBe("text-layer");
    expect(result.text).toContain("Native account statement layer");
    expect(result.text).not.toContain("??");
    expect(result.confidence).toBe(100);
    expect(result.warning).toContain("baixa confiança");
  });
});
