import { useState } from "react";
import { ArrowLeft, Settings2 } from "lucide-react";
import { Link } from "wouter";
import { useIrisLanguage } from "@/lib/irisI18n";
import type { SupportedLanguage } from "@shared/irisLanguageAndUpload";
import { hashPin } from "@/components/LocalLockGate";
import { Button } from "@/components/ui/button";
import { lockIrisAccess } from "@/lib/irisWorker";

const REMOTE_OPT_IN_KEY = "iris.remoteOptIn";

type IrisMode = "demo" | "connected";

function getInitialMode(): IrisMode {
  return localStorage.getItem("iris.mode") === "connected" &&
    localStorage.getItem(REMOTE_OPT_IN_KEY) === "1"
    ? "connected"
    : "demo";
}

export default function Settings() {
  const { language, setLanguage } = useIrisLanguage();
  const [mode, setModeState] = useState<IrisMode>(getInitialMode);

  const setMode = (value: IrisMode) => {
    setModeState(value);
    if (value === "connected") {
      localStorage.setItem("iris.mode", "connected");
      localStorage.setItem(REMOTE_OPT_IN_KEY, "1");
    } else {
      localStorage.setItem("iris.mode", "demo");
      localStorage.removeItem(REMOTE_OPT_IN_KEY);
      lockIrisAccess();
    }
    window.dispatchEvent(new Event("iris-mode-changed"));
  };

  const setPin = async () => {
    const pin = window.prompt("Defina um PIN local de 4 ou mais dígitos:");
    if (pin && pin.length >= 4) {
      localStorage.setItem("iris.pinHash", await hashPin(pin));
      sessionStorage.setItem("iris.unlocked", "1");
      window.alert("PIN local ativado neste navegador.");
    }
  };
  const removePin = () => {
    localStorage.removeItem("iris.pinHash");
    sessionStorage.removeItem("iris.unlocked");
    window.alert("PIN local removido.");
  };

  return (
    <main className="profile-page">
      <div className="profile-card">
        <Link href="/" className="back-link"><ArrowLeft size={16} /> Voltar ao Radar</Link>
        <div className="profile-heading">
          <div className="profile-icon"><Settings2 size={22} /></div>
          <div>
            <div className="eyebrow">IRIS 5.5 · CONFIGURAÇÕES</div>
            <h1>Configurações</h1>
            <p>Preferências locais e controles de segurança. Nada é enviado automaticamente.</p>
          </div>
        </div>

        <div className="memory-settings">
          <strong>Idioma</strong>
          <select value={language} onChange={(event) => setLanguage(event.target.value as SupportedLanguage)} style={{ width: "100%", minHeight: 42, marginTop: 8 }}>
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
          <p>O padrão é Demonstração local. Mudar para Conectado é um opt-in neste navegador; ainda não conecta uma conta Google nem envia dados.</p>
          <select value={mode} onChange={(event) => setMode(event.target.value as IrisMode)} style={{ width: "100%", minHeight: 42, marginTop: 8 }} aria-label="Modo de operação">
            <option value="demo">Demonstração — IA remota e D1 bloqueados</option>
            <option value="connected">Ativar serviços remotos — Gmail, Drive, Calendar, IA e D1</option>
          </select>
          <p role="status" aria-live="polite">
            {mode === "connected"
              ? "Opt-in registrado. Para enviar uma ação remota, ainda é preciso desbloquear os serviços e clicar na ação desejada."
              : "Demonstração ativa: nenhuma mensagem, imagem ou dado é enviado à IA ou ao D1."}
          </p>
          <small>Documentos, finanças e catálogo locais continuam disponíveis em qualquer modo. A credencial remota é mantida somente em memória após validação e será pedida novamente após recarregar ou fechar.</small>
        </div>

        <div className="notification-settings">
          <strong>Privacidade e custo</strong>
          <p>Armazenamento local. Upload somente após ação explícita. Integrações opcionais. Billing não habilitado pelo pacote. Ações externas exigem aprovação explícita.</p>
        </div>

        <div className="memory-settings">
          <strong>Proteção local opcional</strong>
          <p>Um PIN protege o acesso neste navegador. Ele não substitui autenticação de servidor nem criptografa automaticamente arquivos exportados.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <Button variant="outline" onClick={() => void setPin()}>Definir PIN</Button>
            <Button variant="ghost" onClick={removePin}>Remover PIN</Button>
          </div>
        </div>

        <div className="memory-settings">
          <strong>Acessos rápidos</strong>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <Link href="/diagnostico" className="back-link">Diagnóstico</Link>
            <Link href="/seguranca" className="back-link">Segurança</Link>
            <Link href="/catalogo" className="back-link">Catálogo</Link>
            <Link href="/offline" className="back-link">Espaço offline</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
