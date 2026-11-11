import { useEffect, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { Loader2, LockKeyhole, ShieldCheck, UnlockKeyhole } from "lucide-react";
import {
  isIrisAccessUnlocked,
  isIrisRemoteModeEnabled,
  lockIrisAccess,
  unlockIrisAccess,
} from "@/lib/irisWorker";

const MAX_PASSWORD_LENGTH = 256;

export default function RemoteAccessGate() {
  const [unlocked, setUnlocked] = useState(() => isIrisAccessUnlocked());
  const [remoteMode, setRemoteMode] = useState(() => isIrisRemoteModeEnabled());
  const [expanded, setExpanded] = useState(false);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const sync = () => {
      setUnlocked(isIrisAccessUnlocked());
      setRemoteMode(isIrisRemoteModeEnabled());
    };
    window.addEventListener("iris-access-changed", sync);
    window.addEventListener("iris-mode-changed", sync);
    sync();
    return () => {
      window.removeEventListener("iris-access-changed", sync);
      window.removeEventListener("iris-mode-changed", sync);
    };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!remoteMode || pending || !password || password.length > MAX_PASSWORD_LENGTH) return;
    setPending(true);
    setError("");
    setNotice("");
    try {
      await unlockIrisAccess(password);
      setPassword("");
      setNotice("Acesso remoto liberado nesta sessão. Isso não significa que Gmail, Drive ou Calendar já estejam conectados.");
      setExpanded(false);
    } catch (unlockError) {
      setPassword("");
      setError(unlockError instanceof Error
        ? unlockError.message
        : "Não foi possível validar o acesso remoto agora.");
    } finally {
      setPending(false);
    }
  };

  const protect = () => {
    lockIrisAccess();
    setExpanded(false);
    setPassword("");
    setError("");
    setNotice("Serviços remotos protegidos. O acesso será solicitado novamente nesta sessão.");
  };

  return (
    <aside className="remote-access-gate" aria-label="Acesso a serviços remotos">
      <div className="remote-access-gate__status" role="status" aria-live="polite">
        {unlocked ? <UnlockKeyhole size={16} aria-hidden="true" /> : <LockKeyhole size={16} aria-hidden="true" />}
        <span>Serviços conectados: <strong>{unlocked ? "desbloqueados" : "bloqueados"}</strong></span>
        {unlocked ? (
          <button className="remote-access-gate__button" type="button" onClick={protect}>Proteger</button>
        ) : remoteMode ? (
          <button
            className="remote-access-gate__button"
            type="button"
            onClick={() => { setError(""); setNotice(""); setExpanded((value) => !value); }}
            aria-expanded={expanded}
            aria-controls="remote-access-unlock-form"
          >
            Desbloquear
          </button>
        ) : (
          <Link className="remote-access-gate__settings-link" href="/configuracoes">Ativar acesso remoto</Link>
        )}
      </div>

      <p className="remote-access-gate__description">
        O desbloqueio libera somente Gmail, Drive, Calendar, IA e D1. Documentos, finanças e catálogo locais continuam funcionando.
      </p>
      {!remoteMode && <p className="remote-access-gate__mode-note">Modo Demonstração: nenhum conteúdo é enviado. Ative os serviços remotos em Configurações para prosseguir.</p>}

      {unlocked && notice && <p className="remote-access-gate__notice" role="status">{notice}</p>}
      {!unlocked && expanded && remoteMode && (
        <form id="remote-access-unlock-form" className="remote-access-gate__form" onSubmit={(event) => void submit(event)} autoComplete="off">
          <label htmlFor="remote-access-password">Credencial de acesso remoto</label>
          <input
            id="remote-access-password"
            name="iris-remote-unlock"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value.slice(0, MAX_PASSWORD_LENGTH))}
            maxLength={MAX_PASSWORD_LENGTH}
            autoComplete="new-password"
            autoCapitalize="none"
            spellCheck={false}
            required
            aria-describedby="remote-access-privacy remote-access-error"
            disabled={pending}
          />
          <p id="remote-access-privacy">A credencial não é salva pelo app neste navegador. Ela será pedida novamente após recarregar ou fechar.</p>
          {error && <p id="remote-access-error" className="remote-access-gate__error" role="alert">{error}</p>}
          <div className="remote-access-gate__actions">
            <button className="remote-access-gate__button remote-access-gate__button--primary" type="submit" disabled={pending || !password}>
              {pending ? <><Loader2 size={15} className="remote-access-gate__spinner" /> Validando…</> : <><ShieldCheck size={15} /> Desbloquear serviços</>}
            </button>
            <button className="remote-access-gate__button" type="button" onClick={() => { setExpanded(false); setPassword(""); setError(""); }} disabled={pending}>Cancelar</button>
          </div>
        </form>
      )}
      {!unlocked && !expanded && notice && <p className="remote-access-gate__notice" role="status">{notice}</p>}
    </aside>
  );
}
