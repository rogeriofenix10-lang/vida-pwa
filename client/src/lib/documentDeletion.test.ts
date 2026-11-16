import { describe, expect, it } from "vitest";
import {
  deleteDocumentFromLatest,
  updateExistingDocument,
  type LocalDocumentRecord,
} from "./documentDeletion";

type TestDocument = LocalDocumentRecord & {
  name: string;
  kind?: string;
  blob?: Blob;
  statementTotal?: number;
  money?: Array<{ category: string; amount: number }>;
  extractedText?: string;
};

const writeNoop = async (_records: TestDocument[]) => undefined;

describe("local document deletion", () => {
  it("does not read or write when deletion is cancelled", async () => {
    let reads = 0;
    let writes = 0;
    const result = await deleteDocumentFromLatest(
      "contract-1",
      false,
      async () => {
        reads += 1;
        return [{ id: "contract-1", name: "Contrato.pdf" }];
      },
      async () => {
        writes += 1;
      },
    );

    expect(result).toEqual({ status: "cancelled" });
    expect(reads).toBe(0);
    expect(writes).toBe(0);
  });

  it("removes only the selected ID from the latest collection and preserves other Blobs and metadata", async () => {
    const originalBlob = new Blob(["conteúdo sintético"], { type: "application/pdf" });
    const legacyFinance: TestDocument = {
      id: "finance-1",
      name: "Fatura antiga.pdf",
      kind: "financeiro",
      blob: originalBlob,
      statementTotal: 123.45,
      money: [{ category: "Hotel", amount: 123.45 }],
    };
    const newlyAddedContract: TestDocument = {
      id: "contract-2",
      name: "Outro contrato.pdf",
      blob: new Blob(["contrato"], { type: "application/pdf" }),
      customMetadata: { source: "synthetic" },
    } as TestDocument;
    const target: TestDocument = {
      id: "contract-1",
      name: "Contrato a excluir.pdf",
      blob: new Blob(["alvo"], { type: "application/pdf" }),
    };
    const staleComponentItems: TestDocument[] = [target, legacyFinance];
    const latest: TestDocument[] = [target, legacyFinance, newlyAddedContract];
    let reads = 0;
    let written: TestDocument[] | undefined;

    const result = await deleteDocumentFromLatest(
      target.id,
      true,
      async () => {
        reads += 1;
        return latest;
      },
      async (records) => {
        written = records;
      },
    );

    expect(reads).toBe(1);
    expect(staleComponentItems.map((record) => record.id)).toEqual(["contract-1", "finance-1"]);
    expect(result.status).toBe("deleted");
    if (result.status !== "deleted") throw new Error("A exclusão sintética deveria concluir.");
    expect(result.records.map((record) => record.id)).toEqual(["finance-1", "contract-2"]);
    expect(written).toBe(result.records);
    expect(result.records[0]).toBe(legacyFinance);
    expect(result.records[0].blob).toBe(originalBlob);
    expect(result.records[0].statementTotal).toBe(123.45);
    expect(result.records[0].money).toEqual([{ category: "Hotel", amount: 123.45 }]);
    expect(result.records[1]).toBe(newlyAddedContract);
    expect(result.records[1].blob).toBe(newlyAddedContract.blob);
    expect((result.records[1] as TestDocument & { customMetadata: { source: string } }).customMetadata)
      .toEqual({ source: "synthetic" });
  });

  it("does not write when the latest target is already processing", async () => {
    const processing: TestDocument = {
      id: "ocr-1",
      name: "Leitura.pdf",
      processing: true,
    };
    let writes = 0;
    const result = await deleteDocumentFromLatest(
      processing.id,
      true,
      async () => [processing],
      async () => {
        writes += 1;
      },
    );

    expect(result).toEqual({ status: "processing", records: [processing] });
    expect(writes).toBe(0);
  });

  it("leaves stored records unchanged if the persistence write fails", async () => {
    const stored: TestDocument[] = [
      { id: "remove-me", name: "Original.pdf" },
      { id: "keep-me", name: "Preservado.pdf" },
    ];
    const before = stored;

    await expect(
      deleteDocumentFromLatest(
        "remove-me",
        true,
        async () => stored,
        async () => {
          throw new Error("falha sintética de escrita");
        },
      ),
    ).rejects.toThrow("falha sintética de escrita");

    expect(stored).toBe(before);
    expect(stored.map((record) => record.id)).toEqual(["remove-me", "keep-me"]);
  });

  it("does not reinsert a deleted document when a queued OCR update completes", async () => {
    const original: TestDocument = {
      id: "ocr-race",
      name: "Leitura.pdf",
      extractedText: "",
    };
    let stored: TestDocument[] = [original];
    const readLatest = async () => stored;
    const writeLatest = async (records: TestDocument[]) => {
      stored = records;
    };

    const deletion = deleteDocumentFromLatest(
      original.id,
      true,
      readLatest,
      writeLatest,
    );
    const ocrUpdate = updateExistingDocument(
      { ...original, extractedText: "texto sintético" },
      readLatest,
      writeLatest,
    );

    const [deletionResult, updated] = await Promise.all([deletion, ocrUpdate]);
    expect(deletionResult.status).toBe("deleted");
    expect(updated).toEqual([]);
    expect(stored).toEqual([]);
  });

  it("does not write an OCR result when its document is absent from the latest IDs", async () => {
    let writes = 0;
    const updated = await updateExistingDocument(
      { id: "removed-before-ocr", name: "Leitura.pdf", extractedText: "texto" },
      async () => [{ id: "other", name: "Outro.pdf" }],
      async () => {
        writes += 1;
      },
    );

    expect(updated.map((record) => record.id)).toEqual(["other"]);
    expect(writes).toBe(0);
  });
});
