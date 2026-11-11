import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

const FIRST_RUN_KEY = "iris.firstRunCompleted";
const REMOTE_OPT_IN_KEY = "iris.remoteOptIn";

type IrisMode = "demo" | "connected";

export default function FirstRunGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const [completed, setCompleted] = useState(
    () => localStorage.getItem(FIRST_RUN_KEY) === "1",
  );
  const [mode, setMode] = useState<IrisMode>("demo");

  if (completed) return <>{children}</>;

  const finish = () => {
    if (mode === "connected") {
      localStorage.setItem("iris.mode", "connected");
      localStorage.setItem(REMOTE_OPT_IN_KEY, "1");
    } else {
      localStorage.setItem("iris.mode", "demo");
      localStorage.removeItem(REMOTE_OPT_IN_KEY);
    }
    localStorage.setItem(FIRST_RUN_KEY, "1");
    window.dispatchEvent(new Event("iris-mode-changed"));
    setCompleted(true);
  };

  return (
    <main className="profile-page">
      <section className="profile-card first-run-card">
        <div className="profile-heading">
          <div className="profile-icon">
            <ShieldCheck size={22} />
          </div>
          <div>
            <div className="eyebrow">IRIS · PRIVACIDADE POR PADRÃO</div>
            <h1>Antes de começar</h1>
          </div>
        </div>
        <p>
          Documentos, finanças e catálogo locais continuam disponíveis. A Iris não envia
          mensagens, imagens ou outros dados para IA, Gmail, Drive, Calendar ou D1
          automaticamente.
        </p>
        <div className="notification-settings">
          <strong>Escolha o modo de operação</strong>
          <label className="memory-row">
            <span>
              <b>Demonstração local (recomendado)</b>
              <br />
              <small>
                Sem chamadas remotas de IA ou D1. As ferramentas locais continuam funcionando.
              </small>
            </span>
            <input
              type="radio"
              name="iris-first-run-mode"
              checked={mode === "demo"}
              onChange={() => setMode("demo")}
            />
          </label>
          <label className="memory-row">
            <span>
              <b>Ativar serviços remotos</b>
              <br />
              <small>
                Opt-in para Gmail, Drive, Calendar, IA e D1. Ainda será necessário
                desbloquear com a credencial e pedir cada ação explicitamente.
              </small>
            </span>
            <input
              type="radio"
              name="iris-first-run-mode"
              checked={mode === "connected"}
              onChange={() => setMode("connected")}
            />
          </label>
        </div>
        <p className="remote-access-gate__description">
          Selecionar serviços remotos não significa que uma conta Google esteja conectada nem
          envia dados por si só. A credencial de desbloqueio não será armazenada pelo app.
        </p>
        <Button onClick={finish}>Continuar com segurança</Button>
      </section>
    </main>
  );
}
