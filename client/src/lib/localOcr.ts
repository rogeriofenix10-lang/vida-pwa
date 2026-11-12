import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { assertLocalFileSize } from "@/lib/irisLocalStore";
// Guardrails for local-only OCR: a 50 MiB file cap is applied before reads;
// ordinary bills fit within 100 pages and each OCR page is capped at 16 MP.
export const MAX_PDF_PAGES = 100;
export const MAX_OCR_CANVAS_PIXELS = 16_000_000;
export const MAX_OCR_CANVAS_DIMENSION = 8192;
const MIN_RELIABLE_OCR_CONFIDENCE = 35;

export class LocalDocumentLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalDocumentLimitError";
  }
}

export function assertPdfPageCount(pageCount: number) {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
    throw new LocalDocumentLimitError(
      "O PDF informa uma quantidade de páginas inválida.",
    );
  }
  if (pageCount > MAX_PDF_PAGES) {
    throw new LocalDocumentLimitError(
      `PDF acima do limite local de ${MAX_PDF_PAGES} páginas; a leitura foi cancelada.`,
    );
  }
}

export function assertOcrCanvasBounds(
  width: number,
  height: number,
  pageNumber: number,
) {
  const pixelWidth = Math.ceil(width);
  const pixelHeight = Math.ceil(height);
  if (
    !Number.isFinite(pixelWidth) ||
    !Number.isFinite(pixelHeight) ||
    pixelWidth < 1 ||
    pixelHeight < 1 ||
    pixelWidth > MAX_OCR_CANVAS_DIMENSION ||
    pixelHeight > MAX_OCR_CANVAS_DIMENSION ||
    pixelWidth * pixelHeight > MAX_OCR_CANVAS_PIXELS
  ) {
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
export type ReadDocumentOptions = { forceOcr?: boolean };
type OcrResult = { text: string; confidence: number };
type PdfTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
};
type PositionedPdfTextItem = PdfTextItem & {
  x: number;
  y: number;
  fontSize: number;
  order: number;
};
type PdfVisualLine = { items: PositionedPdfTextItem[]; baseline: number };

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
    typeof candidate.width === "number" &&
    typeof candidate.height === "number"
  );
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

const DATE_AT_START =
  /^(?:(?:\d{4}[./-]\d{1,2}[./-]\d{1,2})|(?:\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?)|(?:\d{1,2}\s*[a-zà-öø-ÿ]{3,}))/i;
const MONEY_AT_END =
  /(?:\b(?:R\$|US\$|BRL|USD|EUR)\s*)?[-−(]?\s*(?:\d{1,3}(?:[.\s]\d{3})+|\d+)(?:[,.]\d{2})\s*\)?\s*$/i;

function startsWithDate(
  items: readonly PositionedPdfTextItem[],
  index: number,
): boolean {
  const nextItems = items.slice(index, index + 3);
  const candidate = nextItems
    .map((item) => item.str)
    .join("")
    .trim();
  return DATE_AT_START.test(candidate);
}

function renderVisualLine(items: readonly PositionedPdfTextItem[]): string[] {
  const ordered = [...items].sort(
    (left, right) => left.x - right.x || left.order - right.order,
  );
  const rendered: string[] = [];
  let current = "";
  let previous: PositionedPdfTextItem | undefined;
  const typicalFontSize = median(ordered.map((item) => item.fontSize)) || 10;

  for (let index = 0; index < ordered.length; index += 1) {
    const item = ordered[index];
    const text = item.str;
    const gap = previous ? item.x - (previous.x + previous.width) : 0;
    const largeColumnGap = Math.max(26, typicalFontSize * 2.8);
    const separatesTransactions =
      previous !== undefined &&
      gap >= largeColumnGap &&
      MONEY_AT_END.test(current) &&
      startsWithDate(ordered, index);

    if (separatesTransactions) {
      if (current.trim()) rendered.push(current.trimEnd());
      current = text.trimStart();
    } else {
      const ordinaryGap = Math.max(1.5, item.fontSize * 0.2);
      if (
        previous &&
        gap > ordinaryGap &&
        !/[\s]$/.test(current) &&
        !/^\s/.test(text)
      ) {
        current += " ";
      }
      current += text;
    }
    previous = item;
  }

  if (current.trim()) rendered.push(current.trimEnd());
  return rendered;
}

/** Reconstruct visual reading order from PDF.js coordinates, including common two-column transaction rows. */
export function extractPdfLines(items: readonly unknown[]): string {
  const positioned: PositionedPdfTextItem[] = [];
  items.forEach((rawItem, order) => {
    if (!isPdfTextItem(rawItem) || !rawItem.str) return;
    const x = Number(rawItem.transform[4] ?? 0);
    const y = Number(rawItem.transform[5] ?? 0);
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(rawItem.width)
    )
      return;
    const fontSize =
      Math.abs(rawItem.height) ||
      Math.abs(Number(rawItem.transform[3] ?? 0)) ||
      10;
    positioned.push({ ...rawItem, x, y, fontSize, order });
  });

  // PDF.js may emit text objects in content-stream order rather than visual order.
  // Group baselines first, then sort each baseline from left to right.
  const sortedByY = positioned.sort(
    (left, right) =>
      right.y - left.y || left.x - right.x || left.order - right.order,
  );
  const visualLines: PdfVisualLine[] = [];
  for (const item of sortedByY) {
    const activeLine = visualLines[visualLines.length - 1];
    const referenceFontSize = activeLine
      ? median(activeLine.items.map((lineItem) => lineItem.fontSize))
      : item.fontSize;
    const baselineTolerance = Math.max(
      2,
      Math.min(item.fontSize, referenceFontSize || item.fontSize) * 0.35,
    );
    if (
      !activeLine ||
      Math.abs(item.y - activeLine.baseline) > baselineTolerance
    ) {
      visualLines.push({ items: [item], baseline: item.y });
    } else {
      activeLine.items.push(item);
      activeLine.baseline = median(
        activeLine.items.map((lineItem) => lineItem.y),
      );
    }
  }

  return visualLines
    .flatMap((line) => renderVisualLine(line.items))
    .join("\n")
    .replace(/[\t ]+\n/g, "\n")
    .trim();
}

const MONTH_NAMES =
  "(?:jan(?:eiro|uary)?|fev(?:ereiro)?|feb(?:ruary)?|mar(?:ço|co|ch)?|abr(?:il)?|apr(?:il)?|mai(?:o)?|may|jun(?:ho|e)?|jul(?:ho|y)?|ago(?:sto)?|aug(?:ust)?|set(?:embro)?|sep(?:tember)?|out(?:ubro)?|oct(?:ober)?|nov(?:embro|ember)?|dez(?:embro)?|dec(?:ember)?)";
const DATE_PATTERN = `\\b(?:\\d{4}[./-]\\d{1,2}[./-]\\d{1,2}|\\d{1,2}[./-]\\d{1,2}[./-]\\d{2,4}|\\d{1,2}\\s+${MONTH_NAMES}(?:\\s*,?\\s*\\d{2,4})?)\\b`;
const DATE_IN_TEXT = new RegExp(DATE_PATTERN, "gi");
const DATE_TO_MASK = new RegExp(DATE_PATTERN, "gi");
const MONEY_IN_TEXT =
  /(?:\b(?:R\$|US\$|BRL|USD|EUR)\s*[-−]?\s*\d)|(?:\b\d{1,3}(?:[. ]\d{3})*(?:,\d{2}|\.\d{2})\b)|(?:\b\d+[,\.]\d{2}\b)/i;
const TRANSACTION_TERMS =
  /\b(?:transa(?:ç|c)[õo]es?|lan[cç]amentos?|compras?|hist[oó]rico|estabelecimentos?|despesas?|movimenta[cç][õo]es?)\b/i;

function hasMonetaryValue(text: string): boolean {
  const withoutDates = text.replace(DATE_TO_MASK, " ");
  return MONEY_IN_TEXT.test(withoutDates);
}

function isCorruptedPdfText(text: string): boolean {
  if (!text) return false;
  const suspiciousCount = (
    text.match(/[�\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g) ?? []
  ).length;
  return suspiciousCount >= 2 || suspiciousCount / text.length >= 0.015;
}

function shouldOcrPage(pageText: string, forceOcr: boolean): boolean {
  if (forceOcr) return true;
  const visibleLength = pageText.replace(/\s/g, "").length;
  if (visibleLength < 80) return true;
  if (isCorruptedPdfText(pageText)) return true;
  if (hasMonetaryValue(pageText)) return false;
  const dateCount = [...pageText.matchAll(DATE_IN_TEXT)].length;
  return dateCount >= 2 || (dateCount >= 1 && TRANSACTION_TERMS.test(pageText));
}

function isReliableOcrResult(result: OcrResult): boolean {
  const recognizedCharacters = (result.text.match(/[\p{L}\p{N}]/gu) ?? [])
    .length;
  return (
    result.text.trim().length > 0 &&
    recognizedCharacters >= 3 &&
    Number.isFinite(result.confidence) &&
    result.confidence >= MIN_RELIABLE_OCR_CONFIDENCE
  );
}

function normalizeConfidence(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

async function readPdf(
  file: Blob,
  onProgress?: (progress: OcrProgress) => void,
  options: ReadDocumentOptions = {},
): Promise<DocumentReadResult> {
  const pdfjs =
    (await import("pdfjs-dist/legacy/build/pdf.mjs")) as typeof import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  const pageTexts: string[] = [];
  const pageConfidences: number[] = [];
  const selectedMethods: Array<"text-layer" | "ocr" | "empty"> = [];
  const unreadablePages: number[] = [];
  const failedOcrPages: number[] = [];
  const lowConfidenceOcrPages: number[] = [];
  const corruptedFallbackPages: number[] = [];

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
        // A scanned PDF or forceOcr may still be recoverable from its rendered page.
      }

      let selectedText = pageText;
      let selectedMethod: "text-layer" | "ocr" | "empty" = pageText
        ? "text-layer"
        : "empty";
      let selectedConfidence = pageText
        ? isCorruptedPdfText(pageText)
          ? 35
          : 100
        : 0;
      if (shouldOcrPage(pageText, Boolean(options.forceOcr))) {
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
          await page.render({
            canvas: activeCanvas,
            canvasContext: context,
            viewport,
          }).promise;
          const canvasBlob = await new Promise<Blob | null>((resolve) =>
            activeCanvas.toBlob(resolve, "image/png"),
          );
          if (!canvasBlob)
            throw new Error("Não foi possível renderizar a página.");
          const result = await recognizeBlob(canvasBlob, (progress) =>
            onProgress?.({
              status: `OCR página ${pageNumber}/${pdf.numPages}`,
              progress:
                (pageNumber - 1 + Math.min(1, progress.progress)) /
                pdf.numPages,
            }),
          );
          if (isReliableOcrResult(result)) {
            // Select exactly one source per page; never append OCR to the PDF text layer.
            selectedText = result.text.trim();
            selectedMethod = "ocr";
            selectedConfidence = normalizeConfidence(result.confidence);
          } else {
            lowConfidenceOcrPages.push(pageNumber);
          }
        } catch (error) {
          if (error instanceof LocalDocumentLimitError) throw error;
          failedOcrPages.push(pageNumber);
        } finally {
          if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
          }
        }
      }

      if (selectedText) pageTexts.push(selectedText);
      else unreadablePages.push(pageNumber);
      selectedMethods.push(selectedMethod);
      pageConfidences.push(selectedConfidence);
      if (selectedMethod === "text-layer" && isCorruptedPdfText(selectedText)) {
        corruptedFallbackPages.push(pageNumber);
      }
      onProgress?.({
        status: `Lendo página ${pageNumber}/${pdf.numPages}`,
        progress: pageNumber / pdf.numPages,
      });
    }
  } finally {
    await loadingTask.destroy();
  }

  const text = pageTexts.join("\n\n").trim().slice(0, 300000);
  const hasOcrText = selectedMethods.includes("ocr");
  const hasTextLayer = selectedMethods.includes("text-layer");
  const method = hasOcrText ? "ocr" : hasTextLayer ? "text-layer" : "empty";
  const confidence = pageConfidences.length
    ? Math.round(
        pageConfidences.reduce((sum, value) => sum + value, 0) /
          pageConfidences.length,
      )
    : 0;
  const warnings: string[] = [];
  if (unreadablePages.length) {
    warnings.push(
      `Não foi possível ler ou reconhecer a(s) página(s) ${unreadablePages.join(", ")}.`,
    );
  }
  if (failedOcrPages.length) {
    warnings.push(
      `O OCR falhou na(s) página(s) ${failedOcrPages.join(", ")}; o texto nativo foi mantido quando disponível.`,
    );
  }
  if (lowConfidenceOcrPages.length) {
    warnings.push(
      `O OCR teve baixa confiança na(s) página(s) ${lowConfidenceOcrPages.join(", ")}; o texto nativo foi mantido quando disponível.`,
    );
  }
  if (corruptedFallbackPages.length) {
    warnings.push(
      `O texto nativo da(s) página(s) ${corruptedFallbackPages.join(", ")} parece corrompido; confira a leitura antes de importar.`,
    );
  }
  return {
    text,
    method,
    confidence,
    pages: pdf.numPages,
    warning: warnings.length ? warnings.join(" ") : undefined,
  };
}

export async function readDocumentText(
  file: File,
  onProgress?: (progress: OcrProgress) => void,
  options: ReadDocumentOptions = {},
): Promise<DocumentReadResult> {
  assertLocalFileSize(file, "Documento");
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (isPdf) return readPdf(file, onProgress, options);
  if (file.type.startsWith("image/")) {
    const result = await recognizeBlob(file, onProgress);
    return {
      text: result.text,
      method: result.text ? "ocr" : "empty",
      confidence: result.confidence,
      pages: 1,
    };
  }
  if (
    /\.(xlsx|xls|ods)$/i.test(file.name) ||
    /spreadsheet|excel/.test(file.type)
  ) {
    return {
      text: "",
      method: "empty",
      confidence: 0,
      pages: 0,
      warning:
        "Leitura de planilhas Excel foi desativada por segurança. Salve ou exporte o arquivo como CSV e importe novamente.",
    };
  }
  if (
    file.type.startsWith("text/") ||
    /\.(txt|csv|json|xml|html?)$/i.test(file.name)
  ) {
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
