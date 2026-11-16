import { csvCell } from "@/lib/irisLocalStore";

export type ProductFields = {
  name: string;
  code: string;
  price: string;
  stock: string;
  category: string;
  description: string;
};

export type Product = ProductFields & {
  id: string;
  createdAt: string;
  image?: string;
};

export type ProductDraft = ProductFields;
export type CatalogImportProduct = ProductFields & { image?: string };

export const blankProductDraft: ProductDraft = {
  name: "",
  code: "",
  price: "",
  stock: "",
  category: "",
  description: "",
};

const CSV_HEADER = "nome,codigo,preco,estoque,categoria,descricao";
export const MAX_CATALOG_ROWS = 50_000;
export const MAX_CATALOG_FIELD_LENGTH = 20_000;
const MAX_IMPORTED_IMAGE_BYTES = 8 * 1024 * 1024;

export function productCsv(products: Product[]) {
  const rows = products.map((product) =>
    [
      product.name,
      product.code,
      product.price,
      product.stock,
      product.category,
      product.description,
    ]
      .map(csvCell)
      .join(","),
  );
  return [CSV_HEADER, ...rows].join("\r\n");
}

type CsvRow = { values: string[]; line: number };
type ProductField = keyof ProductDraft;
type HeaderMatch = { field: ProductField; index: number };

const HEADER_ALIASES: Record<string, ProductField> = {
  nome: "name",
  name: "name",
  codigo: "code",
  cod: "code",
  code: "code",
  sku: "code",
  preco: "price",
  price: "price",
  valor: "price",
  estoque: "stock",
  stock: "stock",
  quantidade: "stock",
  categoria: "category",
  category: "category",
  descricao: "description",
  description: "description",
  detalhes: "description",
};

function parseCsvRows(
  input: string,
  delimiter: "," | ";",
  maxRows = MAX_CATALOG_ROWS + 1,
): CsvRow[] {
  const text = input.replace(/^\uFEFF/, "");
  const rows: CsvRow[] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let quoteClosed = false;
  let line = 1;
  let rowLine = 1;

  const pushRow = () => {
    row.push(cell);
    rows.push({ values: row, line: rowLine });
    if (rows.length > maxRows) {
      throw new Error(
        `CSV acima do limite local de ${MAX_CATALOG_ROWS.toLocaleString("pt-BR")} linhas.`,
      );
    }
    row = [];
    cell = "";
    quoteClosed = false;
  };

  for (let index = 0; index < text.length; index += 1) {
    if (maxRows === 1 && rows.length === 1) break;
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
          quoteClosed = true;
        }
      } else if (character === "\r" && text[index + 1] === "\n") {
        cell += "\r\n";
        index += 1;
        line += 1;
      } else {
        cell += character;
        if (character === "\r" || character === "\n") line += 1;
      }
      continue;
    }

    if (quoteClosed) {
      if (character === delimiter) {
        row.push(cell);
        cell = "";
        quoteClosed = false;
      } else if (character === "\n" || character === "\r") {
        pushRow();
        if (character === "\r" && text[index + 1] === "\n") index += 1;
        line += 1;
        rowLine = line;
      } else {
        throw new Error(
          `CSV inválido na linha ${line}: há conteúdo após aspas de fechamento.`,
        );
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === delimiter) {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      pushRow();
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      line += 1;
      rowLine = line;
    } else if (character === '"') {
      throw new Error(
        `CSV inválido na linha ${line}: aspas devem iniciar o campo.`,
      );
    } else {
      cell += character;
    }
  }

  if (quoted)
    throw new Error(
      `CSV inválido na linha ${rowLine}: há aspas sem fechamento.`,
    );
  if (cell.length > 0 || row.length > 0 || quoteClosed) {
    row.push(cell);
    rows.push({ values: row, line: rowLine });
    if (maxRows !== 1 && rows.length > maxRows) {
      throw new Error(
        `CSV acima do limite local de ${MAX_CATALOG_ROWS.toLocaleString("pt-BR")} linhas.`,
      );
    }
  }
  return rows;
}

function matchHeaders(values: string[]): HeaderMatch[] | null {
  const matches: HeaderMatch[] = [];
  const found = new Set<ProductField>();
  for (const [index, header] of values.entries()) {
    const key = header
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    const field = HEADER_ALIASES[key];
    if (!field || found.has(field)) return null;
    found.add(field);
    matches.push({ field, index });
  }
  return found.has("name") ? matches : null;
}

export function parseProductCsv(text: string): ProductDraft[] {
  const choices = ([",", ";"] as const).flatMap((delimiter) => {
    try {
      const headerRow = parseCsvRows(text, delimiter, 1)[0];
      if (!headerRow) return [];
      const matches = matchHeaders(headerRow.values);
      return matches ? [{ delimiter, headerRow, matches }] : [];
    } catch {
      return [];
    }
  });
  if (!choices.length) {
    throw new Error(
      "Cabeçalho CSV inválido: informe ‘nome’ e use somente colunas esperadas (código, preço, estoque, categoria, descrição). Nenhum produto foi importado.",
    );
  }
  const bestScore = Math.max(...choices.map((choice) => choice.matches.length));
  const best = choices.filter((choice) => choice.matches.length === bestScore);
  if (
    best.length > 1 &&
    best[0].headerRow.values.join("\u0000") !==
      best[1].headerRow.values.join("\u0000")
  ) {
    throw new Error(
      "Não foi possível determinar o delimitador CSV entre vírgula e ponto-e-vírgula. Nenhum produto foi importado.",
    );
  }
  const { delimiter, headerRow, matches } = best[0];
  const rows = parseCsvRows(text, delimiter);
  const dataRows = rows
    .slice(1)
    .filter(({ values }) => values.some((value) => value.trim() !== ""));
  const invalidLines: number[] = [];
  const products: ProductDraft[] = [];

  for (const row of dataRows) {
    if (
      row.values.length !== headerRow.values.length ||
      row.values.some(
        (value) =>
          value.length > MAX_CATALOG_FIELD_LENGTH || value.includes("\0"),
      )
    ) {
      invalidLines.push(row.line);
      continue;
    }
    const product: ProductDraft = { ...blankProductDraft };
    for (const { field, index } of matches)
      product[field] = row.values[index].trim();
    if (!product.name) {
      invalidLines.push(row.line);
      continue;
    }
    products.push(product);
  }
  if (invalidLines.length) {
    const listed = invalidLines.slice(0, 10).join(", ");
    throw new Error(
      `CSV rejeitado: ${invalidLines.length} linha(s) inválida(s) (linha(s) ${listed}${invalidLines.length > 10 ? ", …" : ""}); nenhuma alteração foi feita.`,
    );
  }
  if (!products.length)
    throw new Error(
      "O CSV não contém produtos válidos. Nenhuma alteração foi feita.",
    );
  return products;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validateImportedText(
  value: unknown,
  field: string,
  required = false,
): string {
  if (value === undefined && !required) return "";
  if (typeof value !== "string")
    throw new Error(`JSON inválido: o campo “${field}” deve ser texto.`);
  if (value.length > MAX_CATALOG_FIELD_LENGTH || value.includes("\0")) {
    throw new Error(
      `JSON inválido: o campo “${field}” excede o limite ou contém conteúdo inválido.`,
    );
  }
  return value.trim();
}

function validateImportedImage(value: unknown): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string")
    throw new Error(
      "JSON inválido: a imagem precisa ser uma imagem local incorporada em base64.",
    );
  const match =
    /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(
      value,
    );
  if (!match)
    throw new Error(
      "JSON inválido: imagens externas, SVG e formatos não reconhecidos não são importados; use imagens locais PNG, JPEG, WebP ou GIF.",
    );
  const encoded = match[2];
  const bytes =
    Math.floor((encoded.length * 3) / 4) -
    (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
  if (!bytes || bytes > MAX_IMPORTED_IMAGE_BYTES) {
    throw new Error(
      "JSON inválido: cada imagem incorporada deve ter até 8 MB.",
    );
  }
  return value;
}

export function parseProductJson(text: string): CatalogImportProduct[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("JSON inválido. Nenhum produto foi importado.");
  }

  let records: unknown;
  if (Array.isArray(parsed)) {
    records = parsed;
  } else if (isRecord(parsed) && Array.isArray(parsed.products)) {
    if (
      parsed.format !== undefined &&
      parsed.format !== "iris-product-catalog"
    ) {
      throw new Error(
        "Formato JSON diferente do catálogo de produtos IRIS. Nenhum produto foi importado.",
      );
    }
    records = parsed.products;
  } else {
    throw new Error(
      "JSON inválido: espere uma lista de produtos ou a exportação do catálogo IRIS. Nenhum produto foi importado.",
    );
  }

  if ((records as unknown[]).length > MAX_CATALOG_ROWS) {
    throw new Error(
      `JSON acima do limite local de ${MAX_CATALOG_ROWS.toLocaleString("pt-BR")} produtos.`,
    );
  }
  const allowedKeys = new Set([
    "id",
    "createdAt",
    "name",
    "code",
    "price",
    "stock",
    "category",
    "description",
    "image",
  ]);
  const products: CatalogImportProduct[] = [];
  for (const [index, value] of (records as unknown[]).entries()) {
    if (!isRecord(value))
      throw new Error(`JSON inválido: o produto ${index + 1} não é um objeto.`);
    const extraKey = Object.keys(value).find((key) => !allowedKeys.has(key));
    if (extraKey)
      throw new Error(
        `JSON inválido: o produto ${index + 1} contém o campo não reconhecido “${extraKey}”; nenhum dado foi importado.`,
      );
    const product: CatalogImportProduct = {
      name: validateImportedText(value.name, "nome", true),
      code: validateImportedText(value.code, "código"),
      price: validateImportedText(value.price, "preço"),
      stock: validateImportedText(value.stock, "estoque"),
      category: validateImportedText(value.category, "categoria"),
      description: validateImportedText(value.description, "descrição"),
    };
    if (!product.name)
      throw new Error(
        `JSON inválido: o produto ${index + 1} não tem nome. Nenhuma alteração foi feita.`,
      );
    const image = validateImportedImage(value.image);
    if (image) product.image = image;
    products.push(product);
  }
  if (!products.length)
    throw new Error(
      "O JSON não contém produtos válidos. Nenhuma alteração foi feita.",
    );
  return products;
}

function normalizeForComparison(value: string | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt-BR");
}

export function catalogProductFingerprint(
  product: Pick<Product, keyof ProductFields | "image"> | CatalogImportProduct,
) {
  return JSON.stringify(
    [
      product.name,
      product.code,
      product.price,
      product.stock,
      product.category,
      product.description,
    ]
      .map(normalizeForComparison)
      .concat(normalizeForComparison(product.image)),
  );
}

export function countUniqueCatalogImportAdds(
  existing: Product[],
  incoming: CatalogImportProduct[],
) {
  const known = new Set(existing.map(catalogProductFingerprint));
  let added = 0;
  for (const product of incoming) {
    const fingerprint = catalogProductFingerprint(product);
    if (known.has(fingerprint)) continue;
    known.add(fingerprint);
    added += 1;
  }
  return added;
}

export function mergeCatalogProducts(
  existing: Product[],
  incoming: CatalogImportProduct[],
  now = new Date().toISOString(),
  createId = () => crypto.randomUUID(),
) {
  const known = new Set(existing.map(catalogProductFingerprint));
  const added: Product[] = [];
  for (const product of incoming) {
    const fingerprint = catalogProductFingerprint(product);
    if (known.has(fingerprint)) continue;
    known.add(fingerprint);
    added.push({ ...product, id: createId(), createdAt: now });
  }
  return {
    products: [...added, ...existing],
    added: added.length,
    skipped: incoming.length - added.length,
  };
}
