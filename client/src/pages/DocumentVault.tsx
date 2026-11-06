import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  FileArchive,
  FileText,
  FolderHeart,
  ReceiptText,
  Upload,
  Search,
  ShieldCheck,
  FileWarning,
  Download,
  ScanText,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { readLocal, writeLocal } from "@/lib/irisLocalStore";
import { runLocalOcr } from "@/lib/localOcr";
import { downloadIrisFile, loadIrisData, saveIrisData, uploadIrisFile } from "@/lib/irisWorker";
import { readDocumentText } from "@/lib/localOcr";
import "./document-vault.css";

type Kind = "saude" | "financeiro" | "geral";
type Category =
  | "Supermercado"
  | "Posto de combustível"
  | "Hotel"
  | "Restaurante"
  | "Farmácia"
  | "Transporte"
  | "Serviços"
  | "Outros";
type Money = { category: Category; amount: number; source: string };
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
};

const healthTerms =
  /exame|laudo|hemoglobina|glicose|colesterol|triglicer|press[aã]o|consulta|laborat[oó]rio/i;
const financeTerms =
  /fatura|cart[aã]o|vencimento|parcela|estabelecimento|compra|lan[cç]amento|banco|visa|mastercard|elo|amex/i;
const categories: [Category, RegExp][] = [
  ["Supermercado", /supermerc|carrefour|p[aã]o de a[cç]úcar|atacad/i],
  [
    "Posto de combustível",
    /posto|combust[ií]vel|gasolin|shell|ipiranga|br distrib/i,
  ],
  ["Hotel", /hotel|hosped|pousada|booking|airbnb/i],
  ["Restaurante", /restaurante|lanch|ifood|outback|bar\b/i],
  ["Farmácia", /farm[aá]cia|droga|pharma/i],
  ["Transporte", /uber|99\b|taxi|ped[aá]gio|estacion/i],
  ["Serviços", /energia|telefone|internet|seguro|academia|servi[cç]o/i],
];

function parseMoney(value: string) {
  const result: Money[] = [];
  const pattern = /(?:R\$\s*|BRL\s*)([\d.]+,[\d]{2})/gi;
  for (const match of value.matchAll(pattern)) {
    const amount = Number(match[1].replace(/\./g, "").replace(",", "."));
    if (Number.isFinite(amount)) {
      const line = value.slice(
        Math.max(0, (match.index ?? 0) - 100),
        (match.index ?? 0) + 100,
      );
      const found = categories.find(([, rule]) => rule.test(line));
      result.push({
        category: found?.[0] ?? "Outros",
        amount,
        source: line.replace(/\s+/g, " ").trim(),
      });
    }
  }
  return result;
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
function classify(file: File, text: string): Kind {
  const combined = `${file.name} ${text}`;
  if (healthTerms.test(combined)) return "saude";
  if (financeTerms.test(combined)) return "financeiro";
  return "geral";
}
function moneyTotal(items: DocumentRecord[]) {
  return items
    .flatMap((item) => item.money)
    .reduce((sum, item) => sum + item.amount, 0);
}
function labelKind(kind: Kind) {
  return kind === "saude"
    ? "Saúde"
    : kind === "financeiro"
      ? "Financeiro"
      : "Geral";
}

export default function DocumentVault() {
  const [items, setItems] = useState<DocumentRecord[]>([]);
  const [tab, setTab] = useState<"todos" | Kind | "revisao">("todos");
  const [query, setQuery] = useState("");
  const [month, setMonth] = useState("all");
  const [message, setMessage] = useState("");
  const [ocrId, setOcrId] = useState<string | null>(null);
  useEffect(() => {
    void readLocal<DocumentRecord[]>("irisDocuments", []).then((local) => {
      setItems(local);
      void loadIrisData("documents").then(({ items: rows }) => {
        if (!rows.length) return;
        const remote = rows.map((row) => {
          const payload = (row.payload ?? {}) as Partial<DocumentRecord>;
          return {
            ...payload,
            id: String(row.id ?? payload.id ?? crypto.randomUUID()),
            name: String(row.name ?? payload.name ?? "Documento"),
            mime: String(row.mime_type ?? payload.mime ?? "application/octet-stream"),
            size: Number(payload.size ?? 0),
            folder: String(payload.folder ?? "Documentos"),
            kind: (payload.kind ?? "geral") as Kind,
            createdAt: String(payload.createdAt ?? row.created_at ?? new Date().toISOString()),
            extractedText: String(payload.extractedText ?? ""),
            analysis: (payload.analysis ?? "arquivado · formato não textual") as DocumentRecord["analysis"],
            money: Array.isArray(payload.money) ? payload.money : [],
            markers: payload.markers ?? {},
          } as DocumentRecord;
        });
        setItems(remote);
      }).catch(() => undefined);
    });
  }, []);
  const save = async (next: DocumentRecord[]) => {
    setItems(next);
    await writeLocal("irisDocuments", next);
    await Promise.all(
      next.map(async (item) => {
        const { blob: _blob, ...payload } = item;
        await saveIrisData("documents", {
          id: item.id,
          name: item.name,
          mime_type: item.mime,
          storage_key: item.storageKey ?? null,
          payload,
        }).catch(() => undefined);
        if (item.kind === "financeiro") {
          await saveIrisData("finances", {
            id: item.id,
            type: "document",
            description: item.name,
            amount_cents: Math.round((item.total ?? moneyTotal([item])) * 100),
            status: item.reviewStatus === "confirmed" ? "confirmed" : "open",
            payload: { money: item.money, createdAt: item.createdAt },
          }).catch(() => undefined);
        }
      }),
    );
  };
  const ingest = async (files: FileList | null) => {
    if (!files) return;
    setMessage("Processando arquivos localmente…");
    const added: DocumentRecord[] = [];
    let duplicates = 0;
    let uploaded = 0;
    let uploadFailures = 0;
    for (const file of Array.from(files)) {
      const hash = `${file.name.toLowerCase()}|${file.size}|${file.lastModified}`;
      if (items.some((item) => item.hash === hash)) {
        duplicates++;
        continue;
      }
      const reading = await readDocumentText(file);
      const text = reading.text;
      const readable = Boolean(text) && (reading.method !== "ocr" || reading.confidence >= 45);
      const kind = classify(file, text);
      const money = readable ? parseMoney(text) : [];
      const record: DocumentRecord = {
        id: crypto.randomUUID(),
        name: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
        folder:
          kind === "saude"
            ? "Exames"
            : kind === "financeiro"
              ? "Financeiro"
              : "Documentos",
        kind,
        createdAt: new Date().toISOString(),
        extractedText: readable ? text : "",
        analysis: readable
          ? "texto extraído"
          : file.type.startsWith("image/") || file.type === "application/pdf"
            ? "arquivado · OCR necessário"
            : "arquivado · formato não textual",
        institution: text
          .match(/(?:banco|bank)\s*[:\-]?\s*([A-ZÀ-Ú][\wÀ-Ú ]{2,40})/i)?.[1]
          ?.trim(),
        brand:
          text.match(/\b(Visa|Mastercard|Elo|American Express|Amex)\b/i)?.[1] ??
          undefined,
        total: money.reduce((sum, item) => sum + item.amount, 0) || undefined,
        money,
        markers: parseMarkers(text),
        hash,
        reviewStatus: "pending",
        confidence: readable ? Math.min(1, reading.confidence / 100) : 0.2,
        blob: file,
      };
      try {
        const remote = await uploadIrisFile(file, record.id);
        record.storageKey = remote.key;
        uploaded++;
      } catch {
        uploadFailures++;
      }
      added.push(record);
    }
    await save([...added, ...items]);
    setMessage(
      `${added.length} arquivo(s) arquivado(s) para revisão${duplicates ? `; ${duplicates} duplicado(s) ignorado(s)` : ""}. R2: ${uploaded} enviado(s)${uploadFailures ? `, ${uploadFailures} pendente(s) localmente` : ""}.`,
    );
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
  const confirmDocument = async (id: string) =>
    save(
      items.map((item) =>
        item.id === id ? { ...item, reviewStatus: "confirmed" as const } : item,
      ),
    );
  const runOcr = async (item: DocumentRecord) => {
    if (!item.blob) {
      setMessage("O arquivo original não está disponível para OCR local.");
      return;
    }
    setOcrId(item.id);
    setMessage("OCR local em andamento. O arquivo não será enviado.");
    try {
      const text = await runLocalOcr(item.blob, ({ progress }) => {
        setMessage(
          `OCR local: ${Math.round(progress * 100)}%. Nenhum envio externo.`,
        );
      });
      const next = items.map((current) =>
        current.id === item.id
          ? {
              ...current,
              extractedText: text,
              analysis: text ? ("texto extraído" as const) : current.analysis,
              kind: classify(
                new File([item.blob!], item.name, { type: item.mime }),
                text,
              ),
              money: parseMoney(text),
              markers: parseMarkers(text),
              confidence: text ? 0.82 : current.confidence,
            }
          : current,
      );
      await save(next);
      setMessage(
        text
          ? "OCR concluído localmente; revise a classificação."
          : "OCR não encontrou texto legível.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `OCR local indisponível: ${error.message}`
          : "OCR local indisponível.",
      );
    } finally {
      setOcrId(null);
    }
  };
  const downloadDocument = async (item: DocumentRecord) => {
    if (!item.storageKey) { setMessage("Este documento só está disponível neste dispositivo."); return; }
    try {
      const blob = await downloadIrisFile(item.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = item.name; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(`Download de ${item.name} iniciado.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível baixar o documento."); }
  };
  const financeItems = items.filter(
    (item) =>
      item.kind === "financeiro" &&
      (month === "all" || item.createdAt.slice(0, 7) === month),
  );
  const finance = useMemo(() => {
    const map = new Map<Category, number>();
    for (const item of financeItems)
      for (const entry of item.money)
        map.set(entry.category, (map.get(entry.category) ?? 0) + entry.amount);
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
      .map((row) =>
        row
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `iris-gastos-${month === "all" ? "todos" : month}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
            PDF, imagens, texto, CSV e formatos comuns. O original fica no
            navegador e nunca é enviado automaticamente.
          </p>
        </div>
        <label className="button-like">
          <Upload size={16} /> Escolher arquivos
          <input
            type="file"
            multiple
            accept=".pdf,.txt,.csv,.json,.xml,.doc,.docx,.xls,.xlsx,image/*"
            hidden
            onChange={(event) => {
              void ingest(event.target.files);
              event.currentTarget.value = "";
            }}
          />
        </label>
      </section>
      <div className="document-tabs">
        <button
          className={tab === "todos" ? "active" : ""}
          onClick={() => setTab("todos")}
        >
          Todos <span>{items.length}</span>
        </button>
        <button
          className={tab === "saude" ? "active" : ""}
          onClick={() => setTab("saude")}
        >
          <FolderHeart size={15} /> Exames <span>{exams.length}</span>
        </button>
        <button
          className={tab === "financeiro" ? "active" : ""}
          onClick={() => setTab("financeiro")}
        >
          <ReceiptText size={15} /> Gastos{" "}
          <span>
            {items.filter((item) => item.kind === "financeiro").length}
          </span>
        </button>
        <button
          className={tab === "revisao" ? "active" : ""}
          onClick={() => setTab("revisao")}
        >
          Revisão{" "}
          <span>
            {items.filter((item) => item.reviewStatus === "pending").length}
          </span>
        </button>
      </div>
      {message && <div className="document-message">{message}</div>}
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
                <option value={value} key={value}>
                  {value}
                </option>
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
                <div className="document-icon">
                  <FileText size={18} />
                </div>
                <div className="document-row-main">
                  <strong>{item.name}</strong>
                  <small>
                    {labelKind(item.kind)} · pasta {item.folder} ·{" "}
                    {(item.size / 1024).toFixed(0)} KB
                  </small>
                  <small
                    className={
                      item.analysis === "texto extraído"
                        ? "document-ok"
                        : "document-warn"
                    }
                  >
                    {item.analysis} ·{" "}
                    <span className="document-confidence">
                      confiança {Math.round((item.confidence ?? 0) * 100)}%{" "}
                      <span
                        className="document-confidence-meter"
                        aria-hidden="true"
                      >
                        <i
                          style={{
                            width: `${Math.round((item.confidence ?? 0) * 100)}%`,
                          }}
                        />
                      </span>
                    </span>
                  </small>
                  {item.reviewStatus === "pending" && (
                    <button
                      className="document-confirm"
                      type="button"
                      onClick={() => void confirmDocument(item.id)}
                    >
                      Confirmar revisão
                    </button>
                  )}
                  {!item.extractedText && item.blob && (
                    <button
                      className="document-confirm"
                      type="button"
                      disabled={ocrId === item.id}
                      onClick={() => void runOcr(item)}
                    >
                      <ScanText size={14} />{" "}
                      {ocrId === item.id
                        ? "Lendo localmente…"
                        : "Tentar OCR local"}
                    </button>
                  )}
                  {item.kind === "financeiro" && (
                    <small>
                      {item.brand ?? "Bandeira não identificada"}
                      {item.institution ? ` · ${item.institution}` : ""}
                      {item.total
                        ? ` · R$ ${item.total.toFixed(2).replace(".", ",")}`
                        : ""}
                    </small>
                  )}
                  {item.storageKey && (
                    <button className="document-confirm" type="button" onClick={() => void downloadDocument(item)}>
                      <Download size={14} /> Baixar arquivo
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
              <small>
                Adicione uma fatura com valores legíveis para consolidar.
              </small>
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
                {Object.entries(latest.markers).map(([name, value]) => {
                  return (
                    <div className="insight-line" key={name}>
                      <span>{name}</span>
                      <span>{value}</span>
                    </div>
                  );
                })}
                {previous && (
                  <small>
                    Comparação com {previous.name}:{" "}
                    {
                      Object.keys(latest.markers).filter(
                        (name) => typeof previous.markers[name] === "number",
                      ).length
                    }{" "}
                    marcador(es) em comum.
                    {Object.entries(latest.markers)
                      .filter(
                        ([name]) => typeof previous.markers[name] === "number",
                      )
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
          XLS/XLSX são arquivados com segurança e ficam sinalizados para OCR ou
          leitura especializada; esta versão não inventa resultados, não
          substitui profissionais e não envia arquivos a serviços externos.
        </span>
      </p>
    </main>
  );
}
