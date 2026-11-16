export type LocalDocumentRecord = {
  id: string;
  processing?: boolean;
};

export type DocumentDeletionResult<T> =
  | { status: "cancelled" }
  | { status: "not-found" | "processing" | "deleted"; records: T[] };

let mutationQueue: Promise<void> = Promise.resolve();

function serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Deletes only the requested ID after the caller confirms, using the latest collection. */
export function deleteDocumentFromLatest<T extends LocalDocumentRecord>(
  id: string,
  confirmed: boolean,
  readLatest: () => Promise<T[]>,
  writeLatest: (records: T[]) => Promise<void>,
): Promise<DocumentDeletionResult<T>> {
  if (!confirmed) return Promise.resolve({ status: "cancelled" });

  return serializeMutation(async () => {
    const latest = await readLatest();
    const target = latest.find((record) => record.id === id);
    if (!target) return { status: "not-found", records: latest };
    if (target.processing) return { status: "processing", records: latest };

    const remaining = latest.filter((record) => record.id !== id);
    await writeLatest(remaining);
    return { status: "deleted", records: remaining };
  });
}

/** Applies an OCR/status update only while the original record still exists. */
export function updateExistingDocument<T extends LocalDocumentRecord>(
  document: T,
  readLatest: () => Promise<T[]>,
  writeLatest: (records: T[]) => Promise<void>,
): Promise<T[]> {
  return serializeMutation(async () => {
    const latest = await readLatest();
    if (!latest.some((record) => record.id === document.id)) return latest;

    const updated = [document, ...latest.filter((record) => record.id !== document.id)];
    await writeLatest(updated);
    return updated;
  });
}
