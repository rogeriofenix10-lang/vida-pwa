import { useEffect, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { isIrisAccessUnlocked, isIrisDeviceRemembered, isIrisRemoteModeEnabled, restoreIrisAccess, unlockIrisAccess } from "@/lib/irisWorker";

const MAX_PASSWORD_LENGTH = 256;

type RemoteServiceAccessProps = {
  compact?: boolean;
  onReady?: () => void;
};

export default function RemoteServiceAccess({ compact = false, onReady }: RemoteServiceAccessProps) {
  const [remoteMode, setRemoteMode] = useState(() => isIrisRemoteModeEnabled());
  const [unlocked, setUnlocked] = useState(() => isIrisAccessUnlocked());
  const [remembered, setRemembered] = useState(false);
  const [password, setPassword] = useState("");
  const [rememberDevice, setRememberDevice] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const sync = () => {
      const mode = isIrisRemoteModeEnabled();
      const access = mode && isIrisAccessUnlocked();
      setRemoteMode(mode);
      setUnlocked(access);
      void isIrisDeviceRemembered().then((value) => {
        if (active) setRemembered(value);
      });
    };
    const onDeviceStatus = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (typeof detail === "string" && detail) setMessage(detail);
      sync();
    };
    window.addEventListener("iris-access-changed", sync);
    window.addEventListener("iris-mode-changed", sync);
    window.addEventListener("iris-device-auth-status", onDeviceStatus);
    sync();
    return () => {
      active = false;
      window.removeEventListener("iris-access-changed", sync);
      window.removeEventListener("iris-mode-changed", sync);
      window.removeEventListener("iris-device-auth-status", onDeviceStatus);
    };
  }, []);

  const refreshStatus = async () => {
    setRemoteMode(isIrisRemoteModeEnabled());
    setUnlocked(isIrisAccessUnlocked());
    setRemembered(await isIrisDeviceRemembered());
  };

  const restoreRememberedDevice = async () => {
    if (!remoteMode || pending || unlocked) return;
    setPending(true);
    setError("");
    setMessage("Verificando a credencial lembrada deste dispositivo; nenhum texto de tradução ou arquivo foi enviado.");
    try {
      const result = await restoreIrisAccess();
      await refreshStatus();
      if (result.restored && isIrisRemoteModeEnabled() && isIrisAccessUnlocked()) {
        setMessage("Sessão remota restaurada. O conteúdo só será enviado por uma ação separada que você iniciar.");
        onReady?.();
      } else {
        setMessage("Não foi possível restaurar a sessão lembrada. A credencial pode estar ausente, expirada ou temporariamente indisponível; tente entrar com a senha master.");
      }
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "Não foi possível restaurar a sessão deste dispositivo.");
      setMessage("");
    } finally {
      setPending(false);
      await refreshStatus();
    }
  };

  const submitPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!remoteMode || pending || !password || password.length > MAX_PASSWORD_LENGTH) return;
    const submittedPassword = password;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const result = await unlockIrisAccess(submittedPassword, rememberDevice);
      setMessage(result.warning ?? (result.remembered
        ? "Acesso liberado. Foi guardada apenas a credencial de renovação deste dispositivo; a senha master não foi salva."
        : "Acesso liberado somente nesta sessão; a senha master não foi salva."));
      setPassword("");
      await refreshStatus();
      if (isIrisRemoteModeEnabled() && isIrisAccessUnlocked()) onReady?.();
    } catch (unlockError) {
      setPassword("");
      setError(unlockError instanceof Error ? unlockError.message : "Não foi possível validar o acesso remoto agora.");
    } finally {
      setPending(false);
      await refreshStatus();
    }
  };

  return (
    <section
      className="memory-settings remote-service-access"
      aria-label="Acesso a serviços remotos"
      style={compact ? { marginTop: 12, padding: 14, gap: 8 } : undefined}
    >
      <strong>Serviços remotos: {unlocked ? "desbloqueados" : remoteMode ? "bloqueados" : "Demonstração local"}</strong>
      <p>
        {compact
          ? "Dados locais continuam disponíveis. Google e IA remota exigem ativação explícita, sessão desbloqueada e sua ação; autorizar o Google é uma etapa separada."
          : "O acesso remoto é independente do PIN local. Nada é enviado até você iniciar uma ação; OAuth Google é sempre uma etapa separada e explícita."}
      </p>

      {!remoteMode && (
        <p role="status">
          O modo Demonstração está ativo: nenhum texto foi enviado. Para optar por serviços conectados, abra Configurações e escolha “Ativar serviços remotos”; essa escolha não inicia login nem OAuth.
        </p>
      )}

      {!remoteMode && (
        <Link href="/configuracoes" className="remote-access-gate__settings-link" style={{ justifySelf: "start" }}>
          Abrir Configurações
        </Link>
      )}

      {remoteMode && !unlocked && (
        <>
          <p>
            A conexão exige sua ação. “Lembrar este dispositivo” guarda somente a credencial de renovação no armazenamento seguro do dispositivo, nunca a senha master; deixe desmarcado para uma sessão sem lembrança.
          </p>
          {remembered && (
            <button
              className="remote-access-gate__button"
              type="button"
              onClick={() => void restoreRememberedDevice()}
              disabled={pending}
            >
              {pending ? "Verificando…" : "Restaurar sessão deste dispositivo"}
            </button>
          )}
          <form className="remote-access-gate__form" onSubmit={(event) => void submitPassword(event)} autoComplete="off">
            <label htmlFor="remote-service-master-password">Senha master dos serviços remotos (não é o PIN local)</label>
            <input
              id="remote-service-master-password"
              name="iris-master-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value.slice(0, MAX_PASSWORD_LENGTH))}
              maxLength={MAX_PASSWORD_LENGTH}
              autoComplete="new-password"
              autoCapitalize="none"
              spellCheck={false}
              required
              disabled={pending}
            />
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 500 }}>
              <input
                type="checkbox"
                checked={rememberDevice}
                onChange={(event) => setRememberDevice(event.target.checked)}
                disabled={pending}
              />
              <span>Lembrar este dispositivo</span>
            </label>
            <small>A senha é mantida apenas na memória durante a validação e apagada após a tentativa.</small>
            <div className="remote-access-gate__actions">
              <button className="remote-access-gate__button remote-access-gate__button--primary" type="submit" disabled={pending || !password}>
                {pending ? "Validando…" : "Desbloquear serviços"}
              </button>
            </div>
          </form>
          <Link href="/configuracoes" className="remote-access-gate__settings-link" style={{ justifySelf: "start" }}>
            Revisar modo em Configurações
          </Link>
        </>
      )}

      {unlocked && remoteMode && (
        <p role="status">Sessão pronta. Cada tradução, leitura ou conexão externa continua dependendo de uma ação própria.</p>
      )}
      {message && <p role="status">{message}</p>}
      {error && <p className="remote-access-gate__error" role="alert">{error}</p>}
    </section>
  );
}
