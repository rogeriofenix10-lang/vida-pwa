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
import { IRIS_STATIC_MODE } from "@/lib/irisRuntime";
import { askIrisAdvanced } from "@/lib/irisWorker";

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
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const listeningRef = useRef(false);
  const pendingRef = useRef(false);
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

  const translateText = async (rawText: string, fromVoice = false) => {
    const text = rawText.trim();
    if (!text) return;
    if (pendingRef.current) {
      if (fromVoice) {
        voiceQueueRef.current.push(text);
        setStatus("Trecho de voz aguardando a tradução anterior");
      }
      return;
    }

    pendingRef.current = true;
    setPending(true);
    setError("");
    let nextText: string | undefined = text;
    let lastRequestFailed = false;

    try {
      while (nextText) {
        const currentText = nextText;
        nextText = undefined;
        if (!IRIS_STATIC_MODE && currentText.length > DYNAMIC_TEXT_LIMIT) {
          setError(
            `No modo dinâmico, a tradução aceita até ${DYNAMIC_TEXT_LIMIT.toLocaleString("pt-BR")} caracteres. Reduza o texto e tente novamente.`,
          );
          setStatus("Texto acima do limite do modo dinâmico");
          lastRequestFailed = true;
        } else {
          setError("");
          setStatus(`Traduzindo para ${targetLabel}…`);
          try {
            const result = await askIrisAdvanced({
              mode: "translate",
              text: `Traduza de ${sourceLabel} (${source}) para ${targetLabel} (${target}). Retorne só tradução.\n${currentText}`,
            });
            const resultText = result.text?.trim() ?? "";
            if (!resultText) throw new Error("O serviço retornou uma tradução vazia.");
            setTranslated(resultText);
            lastRequestFailed = false;
            speak(resultText);
          } catch (translationError) {
            setError(
              errorMessage(translationError, "Não foi possível traduzir agora."),
            );
            setStatus("Tradução indisponível");
            lastRequestFailed = true;
          }
        }
        nextText = voiceQueueRef.current.shift();
      }
    } finally {
      pendingRef.current = false;
      setPending(false);
      if (listeningRef.current) setStatus(`Ouvindo em ${sourceLabel}`);
      else if (!window.speechSynthesis?.speaking)
        setStatus(lastRequestFailed ? "Tradução indisponível" : "Tradução concluída");
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
      setHeard(candidate);
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
    setHeard("");
    setTranslated("");
    setError("");
    voiceTextRef.current = "";
    voiceQueueRef.current = [];
    setStatus(listeningRef.current ? `Ouvindo em ${sourceLabel}` : "Campos limpos");
  };

  const swap = () => {
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
              <select id="interpreter-source-language" value={source} onChange={(event) => setSource(event.target.value as Lang)} disabled={listening || pending}>
                {LANGS.map((language) => <option key={language.code} value={language.code}>{language.flag} {language.label}</option>)}
              </select>
            </div>
            <button className="swap-language" onClick={swap} disabled={listening || pending} aria-label="Inverter idiomas"><RotateCcw size={19} /></button>
            <div className="language-box">
              <label htmlFor="interpreter-target-language">IRIS responde</label>
              <select id="interpreter-target-language" value={target} onChange={(event) => setTarget(event.target.value as Lang)} disabled={listening || pending}>
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
                  setHeard(value);
                  voiceTextRef.current = value;
                  setTranslated("");
                  setError("");
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

          <p id="interpreter-consent-note" className="interpreter-consent-note">
            O texto digitado, colado ou reconhecido pela voz só é enviado à IA quando você seleciona <b>Traduzir</b>. O reconhecimento depende do navegador e pode usar serviços próprios dele.
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

          {!supported && <p className="interpreter-note">Reconhecimento de voz não está disponível neste navegador. Você ainda pode digitar ou colar até {MAX_TEXT_LENGTH.toLocaleString("pt-BR")} caracteres.</p>}
          {error && <p className="interpreter-error" role="alert">{error}</p>}
          <p className="interpreter-note"><Languages size={15} /> Português ↔ Inglês, Espanhol, Francês, Alemão, Chinês e Japonês.</p>
        </section>
      </main>
    </div>
  );
}
