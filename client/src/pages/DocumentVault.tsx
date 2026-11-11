import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Download,
  FileArchive,
  FileText,
  FileWarning,
  FolderHeart,
  ReceiptText,
  ScanText,
  Search,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { csvCell, downloadBlob, readLocal, writeLocal, assertLocalFileSize } from "@/lib/irisLocalStore";
import { downloadIrisFile } from "@/lib/irisWorker";
import { readDocumentText } from "@/lib/localOcr";
import { parseExpenseLines, type ExpenseCategory } from "@shared/expenseParser";
import "./document-vault.css";

type Kind = "saude" | "financeiro" | "geral";
type Money = {
  category: ExpenseCategory;
  amount: number;
  source: string;
  date?: string;
};
type FinanceEntry = {
  id: string;
  type: "expense";
  description: string;
  category: ExpenseCategory;
  amount: number;
  status: "open" | "paid" | "overdue";
  createdAt: string;
  dueAt: string;
  source: string;
  sourceDocumentId: string;
};
type DocumentRecord = {
  id: string;
  name: string;
  mime: string;
  size: number;
  folder: string;
  kind: Kind;
  createdAt: string;
  extractedText: string;
  analysis:
    | "texto extraído"
    | "arquivado · OCR necessário"
    | "arquivado · formato não textual";
  institution?: string;
  brand?: string;
  total?: number;
  money: Money[];
  markers: Record<string, number>;
  hash?: string;
  storageKey?: string;
  reviewStatus?: "pending" | "confirmed";
  confidence?: number;
  blob?: Blob;
  processing?: boolean;
  processingError?: string;
};

const healthTerms =
  /exame|laudo|hemoglobina|glicose|colesterol|triglicer|press[aã]o|consulta|laborat[oó]rio/i;
const financeTerms =
  /fatura|cart[aã]o|vencimento|parcela|estabelecimento|compra|lan[cç]amento|banco|visa|mastercard|elo|amex/i;

function parseMarkers(value: string) {
  const markers: Record<string, number> = {};
  const rules: [string, RegExp][] = [
    ["Hemoglobina", /hemoglobina[^\d]{0,20}(\d+[,.]?\d*)/i],
    ["Glicose", /glicose[^\d]{0,20}(\d+[,.]?\d*)/i],
    ["Colesterol total", /colesterol(?: total)?[^\d]{0,20}(\d+[,.]?\d*)/i],
    ["Triglicerídeos", /triglicer[ií]deos?[^\d]{0,20}(\d+[,.]?\d*)/i],
    ["TSH", /\bTSH[^\d]{0,20}(\d+[,.]?\d*)/i],
  ];
  for (const [label, rule] of rules) {
    const hit = value.match(rule);
    if (hit) markers[label] = Number(hit[1].replace(",", "."));
  }
  return markers;
}

function classify(file: File, text: string): Kind {
  const combined = `${file.name} ${text}`;
  if (healthTerms.test(combined)) return "saude";
  if (financeTerms.test(combined) || parseExpenseLines(text).length > 0) {
    return "financeiro";
  }
  return "geral";
}

function moneyTotal(items: DocumentRecord[]) {
  return items
    .flatMap((item) => item.money)
    .reduce((sum, item) => sum + item.amount, 0);
}

function labelKind(kind: Kind) {
  return kind === "saude" ? "Saúde" : kind === "financeiro" ? "Financeiro" : "Geral";
}

function needsOcr(file: File) {
  return file.type.startsWith("image/") ||
    file.type === "application/pdf" ||
    /\.(pdf|jpe?g|png|tiff?|webp)$/i.test(file.name);
}

async function upsertFinanceEntries(document: DocumentRecord) {
  const current = await readLocal<FinanceEntry[]>("irisFinances", []);
  const prefix = `${document.id}:expense:`;
  const currentForDocument = new Map(
    current
      .filter((entry) =>
        entry.sourceDocumentId === document.id || entry.id.startsWith(prefix),
      )
      .map((entry) => [entry.id, entry]),
  );
  const retained = current.filter(
    (entry) =>
      entry.sourceDocumentId !== document.id && !entry.id.startsWith(prefix),
  );
  const parsedLines = document.kind === "financeiro" ? document.money : [];
  const generated = parsedLines.map((line, index): FinanceEntry => {
    const id = `${document.id}:expense:${index}`;
    const previous = currentForDocument.get(id);
    return {
      id,
      type: "expense",
      description: line.source,
      category: previous?.category ?? line.category,
      amount: line.amount,
      status: "open",
      createdAt: previous?.createdAt ?? document.createdAt,
      dueAt: previous?.dueAt ?? "",
      source: document.name,
      sourceDocumentId: document.id,
    };
  });
  await writeLocal("irisFinances", [...generated, ...retained]);
}

export default function DocumentVault() {
  const [items, setItems] = useState<DocumentRecord[]>([]);
  const [tab, setTab] = useState<"todos" | Kind | "revisao">("todos");
  const [query, setQuery] = useState("");
  const [month, setMonth] = useState("all");
  const [message, setMessage] = useState("");
  const [ocrId, setOcrId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void readLocal<DocumentRecord[]>("irisDocuments", [])
      .then((local) => {
        if (active) setItems(local);
      })
      .catch(() => {
        if (active) setMessage("Não foi possível abrir os documentos locais.");
      });
    return () => {
      active = false;
    };
  }, []);

  const save = async (next: DocumentRecord[]) => {
    setItems(next);
    await writeLocal("irisDocuments", next);
  };

  const persistDocument = async (document: DocumentRecord) => {
    const latest = await readLocal<DocumentRecord[]>("irisDocuments", items);
    const next = [document, ...latest.filter((item) => item.id !== document.id)];
    await save(next);
  };

  const ingest = async (files: FileList | null) => {
    if (!files) return;

    const selected = Array.from(files);
    let currentItems = await readLocal<DocumentRecord[]>("irisDocuments", items);
    let archived = 0;
    let duplicates = 0;
    let failures = 0;
    const rejectedForSize: string[] = [];
    const knownHashes = new Set(
      currentItems.map((item) => item.hash).filter((hash): hash is string => Boolean(hash)),
    );

    for (const file of selected) {
      try {
        assertLocalFileSize(file, file.name);
      } catch {
        rejectedForSize.push(file.name);
        continue;
      }
      const hash = `${file.name.toLowerCase()}|${file.size}|${file.lastModified}`;
      if (knownHashes.has(hash)) {
        duplicates += 1;
        continue;
      }
      knownHashes.add(hash);

      const record: DocumentRecord = {
        id: crypto.randomUUID(),
        name: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
        folder: "Documentos",
        kind: classify(file, ""),
        createdAt: new Date().toISOString(),
        extractedText: "",
        analysis: needsOcr(file)
          ? "arquivado · OCR necessário"
          : "arquivado · formato não textual",
        money: [],
        markers: {},
        hash,
        reviewStatus: "pending",
        confidence: 0,
        blob: file,
        processing: true,
      };

      try {
        // Persist the original and expose its row before starting PDF/OCR work.
        const latest = await readLocal<DocumentRecord[]>("irisDocuments", currentItems);
        currentItems = [record, ...latest.filter((item) => item.id !== record.id)];
        setItems(currentItems);
        await writeLocal("irisDocuments", currentItems);
        archived += 1;
      } catch (error) {
        failures += 1;
        setMessage(
          `Não foi possível arquivar ${file.name}; o processamento desse arquivo foi ignorado e o lote continuará.${error instanceof Error ? ` ${error.message}` : ""}`,
        );
        continue;
      }

      try {
        setMessage(`Original de ${file.name} salvo localmente. Iniciando leitura…`);
        const reading = await readDocumentText(file, ({ progress, status }) => {
          setMessage(
            `${file.name} · ${status} (${Math.round(progress * 100)}%). Original já salvo localmente.`,
          );
        });
        const reliable =
          Boolean(reading.text) &&
          (reading.method !== "ocr" || reading.confidence >= 45);
        const kind = classify(file, reading.text);
        const money =
          reliable && kind === "financeiro"
            ? parseExpenseLines(reading.text)
            : [];
        const updated: DocumentRecord = {
          ...record,
          folder:
            kind === "saude"
              ? "Exames"
              : kind === "financeiro"
                ? "Financeiro"
                : "Documentos",
          kind,
          extractedText: reliable ? reading.text : "",
          analysis: reliable
            ? "texto extraído"
            : needsOcr(file)
              ? "arquivado · OCR necessário"
              : "arquivado · formato não textual",
          institution: reading.text
            .match(/(?:banco|bank)\s*[:\-]?\s*([A-ZÀ-Ú][\wÀ-Ú ]{2,40})/i)?.[1]
            ?.trim(),
          brand:
            reading.text.match(/\b(Visa|Mastercard|Elo|American Express|Amex)\b/i)?.[1] ??
            undefined,
          total: money.reduce((sum, line) => sum + line.amount, 0) || undefined,
          money,
          markers: kind === "saude" && reliable ? parseMarkers(reading.text) : {},
          confidence: reading.confidence / 100,
          processing: false,
          processingError: undefined,
        };
        await persistDocument(updated);
        currentItems = [updated, ...currentItems.filter((item) => item.id !== updated.id)];
        await upsertFinanceEntries(updated);
      } catch (error) {
        failures += 1;
        const latestRecords = await readLocal<DocumentRecord[]>("irisDocuments", currentItems).catch(
          () => currentItems,
        );
        const latestRecord = latestRecords.find((item) => item.id === record.id) ?? record;
        const failed: DocumentRecord = {
          ...latestRecord,
          processing: false,
          processingError:
            error instanceof Error ? error.message : "Falha durante a leitura local.",
        };
        try {
          await persistDocument(failed);
          currentItems = [failed, ...currentItems.filter((item) => item.id !== failed.id)];
        } catch {
          // The original was persisted before parsing; keep the in-memory row if retry storage fails.
          setItems([failed, ...currentItems.filter((item) => item.id !== failed.id)]);
        }
      }
    }

    const notices = [
      `${archived} arquivo(s) arquivado(s) localmente`,
      duplicates ? `${duplicates} duplicado(s) ignorado(s)` : "",
      rejectedForSize.length
        ? `${rejectedForSize.length} arquivo(s) acima de 50 MB recusado(s) antes de leitura e arquivamento: ${rejectedForSize.slice(0, 3).join(", ")}${rejectedForSize.length > 3 ? "…" : ""}`
        : "",
      failures ? `${failures} falha(s) individual(is); os originais arquivados continuam disponíveis` : "",
    ].filter(Boolean);
    setMessage(notices.join("; ") + ".");
  };

  const availableMonths = useMemo(
    () =>
      [...new Set(items.map((item) => item.createdAt.slice(0, 7)))]
        .sort()
        .reverse(),
    [items],
  );
  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          (tab === "todos" || tab === "revisao" || item.kind === tab) &&
          (tab !== "revisao" || item.reviewStatus === "pending") &&
          (month === "all" || item.createdAt.slice(0, 7) === month) &&
          item.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [items, tab, query, month],
  );

  const confirmDocument = async (id: string) => {
    const latest = await readLocal<DocumentRecord[]>("irisDocuments", items);
    await save(
      latest.map((item) =>
        item.id === id ? { ...item, reviewStatus: "confirmed" as const } : item,
      ),
    );
  };

  const runOcr = async (item: DocumentRecord) => {
    setOcrId(item.id);
    setMessage("Leitura local em andamento. O original permanece arquivado neste dispositivo.");

    const started: DocumentRecord = { ...item, processing: true, processingError: undefined };
    try {
      await persistDocument(started);
      const source = item.blob ?? (item.storageKey ? await downloadIrisFile(item.id) : null);
      if (!source) {
        throw new Error("O arquivo original não está disponível para leitura local.");
      }

      const file = new File([source], item.name, { type: item.mime });
      const reading = await readDocumentText(file, ({ progress, status }) => {
        setMessage(`Leitura local de ${item.name} · ${status} (${Math.round(progress * 100)}%).`);
      });
      const reliable =
        Boolean(reading.text) &&
        (reading.method !== "ocr" || reading.confidence >= 45);
      const kind = reading.text ? classify(file, reading.text) : item.kind;
      const money = reliable
        ? kind === "financeiro"
          ? parseExpenseLines(reading.text)
          : []
        : item.money;
      const updated: DocumentRecord = {
        ...item,
        folder:
          kind === "saude"
            ? "Exames"
            : kind === "financeiro"
              ? "Financeiro"
              : item.folder,
        kind,
        extractedText: reliable ? reading.text : item.extractedText,
        analysis: reliable ? "texto extraído" : item.analysis,
        institution: reliable
          ? reading.text
              .match(/(?:banco|bank)\s*[:\-]?\s*([A-ZÀ-Ú][\wÀ-Ú ]{2,40})/i)?.[1]
              ?.trim()
          : item.institution,
        brand: reliable
          ? reading.text.match(/\b(Visa|Mastercard|Elo|American Express|Amex)\b/i)?.[1]
          : item.brand,
        total: money.reduce((sum, line) => sum + line.amount, 0) || undefined,
        money,
        markers: reliable
          ? kind === "saude"
            ? parseMarkers(reading.text)
            : {}
          : item.markers,
        confidence: reading.confidence / 100,
        processing: false,
        processingError: undefined,
      };
      await persistDocument(updated);
      await upsertFinanceEntries(updated);
      setMessage(
        reliable
          ? `Leitura local concluída · confiança ${Math.round(reading.confidence)}%.${reading.warning ? ` ${reading.warning}` : ""}`
          : `Documento continua pendente: leitura insuficiente (confiança ${Math.round(reading.confidence)}%).${reading.warning ? ` ${reading.warning}` : ""}`,
      );
    } catch (error) {
      const latestRecords = await readLocal<DocumentRecord[]>("irisDocuments", items).catch(
        () => items,
      );
      const latestRecord = latestRecords.find((current) => current.id === item.id) ?? started;
      const failed = {
        ...latestRecord,
        processing: false,
        processingError:
          error instanceof Error ? error.message : "OCR local indisponível.",
      };
      await persistDocument(failed).catch(() => undefined);
      setMessage(
        error instanceof Error
          ? `Falha na leitura local; o original continua arquivado. ${error.message}`
          : "Falha na leitura local; o original continua arquivado.",
      );
    } finally {
      setOcrId(null);
    }
  };

  const downloadDocument = async (item: DocumentRecord) => {
    try {
      if (item.blob) {
        downloadBlob(item.name, item.blob, item.mime);
      } else if (item.storageKey) {
        const blob = await downloadIrisFile(item.id);
        downloadBlob(item.name, blob, item.mime || blob.type || "application/octet-stream");
      } else {
        setMessage("O arquivo original não está disponível para download neste dispositivo.");
        return;
      }
      setMessage(`Download de ${item.name} iniciado.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível baixar o documento.");
    }
  };

  const financeItems = items.filter(
    (item) =>
      item.kind === "financeiro" &&
      (month === "all" || item.createdAt.slice(0, 7) === month),
  );
  const finance = useMemo(() => {
    const map = new Map<ExpenseCategory, number>();
    for (const item of financeItems) {
      for (const entry of item.money) {
        map.set(entry.category, (map.get(entry.category) ?? 0) + entry.amount);
      }
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [financeItems]);
  const exams = [...items.filter((item) => item.kind === "saude")].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt),
  );
  const latest = exams[0];
  const previous = exams[1];

  const exportCsv = () => {
    const rows = [
      ["arquivo", "periodo", "categoria", "valor", "bandeira", "instituicao"],
      ...financeItems.flatMap((item) =>
        item.money.map((entry) => [
          item.name,
          item.createdAt.slice(0, 7),
          entry.category,
          entry.amount.toFixed(2),
          item.brand ?? "",
          item.institution ?? "",
        ]),
      ),
    ];
    const csv = rows
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    downloadBlob(
      `iris-gastos-${month === "all" ? "todos" : month}.csv`,
      `\uFEFF${csv}`,
      "text/csv;charset=utf-8",
    );
  };

  return (
    <main className="document-vault">
      <div className="document-vault-head">
        <Link href="/" className="back-link">
          <ArrowLeft size={16} /> Radar
        </Link>
        <div>
          <div className="eyebrow">IRIS LOCAL · ARQUIVO INTELIGENTE</div>
          <h1>Documentos sob controle</h1>
          <p>
            Arquive, organize e analise no dispositivo. Cada resultado informa
            sua origem e seus limites.
          </p>
        </div>
        <div className="document-trust">
          <ShieldCheck size={16} /> Sem envio automático
        </div>
      </div>

      <section className="document-upload">
        <div>
          <strong>Adicionar documentos</strong>
          <p>
            PDF, imagens, texto e CSV até 50 MB por arquivo. Para analisar uma planilha Excel, salve ou exporte como CSV.
            PDFs aceitos para OCR têm até 100 páginas e 16 milhões de pixels por página.
            O original é salvo no navegador antes da leitura local e nunca é enviado automaticamente.
          </p>
        </div>
        <label className="button-like">
          <Upload size={16} /> Escolher arquivos
          <input
            type="file"
            multiple
            accept=".pdf,.txt,.csv,.json,.xml,.doc,.docx,image/*"
            hidden
            onChange={(event) => {
              void ingest(event.target.files);
              event.currentTarget.value = "";
            }}
          />
        </label>
      </section>

      <div className="document-tabs">
        <button className={tab === "todos" ? "active" : ""} onClick={() => setTab("todos")}>
          Todos <span>{items.length}</span>
        </button>
        <button className={tab === "saude" ? "active" : ""} onClick={() => setTab("saude")}>
          <FolderHeart size={15} /> Exames <span>{exams.length}</span>
        </button>
        <button className={tab === "financeiro" ? "active" : ""} onClick={() => setTab("financeiro")}>
          <ReceiptText size={15} /> Gastos{" "}
          <span>{items.filter((item) => item.kind === "financeiro").length}</span>
        </button>
        <button className={tab === "revisao" ? "active" : ""} onClick={() => setTab("revisao")}>
          Revisão{" "}
          <span>{items.filter((item) => item.reviewStatus === "pending").length}</span>
        </button>
      </div>

      {message && <div className="document-message" role="status">{message}</div>}

      <section className="document-layout">
        <div className="document-list">
          <div className="document-list-head">
            <strong>Arquivo local</strong>
            <select
              className="document-month-filter"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              aria-label="Filtrar por mês"
            >
              <option value="all">Todos os meses</option>
              {availableMonths.map((value) => (
                <option value={value} key={value}>{value}</option>
              ))}
            </select>
            <label>
              <Search size={15} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar arquivo"
              />
            </label>
          </div>

          {filtered.length === 0 ? (
            <div className="document-empty">
              <FileArchive size={30} />
              <p>Nenhum documento nesta visão.</p>
            </div>
          ) : (
            filtered.map((item) => (
              <article className="document-row" key={item.id}>
                <div className="document-icon"><FileText size={18} /></div>
                <div className="document-row-main">
                  <strong>{item.name}</strong>
                  <small>
                    {labelKind(item.kind)} · pasta {item.folder} · {(item.size / 1024).toFixed(0)} KB
                  </small>
                  {item.processing && (
                    <small className="document-warn">
                      Processando localmente… o original já foi salvo neste dispositivo.
                    </small>
                  )}
                  {item.processingError && (
                    <small className="document-warn">
                      Falha individual de leitura; original preservado. {item.processingError}
                    </small>
                  )}
                  <small className={item.analysis === "texto extraído" ? "document-ok" : "document-warn"}>
                    {item.analysis} ·{" "}
                    <span className="document-confidence">
                      confiança {Math.round((item.confidence ?? 0) * 100)}%{" "}
                      <span className="document-confidence-meter" aria-hidden="true">
                        <i style={{ width: `${Math.round((item.confidence ?? 0) * 100)}%` }} />
                      </span>
                    </span>
                  </small>
                  {item.reviewStatus === "pending" && (
                    <button
                      className="document-confirm"
                      type="button"
                      disabled={item.processing}
                      onClick={() => void confirmDocument(item.id)}
                    >
                      Confirmar revisão
                    </button>
                  )}
                  {!item.extractedText && (item.blob || item.storageKey) && (
                    <button
                      className="document-confirm"
                      type="button"
                      disabled={ocrId === item.id || item.processing}
                      onClick={() => void runOcr(item)}
                    >
                      <ScanText size={14} />{" "}
                      {ocrId === item.id ? "Lendo localmente…" : "Tentar leitura local"}
                    </button>
                  )}
                  {item.kind === "financeiro" && (
                    <small>
                      {item.brand ?? "Bandeira não identificada"}
                      {item.institution ? ` · ${item.institution}` : ""}
                      {item.total ? ` · R$ ${item.total.toFixed(2).replace(".", ",")}` : ""}
                    </small>
                  )}
                  {(item.blob || item.storageKey) && (
                    <button
                      className="document-confirm"
                      type="button"
                      onClick={() => void downloadDocument(item)}
                    >
                      <Download size={14} /> Baixar arquivo original
                    </button>
                  )}
                </div>
              </article>
            ))
          )}
        </div>

        <aside className="document-insights">
          <div className="insight-card">
            <strong>Resumo financeiro</strong>
            <button
              className="document-export"
              type="button"
              onClick={exportCsv}
              disabled={financeItems.length === 0}
            >
              <Download size={13} /> CSV
            </button>
            <small className="document-period-label">
              {month === "all" ? "Todos os períodos" : `Período ${month}`}
            </small>
            <b>R$ {moneyTotal(financeItems).toFixed(2).replace(".", ",")}</b>
            {finance.length === 0 ? (
              <small>Adicione uma fatura com valores legíveis para consolidar.</small>
            ) : (
              finance.map(([category, amount]) => (
                <div className="insight-line" key={category}>
                  <span>{category}</span>
                  <span>R$ {amount.toFixed(2).replace(".", ",")}</span>
                </div>
              ))
            )}
          </div>

          <div className="insight-card">
            <strong>Comparação de exames</strong>
            {!latest ? (
              <small>Adicione PDF ou imagem de exame.</small>
            ) : (
              <>
                {Object.entries(latest.markers).map(([name, value]) => (
                  <div className="insight-line" key={name}>
                    <span>{name}</span>
                    <span>{value}</span>
                  </div>
                ))}
                {previous && (
                  <small>
                    Comparação com {previous.name}: {" "}
                    {Object.keys(latest.markers).filter(
                      (name) => typeof previous.markers[name] === "number",
                    ).length}{" "}
                    marcador(es) em comum.
                    {Object.entries(latest.markers)
                      .filter(([name]) => typeof previous.markers[name] === "number")
                      .map(
                        ([name, value]) =>
                          ` ${name}: ${value - (previous.markers[name] ?? value) >= 0 ? "+" : ""}${(value - (previous.markers[name] ?? value)).toFixed(2)};`,
                      )}
                  </small>
                )}
                <small>Informativo; não substitui avaliação médica.</small>
              </>
            )}
          </div>
        </aside>
      </section>

      <p className="document-footnote">
        <span className="document-disclaimer">
          <FileWarning size={15} /> PDFs com camada de texto e arquivos textuais
          podem ser lidos localmente. PDFs escaneados, imagens, DOC/DOCX e
          XLS/XLSX ficam arquivados com segurança e sinalizados para leitura
          local; esta versão não inventa resultados, não substitui profissionais
          e não envia arquivos automaticamente a serviços externos.
        </span>
      </p>
    </main>
  );
}
