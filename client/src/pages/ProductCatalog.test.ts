import { describe, expect, it } from "vitest";
import { parseProductCsv, productCsv } from "./ProductCatalog";
import {
  makeProductCatalogFileRecord,
  sanitizeCatalogFilename,
} from "@/lib/catalogFiles";
import {
  mergeCatalogProducts,
  parseProductJson,
  type Product,
} from "@/lib/catalogImport";
import { createProductCatalogPdf } from "@/lib/catalogPdf";

const existingProduct: Product = {
  id: "existing-id",
  name: "Arroz integral",
  code: "SKU-1",
  price: "12,50",
  stock: "7",
  category: "Mercado",
  description: "Embalagem de 1 kg",
  createdAt: "2024-01-02T03:04:05.000Z",
};

describe("ProductCatalog CSV", () => {
  it("imports quoted pt-BR semicolon CSV and maps headers by name", () => {
    const csv =
      '\uFEFFnome;código;preço;estoque;categoria;descrição\r\n"Feijão";"A;1";"R$ 12,50";4;Mercado;"Feijão; preto"';
    expect(parseProductCsv(csv)).toEqual([
      {
        name: "Feijão",
        code: "A;1",
        price: "R$ 12,50",
        stock: "4",
        category: "Mercado",
        description: "Feijão; preto",
      },
    ]);
  });

  it("recognizes comma CSV with reordered English/Portuguese aliases", () => {
    const csv =
      "categoria,nome,sku,valor,quantidade,detalhes\nMercado,Arroz,SKU-2,8.50,12,Tipo longo";
    expect(parseProductCsv(csv)[0]).toMatchObject({
      name: "Arroz",
      code: "SKU-2",
      price: "8.50",
      stock: "12",
      category: "Mercado",
      description: "Tipo longo",
    });
  });

  it("rejects missing headers and all rows if any row is malformed", () => {
    expect(() => parseProductCsv("item;valor\nArroz;10")).toThrow(
      "Cabeçalho CSV inválido",
    );
    const invalidRows = [
      "nome,codigo,preco,estoque,categoria,descricao",
      "Arroz,A1,10,2,Alimentos,",
      ",A2,12,3,Alimentos,sem nome",
      "Feijão,A3,9,2,Alimentos",
    ].join("\n");
    expect(() => parseProductCsv(invalidRows)).toThrow(
      "2 linha(s) inválida(s)",
    );
    expect(() => parseProductCsv(invalidRows)).toThrow(
      "nenhuma alteração foi feita",
    );
  });

  it("neutralizes imported fields during CSV export and doubles embedded quotes", () => {
    const output = productCsv([
      {
        ...existingProduct,
        name: " \t=1+1",
        code: 'A"B',
        price: "-10",
        description: "@SUM(A1)",
      },
    ]);
    expect(output).toContain('"\' \t=1+1"');
    expect(output).toContain('"A""B"');
    expect(output).toContain('"\'-10"');
    expect(output).toContain('"\'@SUM(A1)"');
    expect(output).toContain("\r\n");
  });
});

describe("ProductCatalog JSON import and preservation", () => {
  it("reads the catalog export shape while regenerating identifiers", () => {
    const parsed = parseProductJson(
      JSON.stringify({
        format: "iris-product-catalog",
        exportedAt: "synthetic",
        products: [{ ...existingProduct, image: undefined }],
      }),
    );
    expect(parsed).toEqual([
      {
        name: existingProduct.name,
        code: existingProduct.code,
        price: existingProduct.price,
        stock: existingProduct.stock,
        category: existingProduct.category,
        description: existingProduct.description,
      },
    ]);
    const merged = mergeCatalogProducts(
      [],
      parsed,
      "synthetic-time",
      () => "new-id",
    );
    expect(merged.products[0]).toMatchObject({
      id: "new-id",
      createdAt: "synthetic-time",
    });
    expect(merged.products[0].id).not.toBe(existingProduct.id);
  });

  it("adds only new exact records and leaves existing product history untouched", () => {
    const snapshot = structuredClone(existingProduct);
    const imported = parseProductJson(
      JSON.stringify({
        products: [
          { ...existingProduct, id: "replace-me", createdAt: "new-time" },
          {
            name: "Farinha",
            code: "SKU-2",
            price: "8",
            stock: "4",
            category: "Mercado",
            description: "Tipo 1",
          },
          {
            name: " farinha ",
            code: " sku-2 ",
            price: "8",
            stock: "4",
            category: "mercado",
            description: "Tipo 1",
          },
        ],
      }),
    );
    const result = mergeCatalogProducts(
      [existingProduct],
      imported,
      "new-time",
      () => "new-product-id",
    );
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.products).toHaveLength(2);
    expect(result.products[0]).toMatchObject({
      id: "new-product-id",
      name: "Farinha",
    });
    expect(result.products[1]).toEqual(snapshot);
    expect(existingProduct).toEqual(snapshot);
  });

  it("rejects malformed, oversized, external-image and unknown-field payloads without partial products", () => {
    expect(() => parseProductJson("not json")).toThrow("JSON inválido");
    expect(() =>
      parseProductJson(
        JSON.stringify({ format: "other", products: [{ name: "A" }] }),
      ),
    ).toThrow("Formato JSON diferente");
    expect(() =>
      parseProductJson(JSON.stringify([{ name: "A", extra: "would be lost" }])),
    ).toThrow("campo não reconhecido");
    expect(() =>
      parseProductJson(
        JSON.stringify([
          { name: "A", image: "https://example.invalid/image.png" },
        ]),
      ),
    ).toThrow("imagens externas");
    expect(() => parseProductJson(JSON.stringify([{ name: "" }]))).toThrow(
      "não tem nome",
    );
  });
});

describe("ProductCatalog original files", () => {
  it("sanitizes names and preserves exact original bytes in a Blob", async () => {
    expect(sanitizeCatalogFilename("../catálogo\u202E.pdf")).toBe(
      "_catálogo_.pdf",
    );
    const inputBytes = new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x00, 0xff,
    ]);
    const original = new File([inputBytes], "catálogo.pdf", {
      type: "application/pdf",
    });
    const record = makeProductCatalogFileRecord(
      original,
      "synthetic-time",
      () => "file-id",
    );
    expect(record.name).toBe("catálogo.pdf");
    expect(record.mime).toBe("application/pdf");
    expect(record.size).toBe(inputBytes.length);
    expect(new Uint8Array(await record.blob.arrayBuffer())).toEqual(inputBytes);
  });

  it("rejects a file above the 50 MB local limit before slicing or archiving it", () => {
    const oversized = {
      name: "catálogo.pdf",
      size: 50 * 1024 * 1024 + 1,
      type: "application/pdf",
      slice: () => {
        throw new Error("A file above the limit must not be read");
      },
    } as unknown as File;
    expect(() => makeProductCatalogFileRecord(oversized)).toThrow(
      "excede o limite local de 50 MB",
    );
  });
});

describe("ProductCatalog PDF export", () => {
  it("produces a parseable paginated PDF with every text field intact", async () => {
    const description = `Início da descrição · ${"medidas e características completas; ".repeat(450)}FIM-DO-CAMPO-SEM-CORTE`;
    const pdf = await createProductCatalogPdf(
      [
        {
          ...existingProduct,
          name: "Produto de teste · edição especial",
          description,
        },
      ],
      new Date("2026-11-15T12:00:00.000Z"),
    );
    expect(pdf.type).toBe("application/pdf");
    expect(pdf.size).toBeGreaterThan(1000);
    expect(new TextDecoder().decode(await pdf.slice(0, 5).arrayBuffer())).toBe(
      "%PDF-",
    );

    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(await pdf.arrayBuffer()),
      disableWorker: true,
      useSystemFonts: true,
    });
    const document = await loadingTask.promise;
    expect(document.numPages).toBeGreaterThan(1);
    const text: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      text.push(
        ...content.items.flatMap((item) => ("str" in item ? [item.str] : [])),
      );
    }
    const extracted = text.join(" ");
    expect(extracted).toContain("Produto de teste");
    expect(extracted).toContain("CÓDIGO");
    expect(extracted).toContain("12,50");
    expect(extracted).toContain("FIM-DO-CAMPO-SEM-CORTE");
    expect(extracted).toContain(
      `Página ${document.numPages} de ${document.numPages}`,
    );
    await loadingTask.destroy();
  });
});
