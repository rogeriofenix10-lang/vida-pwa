import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { assertLocalFileSize } from "@/lib/irisLocalStore";

// Guardrails for local-only OCR: a 50 MiB file cap is applied before reads;
// ordinary bills fit within 100 pages and each OCR page is capped at 16 MP.
export const MAX_PDF_PAGES = 100;
export const MAX_OCR_CANVAS_PIXELS = 16_000_000;
export const MAX_OCR_CANVAS_DIMENSION = 8192;

export class LocalDocumentLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalDocumentLimitError";
  }
}

export function assertPdfPageCount(pageCount: number) {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
    throw new LocalDocumentLimitError("O PDF informa uma quantidade de páginas inválida.");
  }
  if (pageCount > MAX_PDF_PAGES) {
    throw new LocalDocumentLimitError(`PDF acima do limite local de ${MAX_PDF_PAGES} páginas; a leitura foi cancelada.`);
  }
}

export function assertOcrCanvasBounds(width: number, height: number, pageNumber: number) {
  const pixelWidth = Math.ceil(width);
  const pixelHeight = Math.ceil(height);
  if (!Number.isFinite(pixelWidth) || !Number.isFinite(pixelHeight) ||
      pixelWidth < 1 || pixelHeight < 1 ||
      pixelWidth > MAX_OCR_CANVAS_DIMENSION || pixelHeight > MAX_OCR_CANVAS_DIMENSION ||
      pixelWidth * pixelHeight > MAX_OCR_CANVAS_PIXELS) {
    throw new LocalDocumentLimitError(
      `A página ${pageNumber} excede o limite de renderização OCR (${MAX_OCR_CANVAS_PIXELS.toLocaleString("pt-BR")} pixels por página); o processamento foi cancelado.`,
    );
  }
}

export type OcrProgress = { status: string; progress: number };
export type DocumentReadResult = {
  text: string;
  method: "text-layer" | "ocr" | "empty";
  confidence: number;
  pages: number;
  warning?: string;
};

type OcrResult = { text: string; confidence: number };
type PdfTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
};

async function recognizeBlob(
  file: Blob,
  onProgress?: (progress: OcrProgress) => void,
): Promise<OcrResult> {
  assertLocalFileSize(file, "Arquivo para OCR");
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("por+eng", 1, {
    logger: (event) => {
      if (event.status === "recognizing text") {
        onProgress?.({ status: event.status, progress: event.progress });
      }
    },
  });

  try {
    const result = await worker.recognize(file);
    return {
      text: result.data.text.trim().slice(0, 200000),
      confidence: Number(result.data.confidence || 0),
    };
  } finally {
    await worker.terminate();
  }
}

export async function runLocalOcr(
  file: Blob,
  onProgress?: (progress: OcrProgress) => void,
): Promise<string> {
  assertLocalFileSize(file, "Arquivo para OCR");
  return (await recognizeBlob(file, onProgress)).text;
}

function isPdfTextItem(item: unknown): item is PdfTextItem {
  if (!item || typeof item !== "object") return false;
  const candidate = item as Partial<PdfTextItem>;
  return (
    typeof candidate.str === "string" &&
    Array.isArray(candidate.transform) &&
    typeof candidate.width === "number"
  );
}

/** Reconstruct line breaks from PDF.js text coordinates and its hasEOL hints. */
function extractPdfLines(items: readonly unknown[]): string {
  const output: string[] = [];
  let previousY: number | undefined;
  let previousRight: number | undefined;
  let previousFontSize = 0;

  for (const rawItem of items) {
    if (!isPdfTextItem(rawItem) || !rawItem.str) continue;

    const item = rawItem;
    const x = item.transform[4] ?? 0;
    const y = item.transform[5] ?? 0;
    const fontSize =
      Math.abs(item.height) || Math.abs(item.transform[3] ?? 0) || 10;
    const movedToAnotherLine =
      previousY !== undefined &&
      Math.abs(y - previousY) > Math.max(2, Math.min(fontSize, previousFontSize) * 0.35);

    if (movedToAnotherLine) {
      output.push("\n");
      previousRight = undefined;
    } else if (previousRight !== undefined) {
      const gap = x - previousRight;
      if (
        gap > Math.max(1.5, fontSize * 0.2) &&
        !/\s$/.test(output[output.length - 1] ?? "") &&
        !/^\s/.test(item.str)
      ) {
        output.push(" ");
      }
    }

    output.push(item.str);
    previousY = y;
    previousRight = x + item.width;
    previousFontSize = fontSize;

    if (item.hasEOL) {
      output.push("\n");
      previousY = undefined;
      previousRight = undefined;
      previousFontSize = 0;
    }
  }

  return output.join("").replace(/[\t ]+\n/g, "\n").trim();
}

async function readPdf(
  file: Blob,
  onProgress?: (progress: OcrProgress) => void,
): Promise<DocumentReadResult> {
  const pdfjs = (await import(
    "pdfjs-dist/legacy/build/pdf.mjs"
  )) as typeof import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  const pageTexts: string[] = [];
  const ocrConfidences: number[] = [];
  const failedPages: number[] = [];

  try {
    assertPdfPageCount(pdf.numPages);
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      let pageText = "";
      let page: Awaited<ReturnType<typeof pdf.getPage>> | undefined;

      try {
        page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        pageText = extractPdfLines(content.items);
      } catch {
        failedPages.push(pageNumber);
      }

      // A sparse text layer can coexist with a scanned page; OCR that page too.
      const needsOcr = pageText.replace(/\s/g, "").length < 80;
      let ocrText = "";

      if (needsOcr) {
        const confidenceIndex = ocrConfidences.length;
        ocrConfidences.push(0);
        let canvas: HTMLCanvasElement | undefined;
        try {
          page ??= await pdf.getPage(pageNumber);
          const viewport = page.getViewport({ scale: 1.65 });
          assertOcrCanvasBounds(viewport.width, viewport.height, pageNumber);
          const activeCanvas = document.createElement("canvas");
          canvas = activeCanvas;
          activeCanvas.width = Math.ceil(viewport.width);
          activeCanvas.height = Math.ceil(viewport.height);
          const context = activeCanvas.getContext("2d");

          if (!context) throw new Error("Canvas indisponível para OCR.");

          await page.render({ canvas: activeCanvas, canvasContext: context, viewport }).promise;
          const canvasBlob = await new Promise<Blob | null>((resolve) =>
            activeCanvas.toBlob(resolve, "image/png"),
          );
          if (!canvasBlob) throw new Error("Não foi possível renderizar a página.");

          const result = await recognizeBlob(canvasBlob, (progress) =>
            onProgress?.({
              status: `OCR página ${pageNumber}/${pdf.numPages}`,
              progress:
                (pageNumber - 1 + Math.min(1, progress.progress)) / pdf.numPages,
            }),
          );
          ocrText = result.text;
          ocrConfidences[confidenceIndex] = result.confidence;
        } catch (error) {
          if (error instanceof LocalDocumentLimitError) throw error;
          failedPages.push(pageNumber);
        } finally {
          if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
          }
        }
      }

      const combinedPageText = [pageText, ocrText].filter(Boolean).join("\n");
      if (combinedPageText) pageTexts.push(combinedPageText);
      onProgress?.({
        status: `Lendo página ${pageNumber}/${pdf.numPages}`,
        progress: pageNumber / pdf.numPages,
      });
    }
  } finally {
    await loadingTask.destroy();
  }

  const text = pageTexts.join("\n\n").trim().slice(0, 300000);
  const method = !text ? "empty" : ocrConfidences.length ? "ocr" : "text-layer";
  const confidence = ocrConfidences.length
    ? ocrConfidences.reduce((sum, value) => sum + value, 0) /
      ocrConfidences.length
    : text
      ? 100
      : 0;

  return {
    text,
    method,
    confidence,
    pages: pdf.numPages,
    warning: failedPages.length
      ? `Não foi possível ler ou reconhecer a(s) página(s) ${[...new Set(failedPages)].join(", ")}.`
      : undefined,
  };
}

export async function readDocumentText(
  file: File,
  onProgress?: (progress: OcrProgress) => void,
): Promise<DocumentReadResult> {
  assertLocalFileSize(file, "Documento");
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (isPdf) return readPdf(file, onProgress);

  if (file.type.startsWith("image/")) {
    const result = await recognizeBlob(file, onProgress);
    return {
      text: result.text,
      method: result.text ? "ocr" : "empty",
      confidence: result.confidence,
      pages: 1,
    };
  }

  if (/\.(xlsx|xls|ods)$/i.test(file.name) || /spreadsheet|excel/.test(file.type)) {
    return {
      text: "",
      method: "empty",
      confidence: 0,
      pages: 0,
      warning: "Leitura de planilhas Excel foi desativada por segurança. Salve ou exporte o arquivo como CSV e importe novamente.",
    };
  }

  if (file.type.startsWith("text/") || /\.(txt|csv|json|xml|html?)$/i.test(file.name)) {
    const text = (await file.text()).trim();
    return {
      text: text.slice(0, 300000),
      method: text ? "text-layer" : "empty",
      confidence: text ? 100 : 0,
      pages: 1,
    };
  }

  return {
    text: "",
    method: "empty",
    confidence: 0,
    pages: 0,
    warning: "Formato sem leitor local seguro.",
  };
}
