import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IRIS_STATIC_MODE } from "@/lib/irisRuntime";

const FIRST_RUN_KEY = "iris.firstRunCompleted";

export default function FirstRunGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const [completed, setCompleted] = useState(
    () => {
      if (IRIS_STATIC_MODE) {
        localStorage.setItem(FIRST_RUN_KEY, "1");
        localStorage.setItem("iris.mode", "demo");
        return true;
      }
      return localStorage.getItem(FIRST_RUN_KEY) === "1";
    },
  );
  const [mode, setMode] = useState<"demo" | "connected">("demo");
  if (completed) return <>{children}</>;
  const finish = () => {
    const selected = IRIS_STATIC_MODE ? "demo" : mode;
    localStorage.setItem("iris.mode", selected);
    localStorage.setItem(FIRST_RUN_KEY, "1");
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
          Seus documentos, tarefas e backups ficam neste dispositivo. A Iris não
          envia e-mails, mensagens, arquivos ou dados para fora sem sua
          autorização individual.
        </p>
        <div className="notification-settings">
          <strong>Escolha o modo de operação</strong>
          <label className="memory-row">
            <span>
              <b>Demonstração local</b>
              <br />
              <small>
                Sem login, sem backend e com ações externas bloqueadas.
              </small>
            </span>
            <input
              type="radio"
              checked={mode === "demo"}
              onChange={() => setMode("demo")}
            />
          </label>
          <label className="memory-row">
            <span>
              <b>Conectado</b>
              <br />
              <small>
                Somente quando houver backend configurado; cada integração ainda
                exigirá aprovação.
              </small>
            </span>
            <input
              type="radio"
              checked={mode === "connected"}
              onChange={() => setMode("connected")}
              disabled={IRIS_STATIC_MODE}
            />
          </label>
        </div>
        {IRIS_STATIC_MODE && (
          <small>
            Esta publicação é PWA estática: o modo conectado permanece
            desativado.
          </small>
        )}
        <Button onClick={finish}>Continuar com segurança</Button>
      </section>
    </main>
  );
}
