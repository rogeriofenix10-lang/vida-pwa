import { useEffect, useState, type FormEvent } from "react";
import { Link } from "wouter";
import {
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  MonitorSmartphone,
  ShieldCheck,
  Trash2,
  UnlockKeyhole,
} from "lucide-react";
import {
  isIrisAccessUnlocked,
  isIrisDeviceRemembered,
  isIrisRemoteModeEnabled,
  listIrisDevices,
  lockIrisAccess,
  revokeIrisDevice,
  unlockIrisAccess,
  type IrisRemoteDevice,
} from "@/lib/irisWorker";

const MAX_PASSWORD_LENGTH = 256;
const DEVICE_STATUS_EVENT = "iris-device-auth-status";

function formatDeviceDate(value: string | null) {
  if (!value) return "Data indisponível";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Data indisponível"
    : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function RemoteAccessGate() {
  const [unlocked, setUnlocked] = useState(() => isIrisAccessUnlocked());
  const [remoteMode, setRemoteMode] = useState(() => isIrisRemoteModeEnabled());
  const [remembered, setRemembered] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [password, setPassword] = useState("");
  const [rememberDevice, setRememberDevice] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [managingDevices, setManagingDevices] = useState(false);
  const [devices, setDevices] = useState<IrisRemoteDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [deviceError, setDeviceError] = useState("");
  const [removingDeviceId, setRemovingDeviceId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const sync = () => {
      setUnlocked(isIrisAccessUnlocked());
      setRemoteMode(isIrisRemoteModeEnabled());
      void isIrisDeviceRemembered().then((value) => {
        if (active) setRemembered(value);
      });
    };
    const onDeviceStatus = (event: Event) => {
      const message = (event as CustomEvent<string>).detail;
      if (typeof message === "string" && message) setNotice(message);
      sync();
    };
    window.addEventListener("iris-access-changed", sync);
    window.addEventListener("iris-mode-changed", sync);
    window.addEventListener(DEVICE_STATUS_EVENT, onDeviceStatus);
    sync();
    return () => {
      active = false;
      window.removeEventListener("iris-access-changed", sync);
      window.removeEventListener("iris-mode-changed", sync);
      window.removeEventListener(DEVICE_STATUS_EVENT, onDeviceStatus);
    };
  }, []);

  const loadDevices = async () => {
    setDevicesLoading(true);
    setDeviceError("");
    try {
      setDevices(await listIrisDevices());
    } catch (loadError) {
      setDeviceError(loadError instanceof Error
        ? loadError.message
        : "Não foi possível carregar os dispositivos.");
    } finally {
      setDevicesLoading(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!remoteMode || pending || !password || password.length > MAX_PASSWORD_LENGTH) return;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const result = await unlockIrisAccess(password, rememberDevice);
      setPassword("");
      setNotice(result.warning ?? (result.remembered
        ? "Dispositivo lembrado. A sessão atual usa um token de até 6 horas; a credencial do dispositivo permite restauração após reabrir por até 90 dias de inatividade."
        : "Acesso liberado somente nesta sessão, por até 6 horas. Este dispositivo não foi lembrado; a senha master não foi salva."));
      setExpanded(false);
    } catch (unlockError) {
      setPassword("");
      setError(unlockError instanceof Error
        ? unlockError.message
        : "Não foi possível validar o acesso remoto agora.");
    } finally {
      setPending(false);
      setUnlocked(isIrisAccessUnlocked());
      setRemembered(await isIrisDeviceRemembered());
    }
  };

  const protect = async () => {
    setPending(true);
    setExpanded(false);
    setManagingDevices(false);
    setPassword("");
    setError("");
    setNotice("");
    try {
      const result = await lockIrisAccess();
      if (result.storageCleared && !result.revokeAttempted) {
        setNotice("Serviços protegidos. A credencial local foi apagada; não havia dispositivo salvo para revogar.");
      } else if (result.storageCleared && result.revoked) {
        setNotice("Serviços protegidos. A credencial foi apagada e o Worker confirmou a revogação deste dispositivo.");
      } else if (result.storageCleared) {
        setNotice("Serviços protegidos e credencial apagada localmente, mas o Worker não confirmou a revogação. Conecte-se e remova este dispositivo no painel.");
      } else if (result.revoked) {
        setNotice("O Worker confirmou a revogação, mas o navegador não confirmou a remoção local da credencial. Ela não poderá restaurar acesso; tente Proteger novamente quando o armazenamento estiver disponível. Seus documentos locais não foram apagados.");
      } else {
        setNotice(`Sessão bloqueada, mas não foi possível confirmar a remoção local nem a revogação remota. ${result.error ?? "Tente novamente online."}`);
      }
    } finally {
      setPending(false);
      setUnlocked(isIrisAccessUnlocked());
      setRemembered(await isIrisDeviceRemembered());
    }
  };

  const removeDevice = async (device: IrisRemoteDevice) => {
    if (!window.confirm(`Remover o acesso do dispositivo “${device.name}”? Esta ação não pode ser desfeita.`)) return;
    setRemovingDeviceId(device.id);
    setDeviceError("");
    try {
      await revokeIrisDevice(device.id);
      setNotice(`O Worker confirmou a remoção de “${device.name}”.`);
      if (isIrisAccessUnlocked()) await loadDevices();
      else setDevices((current) => current.filter((item) => item.id !== device.id));
    } catch (revokeError) {
      setDeviceError(revokeError instanceof Error
        ? revokeError.message
        : "Não foi possível remover este dispositivo.");
    } finally {
      setRemovingDeviceId(null);
      setUnlocked(isIrisAccessUnlocked());
      setRemembered(await isIrisDeviceRemembered());
    }
  };

  const toggleDevicePanel = () => {
    const next = !managingDevices;
    setManagingDevices(next);
    if (next) void loadDevices();
  };

  return (
    <aside className="remote-access-gate" aria-label="Acesso a serviços remotos">
      <div className="remote-access-gate__status" role="status" aria-live="polite">
        {unlocked ? <UnlockKeyhole size={16} aria-hidden="true" /> : <LockKeyhole size={16} aria-hidden="true" />}
        <span>Serviços conectados: <strong>{unlocked ? "desbloqueados" : "bloqueados"}</strong></span>
        {remembered && !unlocked && <span aria-label="Credencial salva aguardando validação"> · dispositivo lembrado</span>}
        {unlocked ? (
          <button className="remote-access-gate__button" type="button" onClick={() => void protect()} disabled={pending}>
            {pending ? "Protegendo…" : "Proteger"}
          </button>
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
        O desbloqueio libera somente Gmail, Drive, Calendar, IA e D1. Documentos, finanças e catálogo locais continuam funcionando. Nenhum conteúdo é enviado automaticamente.
      </p>
      {!remoteMode && <p className="remote-access-gate__mode-note">Modo Demonstração: nenhum conteúdo é enviado. Ative os serviços remotos em Configurações para prosseguir.</p>}

      {notice && <p className="remote-access-gate__notice" role="status">{notice}</p>}
      {unlocked && remoteMode && (
        <div className="remote-access-gate__devices" style={{ marginTop: 12 }}>
          <button className="remote-access-gate__button" type="button" onClick={toggleDevicePanel} aria-expanded={managingDevices}>
            <MonitorSmartphone size={15} aria-hidden="true" /> {managingDevices ? "Ocultar dispositivos" : "Gerenciar dispositivos"}
          </button>
          {managingDevices && (
            <section aria-label="Dispositivos lembrados" style={{ marginTop: 10 }}>
              <p>As sessões de dispositivo expiram após 90 dias sem atividade; cada renovação válida estende esse prazo. Remova dispositivos que você não reconhece.</p>
              {devicesLoading && <p role="status">Carregando dispositivos…</p>}
              {deviceError && <p className="remote-access-gate__error" role="alert">{deviceError}</p>}
              {!devicesLoading && devices.length === 0 && !deviceError && <p>Nenhum dispositivo ativo foi informado pelo Worker.</p>}
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {devices.map((device) => (
                  <li key={device.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: "10px 0", borderTop: "1px solid currentColor" }}>
                    <span>
                      <strong>{device.name}</strong><br />
                      <small>Último uso: {formatDeviceDate(device.lastUsedAt)} · expira: {formatDeviceDate(device.expiresAt)}</small>
                    </span>
                    <button
                      className="remote-access-gate__button"
                      type="button"
                      onClick={() => void removeDevice(device)}
                      disabled={removingDeviceId !== null}
                      aria-label={`Remover ${device.name}`}
                    >
                      {removingDeviceId === device.id
                        ? <Loader2 size={15} className="remote-access-gate__spinner" aria-label="Removendo" />
                        : <><Trash2 size={14} aria-hidden="true" /> Remover</>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {!unlocked && expanded && remoteMode && (
        <form id="remote-access-unlock-form" className="remote-access-gate__form" onSubmit={(event) => void submit(event)} autoComplete="off">
          <label htmlFor="remote-access-password">Senha master dos serviços remotos (não é o PIN local)</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              id="remote-access-password"
              name="iris-master-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value.slice(0, MAX_PASSWORD_LENGTH))}
              maxLength={MAX_PASSWORD_LENGTH}
              autoComplete="new-password"
              autoCapitalize="none"
              spellCheck={false}
              required
              aria-describedby="remote-access-privacy remote-access-error"
              disabled={pending}
              style={{ flex: 1, minWidth: 0 }}
            />
            <button
              className="remote-access-gate__button"
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? "Ocultar senha master" : "Mostrar senha master"}
              aria-pressed={showPassword}
              disabled={pending}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <p id="remote-access-privacy">
            A senha master nunca é salva pelo app. “Lembrar este dispositivo” salva somente a credencial de renovação no IndexedDB separado, fora do backup; o token de acesso dura até 6 horas. Uma lembrança fica ativa por até 90 dias sem atividade.
          </p>
          <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "10px 0" }}>
            <input
              type="checkbox"
              checked={rememberDevice}
              onChange={(event) => setRememberDevice(event.target.checked)}
              disabled={pending}
            />
            <span>Lembrar este dispositivo</span>
          </label>
          {error && <p id="remote-access-error" className="remote-access-gate__error" role="alert">{error}</p>}
          <div className="remote-access-gate__actions">
            <button className="remote-access-gate__button remote-access-gate__button--primary" type="submit" disabled={pending || !password}>
              {pending ? <><Loader2 size={15} className="remote-access-gate__spinner" /> Validando…</> : <><ShieldCheck size={15} /> Desbloquear serviços</>}
            </button>
            <button className="remote-access-gate__button" type="button" onClick={() => { setExpanded(false); setPassword(""); setError(""); }} disabled={pending}>Cancelar</button>
          </div>
        </form>
      )}
    </aside>
  );
}
