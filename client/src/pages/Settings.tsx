import { useState, type FormEvent } from "react";
import { ArrowLeft, Settings2 } from "lucide-react";
import { Link } from "wouter";
import { useIrisLanguage } from "@/lib/irisI18n";
import type { SupportedLanguage } from "@shared/irisLanguageAndUpload";
import {
  clearLocalPinKeys,
  forgetLocalUnlock,
  getLocalPinHash,
  hashPin,
  safeReadLocalStorage,
  safeRemoveLocalStorage,
  safeWriteLocalStorage,
  saveLocalPinHash,
} from "@/lib/irisLocalLock";
import { Button } from "@/components/ui/button";
import { lockIrisAccess } from "@/lib/irisWorker";
import RemoteAccessGate from "@/components/RemoteAccessGate";

const REMOTE_OPT_IN_KEY = "iris.remoteOptIn";
const PIN_PATTERN = /^\d{4,12}$/;
type IrisMode = "demo" | "connected";

function getInitialMode(): IrisMode {
  const mode = safeReadLocalStorage("iris.mode");
  const remoteOptIn = safeReadLocalStorage(REMOTE_OPT_IN_KEY);
  return mode.value === "connected" && remoteOptIn.value === "1"
    ? "connected"
    : "demo";
}

export default function Settings() {
  const { language, setLanguage } = useIrisLanguage();
  const [mode, setModeState] = useState<IrisMode>(getInitialMode);
  const [hasLocalPin, setHasLocalPin] = useState(() =>
    Boolean(getLocalPinHash()),
  );
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinNotice, setPinNotice] = useState("");

  const setMode = (value: IrisMode) => {
    setModeState(value);
    if (value === "connected") {
      safeWriteLocalStorage("iris.mode", "connected");
      safeWriteLocalStorage(REMOTE_OPT_IN_KEY, "1");
    } else {
      safeWriteLocalStorage("iris.mode", "demo");
      safeRemoveLocalStorage(REMOTE_OPT_IN_KEY);
      lockIrisAccess();
    }
    window.dispatchEvent(new Event("iris-mode-changed"));
  };

  const savePin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPinError("");
    setPinNotice("");

    if (!PIN_PATTERN.test(newPin)) {
      setPinError("O PIN deve conter somente 4 a 12 dígitos.");
      return;
    }
    if (newPin !== confirmPin) {
      setPinError("A confirmação do PIN não corresponde.");
      return;
    }

    try {
      const result = saveLocalPinHash(await hashPin(newPin));
      if (!result.saved) {
        setPinError(
          "Não foi possível salvar o PIN neste navegador. Verifique as permissões de armazenamento.",
        );
        return;
      }

      setHasLocalPin(true);
      setNewPin("");
      setConfirmPin("");
      setPinNotice(
        result.remembered
          ? "PIN salvo. A liberação deste navegador foi atualizada para o novo PIN."
          : "PIN salvo, mas não foi possível lembrar este navegador; ele pedirá o PIN novamente após a sessão.",
      );
    } catch {
      setPinError(
        "Não foi possível gerar o hash do PIN neste navegador. Nenhum PIN foi salvo.",
      );
    }
  };

  const removePin = () => {
    setPinError("");
    setPinNotice("");
    if (
      !window.confirm(
        "Remover somente o PIN local? Seus documentos e demais dados locais serão preservados.",
      )
    )
      return;

    if (!clearLocalPinKeys()) {
      setPinError(
        "Não foi possível remover todas as chaves do PIN neste navegador.",
      );
      return;
    }
    setHasLocalPin(false);
    setNewPin("");
    setConfirmPin("");
    setPinNotice(
      "PIN local removido. Os demais dados locais foram preservados.",
    );
  };

  const forgetBrowserTrust = () => {
    setPinError("");
    setPinNotice("");
    if (
      !window.confirm(
        "Esquecer a liberação local deste navegador e recarregar para pedir o PIN? Seus documentos, finanças, catálogo e demais dados serão preservados.",
      )
    )
      return;

    if (!forgetLocalUnlock()) {
      setPinError(
        "Não foi possível remover a lembrança local neste navegador.",
      );
      return;
    }
    window.location.reload();
  };

  return (
    <main className="profile-page">
      <div className="profile-card">
        <Link href="/" className="back-link">
          <ArrowLeft size={16} /> Voltar ao Radar
        </Link>
        <div className="profile-heading">
          <div className="profile-icon">
            <Settings2 size={22} />
          </div>
          <div>
            <div className="eyebrow">IRIS 5.5 · CONFIGURAÇÕES</div>
            <h1>Configurações</h1>
            <p>
              Preferências locais e controles de segurança. Nada é enviado
              automaticamente.
            </p>
          </div>
        </div>

        <div className="memory-settings">
          <strong>Idioma</strong>
          <select
            value={language}
            onChange={(event) =>
              setLanguage(event.target.value as SupportedLanguage)
            }
            style={{ width: "100%", minHeight: 42, marginTop: 8 }}
          >
            <option value="pt-BR">Português (Brasil)</option>
            <option value="en">English</option>
            <option value="es">Español</option>
            <option value="fr">Français</option>
            <option value="it">Italiano</option>
            <option value="de">Deutsch</option>
            <option value="zh-CN">中文</option>
            <option value="ja-JP">日本語</option>
            <option value="ar">العربية</option>
          </select>
        </div>

        <div className="memory-settings">
          <strong>Modo de operação e privacidade</strong>
          <p>
            O padrão é Demonstração local. Mudar para Conectado é um opt-in
            neste navegador; ainda não conecta uma conta Google nem envia dados.
          </p>
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as IrisMode)}
            style={{ width: "100%", minHeight: 42, marginTop: 8 }}
            aria-label="Modo de operação"
          >
            <option value="demo">
              Demonstração — IA remota e D1 bloqueados
            </option>
            <option value="connected">
              Ativar serviços remotos — Gmail, Drive, Calendar, IA e D1
            </option>
          </select>
          <p role="status" aria-live="polite">
            {mode === "connected"
              ? "Opt-in registrado. Para enviar uma ação remota, ainda é preciso desbloquear os serviços e clicar na ação desejada."
              : "Demonstração ativa: nenhuma mensagem, imagem ou dado é enviado à IA ou ao D1."}
          </p>
          <small>
            A senha mestra não é persistida pelo app. Ao escolher “Lembrar
            dispositivo” no acesso remoto, uma credencial do dispositivo pode
            ser mantida por até 90 dias de inatividade; o uso renova esse prazo.
            Use “Proteger” para revogar o acesso lembrado e exigir nova
            validação.
          </small>
        </div>

        <details className="memory-settings remote-access-settings">
          <summary>Controle dos serviços remotos</summary>
          <RemoteAccessGate />
        </details>

        <div className="notification-settings">
          <strong>Privacidade e custo</strong>
          <p>
            Armazenamento local. Upload somente após ação explícita. Integrações
            opcionais. Billing não habilitado pelo pacote. Ações externas exigem
            aprovação explícita.
          </p>
        </div>

        <section
          className="memory-settings"
          aria-labelledby="local-protection-title"
        >
          <strong id="local-protection-title">Proteção local opcional</strong>
          <p>
            O PIN local protege somente este navegador e é diferente da senha
            mestra remota. A senha mestra não recupera o PIN sem validação
            remota explícita; o PIN não substitui autenticação do servidor nem
            criptografa arquivos exportados.
          </p>
          <p role="status" aria-live="polite">
            {hasLocalPin
              ? "PIN local configurado neste navegador."
              : "Nenhum PIN local configurado."}
          </p>
          <form
            onSubmit={(event) => void savePin(event)}
            style={{ display: "grid", gap: 9 }}
          >
            <label
              htmlFor="settings-new-local-pin"
              style={{ color: "#385572", fontSize: 12, fontWeight: 800 }}
            >
              {hasLocalPin
                ? "Novo PIN local"
                : "Novo PIN local (4 a 12 dígitos)"}
            </label>
            <input
              id="settings-new-local-pin"
              name="settings-new-local-pin"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              pattern="[0-9]{4,12}"
              minLength={4}
              maxLength={12}
              value={newPin}
              onChange={(event) => {
                setNewPin(event.target.value);
                setPinError("");
                setPinNotice("");
              }}
              required
              aria-describedby="settings-pin-guidance settings-pin-error"
              style={{
                width: "100%",
                minHeight: 42,
                padding: "8px 12px",
                border: "1px solid #cfdeec",
                borderRadius: 10,
              }}
            />
            <label
              htmlFor="settings-confirm-local-pin"
              style={{ color: "#385572", fontSize: 12, fontWeight: 800 }}
            >
              Confirmar novo PIN
            </label>
            <input
              id="settings-confirm-local-pin"
              name="settings-confirm-local-pin"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              pattern="[0-9]{4,12}"
              minLength={4}
              maxLength={12}
              value={confirmPin}
              onChange={(event) => {
                setConfirmPin(event.target.value);
                setPinError("");
                setPinNotice("");
              }}
              required
              aria-describedby="settings-pin-guidance settings-pin-error"
              style={{
                width: "100%",
                minHeight: 42,
                padding: "8px 12px",
                border: "1px solid #cfdeec",
                borderRadius: 10,
              }}
            />
            <small id="settings-pin-guidance">
              Use somente 4 a 12 algarismos. Ao salvar aqui, a confiança antiga
              é removida e o novo hash é lembrado neste navegador; o texto do
              PIN não é armazenado.
            </small>
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                marginTop: 4,
              }}
            >
              <Button type="submit" variant="outline">
                {hasLocalPin ? "Alterar PIN" : "Definir PIN"}
              </Button>
              {hasLocalPin && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={forgetBrowserTrust}
                >
                  Esquecer liberação local
                </Button>
              )}
              {hasLocalPin && (
                <Button type="button" variant="ghost" onClick={removePin}>
                  Remover PIN
                </Button>
              )}
            </div>
          </form>
          {pinError && (
            <p
              id="settings-pin-error"
              role="alert"
              aria-live="assertive"
              style={{ color: "#a44854", fontSize: 13 }}
            >
              {pinError}
            </p>
          )}
          {pinNotice && (
            <p
              role="status"
              aria-live="polite"
              style={{ color: "#287568", fontSize: 13 }}
            >
              {pinNotice}
            </p>
          )}
        </section>

        <div className="memory-settings">
          <strong>Acessos rápidos</strong>
          <div
            style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}
          >
            <Link href="/diagnostico" className="back-link">
              Diagnóstico
            </Link>
            <Link href="/seguranca" className="back-link">
              Segurança
            </Link>
            <Link href="/catalogo" className="back-link">
              Catálogo
            </Link>
            <Link href="/offline" className="back-link">
              Espaço offline
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
