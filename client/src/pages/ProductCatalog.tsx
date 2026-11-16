import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Download,
  Package,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import CatalogFiles from "@/components/CatalogFiles";
import CatalogImportPreview from "@/components/CatalogImportPreview";
import {
  addProductCatalogFiles,
  readProductCatalogFiles,
  removeProductCatalogFile,
  type ProductCatalogFile,
} from "@/lib/catalogFiles";
import {
  blankProductDraft,
  mergeCatalogProducts,
  parseProductCsv,
  parseProductJson,
  productCsv,
  type CatalogImportProduct,
  type Product,
  type ProductDraft,
} from "@/lib/catalogImport";
import { createProductCatalogPdf } from "@/lib/catalogPdf";
import {
  assertLocalFileSize,
  downloadBlob,
  downloadJson,
  readLocal,
  writeLocal,
} from "@/lib/irisLocalStore";

export { parseProductCsv, productCsv } from "@/lib/catalogImport";
type PendingImport = { fileName: string; products: CatalogImportProduct[] };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function exportDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function ProductCatalog() {
  const [products, setProducts] = useState<Product[]>([]);
  const [catalogFiles, setCatalogFiles] = useState<ProductCatalogFile[]>([]);
  const [draft, setDraft] = useState<ProductDraft>(blankProductDraft);
  const [query, setQuery] = useState("");
  const [image, setImage] = useState<string>();
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(
    null,
  );
  const [importBusy, setImportBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const loadCatalog = async () => {
      if (!("indexedDB" in window)) {
        if (active)
          setMessage(
            "IndexedDB não está disponível neste navegador. Nenhum dado do catálogo foi alterado.",
          );
        if (active) setLoaded(true);
        return;
      }
      try {
        const stored = await readLocal<Product[]>("products", []);
        if (!Array.isArray(stored))
          throw new Error(
            "O conteúdo local do catálogo de produtos não tem um formato válido.",
          );
        if (active) setProducts(stored);
      } catch (error) {
        if (active)
          setMessage(
            `Não foi possível carregar os produtos locais: ${errorMessage(error, "armazenamento indisponível")}`,
          );
      }
      try {
        const files = await readProductCatalogFiles();
        if (active) setCatalogFiles(files);
      } catch (error) {
        if (active)
          setMessage(
            `Não foi possível carregar os arquivos originais locais: ${errorMessage(error, "armazenamento indisponível")}`,
          );
      } finally {
        if (active) setLoaded(true);
      }
    };
    void loadCatalog();
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(
    () =>
      products.filter((product) =>
        `${product.name} ${product.code} ${product.category}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [products, query],
  );

  const saveProducts = async (next: Product[]) => {
    if (!("indexedDB" in window))
      throw new Error("IndexedDB não está disponível neste navegador.");
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
      await saveProducts([item, ...products]);
      setDraft({ ...blankProductDraft });
      setImage(undefined);
      setMessage("Produto salvo somente neste dispositivo.");
    } catch (error) {
      setMessage(
        `Não foi possível salvar o produto localmente: ${errorMessage(error, "armazenamento indisponível")}`,
      );
    }
  };

  const removeProduct = async (product: Product) => {
    const confirmed = window.confirm(
      `Excluir “${product.name}” do catálogo deste dispositivo? Esta ação não pode ser desfeita.`,
    );
    if (!confirmed) return;
    try {
      await saveProducts(products.filter((item) => item.id !== product.id));
      setMessage(`Produto “${product.name}” removido do catálogo local.`);
    } catch (error) {
      setMessage(
        `Não foi possível remover o produto do armazenamento local: ${errorMessage(error, "armazenamento indisponível")}`,
      );
    }
  };

  const exportJson = () => {
    try {
      downloadJson(`iris-catalogo-${exportDate()}.json`, {
        format: "iris-product-catalog",
        exportedAt: new Date().toISOString(),
        products,
      });
      setMessage(
        "Solicitação de download JSON encaminhada ao navegador. Não é possível confirmar se o arquivo foi salvo; confira a lista de downloads.",
      );
    } catch (error) {
      setMessage(
        `Não foi possível iniciar a exportação JSON: ${errorMessage(error, "erro no navegador")}`,
      );
    }
  };

  const exportCsv = () => {
    try {
      downloadBlob(
        `iris-catalogo-${exportDate()}.csv`,
        `\uFEFF${productCsv(products)}`,
        "text/csv;charset=utf-8",
      );
      setMessage(
        "Solicitação de download CSV encaminhada ao navegador. Não é possível confirmar se o arquivo foi salvo; confira a lista de downloads.",
      );
    } catch (error) {
      setMessage(
        `Não foi possível iniciar a exportação CSV: ${errorMessage(error, "erro no navegador")}`,
      );
    }
  };

  const exportPdf = async () => {
    setPdfBusy(true);
    try {
      const pdf = await createProductCatalogPdf(products);
      if (!(pdf instanceof Blob) || pdf.size < 5)
        throw new Error("O gerador não produziu um PDF baixável.");
      const signature = new TextDecoder().decode(
        await pdf.slice(0, 5).arrayBuffer(),
      );
      if (signature !== "%PDF-")
        throw new Error("O arquivo gerado não tem assinatura PDF válida.");
      downloadBlob(`iris-catalogo-${exportDate()}.pdf`, pdf, "application/pdf");
      setMessage(
        "PDF do catálogo preparado e a solicitação de download foi encaminhada ao navegador. Não é possível confirmar se o arquivo foi salvo; confira a lista de downloads.",
      );
    } catch (error) {
      setMessage(
        `Não foi possível gerar ou baixar o PDF: ${errorMessage(error, "erro no navegador")}`,
      );
    } finally {
      setPdfBusy(false);
    }
  };

  const importProducts = async (file: File) => {
    setPendingImport(null);
    try {
      assertLocalFileSize(file, file.name || "Arquivo");
      const extension = file.name.toLowerCase().split(".").pop();
      let incoming: CatalogImportProduct[];
      if (extension === "csv") {
        incoming = parseProductCsv(await file.text());
      } else if (extension === "json") {
        incoming = parseProductJson(await file.text());
      } else {
        throw new Error(
          "Escolha um arquivo .csv ou .json. PDF e formatos Office podem ser arquivados como originais, mas não são convertidos automaticamente em produtos.",
        );
      }
      setPendingImport({ fileName: file.name, products: incoming });
      setMessage(
        "Prévia pronta. Nenhum produto será salvo até você confirmar.",
      );
    } catch (error) {
      setMessage(
        `Não foi possível preparar a importação: ${errorMessage(error, "arquivo inválido")}`,
      );
    }
  };

  const confirmImport = async () => {
    if (!pendingImport) return;
    setImportBusy(true);
    try {
      const result = mergeCatalogProducts(products, pendingImport.products);
      if (result.added > 0) await saveProducts(result.products);
      setPendingImport(null);
      setMessage(
        result.added > 0
          ? `${result.added} produto(s) acrescentado(s) localmente; ${result.skipped} duplicado(s) exato(s) ignorado(s). Produtos anteriores foram preservados.`
          : "Todos os produtos da prévia já existem. Nenhum registro foi alterado.",
      );
    } catch (error) {
      setMessage(
        `Não foi possível confirmar a importação: ${errorMessage(error, "falha ao gravar")}`,
      );
    } finally {
      setImportBusy(false);
    }
  };

  const uploadCatalogFiles = async (files: File[]) => {
    try {
      const next = await addProductCatalogFiles(files);
      setCatalogFiles(next);
      setMessage(
        `${files.length} arquivo(s) original(is) arquivado(s) na coleção local do catálogo. Os produtos não foram alterados; o navegador pode exigir espaço livre no dispositivo.`,
      );
    } catch (error) {
      setMessage(
        `Não foi possível arquivar os originais: ${errorMessage(error, "armazenamento local indisponível")}`,
      );
    }
  };

  const downloadCatalogFile = (file: ProductCatalogFile) => {
    try {
      if (!(file.blob instanceof Blob) || file.blob.size !== file.size)
        throw new Error(
          "A cópia local original não está disponível ou está incompleta.",
        );
      downloadBlob(
        file.name,
        file.blob,
        file.mime || "application/octet-stream",
      );
      setMessage(
        `Solicitação de download do original “${file.name}” encaminhada ao navegador. Não é possível confirmar se foi salvo; confira a lista de downloads.`,
      );
    } catch (error) {
      setMessage(
        `Não foi possível baixar o original: ${errorMessage(error, "arquivo local indisponível")}`,
      );
    }
  };

  const deleteCatalogFile = async (file: ProductCatalogFile) => {
    try {
      const next = await removeProductCatalogFile(file.id);
      setCatalogFiles(next);
      setMessage(
        `“${file.name}” foi removido somente da coleção de originais do catálogo. Produtos e demais arquivos foram preservados.`,
      );
    } catch (error) {
      setMessage(
        `Não foi possível excluir o arquivo original: ${errorMessage(error, "armazenamento local indisponível")}`,
      );
    }
  };

  return (
    <main className="profile-page">
      <div className="profile-card">
        <Link href="/" className="back-link">
          <ArrowLeft size={16} /> Voltar ao início
        </Link>
        <div className="profile-heading">
          <div className="profile-icon">
            <Package size={22} />
          </div>
          <div>
            <div className="eyebrow">IRIS COMERCIAL · LOCAL</div>
            <h1>Catálogo de produtos</h1>
            <p>
              Organize produtos, imagens e catálogos neste dispositivo, sem
              upload automático. Cada arquivo tem limite local de 50 MB.
            </p>
          </div>
        </div>
        <div className="notification-settings">
          <strong>Modo local e custo zero</strong>
          <p>
            Os produtos e seus históricos atuais permanecem na coleção IndexedDB
            “products”. Arquivos originais ficam em “productCatalogFiles”,
            separados do cadastro; não dependem do Drive. CSV e JSON são
            revisados antes da confirmação e acrescentam somente novos itens.
            PDFs são gerados localmente para download, com texto paginado.
          </p>
        </div>
        <div className="memory-settings">
          <strong>Novo produto</strong>
          <div className="catalog-form-grid">
            {(["name", "code", "price", "stock", "category"] as const).map(
              (key) => (
                <input
                  key={key}
                  value={draft[key]}
                  onChange={(event) =>
                    setDraft({ ...draft, [key]: event.target.value })
                  }
                  placeholder={
                    {
                      name: "Nome",
                      code: "Código",
                      price: "Preço",
                      stock: "Estoque",
                      category: "Categoria",
                    }[key]
                  }
                  aria-label={
                    {
                      name: "Nome do produto",
                      code: "Código do produto",
                      price: "Preço",
                      stock: "Estoque",
                      category: "Categoria",
                    }[key]
                  }
                />
              ),
            )}
            <textarea
              value={draft.description}
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
              placeholder="Descrição"
              aria-label="Descrição do produto"
              rows={2}
            />
            <label className="button-like">
              Imagem do produto
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (!file) return;
                  try {
                    assertLocalFileSize(file, file.name || "Imagem");
                  } catch (error) {
                    setMessage(
                      errorMessage(
                        error,
                        "Imagem acima do limite local de 50 MB.",
                      ),
                    );
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () =>
                    setImage(
                      typeof reader.result === "string"
                        ? reader.result
                        : undefined,
                    );
                  reader.onerror = () =>
                    setMessage("Não foi possível ler a imagem selecionada.");
                  reader.readAsDataURL(file);
                }}
              />
            </label>
            <Button disabled={!loaded} onClick={() => void add()}>
              <Plus size={15} /> Salvar produto
            </Button>
          </div>
        </div>
        <div className="memory-settings">
          <div className="catalog-toolbar">
            <strong>Produtos ({filtered.length})</strong>
            <div className="catalog-search">
              <Search size={15} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar"
                aria-label="Buscar produtos"
              />
            </div>
            <label
              className="button-like"
              aria-disabled={!loaded || importBusy}
            >
              Importar produtos (CSV/JSON)
              <input
                type="file"
                accept=".csv,.json,text/csv,application/json"
                hidden
                disabled={!loaded || importBusy}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void importProducts(file);
                }}
              />
            </label>
            <Button
              variant="outline"
              disabled={!loaded || pdfBusy}
              onClick={() => void exportPdf()}
            >
              <Download size={15} /> {pdfBusy ? "Gerando PDF…" : "Baixar PDF"}
            </Button>
            <Button variant="outline" disabled={!loaded} onClick={exportJson}>
              <Download size={15} /> Baixar JSON
            </Button>
            <Button variant="outline" disabled={!loaded} onClick={exportCsv}>
              <Download size={15} /> Baixar CSV
            </Button>
          </div>
          {!loaded ? (
            <small>Carregando catálogo local…</small>
          ) : filtered.length === 0 ? (
            <small>
              Nenhum produto local cadastrado. JSON, CSV e PDF também podem ser
              gerados com o catálogo vazio.
            </small>
          ) : (
            filtered.map((product) => (
              <div className="memory-row" key={product.id}>
                <span>
                  {product.image && (
                    <img
                      src={product.image}
                      alt=""
                      style={{
                        width: 42,
                        height: 42,
                        objectFit: "cover",
                        borderRadius: 8,
                        verticalAlign: "middle",
                        marginRight: 8,
                      }}
                    />
                  )}
                  <b>{product.name}</b>
                  <br />
                  <small>
                    {product.code} · {product.category} · Preço:{" "}
                    {product.price || "—"} · Estoque: {product.stock || "—"}
                  </small>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void removeProduct(product)}
                  aria-label={`Excluir ${product.name}`}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            ))
          )}
        </div>
        {pendingImport && (
          <CatalogImportPreview
            fileName={pendingImport.fileName}
            incoming={pendingImport.products}
            existing={products}
            disabled={importBusy}
            onConfirm={() => void confirmImport()}
            onCancel={() => {
              setPendingImport(null);
              setMessage("Importação cancelada. Nenhum produto foi alterado.");
            }}
          />
        )}
        <CatalogFiles
          files={catalogFiles}
          disabled={!loaded}
          onUpload={uploadCatalogFiles}
          onDownload={downloadCatalogFile}
          onDelete={(file) => void deleteCatalogFile(file)}
        />
        {message && (
          <div className="profile-message" role="status" aria-live="polite">
            {message}
          </div>
        )}
      </div>
    </main>
  );
}
