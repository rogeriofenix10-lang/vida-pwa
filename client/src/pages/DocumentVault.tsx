import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Download,
  FileArchive,
  FileText,
  FileWarning,
  FolderHeart,
  ScanText,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { Link } from "wouter";
import { readLocal, writeLocal, downloadBlob, assertLocalFileSize } from "@/lib/irisLocalStore";
import { downloadIrisFile } from "@/lib/irisWorker";
import { readDocumentText, type DocumentReadResult } from "@/lib/localOcr";
import { deleteDocumentFromLatest, updateExistingDocument } from "@/lib/documentDeletion";
import { redactFinancialIdentifiers } from "@shared/cardStatement";
import {
  classifyDocument,
  documentFileHash,
  folderForClassification,
  isContractDocument,
  isFinancialDocument,
  kindForClassification,
  type DocumentClassification,
  type DocumentKind,
} from "@/lib/documentLibrary";
import "./document-vault.css";

type Money = {
  category: string;
  amount: number;
  source: string;
  date?: string;
};
type DocumentRecord = {
  id: string;
  name: string;
  mime: string;
  size: number;
  folder: string;
  kind: DocumentKind;
  createdAt: string;
  extractedText: string;
  analysis:
    | "texto extraído"
    | "arquivado · OCR necessário"
    | "arquivado · formato não textual";
  markers: Record<string, number>;
  reviewStatus?: "pending" | "confirmed";
  confidence?: number;
  blob?: Blob;
  storageKey?: string;
  storagekey?: string;
  processing?: boolean;
  processingError?: string;
  // Legacy financial metadata is retained on existing records but never written here.
  institution?: string;
  brand?: string;
  total?: number;
  statementTotal?: number;
  statementDueAt?: string;
  warnings?: string[];
  money?: Money[];
  hash?: string;
  classificationKind?: string;
  [legacyField: string]: unknown;
};
type Tab = "todos" | "saude" | "contratos" | "revisao";

function safeStoredText(value: string, maxLength = 200000) {
  return redactFinancialIdentifiers(
    value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " "),
  ).slice(0, maxLength);
}

function safeFileName(value: string) {
  const leaf = value.replaceAll("\\", "/").split("/").pop() ?? value;
  return safeStoredText(leaf.replace(/[\u0000-\u001F\u007F]/g, "_"), 180).trim() || "documento";
}

function safeWarnings(warnings: string[]) {
  return warnings.map((warning) => safeStoredText(warning, 500)).filter(Boolean);
}

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

function needsOcr(file: Pick<File, "type" | "name">) {
  return file.type.startsWith("image/") ||
    file.type === "application/pdf" ||
    /\.(pdf|jpe?g|png|tiff?|webp)$/i.test(file.name);
}

function labelKind(item: DocumentRecord) {
  if (isContractDocument(item)) return "Contrato";
  return item.kind === "saude" ? "Saúde" : item.kind === "financeiro" ? "Financeiro" : "Geral";
}

function originalAvailable(item: DocumentRecord) {
  return Boolean(item.blob || item.storageKey || item.storagekey);
}

function analysisIsReliable(reading: DocumentReadResult) {
  return Boolean(reading.text) && (reading.method !== "ocr" || reading.confidence >= 45);
}

export default function DocumentVault() {
  const [items, setItems] = useState<DocumentRecord[]>([]);
  const [tab, setTab] = useState<Tab>("todos");
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

  // Updates replace only the explicitly edited record; no load-time migration or finance writes.
  const persistDocument = async (document: DocumentRecord) => {
    const next = await updateExistingDocument(
      document,
      () => readLocal<DocumentRecord[]>("irisDocuments", []),
      (records) => writeLocal("irisDocuments", records),
    );
    setItems(next);
    return next;
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
        rejectedForSize.push(safeFileName(file.name));
        continue;
      }

      let hash: string;
      try {
        hash = await documentFileHash(file);
      } catch {
        failures += 1;
        setMessage("Não foi possível calcular uma impressão digital local segura; este arquivo não foi arquivado.");
        continue;
      }
      if (knownHashes.has(hash)) {
        duplicates += 1;
        continue;
      }
      knownHashes.add(hash);

      const initialClassification = classifyDocument(file, "");
      const kind = kindForClassification(initialClassification);
      const record: DocumentRecord = {
        id: crypto.randomUUID(),
        name: safeFileName(file.name),
        mime: file.type || "application/octet-stream",
        size: file.size,
        folder: folderForClassification(initialClassification),
        kind,
        createdAt: new Date().toISOString(),
        extractedText: "",
        analysis: needsOcr(file)
          ? "arquivado · OCR necessário"
          : "arquivado · formato não textual",
        markers: {},
        money: [],
        hash,
        reviewStatus: "pending",
        confidence: 0,
        // Preserve the exact original bytes and MIME type locally.
        blob: new Blob([file], { type: file.type || "application/octet-stream" }),
        processing: true,
      };

      try {
        const latest = await readLocal<DocumentRecord[]>("irisDocuments", currentItems);
        currentItems = [record, ...latest.filter((item) => item.id !== record.id)];
        await writeLocal("irisDocuments", currentItems);
        setItems(currentItems);
        archived += 1;
      } catch (error) {
        failures += 1;
        setMessage(
          `Não foi possível arquivar ${record.name}; o processamento desse arquivo foi ignorado e o lote continuará.${error instanceof Error ? ` ${safeStoredText(error.message, 500)}` : ""}`,
        );
        continue;
      }

      try {
        setMessage(`Original de ${record.name} salvo localmente. Iniciando leitura…`);
        const onProgress = ({ progress, status }: { progress: number; status: string }) => {
          setMessage(
            `${record.name} · ${status} (${Math.round(progress * 100)}%). Original já salvo localmente.`,
          );
        };
        // Extract text locally for indexing/archive; financial analysis remains in FinanceHub.
        const reading = await readDocumentText(file, onProgress);
        const classification = classifyDocument(file, reading.text);
        const resultKind = kindForClassification(classification);
        const reliable = analysisIsReliable(reading);
        const updated: DocumentRecord = {
          ...record,
          folder: folderForClassification(classification),
          kind: resultKind,
          extractedText: reliable ? safeStoredText(reading.text) : "",
          analysis: reliable
            ? "texto extraído"
            : needsOcr(file)
              ? "arquivado · OCR necessário"
              : "arquivado · formato não textual",
          warnings: reading.warning ? safeWarnings([reading.warning]) : [],
          markers: resultKind === "saude" && reliable ? parseMarkers(reading.text) : {},
          confidence: reading.confidence / 100,
          processing: false,
          processingError: undefined,
        };
        currentItems = await persistDocument(updated);
      } catch (error) {
        failures += 1;
        const latestRecords = await readLocal<DocumentRecord[]>("irisDocuments", currentItems).catch(
          () => currentItems,
        );
        const latestRecord = latestRecords.find((item) => item.id === record.id) ?? record;
        const failed: DocumentRecord = {
          ...latestRecord,
          processing: false,
          processingError: safeStoredText(
            error instanceof Error ? error.message : "Falha durante a leitura local.",
            500,
          ),
        };
        try {
          currentItems = await persistDocument(failed);
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
    () => [...new Set(items.map((item) => item.createdAt.slice(0, 7)))].sort().reverse(),
    [items],
  );
  const filtered = useMemo(
    () =>
      items.filter((item) =>
        (tab === "todos" ||
          (tab === "saude" && item.kind === "saude") ||
          (tab === "contratos" && isContractDocument(item)) ||
          (tab === "revisao" && !isFinancialDocument(item) && item.reviewStatus === "pending")) &&
        (month === "all" || item.createdAt.slice(0, 7) === month) &&
        item.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [items, tab, query, month],
  );

  const confirmDocument = async (id: string) => {
    const latest = await readLocal<DocumentRecord[]>("irisDocuments", items);
    const document = latest.find((item) => item.id === id);
    if (!document || isFinancialDocument(document)) return;
    const next = latest.map((item) =>
      item.id === id ? { ...item, reviewStatus: "confirmed" as const } : item,
    );
    await writeLocal("irisDocuments", next);
    setItems(next);
  };

  const deleteDocument = async (item: DocumentRecord) => {
    if (item.processing || ocrId === item.id) {
      setMessage(`A exclusão de ${item.name} fica bloqueada enquanto a leitura local estiver em andamento.`);
      return;
    }

    const confirmed = window.confirm(
      `Excluir “${item.name}” deste dispositivo?\n\nEsta ação remove somente a cópia local deste documento. Não apaga lançamentos de Finanças nem o arquivo remoto (se houver), e não altera os outros documentos. Esta ação não pode ser desfeita.`,
    );
    if (!confirmed) return;

    try {
      const result = await deleteDocumentFromLatest(
        item.id,
        confirmed,
        () => readLocal<DocumentRecord[]>("irisDocuments", []),
        (records) => writeLocal("irisDocuments", records),
      );
      if (result.status === "cancelled") return;

      setItems(result.records);
      if (result.status === "deleted") {
        setMessage(`A cópia local de “${item.name}” foi removida. Lançamentos de Finanças e arquivos remotos não foram alterados.`);
      } else if (result.status === "processing") {
        setMessage(`Não foi possível excluir “${item.name}”: a leitura local está em andamento.`);
      } else {
        setMessage(`“${item.name}” não está mais no arquivo local; a lista foi atualizada.`);
      }
    } catch (error) {
      setMessage(
        `Não foi possível excluir “${item.name}”; os dados locais foram preservados.${error instanceof Error ? ` ${safeStoredText(error.message, 300)}` : ""}`,
      );
    }
  };

  const runOcr = async (item: DocumentRecord) => {
    if (isFinancialDocument(item)) {
      setMessage("Faturas e extratos permanecem arquivados aqui; leitura financeira e lançamentos ficam no módulo Finanças.");
      return;
    }
    setOcrId(item.id);
    setMessage("Leitura local em andamento. O original permanece arquivado neste dispositivo.");

    let started: DocumentRecord = {
      ...item,
      processing: true,
      processingError: undefined,
    };
    try {
      const source = item.blob ?? (item.storageKey || item.storagekey ? await downloadIrisFile(item.id) : null);
      if (!source) {
        throw new Error("O arquivo original não está disponível para leitura local.");
      }

      await persistDocument(started);
      const file = new File([source], item.name, { type: item.mime });
      const onProgress = ({ progress, status }: { progress: number; status: string }) => {
        setMessage(`Leitura local de ${item.name} · ${status} (${Math.round(progress * 100)}%).`);
      };
      const reading = await readDocumentText(file, onProgress);
      const classification: DocumentClassification = classifyDocument(file, reading.text);
      const kind = kindForClassification(classification);
      const reliable = analysisIsReliable(reading);
      const updated: DocumentRecord = {
        ...started,
        folder: folderForClassification(classification),
        kind,
        extractedText: reliable ? safeStoredText(reading.text) : item.extractedText,
        analysis: reliable ? "texto extraído" : item.analysis,
        warnings:
          kind === "financeiro"
            ? item.warnings
            : reliable && reading.warning
              ? safeWarnings([reading.warning])
              : item.warnings,
        markers: reliable
          ? kind === "saude"
            ? parseMarkers(reading.text)
            : kind === "financeiro"
              ? item.markers
              : {}
          : item.markers,
        confidence: reliable ? reading.confidence / 100 : item.confidence,
        processing: false,
        processingError: undefined,
      };
      await persistDocument(updated);
      setMessage(
        kind === "financeiro"
          ? "Leitura local concluída. O arquivo foi classificado como financeiro; nenhum lançamento foi criado. Confira a gestão no módulo Finanças."
          : reliable
            ? `Leitura local concluída · confiança ${Math.round(reading.confidence)}%.${reading.warning ? ` ${safeStoredText(reading.warning, 500)}` : ""}`
            : `Documento continua pendente: leitura insuficiente (confiança ${Math.round(reading.confidence)}%).${reading.warning ? ` ${safeStoredText(reading.warning, 500)}` : ""}`,
      );
    } catch (error) {
      const latestRecords = await readLocal<DocumentRecord[]>("irisDocuments", items).catch(
        () => items,
      );
      const latestRecord = latestRecords.find((current) => current.id === item.id) ?? started;
      const failed: DocumentRecord = {
        ...latestRecord,
        processing: false,
        processingError: safeStoredText(
          error instanceof Error ? error.message : "OCR local indisponível.",
          500,
        ),
      };
      await persistDocument(failed).catch(() => undefined);
      setMessage(
        error instanceof Error
          ? `Falha na leitura local; o original continua arquivado. ${safeStoredText(error.message, 500)}`
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
      } else if (item.storageKey || item.storagekey) {
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

  const exams = [...items.filter((item) => item.kind === "saude")].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt),
  );
  const latest = exams[0];
  const previous = exams[1];
  const contractCount = items.filter(isContractDocument).length;
  const reviewCount = items.filter(
    (item) => !isFinancialDocument(item) && item.reviewStatus === "pending",
  ).length;

  return (
    <main className="document-vault">
      <div className="document-vault-head">
        <Link href="/" className="back-link">
          <ArrowLeft size={16} /> Início
        </Link>
        <div>
          <div className="eyebrow">IRIS LOCAL · ARQUIVO INTELIGENTE</div>
          <h1>Documentos e contratos</h1>
          <p>
            Arquive, organize, leia e baixe neste dispositivo. Contratos têm uma pasta própria;
            faturas e extratos são analisados no módulo Finanças.
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
            PDFs aceitos para leitura local têm até 100 páginas e 16 milhões de pixels por página.
            O original fica local, sem alterar seu conteúdo, e pode conter números identificadores. Textos derivados são mascarados.
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
        <button className={tab === "contratos" ? "active" : ""} onClick={() => setTab("contratos")}>
          <FileText size={15} /> Contratos <span>{contractCount}</span>
        </button>
        <button className={tab === "revisao" ? "active" : ""} onClick={() => setTab("revisao")}>
          Revisão <span>{reviewCount}</span>
        </button>
      </div>

      {message && <div className="document-message" role="status">{message}</div>}

      <section className={tab === "saude" ? "document-layout" : "document-layout document-library-layout"}>
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
            filtered.map((item) => {
              const financial = isFinancialDocument(item);
              return (
                <article className="document-row" key={item.id}>
                  <div className="document-icon"><FileText size={18} /></div>
                  <div className="document-row-main">
                    <strong>{item.name}</strong>
                    <small>
                      {labelKind(item)} · pasta {item.folder} · {(item.size / 1024).toFixed(0)} KB
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
                    {financial ? (
                      <small className="document-finance-note">
                        Original financeiro arquivado. Análise e lançamentos ficam em{" "}
                        <Link href="/financas">Finanças</Link>.
                        {!originalAvailable(item) && " O original não está disponível aqui; recupere-o antes de analisar."}
                      </small>
                    ) : (
                      <small className={item.analysis === "texto extraído" ? "document-ok" : "document-warn"}>
                        {item.analysis} ·{" "}
                        <span className="document-confidence">
                          confiança {Math.round((item.confidence ?? 0) * 100)}%{" "}
                          <span className="document-confidence-meter" aria-hidden="true">
                            <i style={{ width: `${Math.round((item.confidence ?? 0) * 100)}%` }} />
                          </span>
                        </span>
                      </small>
                    )}
                    {!financial && item.reviewStatus === "pending" && (
                      <button
                        className="document-confirm"
                        type="button"
                        disabled={item.processing}
                        onClick={() => void confirmDocument(item.id)}
                      >
                        Confirmar revisão
                      </button>
                    )}
                    {!financial && !item.extractedText && originalAvailable(item) && (
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
                    {originalAvailable(item) && (
                      <button
                        className="document-confirm"
                        type="button"
                        onClick={() => void downloadDocument(item)}
                      >
                        <Download size={14} /> Baixar arquivo original
                      </button>
                    )}
                    <button
                      className="document-delete"
                      type="button"
                      onClick={() => void deleteDocument(item)}
                      disabled={Boolean(item.processing) || ocrId === item.id}
                      aria-label={`Excluir documento ${item.name}`}
                      title="Excluir somente a cópia deste dispositivo"
                    >
                      <Trash2 size={14} /> Excluir
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </div>

        {tab === "saude" && <aside className="document-insights">
          <div className="insight-card">
            <strong>Comparação de exames</strong>
            {!latest ? (
              <small>Adicione PDF ou imagem de exame.</small>
            ) : (
              <>
                {Object.entries(latest.markers ?? {}).map(([name, value]) => (
                  <div className="insight-line" key={name}>
                    <span>{name}</span>
                    <span>{value}</span>
                  </div>
                ))}
                {previous && (
                  <small>
                    Comparação com {previous.name}: {" "}
                    {Object.keys(latest.markers ?? {}).filter(
                      (name) => typeof previous.markers?.[name] === "number",
                    ).length}{" "}
                    marcador(es) em comum.
                    {Object.entries(latest.markers ?? {})
                      .filter(([name]) => typeof previous.markers?.[name] === "number")
                      .map(
                        ([name, value]) =>
                          ` ${name}: ${value - (previous.markers?.[name] ?? value) >= 0 ? "+" : ""}${(value - (previous.markers?.[name] ?? value)).toFixed(2)};`,
                      )}
                  </small>
                )}
                <small>Informativo; não substitui avaliação médica.</small>
              </>
            )}
          </div>
        </aside>}
      </section>

      <p className="document-footnote">
        <span className="document-disclaimer">
          <FileWarning size={15} /> PDFs com camada de texto e arquivos textuais podem ser lidos localmente.
          PDFs escaneados e imagens podem exigir OCR local; DOC/DOCX e XLS/XLSX ficam arquivados sem leitura.
          Esta versão não inventa resultados, não substitui profissionais e não envia arquivos automaticamente a serviços externos.
        </span>
      </p>
    </main>
  );
}
