export type OcrProgress = { status: string; progress: number };
export type DocumentReadResult = {
  text: string;
  method: "text-layer" | "ocr" | "empty";
  confidence: number;
  pages: number;
  warning?: string;
};

type OcrResult = { text: string; confidence: number };

async function readSpreadsheet(file: File): Promise<DocumentReadResult> {
  const xlsx = await import("xlsx");
  const workbook = xlsx.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const text = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    return `## ${name}\n${xlsx.utils.sheet_to_csv(sheet, { FS: "\t", RS: "\n" })}`;
  }).join("\n").trim();
  return { text: text.slice(0, 300000), method: text ? "text-layer" : "empty", confidence: text ? 100 : 0, pages: workbook.SheetNames.length };
}

async function recognizeBlob(file: Blob, onProgress?: (progress: OcrProgress) => void): Promise<OcrResult> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("por+eng", 1, {
    logger: (event) => {
      if (event.status === "recognizing text") onProgress?.({ status: event.status, progress: event.progress });
    },
  });
  try {
    const result = await worker.recognize(file);
    return { text: result.data.text.trim().slice(0, 200000), confidence: Number(result.data.confidence || 0) };
  } finally {
    await worker.terminate();
  }
}

export async function runLocalOcr(file: Blob, onProgress?: (progress: OcrProgress) => void): Promise<string> {
  return (await recognizeBlob(file, onProgress)).text;
}

async function readPdf(file: Blob, onProgress?: (progress: OcrProgress) => void): Promise<DocumentReadResult> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs") as typeof import("pdfjs-dist/legacy/build/pdf.mjs");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: bytes, disableWorker: true }).promise;
  const textParts: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => "str" in item ? item.str : "").join(" ").replace(/\s+/g, " ").trim();
    if (pageText) textParts.push(pageText);
  }
  const textLayer = textParts.join("\n").trim();
  if (textLayer.length >= 80) return { text: textLayer.slice(0, 300000), method: "text-layer", confidence: 100, pages: pdf.numPages };

  const ocrParts: string[] = [];
  let confidenceTotal = 0;
  const maxPages = Math.min(pdf.numPages, 30);
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.65 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) continue;
    await page.render({ canvasContext: context, viewport }).promise;
    const result = await recognizeBlob(canvas, (progress) => onProgress?.({ ...progress, progress: ((pageNumber - 1) + progress.progress) / maxPages }));
    if (result.text) ocrParts.push(result.text);
    confidenceTotal += result.confidence;
  }
  const ocrText = ocrParts.join("\n").trim().slice(0, 300000);
  const confidence = maxPages ? confidenceTotal / maxPages : 0;
  return { text: ocrText, method: ocrText ? "ocr" : "empty", confidence, pages: pdf.numPages, warning: pdf.numPages > maxPages ? `OCR limitado às primeiras ${maxPages} páginas.` : undefined };
}

export async function readDocumentText(file: File, onProgress?: (progress: OcrProgress) => void): Promise<DocumentReadResult> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (isPdf) return readPdf(file, onProgress);
  if (file.type.startsWith("image/")) {
    const result = await recognizeBlob(file, onProgress);
    return { text: result.text, method: result.text ? "ocr" : "empty", confidence: result.confidence, pages: 1 };
  }
  if (/\.(xlsx|xls|ods)$/i.test(file.name) || /spreadsheet|excel/.test(file.type)) {
    return readSpreadsheet(file);
  }
  if (file.type.startsWith("text/") || /\.(txt|csv|json|xml|html?)$/i.test(file.name)) {
    const text = (await file.text()).trim();
    return { text: text.slice(0, 300000), method: text ? "text-layer" : "empty", confidence: text ? 100 : 0, pages: 1 };
  }
  return { text: "", method: "empty", confidence: 0, pages: 0, warning: "Formato sem leitor local seguro." };
}
