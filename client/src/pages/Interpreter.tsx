import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  Languages,
  Mic,
  MicOff,
  RotateCcw,
  Sparkles,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import RemoteServiceAccess from "@/components/RemoteServiceAccess";
import { IRIS_STATIC_MODE } from "@/lib/irisRuntime";
import { askIrisAdvanced, isIrisAccessUnlocked, isIrisRemoteModeEnabled } from "@/lib/irisWorker";
import { translateWithAvailableService } from "@/lib/translation";

type Lang = "pt-BR" | "en-US" | "es-ES" | "fr-FR" | "de-DE" | "zh-CN" | "ja-JP";
const MAX_TEXT_LENGTH = 12000;
const DYNAMIC_TEXT_LIMIT = 1200;
const LANGS: Array<{ code: Lang; label: string; flag: string }> = [
  { code: "pt-BR", label: "Português", flag: "🇧🇷" },
  { code: "en-US", label: "Inglês", flag: "🇺🇸" },
  { code: "es-ES", label: "Espanhol", flag: "🇪🇸" },
  { code: "fr-FR", label: "Francês", flag: "🇫🇷" },
  { code: "de-DE", label: "Alemão", flag: "🇩🇪" },
  { code: "zh-CN", label: "Chinês", flag: "🇨🇳" },
  { code: "ja-JP", label: "Japonês", flag: "🇯🇵" },
];

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: any) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: any) => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const getRecognition = () => {
  const w = window as any;
  return (w.SpeechRecognition || w.webkitSpeechRecognition) as
    | SpeechRecognitionCtor
    | undefined;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function Interpreter() {
  const [source, setSource] = useState<Lang>("pt-BR");
  const [target, setTarget] = useState<Lang>("en-US");
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(true);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("Pronto para interpretar");
  const [heard, setHeard] = useState("");
  const [translated, setTranslated] = useState("");
  const [error, setError] = useState("");
  const [downloadRequest, setDownloadRequest] = useState<{ text: string; source: Lang; target: Lang } | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const listeningRef = useRef(false);
  const pendingRef = useRef(false);
  const translationSequenceRef = useRef(0);
  const voiceQueueRef = useRef<string[]>([]);
  const voiceTextRef = useRef("");

  const sourceLabel = useMemo(
    () => LANGS.find((language) => language.code === source)?.label ?? source,
    [source],
  );
  const targetLabel = useMemo(
    () => LANGS.find((language) => language.code === target)?.label ?? target,
    [target],
  );
  const supported = Boolean(getRecognition());

  useEffect(
    () => () => {
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      recognition?.stop();
      window.speechSynthesis?.cancel();
    },
    [],
  );

  const speak = (text: string) => {
    if (!speaking || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = target;
    utterance.rate = 1;
    utterance.onstart = () => setStatus("Reproduzindo tradução");
    utterance.onend = () =>
      setStatus(listeningRef.current ? `Ouvindo em ${sourceLabel}` : "Tradução concluída");
    window.speechSynthesis.speak(utterance);
  };

  const translateText = async (rawText: string, allowLocalDownload = false) => {
    const text = rawText.trim();
    if (!text || pendingRef.current) return;
    if (!IRIS_STATIC_MODE && text.length > DYNAMIC_TEXT_LIMIT) {
      setError(`No modo dinâmico, a tradução aceita até ${DYNAMIC_TEXT_LIMIT.toLocaleString("pt-BR")} caracteres. Reduza o texto e tente novamente.`);
      setStatus("Texto acima do limite do modo dinâmico");
      return;
    }

    const requestId = ++translationSequenceRef.current;
    const requestIsCurrent = () => translationSequenceRef.current === requestId;
    setDownloadRequest(null);
    pendingRef.current = true;
    setPending(true);
    setTranslated("");
    setError("");
    setStatus(`Verificando tradução para ${targetLabel}…`);

    try {
      const outcome = await translateWithAvailableService({
        text: rawText,
        sourceLanguage: source.split("-")[0],
        targetLanguage: target.split("-")[0],
        remoteEnabled: isIrisRemoteModeEnabled(),
        accessUnlocked: isIrisAccessUnlocked(),
        allowLocalDownload,
      }, {
        isCurrent: requestIsCurrent,
        remoteTranslate: async (request) => {
          if (!requestIsCurrent()) throw new Error("O texto mudou antes do envio; clique em Traduzir novamente.");
          if (!isIrisRemoteModeEnabled()) throw new Error("Modo Demonstração ativo: nenhum texto foi enviado. Se quiser, ative serviços remotos em Configurações.");
          if (!isIrisAccessUnlocked()) throw new Error("Sessão remota bloqueada: nenhum texto foi enviado. Restaure ou desbloqueie o acesso e clique em Traduzir novamente.");
          const result = await askIrisAdvanced({
            mode: "translate",
            text: `Traduza de ${sourceLabel} (${source}) para ${targetLabel} (${target}). Retorne só tradução.\n${request.text}`,
          });
          return result.text ?? "";
        },
      });

      if (!requestIsCurrent() || outcome.status === "stale") return;
      if (outcome.status === "translated") {
        setTranslated(outcome.text);
        setDownloadRequest(null);
        setStatus(outcome.provider === "same-language"
          ? "Os idiomas são iguais; o texto foi mantido localmente."
          : outcome.provider === "browser"
            ? "Tradução concluída no dispositivo."
            : "Tradução remota concluída após seu clique.");
        speak(outcome.text);
      } else if (outcome.status === "download-required") {
        setDownloadRequest({ text: rawText, source, target });
        setStatus("O navegador oferece tradução local, mas o modelo ainda não está disponível.");
        setError(outcome.remoteReason === "demo"
          ? "Nada foi enviado. Autorize o download local abaixo ou ative serviços remotos em Configurações para usar o fallback."
          : outcome.remoteReason === "locked"
            ? "Nada foi enviado. Autorize o download local abaixo ou desbloqueie uma sessão remota para usar o fallback."
            : "Nada foi baixado. Autorize explicitamente o preparo do modelo local abaixo.");
      } else if (outcome.status === "downloading") {
        setStatus("O modelo de tradução local já está sendo preparado pelo navegador.");
        setError(outcome.remoteReason === "demo"
          ? "Aguarde o navegador concluir. O modo Demonstração continua sem enviar texto à Iris."
          : outcome.remoteReason === "locked"
            ? "Aguarde o navegador concluir ou restaure/desbloqueie o acesso remoto para usar o fallback."
            : "Aguarde o navegador concluir e tente novamente.");
      } else {
        setStatus("Tradução bloqueada ou indisponível");
        setError(outcome.remoteReason === "demo"
          ? "Este navegador não oferece um tradutor local pronto. No modo Demonstração nenhum texto foi enviado; ative o modo conectado em Configurações se quiser usar a IA."
          : outcome.remoteReason === "locked"
            ? "Este navegador não oferece um tradutor local pronto. A sessão remota está bloqueada; restaure o dispositivo ou desbloqueie com a senha master."
            : outcome.detail
              ? `O tradutor do navegador falhou: ${outcome.detail}`
              : "Este navegador não oferece tradução local pronta e nenhum serviço remoto autorizado está disponível.");
      }
    } catch (translationError) {
      if (!requestIsCurrent()) return;
      setStatus("Tradução indisponível");
      setError(errorMessage(translationError, "Não foi possível traduzir agora."));
    } finally {
      pendingRef.current = false;
      setPending(false);
      if (requestIsCurrent() && listeningRef.current && !error) setStatus(`Ouvindo em ${sourceLabel}`);
    }
  };

  const start = () => {
    const Ctor = getRecognition();
    if (!Ctor) {
      setError(
        "Seu navegador não oferece reconhecimento de voz. Você ainda pode digitar ou colar texto no campo de origem.",
      );
      return;
    }

    setError("");
    setHeard("");
    setTranslated("");
    setDownloadRequest(null);
    translationSequenceRef.current += 1;
    voiceTextRef.current = "";
    voiceQueueRef.current = [];

    const recognition = new Ctor();
    recognition.lang = source;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let finalText = "";
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        if (result?.isFinal) finalText += result?.[0]?.transcript ?? "";
      }
      const segment = finalText.trim();
      if (!segment) return;

      const separator = voiceTextRef.current ? " " : "";
      const candidate = `${voiceTextRef.current}${separator}${segment}`;
      if (candidate.length > MAX_TEXT_LENGTH) {
        setError(`O reconhecimento atingiu o limite de ${MAX_TEXT_LENGTH.toLocaleString("pt-BR")} caracteres. Pare a voz para continuar por texto.`);
        return;
      }
      voiceTextRef.current = candidate;
      translationSequenceRef.current += 1;
      setHeard(candidate);
      setTranslated("");
      setError("");
      setDownloadRequest(null);
      setStatus("Texto de voz atualizado; clique em Traduzir para enviar ou processar.");
    };
    recognition.onerror = (event) => {
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;
      listeningRef.current = false;
      setListening(false);
      setError(`Microfone: ${event?.error ?? "erro desconhecido"}. Inicie novamente se quiser tentar outra vez.`);
      setStatus("Microfone parado por erro");
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) {
        try {
          recognition.start();
          listeningRef.current = true;
          setListening(true);
          setStatus(`Ouvindo em ${sourceLabel}`);
          return;
        } catch {
          recognitionRef.current = null;
        }
      }
      listeningRef.current = false;
      setListening(false);
      if (!pendingRef.current) setStatus("Intérprete pausado");
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      listeningRef.current = true;
      setListening(true);
      setStatus(`Ouvindo em ${sourceLabel}`);
    } catch {
      recognitionRef.current = null;
      listeningRef.current = false;
      setListening(false);
      setError("Não foi possível iniciar o microfone. Verifique a permissão do microfone no navegador.");
      setStatus("Microfone indisponível");
    }
  };

  const stop = () => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    listeningRef.current = false;
    setListening(false);
    try {
      recognition?.stop();
    } catch {
      // O reconhecimento pode já ter sido encerrado pelo navegador.
    }
    setStatus(pendingRef.current ? "Voz parada; tradução em andamento" : "Intérprete pausado");
  };

  const clear = () => {
    translationSequenceRef.current += 1;
    setHeard("");
    setTranslated("");
    setError("");
    setDownloadRequest(null);
    voiceTextRef.current = "";
    voiceQueueRef.current = [];
    setStatus(listeningRef.current ? `Ouvindo em ${sourceLabel}` : "Campos limpos");
  };

  const openManualTranslator = () => {
    const text = heard.trim();
    if (!text) return;
    const confirmed = window.confirm(
      `Abrir o Google Tradutor compartilhará este texto com o Google para tradução de ${sourceLabel} para ${targetLabel}. Nada será compartilhado se você cancelar. Deseja continuar?`,
    );
    if (!confirmed) return;
    const url = new URL("https://translate.google.com/");
    url.searchParams.set("sl", source.split("-")[0]);
    url.searchParams.set("tl", target.split("-")[0]);
    url.searchParams.set("text", text);
    url.searchParams.set("op", "translate");
    window.open(url.href, "_blank", "noopener,noreferrer");
  };

  const swap = () => {
    translationSequenceRef.current += 1;
    setSource(target);
    setTarget(source);
    clear();
    setStatus("Idiomas invertidos");
  };

  return (
    <div className="vida-shell interpreter-shell">
      <header className="topbar">
        <Link href="/" className="brand-lockup" style={{ textDecoration: "none" }}>
          <span className="brand-mark"><Sparkles size={17} /></span>IRIS
        </Link>
        <Link href="/" className="outline-action"><ArrowLeft size={15} /> Voltar</Link>
      </header>
      <main className="interpreter-page">
        <div className="eyebrow">IRIS INTERPRETER</div>
        <h1>Tradução <span>voz ↔ voz</span></h1>
        <p className="hero-subtitle">
          Traduza texto sob demanda. Nada é enviado ao serviço de IA enquanto você digita ou dita: o conteúdo só segue após clicar em Traduzir.
        </p>

        <section className="interpreter-card">
          <div className="language-row">
            <div className="language-box">
              <label htmlFor="interpreter-source-language">Você fala</label>
              <select id="interpreter-source-language" value={source} onChange={(event) => { translationSequenceRef.current += 1; setSource(event.target.value as Lang); setTranslated(""); setError(""); setDownloadRequest(null); setStatus("Idiomas atualizados; pronto para traduzir."); }} disabled={listening || pending}>
                {LANGS.map((language) => <option key={language.code} value={language.code}>{language.flag} {language.label}</option>)}
              </select>
            </div>
            <button className="swap-language" onClick={swap} disabled={listening || pending} aria-label="Inverter idiomas"><RotateCcw size={19} /></button>
            <div className="language-box">
              <label htmlFor="interpreter-target-language">IRIS responde</label>
              <select id="interpreter-target-language" value={target} onChange={(event) => { translationSequenceRef.current += 1; setTarget(event.target.value as Lang); setTranslated(""); setError(""); setDownloadRequest(null); setStatus("Idiomas atualizados; pronto para traduzir."); }} disabled={listening || pending}>
                {LANGS.map((language) => <option key={language.code} value={language.code}>{language.flag} {language.label}</option>)}
              </select>
            </div>
          </div>

          <div className={`interpreter-status ${listening ? "live" : ""}`} aria-live="polite">
            <span className="live-dot" />{status}{pending ? " · aguardando resposta" : ""}
          </div>

          <div className="interpreter-editors">
            <div className="interpreter-editor">
              <div className="interpreter-editor-heading">
                <label htmlFor="interpreter-source-text">Texto de origem — {sourceLabel} ({source})</label>
                <span>{heard.length.toLocaleString("pt-BR")} / {MAX_TEXT_LENGTH.toLocaleString("pt-BR")}</span>
              </div>
              <textarea
                id="interpreter-source-text"
                className="interpreter-textarea"
                value={heard}
                onChange={(event) => {
                  const value = event.target.value.slice(0, MAX_TEXT_LENGTH);
                  translationSequenceRef.current += 1;
                  setHeard(value);
                  voiceTextRef.current = value;
                  setTranslated("");
                  setError("");
                  setDownloadRequest(null);
                  setStatus(value.trim() ? "Texto atualizado; clique em Traduzir quando quiser." : "Pronto para interpretar");
                }}
                maxLength={MAX_TEXT_LENGTH}
                rows={6}
                placeholder="Digite ou cole o texto para traduzir…"
                aria-describedby="interpreter-consent-note"
              />
            </div>
            <div className="interpreter-editor">
              <div className="interpreter-editor-heading">
                <label htmlFor="interpreter-output-text">Tradução — {targetLabel} ({target})</label>
                {translated && <span>Somente leitura</span>}
              </div>
              <textarea
                id="interpreter-output-text"
                className="interpreter-textarea interpreter-output-textarea"
                value={translated}
                readOnly
                rows={6}
                placeholder="A tradução aparecerá aqui…"
                aria-label={`Tradução em ${targetLabel} (${target}); somente leitura`}
              />
              {translated && <button className="speak-again" onClick={() => speak(translated)}><Volume2 size={15} /> Ouvir novamente</button>}
            </div>
          </div>

          {downloadRequest && (
            <div className="interpreter-note" role="status" style={{ flexDirection: "column", gap: 8 }}>
              <span>O preparo pode baixar e armazenar um modelo de tradução no navegador. Nada foi baixado ainda.</span>
              <Button
                variant="outline"
                disabled={pending || heard !== downloadRequest.text || source !== downloadRequest.source || target !== downloadRequest.target}
                onClick={() => void translateText(downloadRequest.text, true)}
              >
                Autorizar download e traduzir neste dispositivo
              </Button>
            </div>
          )}

          {heard.trim() && (
            <div className="interpreter-note" style={{ flexDirection: "column", gap: 8 }}>
              <span>Alternativa manual: o texto só será compartilhado com o Google se você clicar e confirmar.</span>
              <Button variant="outline" onClick={openManualTranslator} disabled={pending}>
                Abrir Google Tradutor manualmente
              </Button>
            </div>
          )}

          <p id="interpreter-consent-note" className="interpreter-consent-note">
            Digitação e ditado não enviam conteúdo. “Traduzir” usa o tradutor do navegador se estiver pronto; a IA remota só é usada após seu clique e com acesso conectado desbloqueado. O reconhecimento de voz pode usar serviços próprios do navegador.
          </p>

          <div className="interpreter-controls">
            <Button className="interpreter-translate" onClick={() => void translateText(heard)} disabled={pending || !heard.trim()}>
              {pending ? "Traduzindo…" : "Traduzir"}
            </Button>
            <Button
              className={listening ? "interpreter-stop" : "interpreter-start"}
              onClick={listening ? stop : start}
              disabled={pending && !listening}
              aria-label={listening ? "Parar voz" : "Iniciar voz"}
            >
              {listening ? <><MicOff size={18} /> Parar voz</> : <><Mic size={18} /> Iniciar voz</>}
            </Button>
            <button className="voice-toggle" onClick={() => setSpeaking((enabled) => !enabled)}>
              <VolumeX size={16} /> Voz {speaking ? "ativada" : "desativada"}
            </button>
            <Button variant="outline" onClick={clear} disabled={pending || (!heard && !translated && !error)}>Limpar</Button>
          </div>

          <RemoteServiceAccess compact />
          {!supported && <p className="interpreter-note">Reconhecimento de voz não está disponível neste navegador. Você ainda pode digitar ou colar até {MAX_TEXT_LENGTH.toLocaleString("pt-BR")} caracteres.</p>}
          {error && <p className="interpreter-error" role="alert">{error}</p>}
          <p className="interpreter-note"><Languages size={15} /> Português ↔ Inglês, Espanhol, Francês, Alemão, Chinês e Japonês.</p>
        </section>
      </main>
    </div>
  );
}
