import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Download,
  FileDown,
  LockKeyhole,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  buildLocalBackup,
  clearLocalWorkspace,
  downloadCompleteBackupZip,
  downloadJson,
  inspectBackupFile,
  readLocal,
  restoreLocalBackup,
  type IrisApproval,
  writeLocal,
} from "@/lib/irisLocalStore";
import { hashPin } from "@/components/LocalLockGate";

const DEFAULT_APPROVALS: IrisApproval[] = [
  {
    id: "demo-approval",
    action: "Compartilhar documento",
    detail: "Rascunho local — nenhuma transmissão permitida",
    status: "pending",
    createdAt: new Date().toISOString(),
  },
];

export default function SecurityCenter() {
  const [approvals, setApprovals] = useState<IrisApproval[]>([]);
  const [message, setMessage] = useState("");
  const [backupInfo, setBackupInfo] = useState<{
    type: string;
    documents: number;
    size: number;
    hash: string;
  } | null>(null);
  const [storage, setStorage] = useState<{ usage?: number; quota?: number }>(
    {},
  );
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [hasPin, setHasPin] = useState(() =>
    Boolean(localStorage.getItem("iris.pinHash")),
  );

  useEffect(() => {
    void readLocal("approvals", DEFAULT_APPROVALS).then(setApprovals);
    void navigator.storage
      ?.estimate()
      .then((result) =>
        setStorage({ usage: result.usage, quota: result.quota }),
      );
  }, []);

  const save = async (next: IrisApproval[]) => {
    setApprovals(next);
    await writeLocal("approvals", next);
  };
  const update = async (id: string, status: IrisApproval["status"]) =>
    save(
      approvals.map((item) => (item.id === id ? { ...item, status } : item)),
    );
  const backup = async (includeFiles = false) => {
    if (includeFiles) {
      await downloadCompleteBackupZip(
        `iris-backup-completo-${new Date().toISOString().slice(0, 10)}.zip`,
      );
      setMessage("Backup completo ZIP preparado com PDFs e imagens locais.");
      return;
    }
    downloadJson(
      `iris-backup-leve-${new Date().toISOString().slice(0, 10)}.json`,
      await buildLocalBackup(),
    );
    setMessage("Backup leve preparado com dados e textos locais.");
  };
  const restore = async (file: File) => {
    try {
      const info = await inspectBackupFile(file);
      setBackupInfo(info);
      if (
        !window.confirm(
          `Restaurar ${info.type} com ${info.documents} documento(s), ${(info.size / 1024).toFixed(0)} KB?\nHash SHA-256: ${info.hash}\n\nOs dados locais atuais serão substituídos.`,
        )
      ) {
        setMessage("Restauração cancelada pelo usuário.");
        return;
      }
      await restoreLocalBackup(file);
      setApprovals(await readLocal("approvals", []));
      setMessage("Backup restaurado somente neste dispositivo.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Backup inválido.");
    }
  };
  const clear = async () => {
    if (
      !window.confirm(
        "Tem certeza? Todos os dados locais desta Iris serão removidos neste navegador.",
      )
    )
      return;
    await clearLocalWorkspace();
    setApprovals([]);
    setMessage("Dados locais removidos. Nenhum serviço externo foi alterado.");
  };
  const revokeAll = async () => {
    await save(
      approvals.map((item) =>
        item.status === "approved"
          ? { ...item, status: "cancelled" as const }
          : item,
      ),
    );
    setMessage("Todas as autorizações locais foram revogadas.");
  };
  const configurePin = async () => {
    if (pin.length < 4)
      return setMessage("Use um PIN local com pelo menos 4 caracteres.");
    if (pin !== pinConfirm)
      return setMessage("A confirmação do PIN não confere.");
    localStorage.setItem("iris.pinHash", await hashPin(pin));
    sessionStorage.removeItem("iris.unlocked");
    setHasPin(true);
    setPin("");
    setPinConfirm("");
    setMessage("PIN local ativado neste navegador.");
  };
  const removePin = () => {
    localStorage.removeItem("iris.pinHash");
    sessionStorage.removeItem("iris.unlocked");
    setHasPin(false);
    setMessage("PIN local removido deste navegador.");
  };

  return (
    <main className="profile-page">
      <div className="profile-card">
        <Link href="/" className="back-link">
          <ArrowLeft size={16} /> Voltar ao Radar
        </Link>
        <div className="profile-heading">
          <div className="profile-icon">
            <LockKeyhole size={22} />
          </div>
          <div>
            <div className="eyebrow">GOVERNANÇA LOCAL</div>
            <h1>Central de Segurança</h1>
            <p>
              Controle local de permissões, aprovações, backups e proteção.
              Ações externas permanecem bloqueadas.
            </p>
          </div>
        </div>
        <div className="notification-settings">
          <strong>
            <ShieldCheck size={17} /> Modo demonstração seguro
          </strong>
          <p>
            Dados desta central ficam no IndexedDB deste navegador. A Iris pode
            preparar uma ação, mas não envia, publica, exclui ou compartilha sem
            autorização explícita.
          </p>
          <div className="memory-row">
            <span>Transmissão externa</span>
            <b>Bloqueada</b>
          </div>
          <div className="memory-row">
            <span>Persistência</span>
            <b>Somente neste dispositivo</b>
          </div>
          <div className="memory-row">
            <span>Autenticação externa</span>
            <b>Não configurada</b>
          </div>
        </div>
        <div className="memory-settings">
          <strong>Proteção por PIN local</strong>
          <p>
            Opcional. O PIN é transformado em hash e permanece somente neste
            navegador; não é enviado nem incluído nos backups.
          </p>
          {hasPin ? (
            <>
              <div className="memory-row">
                <span>Status</span>
                <b>Ativo neste navegador</b>
              </div>
              <Button variant="outline" onClick={removePin}>
                Remover PIN
              </Button>
            </>
          ) : (
            <div style={{ display: "grid", gap: 8, maxWidth: 360 }}>
              <input
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(event) => setPin(event.target.value)}
                placeholder="Novo PIN (mínimo 4 caracteres)"
              />
              <input
                type="password"
                inputMode="numeric"
                value={pinConfirm}
                onChange={(event) => setPinConfirm(event.target.value)}
                placeholder="Confirmar PIN"
              />
              <Button variant="outline" onClick={() => void configurePin()}>
                <LockKeyhole size={15} /> Ativar proteção local
              </Button>
            </div>
          )}
        </div>
        <div className="memory-settings">
          <strong>Privacidade e armazenamento</strong>
          <p>
            O conteúdo permanece neste navegador. Nenhuma integração externa é
            ativada por esta tela.
          </p>
          <div className="memory-row">
            <span>Uso aproximado</span>
            <b>
              {storage.usage
                ? `${(storage.usage / 1048576).toFixed(1)} MB`
                : "não informado"}
            </b>
          </div>
          <div className="memory-row">
            <span>Limite estimado</span>
            <b>
              {storage.quota
                ? `${(storage.quota / 1073741824).toFixed(1)} GB`
                : "não informado"}
            </b>
          </div>
          <div className="memory-row">
            <span>Cofres lógicos</span>
            <b>Saúde · Financeiro · Geral</b>
          </div>
        </div>
        <div className="memory-settings">
          <strong>Fila de aprovação</strong>
          <p>Revise cada proposta antes de permitir uma ação sensível.</p>
          {approvals.length === 0 ? (
            <small>Nenhuma proposta pendente.</small>
          ) : (
            approvals.map((item) => (
              <div className="memory-row" key={item.id}>
                <span>
                  <b>{item.action}</b>
                  <br />
                  <small>{item.detail}</small>
                </span>
                {item.status === "pending" ? (
                  <span style={{ display: "flex", gap: 8 }}>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void update(item.id, "approved")}
                    >
                      Autorizar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void update(item.id, "cancelled")}
                    >
                      Cancelar
                    </Button>
                  </span>
                ) : (
                  <b>
                    {item.status === "approved"
                      ? "Autorizada localmente"
                      : "Cancelada"}
                  </b>
                )}
              </div>
            ))
          )}
        </div>
        <div className="memory-settings">
          <strong>Backup e restauração</strong>
          <p>
            Exporte dados locais em JSON ou ZIP. O backup leve não inclui os
            binários; o backup completo inclui PDFs e imagens dentro de um ZIP
            criado no navegador. Nenhum arquivo é enviado automaticamente para a
            nuvem.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button variant="outline" onClick={() => void backup(false)}>
              <Download size={15} /> Backup leve
            </Button>
            <Button variant="outline" onClick={() => void backup(true)}>
              <Download size={15} /> Backup completo
            </Button>
            <label className="button-like">
              <Upload size={15} /> Restaurar backup
              <input
                type="file"
                accept="application/json,.zip,application/zip"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void restore(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <Button variant="ghost" onClick={() => void clear()}>
              <Trash2 size={15} /> Limpar dados locais
            </Button>
          </div>
          {backupInfo && (
            <small>
              Último arquivo inspecionado: {backupInfo.type} ·{" "}
              {backupInfo.documents} documento(s) · SHA-256{" "}
              {backupInfo.hash.slice(0, 16)}…
            </small>
          )}
        </div>
        <div className="memory-settings">
          <strong>Auditoria desta sessão</strong>
          <p>
            Eventos locais: {approvals.length}. As ações aprovadas aqui não são
            enviadas a nenhum serviço externo.
          </p>
          <Button variant="outline" onClick={() => void revokeAll()}>
            Revogar todas as autorizações
          </Button>
        </div>
        {message && (
          <div className="profile-message">
            <FileDown size={15} /> {message}
          </div>
        )}
      </div>
    </main>
  );
}
