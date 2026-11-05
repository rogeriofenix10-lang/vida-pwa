export type OcrProgress = { status: string; progress: number };

export async function runLocalOcr(
  file: Blob,
  onProgress?: (progress: OcrProgress) => void,
): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("por+eng", 1, {
    logger: (event) => {
      if (event.status === "recognizing text")
        onProgress?.({ status: event.status, progress: event.progress });
    },
  });
  try {
    const result = await worker.recognize(file);
    return result.data.text.trim().slice(0, 200000);
  } finally {
    await worker.terminate();
  }
}
