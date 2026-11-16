import type { Product } from "@/lib/catalogImport";

const PAGE_MARGIN = 42;
const FOOTER_RESERVE = 30;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

function supportedImage(image: string | undefined) {
  if (!image) return null;
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(
    image,
  );
  if (!match) return null;
  const encoded = match[2];
  const byteLength =
    Math.floor((encoded.length * 3) / 4) -
    (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
  if (!byteLength || byteLength > IMAGE_MAX_BYTES) return null;
  return {
    data: image,
    format: match[1].toUpperCase() === "PNG" ? "PNG" : "JPEG",
  } as const;
}

export async function createProductCatalogPdf(
  products: Product[],
  exportedAt = new Date(),
) {
  const { jsPDF } = await import("jspdf");
  const document = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "a4",
    compress: true,
  });
  const pageWidth = document.internal.pageSize.getWidth();
  const pageHeight = document.internal.pageSize.getHeight();
  const contentWidth = pageWidth - PAGE_MARGIN * 2;
  const contentBottom = pageHeight - PAGE_MARGIN - FOOTER_RESERVE;
  let y = PAGE_MARGIN;

  const nextPage = () => {
    document.addPage();
    y = PAGE_MARGIN;
  };
  const ensureSpace = (height: number) => {
    if (y + height > contentBottom) nextPage();
  };
  const writeWrapped = (
    value: string,
    options: {
      fontSize: number;
      bold?: boolean;
      color?: [number, number, number];
    },
  ) => {
    document.setFont("helvetica", options.bold ? "bold" : "normal");
    document.setFontSize(options.fontSize);
    document.setTextColor(...(options.color ?? [31, 41, 55]));
    const lines = document.splitTextToSize(
      value || "—",
      contentWidth,
    ) as string[];
    const lineHeight = options.fontSize * 1.38;
    for (const line of lines) {
      ensureSpace(lineHeight);
      document.text(line, PAGE_MARGIN, y);
      y += lineHeight;
    }
  };
  const writeField = (label: string, value: string) => {
    document.setFont("helvetica", "bold");
    document.setFontSize(8.5);
    document.setTextColor(83, 105, 126);
    ensureSpace(12);
    document.text(label.toLocaleUpperCase("pt-BR"), PAGE_MARGIN, y);
    y += 11;
    writeWrapped(value, { fontSize: 10, color: [31, 41, 55] });
    y += 3;
  };

  document.setFont("helvetica", "bold");
  document.setFontSize(20);
  document.setTextColor(20, 55, 96);
  document.text("Catálogo de produtos", PAGE_MARGIN, y);
  y += 25;
  document.setFont("helvetica", "normal");
  document.setFontSize(9);
  document.setTextColor(88, 105, 122);
  document.text(
    `${products.length} produto(s) · exportado em ${exportedAt.toLocaleString("pt-BR")}`,
    PAGE_MARGIN,
    y,
  );
  y += 27;

  if (!products.length) {
    writeWrapped("Nenhum produto cadastrado no catálogo.", { fontSize: 11 });
  }

  for (const [index, product] of products.entries()) {
    if (y > PAGE_MARGIN + 6) y += 7;
    writeWrapped(`${index + 1}. ${product.name || "Produto sem nome"}`, {
      fontSize: 13,
      bold: true,
      color: [20, 55, 96],
    });

    const image = supportedImage(product.image);
    if (image) {
      ensureSpace(67);
      try {
        document.addImage(
          image.data,
          image.format,
          PAGE_MARGIN,
          y + 2,
          72,
          54,
          undefined,
          "FAST",
        );
        y += 62;
      } catch {
        // An imagem opcional não bloqueia o PDF nem afeta os campos textuais.
      }
    }

    writeField("Código", product.code);
    writeField("Preço", product.price);
    writeField("Estoque", product.stock);
    writeField("Categoria", product.category);
    writeField("Descrição", product.description);

    document.setDrawColor(216, 226, 236);
    ensureSpace(9);
    document.line(PAGE_MARGIN, y + 1, pageWidth - PAGE_MARGIN, y + 1);
    y += 10;
  }

  const pageCount = document.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    document.setPage(page);
    document.setFont("helvetica", "normal");
    document.setFontSize(8);
    document.setTextColor(112, 128, 144);
    document.text(
      `Página ${page} de ${pageCount}`,
      pageWidth - PAGE_MARGIN,
      pageHeight - 18,
      { align: "right" },
    );
  }

  return document.output("blob");
}
