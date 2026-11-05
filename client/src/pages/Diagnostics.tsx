import { useEffect, useState } from "react";
import { Activity, ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import { Link } from "wouter";
import { useIrisLanguage } from "@/lib/irisI18n";
import { readLocal, writeLocal } from "@/lib/irisLocalStore";

type Check = { label: string; ok: boolean; detail: string };

export default function Diagnostics() {
  const { language, setLanguage } = useIrisLanguage();
  const [checks, setChecks] = useState<Check[]>([]);
  useEffect(() => {
    let active = true;
    const run = async () => {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
      const hasSpeech =
        "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
      const hasRecognition =
        "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
      const hasRecorder = "MediaRecorder" in window;
      const hasIndexedDb = "indexedDB" in window;
      const hasServiceWorker = "serviceWorker" in navigator;
      const hasStorage = "localStorage" in window;
      const hasOcrRuntime = "Worker" in window && "createImageBitmap" in window;
      const lastBackup = localStorage.getItem("iris.lastBackupAt");
      let indexedDbWritable = false;
      try {
        await writeLocal("iris:diagnostic", {
          checkedAt: new Date().toISOString(),
        });
        indexedDbWritable = (await readLocal("iris:diagnostic", null)) !== null;
      } catch {}
      let storageDetail = hasStorage
        ? "Preferências locais disponíveis."
        : "Preferências não podem ser persistidas.";
      try {
        const estimate = await navigator.storage?.estimate();
        if (estimate?.quota)
          storageDetail += ` Limite estimado: ${(estimate.quota / 1073741824).toFixed(1)} GB.`;
      } catch {}
      const permission =
        typeof navigator.permissions?.query === "function"
          ? await navigator.permissions
              .query({ name: "microphone" as PermissionName })
              .catch(() => null)
          : null;
      const next: Check[] = [
        {
          label: "PWA / standalone",
          ok: standalone,
          detail: standalone
            ? "Executando como aplicativo instalado."
            : "Abra pelo HTTPS e use Instalar na tela inicial.",
        },
        {
          label: "Service Worker",
          ok: hasServiceWorker,
          detail: hasServiceWorker
            ? "API disponível; registro ocorre em produção."
            : "Este navegador não oferece Service Worker.",
        },
        {
          label: "IndexedDB",
          ok: hasIndexedDb && indexedDbWritable,
          detail: indexedDbWritable
            ? "Leitura e escrita local confirmadas."
            : "Armazenamento local indisponível ou bloqueado.",
        },
        {
          label: "OCR local",
          ok: hasOcrRuntime,
          detail: hasOcrRuntime
            ? "Motor local disponível sob demanda; o modelo pode ser armazenado em cache."
            : "Este navegador não oferece recursos suficientes para OCR local.",
        },
        {
          label: "Último backup",
          ok: Boolean(lastBackup),
          detail: lastBackup
            ? `Último backup local: ${new Date(lastBackup).toLocaleString()}.`
            : "Nenhum backup foi registrado neste navegador.",
        },
        {
          label: "Síntese de voz",
          ok: hasSpeech,
          detail: hasSpeech
            ? "Síntese de voz disponível."
            : "Síntese de voz indisponível.",
        },
        {
          label: "Reconhecimento de voz",
          ok: hasRecognition,
          detail: hasRecognition
            ? "Captura de voz disponível no navegador."
            : "Reconhecimento pode não ser suportado neste navegador.",
        },
        {
          label: "Gravador de vídeo",
          ok: hasRecorder,
          detail: hasRecorder
            ? "MediaRecorder disponível."
            : "Vídeo WebM indisponível.",
        },
        {
          label: "Microfone",
          ok: permission?.state !== "denied",
          detail: permission
            ? `Permissão atual: ${permission.state}.`
            : "Permissão será solicitada somente ao iniciar voz.",
        },
        { label: "Armazenamento", ok: hasStorage, detail: storageDetail },
        {
          label: "Rede",
          ok: navigator.onLine,
          detail: navigator.onLine
            ? "Navegador informa conexão ativa."
            : "Modo offline detectado; ações externas continuam bloqueadas.",
        },
      ];
      if (active) setChecks(next);
    };
    void run();
    return () => {
      active = false;
    };
  }, []);
  return (
    <main className="profile-page">
      <div className="profile-card">
        <Link href="/" className="back-link">
          <ArrowLeft size={16} /> Voltar ao Radar
        </Link>
        <div className="profile-heading">
          <div className="profile-icon">
            <Activity size={22} />
          </div>
          <div>
            <div className="eyebrow">IRIS 5.5 · DIAGNÓSTICO</div>
            <h1>
              {language === "pt-BR" ? "Diagnóstico local" : "Local diagnostics"}
            </h1>
            <p>
              {language === "pt-BR"
                ? "Verifique os recursos do navegador sem transmitir dados."
                : "Check browser capabilities without transmitting data."}
            </p>
          </div>
        </div>
        <div className="notification-settings">
          <strong>
            {language === "pt-BR" ? "Modo de operação" : "Operating mode"}
          </strong>
          <p>
            {localStorage.getItem("iris.mode") === "connected"
              ? "Conectado: integrações continuam sujeitas a autorização explícita."
              : "Demonstração: dados locais e ações externas bloqueadas."}
          </p>
        </div>
        <div className="memory-settings">
          <strong>
            {language === "pt-BR"
              ? "Idioma da interface"
              : "Interface language"}
          </strong>
          <select
            value={language}
            onChange={(event) =>
              setLanguage(event.target.value as typeof language)
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
          <strong>
            {language === "pt-BR"
              ? "Capacidades detectadas"
              : "Detected capabilities"}
          </strong>
          {checks.length === 0 ? (
            <small>Executando diagnóstico local…</small>
          ) : (
            checks.map((check) => (
              <div className="memory-row" key={check.label}>
                <span>
                  <b>{check.label}</b>
                  <br />
                  <small>{check.detail}</small>
                </span>
                {check.ok ? (
                  <CheckCircle2 color="#16a34a" size={19} />
                ) : (
                  <XCircle color="#dc2626" size={19} />
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
