import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, FolderOpen, Plus, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  googleDriveCreateFolder,
  googleDriveFiles,
  googleDriveStatus,
  isIrisAccessUnlocked,
  isIrisRemoteModeEnabled,
  startGoogleOAuth,
  type GoogleDriveFile,
} from "@/lib/irisWorker";

function messageFor(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const demoMessage = "O Google Drive está bloqueado intencionalmente no modo Demonstração. Nenhum dado foi enviado. Ative o acesso remoto em Configurações somente se quiser usar esse recurso.";

export default function GoogleWorkspace() {
  const [driveAuthorized, setDriveAuthorized] = useState(false);
  const [files, setFiles] = useState<GoogleDriveFile[]>([]);
  const [folder, setFolder] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [remoteAccessReady, setRemoteAccessReady] = useState(
    () => isIrisRemoteModeEnabled() && isIrisAccessUnlocked(),
  );
  const retryAfterUnlock = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setMessage("");
    if (!isIrisRemoteModeEnabled()) {
      setDriveAuthorized(false);
      setFiles([]);
      setMessage(demoMessage);
      retryAfterUnlock.current = false;
      setLoading(false);
      return;
    }
    if (!isIrisAccessUnlocked()) {
      setRemoteAccessReady(false);
      setDriveAuthorized(false);
      setFiles([]);
      setMessage("O Google Drive exige uma sessão remota desbloqueada. Nenhuma consulta foi enviada; desbloqueie o acesso remoto em Configurações para continuar.");
      retryAfterUnlock.current = true;
      setLoading(false);
      return;
    }

    setRemoteAccessReady(true);
    let failed = false;
    try {
      const status = await googleDriveStatus();
      const authorized = status.authorized === true;
      setDriveAuthorized(authorized);
      if (authorized) {
        try {
          setFiles((await googleDriveFiles()).files ?? []);
        } catch (error) {
          failed = true;
          setMessage(messageFor(error, "Falha de rede ao consultar o Google Drive. Tente novamente."));
        }
      } else {
        setFiles([]);
      }
    } catch (error) {
      failed = true;
      setDriveAuthorized(false);
      setFiles([]);
      setMessage(messageFor(error, "Falha de rede ao consultar o Google Drive. Tente novamente."));
    }

    retryAfterUnlock.current = failed && !isIrisAccessUnlocked();
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onAccessChanged = () => {
      const ready = isIrisRemoteModeEnabled() && isIrisAccessUnlocked();
      setRemoteAccessReady(ready);
      if (!ready) {
        setDriveAuthorized(false);
        setFiles([]);
        if (!isIrisRemoteModeEnabled()) setMessage(demoMessage);
        return;
      }
      if (retryAfterUnlock.current || !driveAuthorized) {
        retryAfterUnlock.current = false;
        void refresh();
      }
    };
    window.addEventListener("iris-access-changed", onAccessChanged);
    window.addEventListener("iris-mode-changed", onAccessChanged);
    return () => {
      window.removeEventListener("iris-access-changed", onAccessChanged);
      window.removeEventListener("iris-mode-changed", onAccessChanged);
    };
  }, [driveAuthorized, refresh]);

  const connectGoogle = async () => {
    if (!isIrisRemoteModeEnabled() || !isIrisAccessUnlocked()) {
      setMessage("Desbloqueie o acesso remoto antes de conectar o Google Drive. Nenhuma solicitação foi enviada.");
      return;
    }
    setMessage("");
    try {
      await startGoogleOAuth("drive");
    } catch (error) {
      setMessage(messageFor(error, "Não foi possível iniciar a autorização Google."));
    }
  };

  const createFolder = async () => {
    if (!remoteAccessReady || !isIrisRemoteModeEnabled() || !isIrisAccessUnlocked() || !driveAuthorized) {
      setMessage("Autorize o Google Drive e desbloqueie o acesso remoto antes de criar pastas. Nenhuma alteração foi enviada.");
      return;
    }
    const name = folder.trim();
    if (!name) {
      setMessage("Informe o nome da pasta.");
      return;
    }
    if (!window.confirm(`Criar a pasta “${name}” no Google Drive?\n\nA pasta só será criada após esta confirmação.`)) return;

    setCreatingFolder(true);
    setMessage("");
    try {
      await googleDriveCreateFolder(name, true);
      setFolder("");
      setMessage("Pasta criada no Google Drive.");
      await refresh();
    } catch (error) {
      setMessage(messageFor(error, "Falha ao criar pasta."));
    } finally {
      setCreatingFolder(false);
    }
  };

  const canManageDrive = remoteAccessReady && driveAuthorized && isIrisRemoteModeEnabled() && isIrisAccessUnlocked();

  return (
    <main className="profile-page">
      <div className="profile-card">
        <Link href="/" className="back-link"><ArrowLeft size={16} /> Voltar ao início</Link>
        <div className="profile-heading">
          <div className="profile-icon"><FolderOpen size={22} /></div>
          <div>
            <div className="eyebrow">IRIS GOOGLE DRIVE · OAUTH</div>
            <h1>Google Drive</h1>
            <p>Consulte seus arquivos e organize pastas somente após desbloquear o acesso remoto. Alterações exigem confirmação explícita.</p>
          </div>
        </div>

        <section className="memory-settings" aria-labelledby="google-drive-heading">
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <strong id="google-drive-heading"><FolderOpen size={16} /> Google Drive</strong>
            {driveAuthorized
              ? <span className="iris-pwa-safe">Autorizado</span>
              : <Button onClick={() => void connectGoogle()} disabled={!remoteAccessReady}>Autorizar Drive</Button>}
            <Button variant="outline" onClick={() => void refresh()} disabled={loading || creatingFolder || !remoteAccessReady}>
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Atualizar
            </Button>
          </div>
          {canManageDrive && <>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <input value={folder} onChange={(event) => setFolder(event.target.value)} placeholder="Nome da nova pasta" aria-label="Nome da nova pasta" />
              <Button onClick={() => void createFolder()} disabled={creatingFolder || loading}>
                <Plus size={15} /> {creatingFolder ? "Criando…" : "Criar pasta"}
              </Button>
            </div>
            {files.length === 0 ? <small>Nenhum arquivo retornado.</small> : files.slice(0, 50).map((file) => (
              <div className="memory-row" key={file.id}>
                <span><b>{file.name}</b><br /><small>{file.mimeType ?? "arquivo"} · {file.modifiedTime ?? ""}</small></span>
                {file.webViewLink && <a href={file.webViewLink} target="_blank" rel="noreferrer" aria-label={`Abrir ${file.name}`}><ExternalLink size={15} /></a>}
              </div>
            ))}
          </>}
        </section>

        <p style={{ marginTop: 16 }}>
          A agenda fica no botão <Link href="/?view=agenda">Agenda</Link> da tela inicial.
        </p>
        {message && <div className="profile-message" role="status">{message}</div>}
      </div>
    </main>
  );
}
