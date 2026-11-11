import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, Package, Plus, Search, Trash2 } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { assertLocalFileSize, csvCell, downloadBlob, downloadJson, readLocal, writeLocal } from "@/lib/irisLocalStore";

type Product = {
  id: string;
  name: string;
  code: string;
  price: string;
  stock: string;
  category: string;
  description: string;
  image?: string;
  createdAt: string;
};
type ProductDraft = Omit<Product, "id" | "createdAt" | "image">;

const blank: ProductDraft = {
  name: "",
  code: "",
  price: "",
  stock: "",
  category: "",
  description: "",
};
const CSV_HEADER = "nome,codigo,preco,estoque,categoria,descricao";
const MAX_CATALOG_CSV_ROWS = 50_000;
const MAX_CATALOG_FIELD_LENGTH = 20_000;

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function productCsv(products: Product[]) {
  const rows = products.map((product) =>
    [product.name, product.code, product.price, product.stock, product.category, product.description]
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

function parseCsvRows(input: string, delimiter: "," | ";", maxRows = MAX_CATALOG_CSV_ROWS + 1): CsvRow[] {
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
      throw new Error(`CSV acima do limite local de ${MAX_CATALOG_CSV_ROWS.toLocaleString("pt-BR")} linhas.`);
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
      } else {
        if (character === "\r" && text[index + 1] === "\n") {
          cell += "\r\n";
          index += 1;
          line += 1;
        } else {
          cell += character;
          if (character === "\r" || character === "\n") line += 1;
        }
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
        throw new Error(`CSV inválido na linha ${line}: há conteúdo após aspas de fechamento.`);
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
      throw new Error(`CSV inválido na linha ${line}: aspas devem iniciar o campo.`);
    } else {
      cell += character;
    }
  }

  if (quoted) throw new Error(`CSV inválido na linha ${rowLine}: há aspas sem fechamento.`);
  if (cell.length > 0 || row.length > 0 || quoteClosed) {
    row.push(cell);
    rows.push({ values: row, line: rowLine });
    if (maxRows !== 1 && rows.length > maxRows) {
      throw new Error(`CSV acima do limite local de ${MAX_CATALOG_CSV_ROWS.toLocaleString("pt-BR")} linhas.`);
    }
  }
  return rows;
}

function matchHeaders(values: string[]): HeaderMatch[] | null {
  const matches: HeaderMatch[] = [];
  const found = new Set<ProductField>();
  for (const [index, header] of values.entries()) {
    const key = header.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
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
    throw new Error("Cabeçalho CSV inválido: informe ‘nome’ e use somente colunas esperadas (código, preço, estoque, categoria, descrição). Nenhum produto foi importado.");
  }
  const bestScore = Math.max(...choices.map((choice) => choice.matches.length));
  const best = choices.filter((choice) => choice.matches.length === bestScore);
  if (best.length > 1 && best[0].headerRow.values.join("\u0000") !== best[1].headerRow.values.join("\u0000")) {
    throw new Error("Não foi possível determinar o delimitador CSV entre vírgula e ponto-e-vírgula. Nenhum produto foi importado.");
  }
  const { delimiter, headerRow, matches } = best[0];
  const rows = parseCsvRows(text, delimiter);
  const dataRows = rows.slice(1).filter(({ values }) => values.some((value) => value.trim() !== ""));
  const invalidLines: number[] = [];
  const products: ProductDraft[] = [];

  for (const row of dataRows) {
    if (row.values.length !== headerRow.values.length) {
      invalidLines.push(row.line);
      continue;
    }
    if (row.values.some((value) => value.length > MAX_CATALOG_FIELD_LENGTH || value.includes("\0"))) {
      invalidLines.push(row.line);
      continue;
    }
    const product: ProductDraft = { ...blank };
    for (const { field, index } of matches) product[field] = row.values[index].trim();
    if (!product.name) {
      invalidLines.push(row.line);
      continue;
    }
    products.push(product);
  }
  if (invalidLines.length) {
    const listed = invalidLines.slice(0, 10).join(", ");
    throw new Error(`CSV rejeitado: ${invalidLines.length} linha(s) inválida(s) (linha(s) ${listed}${invalidLines.length > 10 ? ", …" : ""}); nenhuma alteração foi feita.`);
  }
  if (!products.length) throw new Error("O CSV não contém produtos válidos. Nenhuma alteração foi feita.");
  return products;
}

export default function ProductCatalog() {
  const [products, setProducts] = useState<Product[]>([]);
  const [draft, setDraft] = useState<ProductDraft>(blank);
  const [query, setQuery] = useState("");
  const [image, setImage] = useState<string>();
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    const loadProducts = async () => {
      try {
        if (!("indexedDB" in window)) throw new Error("IndexedDB não está disponível neste navegador.");
        const stored = await readLocal<Product[]>("products", []);
        if (!Array.isArray(stored)) throw new Error("O conteúdo local do catálogo não tem um formato válido.");
        if (active) setProducts(stored);
      } catch (error) {
        if (active) setMessage(`Não foi possível carregar o catálogo local: ${errorMessage(error, "armazenamento indisponível")}`);
      } finally {
        if (active) setLoaded(true);
      }
    };
    void loadProducts();
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(
    () => products.filter((product) => `${product.name} ${product.code} ${product.category}`.toLowerCase().includes(query.toLowerCase())),
    [products, query],
  );

  const save = async (next: Product[]) => {
    if (!("indexedDB" in window)) throw new Error("IndexedDB não está disponível neste navegador.");
    await writeLocal("products", next);
    setProducts(next);
  };

  const add = async () => {
    if (!draft.name.trim()) {
      setMessage("Informe o nome do produto.");
      return;
    }
    const item: Product = {
      ...draft,
      name: draft.name.trim(),
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...(image ? { image } : {}),
    };
    try {
      await save([item, ...products]);
      setDraft({ ...blank });
      setImage(undefined);
      setMessage("Produto salvo somente neste dispositivo.");
    } catch (error) {
      setMessage(`Não foi possível salvar o produto localmente: ${errorMessage(error, "armazenamento indisponível")}`);
    }
  };

  const remove = async (product: Product) => {
    const confirmed = window.confirm(`Excluir “${product.name}” do catálogo deste dispositivo? Esta ação não pode ser desfeita.`);
    if (!confirmed) return;
    try {
      await save(products.filter((item) => item.id !== product.id));
      setMessage(`Produto “${product.name}” removido do catálogo local.`);
    } catch (error) {
      setMessage(`Não foi possível remover o produto do armazenamento local: ${errorMessage(error, "armazenamento indisponível")}`);
    }
  };

  const exportJson = () => {
    try {
      downloadJson(`iris-catalogo-${new Date().toISOString().slice(0, 10)}.json`, {
        format: "iris-product-catalog",
        exportedAt: new Date().toISOString(),
        products,
      });
      setMessage("Solicitação de download JSON enviada. Verifique os downloads do navegador; o navegador pode solicitar confirmação ou bloquear o arquivo.");
    } catch (error) {
      setMessage(`Não foi possível iniciar a exportação JSON: ${errorMessage(error, "erro no navegador")}`);
    }
  };

  const exportCsv = () => {
    try {
      downloadBlob(`iris-catalogo-${new Date().toISOString().slice(0, 10)}.csv`, `\uFEFF${productCsv(products)}`, "text/csv;charset=utf-8");
      setMessage("Solicitação de download CSV enviada. Verifique os downloads do navegador; o navegador pode solicitar confirmação ou bloquear o arquivo.");
    } catch (error) {
      setMessage(`Não foi possível iniciar a exportação CSV: ${errorMessage(error, "erro no navegador")}`);
    }
  };

  const importCsv = async (file: File) => {
    try {
      assertLocalFileSize(file, file.name);
      const imported = parseProductCsv(await file.text());
      const createdAt = new Date().toISOString();
      const next = [
        ...imported.map((product) => ({ ...product, id: crypto.randomUUID(), createdAt })),
        ...products,
      ];
      await save(next);
      setMessage(`${imported.length} produto(s) importado(s) localmente.`);
    } catch (error) {
      setMessage(`Não foi possível importar o CSV: ${errorMessage(error, "arquivo ou armazenamento inválido")}`);
    }
  };

  return (
    <main className="profile-page">
      <div className="profile-card">
        <Link href="/" className="back-link"><ArrowLeft size={16} /> Voltar ao Radar</Link>
        <div className="profile-heading">
          <div className="profile-icon"><Package size={22} /></div>
          <div>
            <div className="eyebrow">IRIS COMERCIAL · LOCAL</div>
            <h1>Catálogo de produtos</h1>
            <p>Organize produtos e imagens no dispositivo, sem upload automático. Arquivos de importação e imagens: até 50 MB por arquivo.</p>
          </div>
        </div>
        <div className="notification-settings">
          <strong>Modo local e custo zero</strong>
          <p>Os dados ficam no IndexedDB deste navegador. Use exportação JSON/CSV para compartilhar manualmente, após revisar o conteúdo. O importador CSV aceita vírgula ou ponto-e-vírgula, exige cabeçalho e rejeita o arquivo inteiro se houver linha inválida. Exportar solicita um download; confirme o resultado na lista de downloads do navegador.</p>
        </div>
        <div className="memory-settings">
          <strong>Novo produto</strong>
          <div className="catalog-form-grid">
            {(["name", "code", "price", "stock", "category"] as const).map((key) => (
              <input
                key={key}
                value={draft[key]}
                onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                placeholder={{ name: "Nome", code: "Código", price: "Preço", stock: "Estoque", category: "Categoria" }[key]}
                aria-label={{ name: "Nome do produto", code: "Código do produto", price: "Preço", stock: "Estoque", category: "Categoria" }[key]}
              />
            ))}
            <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Descrição" aria-label="Descrição do produto" rows={2} />
            <label className="button-like">
              Imagem
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  try {
                    assertLocalFileSize(file, file.name);
                  } catch (error) {
                    setMessage(errorMessage(error, "Imagem acima do limite local de 50 MB."));
                    event.currentTarget.value = "";
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () => setImage(typeof reader.result === "string" ? reader.result : undefined);
                  reader.onerror = () => setMessage("Não foi possível ler a imagem selecionada.");
                  reader.readAsDataURL(file);
                }}
              />
            </label>
            <Button disabled={!loaded} onClick={() => void add()}><Plus size={15} /> Salvar produto</Button>
          </div>
        </div>
        <div className="memory-settings">
          <div className="catalog-toolbar">
            <strong>Produtos ({filtered.length})</strong>
            <div className="catalog-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar" aria-label="Buscar produtos" /></div>
            <label className="button-like">
              Importar CSV
              <input
                type="file"
                accept=".csv,text/csv"
                hidden
                disabled={!loaded}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importCsv(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <Button variant="outline" disabled={!loaded} onClick={exportJson}><Download size={15} /> JSON</Button>
            <Button variant="outline" disabled={!loaded} onClick={exportCsv}><Download size={15} /> CSV</Button>
          </div>
          {!loaded ? <small>Carregando catálogo local…</small> : filtered.length === 0 ? <small>Nenhum produto local cadastrado. O CSV pode ser baixado mesmo vazio como modelo.</small> : filtered.map((product) => (
            <div className="memory-row" key={product.id}>
              <span>
                {product.image && <img src={product.image} alt="" style={{ width: 42, height: 42, objectFit: "cover", borderRadius: 8, verticalAlign: "middle", marginRight: 8 }} />}
                <b>{product.name}</b><br />
                <small>{product.code} · {product.category} · Preço: {product.price || "—"} · Estoque: {product.stock || "—"}</small>
              </span>
              <Button size="sm" variant="ghost" onClick={() => void remove(product)} aria-label={`Excluir ${product.name}`}><Trash2 size={15} /></Button>
            </div>
          ))}
        </div>
        {message && <div className="profile-message" role="status" aria-live="polite">{message}</div>}
      </div>
    </main>
  );
}
