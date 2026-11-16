import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BriefcaseBusiness,
  Download,
  FileDown,
  FileText,
  Paperclip,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UsersRound,
  X,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import BusinessClientEditor from "@/components/BusinessClientEditor";
import {
  BUSINESS_CLIENT_FIELDS,
  BUSINESS_CLIENT_FIELD_LABELS,
  annotateBusinessClientDuplicates,
  businessClientDisplayName,
  businessClientExportCsv,
  businessClientExportJson,
  businessClientMissingFields,
  filterBusinessClients,
  mergeBusinessRecords,
  parseBusinessRemoteRow,
  toBusinessRemoteRow,
  type BusinessClientCandidate,
  type BusinessClientValues,
  type BusinessImportFile,
  type BusinessKind,
  type BusinessRecord,
} from "@/lib/businessRecords";
import { readClientImportFile } from "@/lib/clientImport";
import {
  assertLocalFileSize,
  downloadBlob,
  downloadJson,
  readLocal,
  writeLocal,
  writeLocalBatch,
} from "@/lib/irisLocalStore";
import {
  downloadIrisFile,
  isIrisAccessUnlocked,
  isIrisRemoteModeEnabled,
  loadIrisData,
  saveIrisData,
  uploadIrisFile,
} from "@/lib/irisWorker";
import "./business-hub.css";

type Draft = {
  kind: BusinessKind;
  name: string;
  company: string;
  amount: string;
  status: string;
  notes: string;
};
type ImportReview = {
  file: File;
  hash: string;
  format: string;
  method: string;
  warnings: string[];
  candidates: BusinessClientCandidate[];
};
type ClientEdit = {
  id: string;
  values: BusinessClientValues;
  extraFields: Record<string, string>;
};

const labels: Record<BusinessKind, string> = {
  cliente: "Cliente",
  fornecedor: "Fornecedor",
  pedido: "Pedido",
  comissao: "Comissão",
  meta: "Meta",
  inadimplencia: "Inadimplência",
};
const newDraft = (): Draft => ({ kind: "cliente", name: "", company: "", amount: "", status: "aberto", notes: "" });
const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const bytesLabel = (bytes: number) => bytes < 1024 * 1024
  ? `${(bytes / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} KB`
  : `${(bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;

function clientValuesFromRecord(record: BusinessRecord): BusinessClientValues {
  const values: BusinessClientValues = {};
  for (const field of BUSINESS_CLIENT_FIELDS) {
    const value = record[field];
    if (typeof value === "string") values[field] = value;
  }
  if (!values.name) values.name = record.name || "";
  if (!values.legalName) values.legalName = record.company || "";
  return values;
}

function uniqueFileRecord(
  files: BusinessImportFile[],
  file: File,
  hash: string,
  purpose: BusinessImportFile["purpose"],
  recordIds: string[],
): { files: BusinessImportFile[]; id: string } {
  const existing = files.find((entry) => entry.hash === hash);
  if (existing) {
    const updated = {
      ...existing,
      relatedRecordIds: [...new Set([...(existing.relatedRecordIds ?? []), ...recordIds])],
    };
    return { files: files.map((entry) => entry.id === existing.id ? updated : entry), id: existing.id };
  }
  const entry: BusinessImportFile = {
    id: crypto.randomUUID(),
    name: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size,
    hash,
    createdAt: new Date().toISOString(),
    blob: file,
    purpose,
    relatedRecordIds: [...new Set(recordIds)],
  };
  return { files: [entry, ...files], id: entry.id };
}

async function sha256File(file: Blob) {
  if (!globalThis.crypto?.subtle) throw new Error("O navegador não oferece verificação local SHA-256; use uma conexão segura para importar o arquivo.");
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function importedRecord(candidate: BusinessClientCandidate, id: string, hash: string, fileName: string): BusinessRecord {
  const values = Object.fromEntries(Object.entries(candidate.values).filter(([, value]) => typeof value === "string" && value.trim())) as BusinessClientValues;
  const name = values.name?.trim() || values.legalName?.trim() || values.tradeName?.trim() || "";
  return {
    ...values,
    id,
    kind: "cliente",
    name,
    company: values.legalName || "",
    amount: 0,
    status: values.status || "",
    notes: values.notes || "",
    createdAt: new Date().toISOString(),
    email: values.email || "",
    phone: values.phone || "",
    extraFields: { ...candidate.extraFields },
    importFileHash: hash,
    importFileName: fileName,
    needsSync: true,
  };
}

function pdfFieldLines(record: BusinessRecord) {
  const lines = BUSINESS_CLIENT_FIELDS.map((field) => {
    const value = record[field];
    return `${BUSINESS_CLIENT_FIELD_LABELS[field]}: ${typeof value === "string" && value.trim() ? value.trim() : "Não informado"}`;
  });
  for (const [key, value] of Object.entries(record.extraFields ?? {})) lines.push(`${key}: ${value || "Não informado"}`);
  return lines;
}

export default function BusinessHub() {
  const [items, setItems] = useState<BusinessRecord[]>([]);
  const [files, setFiles] = useState<BusinessImportFile[]>([]);
  const [draft, setDraft] = useState<Draft>(newDraft);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [filters, setFilters] = useState({ name: "", group: "", city: "", state: "" });
  const [operationQuery, setOperationQuery] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importProgress, setImportProgress] = useState("");
  const [review, setReview] = useState<ImportReview | null>(null);
  const [edit, setEdit] = useState<ClientEdit | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    let active = true;
    const loadLocal = () => {
      void Promise.all([
        readLocal<BusinessRecord[]>("businessRecords", []),
        readLocal<BusinessImportFile[]>("businessImportFiles", []),
      ]).then(([localItems, localFiles]) => {
        if (!active) return;
        setItems(Array.isArray(localItems) ? localItems : []);
        setFiles(Array.isArray(localFiles) ? localFiles : []);
      }).catch(() => {
        if (active) setMessage("Não foi possível abrir os registros e arquivos comerciais locais. Nenhum dado foi removido.");
      });
    };
    const initialLoad = async () => {
      try {
        const [localItems, localFiles] = await Promise.all([
          readLocal<BusinessRecord[]>("businessRecords", []),
          readLocal<BusinessImportFile[]>("businessImportFiles", []),
        ]);
        const local = Array.isArray(localItems) ? localItems : [];
        if (!active) return;
        setItems(local);
        setFiles(Array.isArray(localFiles) ? localFiles : []);
        if (!isIrisRemoteModeEnabled() || !isIrisAccessUnlocked()) return;
        try {
          const { items: rows } = await loadIrisData("business");
          if (!active) return;
          const remote = rows.map((row) => parseBusinessRemoteRow(row)).filter((row) => row.id);
          const [latestLocal, latestFiles] = await Promise.all([
            readLocal<BusinessRecord[]>("businessRecords", []),
            readLocal<BusinessImportFile[]>("businessImportFiles", []),
          ]);
          const merged = mergeBusinessRecords(Array.isArray(latestLocal) ? latestLocal : local, remote);
          if (active) {
            setItems(merged);
            setFiles(Array.isArray(latestFiles) ? latestFiles : []);
          }
          if (JSON.stringify(merged) !== JSON.stringify(Array.isArray(latestLocal) ? latestLocal : local)) {
            await writeLocal("businessRecords", merged);
          }
        } catch {
          if (active) setMessage("A consulta remota não ficou disponível; os registros locais continuam acessíveis e intactos.");
        }
      } catch {
        if (active) setMessage("Não foi possível abrir os registros e arquivos comerciais locais. Nenhum dado foi removido.");
      }
    };
    window.addEventListener("iris-local-changed", loadLocal);
    void initialLoad();
    return () => {
      active = false;
      window.removeEventListener("iris-local-changed", loadLocal);
    };
  }, []);

  const clients = useMemo(() => filterBusinessClients(items, filters), [items, filters]);
  const operations = useMemo(() => items.filter((item) => item.kind !== "cliente" &&
    `${item.name} ${item.company} ${item.kind} ${item.notes}`.toLocaleLowerCase("pt-BR").includes(operationQuery.toLocaleLowerCase("pt-BR"))), [items, operationQuery]);
  const reviewCandidates = useMemo(() => review
    ? annotateBusinessClientDuplicates(review.candidates, items.filter((item) => item.kind === "cliente"))
    : [], [review, items]);
  const duplicateCount = reviewCandidates.filter((candidate) => candidate.duplicateReason).length;
  const selectedImportCount = reviewCandidates.filter((candidate) => candidate.selected && !candidate.duplicateReason).length;
  const pendingSyncCount = items.filter((item) => item.needsSync === true || !item.remoteSyncedAt).length;

  const setFilter = (field: keyof typeof filters, value: string) => setFilters((current) => ({ ...current, [field]: value }));

  const add = async () => {
    if (!draft.name.trim()) { setMessage("Informe um nome ou referência."); return; }
    setBusy(true);
    try {
      const id = crypto.randomUUID();
      let nextFiles = files;
      let localFileId: string | undefined;
      let attachmentHash: string | undefined;
      if (attachment) {
        assertLocalFileSize(attachment, "Anexo comercial");
        attachmentHash = await sha256File(attachment);
        const stored = uniqueFileRecord(files, attachment, attachmentHash, "record-attachment", [id]);
        nextFiles = stored.files;
        localFileId = stored.id;
      }
      const item: BusinessRecord = {
        id,
        kind: draft.kind,
        name: draft.name.trim(),
        company: draft.company.trim(),
        amount: Number(String(draft.amount).replace(",", ".")) || 0,
        status: draft.status,
        notes: draft.notes.trim(),
        createdAt: new Date().toISOString(),
        ...(localFileId ? { localFileId } : {}),
        ...(attachment ? { fileName: attachment.name, fileMime: attachment.type || "application/octet-stream" } : {}),
        needsSync: true,
      };
      const next = [item, ...items];
      await writeLocalBatch({ businessRecords: next, businessImportFiles: nextFiles });
      setItems(next);
      setFiles(nextFiles);
      setDraft(newDraft());
      setAttachment(null);
      setMessage(`${labels[item.kind]} salvo neste dispositivo${attachment ? " com anexo local" : ""}. Sincronização remota é opcional e manual.`);
    } catch (error) {
      setMessage(error instanceof Error ? `Não foi possível salvar localmente: ${error.message}` : "Não foi possível salvar o registro local.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    const item = items.find((entry) => entry.id === id);
    if (!item || !window.confirm(`Remover “${item.name}” dos registros comerciais deste dispositivo? Arquivos originais e dados remotos não serão apagados.`)) return;
    const next = items.filter((entry) => entry.id !== id);
    try {
      await writeLocal("businessRecords", next);
      setItems(next);
      setMessage("Registro removido apenas deste dispositivo; arquivos locais e cópias remotas não foram apagados.");
    } catch (error) {
      setMessage(error instanceof Error ? `Não foi possível remover o registro local: ${error.message}` : "Não foi possível remover o registro local.");
    }
  };

  const downloadRecordFile = async (item: BusinessRecord) => {
    const localFile = files.find((entry) => entry.id === item.localFileId);
    if (localFile?.blob instanceof Blob) {
      downloadBlob(localFile.name || item.fileName || item.name, localFile.blob, localFile.mime || "application/octet-stream");
      setMessage(`Download local de ${localFile.name || item.name} iniciado.`);
      return;
    }
    if (!item.storageKey) { setMessage("Este registro não possui arquivo anexado neste dispositivo."); return; }
    try {
      const blob = await downloadIrisFile(item.id);
      downloadBlob(item.fileName || item.name, blob, item.fileMime || "application/octet-stream");
      setMessage(`Download de ${item.fileName || item.name} iniciado.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível baixar o arquivo.");
    }
  };

  const selectImportFile = async (file: File | undefined) => {
    setReview(null);
    setMessage("");
    if (!file) return;
    setImportBusy(true);
    setImportProgress("Verificando arquivo e extraindo dados neste dispositivo…");
    try {
      assertLocalFileSize(file, "Arquivo de clientes");
      const [result, hash] = await Promise.all([
        readClientImportFile(file, setImportProgress),
        sha256File(file),
      ]);
      const candidates = annotateBusinessClientDuplicates(
        result.candidates.map((candidate) => ({ ...candidate, selected: true })),
        items.filter((item) => item.kind === "cliente"),
      ).map((candidate) => candidate.duplicateReason ? { ...candidate, selected: false } : candidate);
      setReview({ file, hash, format: result.format, method: result.method, warnings: result.warnings, candidates });
      setImportProgress("");
      setMessage(result.candidates.length
        ? `${result.candidates.length} registro(s) candidato(s) preparado(s) para revisão; nenhum dado foi salvo ou enviado.`
        : "Arquivo lido localmente. Não foram encontrados clientes identificáveis para revisar.");
    } catch (error) {
      setImportProgress("");
      setMessage(error instanceof Error ? error.message : "Não foi possível ler o arquivo neste dispositivo.");
    } finally {
      setImportBusy(false);
    }
  };

  const updateCandidate = (index: number, update: (candidate: BusinessClientCandidate) => BusinessClientCandidate) => {
    setReview((current) => current ? {
      ...current,
      candidates: current.candidates.map((candidate, candidateIndex) => candidateIndex === index ? update(candidate) : candidate),
    } : current);
  };

  const confirmImport = async () => {
    if (!review) return;
    const candidates = annotateBusinessClientDuplicates(review.candidates, items.filter((item) => item.kind === "cliente"));
    const chosen = candidates.filter((candidate) => candidate.selected && !candidate.duplicateReason);
    const missingIdentity = chosen.filter((candidate) =>
      ![candidate.values.name, candidate.values.legalName, candidate.values.tradeName].some((value) => value?.trim()),
    );
    if (missingIdentity.length) {
      setMessage(`${missingIdentity.length} candidato(s) sem nome, razão social ou nome fantasia não podem ser salvos. Preencha um desses campos na revisão.`);
      return;
    }
    const newIds = chosen.map(() => crypto.randomUUID());
    const additions = chosen.map((candidate, index) => importedRecord(candidate, newIds[index], review.hash, review.file.name));
    const nextItems = [...additions, ...items];
    const storedFile = uniqueFileRecord(files, review.file, review.hash, "client-import", additions.map((item) => item.id));
    if (!window.confirm(`Guardar o original ${review.file.name} neste dispositivo e adicionar ${additions.length} cliente(s) revisado(s)?${duplicateCount ? ` ${duplicateCount} duplicata(s) provável(is) ficarão de fora.` : ""} Nada será enviado ao serviço remoto.`)) return;
    setImportBusy(true);
    try {
      await writeLocalBatch({ businessRecords: nextItems, businessImportFiles: storedFile.files });
      setItems(nextItems);
      setFiles(storedFile.files);
      setReview(null);
      setMessage(`${additions.length} cliente(s) salvo(s) localmente. Original preservado com hash SHA-256; sincronização remota não foi iniciada.`);
    } catch (error) {
      setMessage(error instanceof Error ? `Não foi possível confirmar a importação local: ${error.message}` : "Não foi possível salvar o lote local.");
    } finally {
      setImportBusy(false);
    }
  };

  const openClientEditor = (item: BusinessRecord) => setEdit({
    id: item.id,
    values: clientValuesFromRecord(item),
    extraFields: { ...(item.extraFields ?? {}) },
  });

  const saveClientEdit = async () => {
    if (!edit) return;
    const current = items.find((item) => item.id === edit.id);
    if (!current) { setEdit(null); return; }
    const values = edit.values;
    const name = values.name?.trim() || values.legalName?.trim() || values.tradeName?.trim() || current.name;
    const nextItem: BusinessRecord = {
      ...current,
      ...values,
      name,
      company: values.legalName?.trim() || "",
      email: values.email?.trim() || "",
      phone: values.phone?.trim() || "",
      notes: values.notes ?? "",
      status: values.status ?? "",
      extraFields: { ...edit.extraFields },
      needsSync: true,
      remoteSyncedAt: undefined,
    };
    const next = items.map((item) => item.id === nextItem.id ? nextItem : item);
    try {
      await writeLocal("businessRecords", next);
      setItems(next);
      setEdit(null);
      setMessage("Detalhes do cliente atualizados somente neste dispositivo. Sincronização remota requer ação separada.");
    } catch (error) {
      setMessage(error instanceof Error ? `Não foi possível salvar os detalhes: ${error.message}` : "Não foi possível salvar os detalhes localmente.");
    }
  };

  const syncExplicitly = async () => {
    if (!isIrisRemoteModeEnabled() || !isIrisAccessUnlocked()) {
      setMessage("Sincronização bloqueada: ative explicitamente o modo conectado e desbloqueie os serviços em Configurações. Os dados continuam locais.");
      return;
    }
    const pending = items.filter((item) => item.needsSync === true || !item.remoteSyncedAt);
    if (!pending.length) { setMessage("Não há registros locais pendentes de sincronização."); return; }
    if (!window.confirm(`Sincronizar ${pending.length} registro(s) comercial(is) para o D1${pending.some((item) => item.localFileId) ? " e anexos vinculados para R2" : ""}? Isso enviará os campos e extras desses registros. Arquivos importados de clientes não serão enviados. Esta ação só ocorre após esta confirmação.`)) return;
    setSyncing(true);
    let working = [...items];
    let sent = 0;
    try {
      for (const original of pending) {
        if (!isIrisRemoteModeEnabled() || !isIrisAccessUnlocked()) throw new Error("O acesso remoto foi protegido durante a sincronização. Os registros restantes continuam locais.");
        let storageKey = original.storageKey;
        if (!storageKey && original.localFileId) {
          const file = files.find((entry) => entry.id === original.localFileId);
          if (file?.blob instanceof Blob) storageKey = (await uploadIrisFile(new File([file.blob], file.name, { type: file.mime }), original.id)).key;
        }
        await saveIrisData("business", toBusinessRemoteRow(original, storageKey));
        const synced: BusinessRecord = {
          ...original,
          ...(storageKey ? { storageKey } : {}),
          remoteSyncedAt: new Date().toISOString(),
          needsSync: false,
        };
        working = working.map((item) => item.id === synced.id ? synced : item);
        await writeLocal("businessRecords", working);
        setItems(working);
        sent += 1;
      }
      setMessage(`${sent} registro(s) sincronizado(s) por ação confirmada. Os originais de importação permaneceram locais.`);
    } catch (error) {
      setMessage(`${sent} registro(s) sincronizado(s); os demais continuam locais. ${error instanceof Error ? error.message : "Falha de sincronização."}`);
    } finally {
      setSyncing(false);
    }
  };

  const exportCsv = () => {
    downloadBlob("iris-clientes-filtrados.csv", businessClientExportCsv(clients), "text/csv;charset=utf-8");
    setMessage(`Exportação CSV local iniciada para ${clients.length} cliente(s) filtrado(s), incluindo campos extras.`);
  };
  const exportJson = () => {
    downloadJson("iris-clientes-filtrados.json", businessClientExportJson(clients, filters));
    setMessage(`Exportação JSON local iniciada para ${clients.length} cliente(s) filtrado(s), incluindo campos extras.`);
  };
  const exportPdf = async () => {
    if (!clients.length) return;
    try {
      const { createBusinessClientPdf } = await import("@/lib/businessPdf");
      const pdf = await createBusinessClientPdf(clients);
      pdf.save("iris-clientes-filtrados.pdf");
      setMessage(`Relatório PDF local iniciado para ${clients.length} cliente(s), com campos conhecidos e extras.`);
    } catch (error) {
      setMessage(error instanceof Error ? `Não foi possível gerar o PDF local: ${error.message}` : "Não foi possível gerar o PDF local.");
    }
  };

  return <main className="profile-page business-page"><div className="profile-card business-card">
    <Link href="/" className="back-link"><ArrowLeft size={16} /> Voltar ao início</Link>
    <div className="profile-heading business-heading"><div className="profile-icon"><BriefcaseBusiness size={22} /></div><div><div className="eyebrow">IRIS COMERCIAL · LOCAL FIRST</div><h1>Clientes e gestão comercial</h1><p>Importe uma relação, revise cada campo e salve somente após confirmar. Arquivos e registros permanecem neste dispositivo por padrão.</p></div></div>

    <div className="business-privacy"><ShieldCheck size={18} /><div><strong>Privacidade e armazenamento</strong><p>PDF/OCR, planilhas e documentos Office são lidos localmente. Importações nunca iniciam sincronização. O limite de cada arquivo é 50 MB; PDFs também seguem os limites informados pelo leitor local.</p></div></div>

    <section className="business-section business-create">
      <div className="business-section-heading"><div><span className="eyebrow">CADASTRO COMERCIAL</span><h2>Novo registro manual</h2></div><small>Salvo localmente antes de qualquer acesso remoto.</small></div>
      <div className="business-create-grid">
        <label><span>Tipo de registro</span><select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as BusinessKind })}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>Nome ou referência</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Nome ou referência" /></label>
        <label><span>Empresa / razão social</span><input value={draft.company} onChange={(event) => setDraft({ ...draft, company: event.target.value })} placeholder="Empresa (opcional)" /></label>
        <label><span>Valor opcional</span><input inputMode="decimal" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} placeholder="Valor" /></label>
        <label><span>Status</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}><option value="aberto">Aberto</option><option value="em_andamento">Em andamento</option><option value="concluido">Concluído</option><option value="atrasado">Atrasado</option></select></label>
        <label className="business-create-notes"><span>Observações</span><textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Observações opcionais" rows={2} /></label>
        <label className="business-attachment"><span><Paperclip size={15} /> {attachment ? attachment.name : "Anexar original local (opcional)"}</span><input type="file" accept=".pdf,.csv,.json,.txt,.xlsx,.xls,.doc,.docx,image/*" onChange={(event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          try { assertLocalFileSize(file, "Anexo comercial"); setAttachment(file); }
          catch (error) { setMessage(error instanceof Error ? error.message : "Arquivo recusado."); }
        }} /></label>
        {attachment && <Button type="button" variant="ghost" onClick={() => setAttachment(null)} aria-label="Remover anexo escolhido"><X size={14} /> Remover anexo</Button>}
        <Button type="button" disabled={busy} onClick={() => void add()}><Plus size={15} /> {busy ? "Salvando localmente…" : "Salvar registro"}</Button>
      </div>
    </section>

    <section className="business-section business-import">
      <div className="business-section-heading"><div><span className="eyebrow">IMPORTAÇÃO LOCAL</span><h2>Revisar antes de salvar</h2></div><span className="business-local-chip"><ShieldCheck size={14} /> Nada é enviado automaticamente</span></div>
      <p>Formatos legíveis aqui: PDF (camada de texto ou OCR), CSV, JSON, TXT, XLSX e DOCX. Cada candidato é editável e selecionável; campos ausentes ficam vazios. Duplicatas claras são sinalizadas, não substituem cadastros.</p>
      <label className="business-upload-button"><Upload size={16} /><span>{importBusy ? "Lendo arquivo local…" : "Escolher relação de clientes"}<small>PDF, CSV, JSON, TXT, XLSX ou DOCX · até 50 MB</small></span><input type="file" accept=".pdf,.csv,.json,.txt,.xlsx,.docx,application/pdf,text/csv,application/json,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={importBusy} onChange={(event) => {
        const file = event.target.files?.[0];
        event.currentTarget.value = "";
        void selectImportFile(file);
      }} /></label>
      {importBusy && <div className="business-progress" role="status">{importProgress || "Processando localmente…"}</div>}
      {review && <div className="business-import-review">
        <div className="business-review-heading"><div><strong>Prévia: {review.file.name}</strong><small>{review.format} · {review.candidates.length} candidato(s) · leitura {review.method === "ocr" ? "OCR" : review.method === "text-layer" ? "texto" : "estruturada"} · {bytesLabel(review.file.size)}</small></div><Button type="button" size="sm" variant="ghost" onClick={() => setReview(null)} aria-label="Cancelar revisão"><X size={15} /> Cancelar</Button></div>
        {review.warnings.map((warning, index) => <div className="business-review-warning" key={`${index}-${warning}`}>{warning}</div>)}
        {review.candidates.map((candidate, index) => {
          const missing = businessClientMissingFields(candidate.values);
          const title = candidate.values.name || candidate.values.legalName || candidate.values.tradeName || `Cliente candidato ${index + 1}`;
          return <details className={`business-candidate ${candidate.duplicateReason ? "is-duplicate" : ""}`} key={`${review.hash}-${index}`}>
            <summary><input type="checkbox" checked={candidate.selected && !candidate.duplicateReason} disabled={Boolean(candidate.duplicateReason)} onClick={(event) => event.stopPropagation()} onChange={(event) => updateCandidate(index, (current) => ({ ...current, selected: event.target.checked }))} aria-label={`Selecionar ${title}`} /><span><strong>{title}</strong><small>{missing.length ? `${missing.length} campo(s) ausente(s)` : "Campos reconhecidos"}{candidate.sourceLine ? ` · origem linha/bloco ${candidate.sourceLine}` : ""}</small></span>{candidate.duplicateReason && <em>Possível duplicata · {candidate.duplicateReason}{candidate.duplicateOf?.name ? ` de ${candidate.duplicateOf.name}` : ""}</em>}</summary>
            <div className="business-candidate-body">
              {candidate.warnings.map((warning, warningIndex) => <div className="business-review-warning" key={`${warningIndex}-${warning}`}>{warning}</div>)}
              {missing.length > 0 && <p className="business-missing-fields"><strong>Não encontrados:</strong> {missing.map((field) => BUSINESS_CLIENT_FIELD_LABELS[field]).join(", ")}. Os campos não foram preenchidos automaticamente.</p>}
              <BusinessClientEditor prefix={`import-${index}`} values={candidate.values} extraFields={candidate.extraFields} onValuesChange={(values) => updateCandidate(index, (current) => ({ ...current, values }))} onExtraFieldsChange={(extraFields) => updateCandidate(index, (current) => ({ ...current, extraFields }))} />
            </div>
          </details>;
        })}
        <div className="business-review-footer"><span>{selectedImportCount} selecionado(s) · {duplicateCount} duplicata(s) provável(is) não selecionável(is)</span><Button type="button" disabled={importBusy} onClick={() => void confirmImport()}><ShieldCheck size={15} /> Confirmar e guardar original</Button></div>
      </div>}
    </section>

    <section className="business-section business-portfolio">
      <div className="business-section-heading"><div><span className="eyebrow">CARTEIRA</span><h2><UsersRound size={20} /> Clientes ({clients.length})</h2></div><div className="business-export-actions"><Button type="button" variant="outline" disabled={!clients.length} onClick={exportCsv}><Download size={14} /> CSV filtrado</Button><Button type="button" variant="outline" disabled={!clients.length} onClick={exportJson}><Download size={14} /> JSON filtrado</Button><Button type="button" variant="outline" disabled={!clients.length} onClick={() => void exportPdf()}><FileText size={14} /> PDF filtrado</Button></div></div>
      <div className="business-filters">
        <label><span>Nome</span><input value={filters.name} onChange={(event) => setFilter("name", event.target.value)} placeholder="Filtrar nome" /></label>
        <label><span>Grupo econômico</span><input value={filters.group} onChange={(event) => setFilter("group", event.target.value)} placeholder="Filtrar grupo" /></label>
        <label><span>Cidade</span><input value={filters.city} onChange={(event) => setFilter("city", event.target.value)} placeholder="Filtrar cidade" /></label>
        <label><span>Estado / UF</span><input value={filters.state} onChange={(event) => setFilter("state", event.target.value)} placeholder="Filtrar estado" /></label>
      </div>
      {clients.length === 0 ? <p className="business-empty">Nenhum cliente corresponde aos filtros. Registros existentes permanecem salvos ao mudar a busca.</p> : <div className="business-client-list">{clients.map((client) => <article className="business-client-card" key={client.id}>
        <div className="business-client-summary"><div><strong>{businessClientDisplayName(client)}</strong><small>{client.legalName || client.company || "Razão social não informada"}{client.tradeName ? ` · ${client.tradeName}` : ""}</small><small>{[client.economicGroup, client.city, client.state].filter((value) => typeof value === "string" && value).join(" · ") || "Grupo, cidade e estado não informados"}</small><small>{[client.document, client.email, client.phone, client.whatsapp].filter((value) => typeof value === "string" && value).join(" · ") || "Documento e contato não informados"}</small></div><div className="business-row-actions"><Button type="button" size="sm" variant="outline" onClick={() => openClientEditor(client)}>Detalhes / editar</Button><Button type="button" size="icon-sm" variant="ghost" onClick={() => void remove(client.id)} aria-label={`Remover cliente ${businessClientDisplayName(client)}`}><Trash2 size={15} /></Button></div></div>
        {edit?.id === client.id && <div className="business-client-edit"><div className="business-editor-heading"><strong>Dados completos · alterações só neste dispositivo</strong><Button type="button" size="sm" variant="ghost" onClick={() => setEdit(null)}><X size={14} /> Cancelar</Button></div><BusinessClientEditor prefix={`client-${client.id}`} values={edit.values} extraFields={edit.extraFields} onValuesChange={(values) => setEdit((current) => current ? { ...current, values } : current)} onExtraFieldsChange={(extraFields) => setEdit((current) => current ? { ...current, extraFields } : current)} /><div className="business-edit-actions"><Button type="button" variant="outline" onClick={() => setEdit(null)}>Descartar</Button><Button type="button" onClick={() => void saveClientEdit()}>Salvar alterações locais</Button></div></div>}
      </article>)}</div>}
    </section>

    <section className="business-section business-originals">
      <div className="business-section-heading"><div><span className="eyebrow">ARQUIVO LOCAL</span><h2><FileDown size={19} /> Originais preservados ({files.length})</h2></div><small>Os arquivos permanecem no IndexedDB deste dispositivo.</small></div>
      {files.length === 0 ? <p className="business-empty">Nenhum original comercial arquivado ainda.</p> : <div className="business-file-list">{files.map((file) => <div className="business-file-row" key={file.id}><span><strong>{file.name}</strong><small>{bytesLabel(file.size)} · SHA-256 {file.hash.slice(0, 12)}… · {file.purpose === "client-import" ? "Relação de clientes" : "Anexo comercial"}</small></span><Button type="button" size="sm" variant="outline" onClick={() => downloadBlob(file.name, file.blob, file.mime)}><Download size={14} /> Baixar original</Button></div>)}</div>}
    </section>

    <section className="business-section business-operations">
      <div className="business-section-heading"><div><span className="eyebrow">GESTÃO OPERACIONAL</span><h2>Fornecedores, pedidos, comissões, metas e inadimplência ({operations.length})</h2></div><div className="business-operation-tools"><label><Search size={14} /><input value={operationQuery} onChange={(event) => setOperationQuery(event.target.value)} placeholder="Buscar registros" /></label><Button type="button" variant="outline" onClick={() => downloadJson("iris-comercial.json", { format: "iris-business", exportedAt: new Date().toISOString(), records: items })}><Download size={14} /> Exportar tudo</Button></div></div>
      {operations.length === 0 ? <p className="business-empty">Nenhum outro registro comercial para exibir.</p> : operations.map((item) => <div className="business-operation-row" key={item.id}><span><b>{labels[item.kind]} · {item.name}</b><small>{item.company || "Sem empresa"} · {item.amount ? money(item.amount) : "sem valor"} · {item.status || "status não informado"}{item.notes ? ` · ${item.notes}` : ""}{item.fileName ? ` · ${item.fileName}` : ""}</small></span><div className="business-row-actions">{(item.localFileId || item.storageKey) && <Button type="button" size="icon-sm" variant="ghost" onClick={() => void downloadRecordFile(item)} aria-label={`Baixar ${item.fileName || item.name}`}><FileDown size={15} /></Button>}<Button type="button" size="icon-sm" variant="ghost" onClick={() => void remove(item.id)} aria-label={`Excluir ${item.name}`}><Trash2 size={15} /></Button></div></div>)}
    </section>

    <div className="business-sync-footer"><div><strong>Sincronização remota opcional</strong><small>{pendingSyncCount} registro(s) pendente(s). Importação nunca inicia envio; arquivos de relação não são enviados.</small></div><Button type="button" variant="outline" disabled={syncing || pendingSyncCount === 0} onClick={() => void syncExplicitly()}><ShieldCheck size={15} /> {syncing ? "Sincronizando…" : "Sincronizar com confirmação"}</Button></div>
    {message && <div className="profile-message business-message" role="status">{message}</div>}
  </div></main>;
}
