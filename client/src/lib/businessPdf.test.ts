import { describe, expect, it } from "vitest";
import { createBusinessClientPdf } from "./businessPdf";

describe("carteira PDF local", () => {
  it("preserves every long field within readable page bounds", async () => {
    const pdf = await createBusinessClientPdf([{
      id: "synthetic", kind: "cliente", name: "Cliente de teste", company: "Empresa de teste", amount: 0,
      status: "ativo", createdAt: "2026-11-15", notes: `${"observação extensa; ".repeat(2000)}FIM-NOTAS-SEM-CORTE`,
      economicGroup: "Grupo teste", city: "Recife", state: "PE", extraFields: { código: "FIM-EXTRA-PRESERVADO" },
    }]);
    const bytes = new Uint8Array(pdf.output("arraybuffer"));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument({ data: bytes, disableWorker: true, useSystemFonts: true });
    const doc = await task.promise;
    expect(doc.numPages).toBeGreaterThan(1);
    let text = "";
    for (let pageIndex = 1; pageIndex <= doc.numPages; pageIndex++) {
      const page = await doc.getPage(pageIndex);
      const content = await page.getTextContent();
      for (const item of content.items) if ("str" in item) {
        text += `${item.str} `;
        expect(item.transform[5]).toBeGreaterThan(20);
        expect(item.transform[5]).toBeLessThan(page.view[3]);
      }
    }
    expect(text).toContain("FIM-NOTAS-SEM-CORTE");
    expect(text).toContain("FIM-EXTRA-PRESERVADO");
    await task.destroy();
  });
});
