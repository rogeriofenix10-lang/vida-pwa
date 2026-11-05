import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Languages, Mic, MicOff, Volume2, VolumeX, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

type Lang = "pt-BR" | "en-US" | "es-ES" | "fr-FR" | "de-DE" | "zh-CN" | "ja-JP";
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
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: any) => void) | null; onend: (() => void) | null; onerror: ((event: any) => void) | null;
  start: () => void; stop: () => void;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const getRecognition = () => {
  const w = window as any;
  return (w.SpeechRecognition || w.webkitSpeechRecognition) as SpeechRecognitionCtor | undefined;
};

export default function Interpreter() {
  const [source, setSource] = useState<Lang>("pt-BR");
  const [target, setTarget] = useState<Lang>("en-US");
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(true);
  const [status, setStatus] = useState("Pronto para interpretar");
  const [heard, setHeard] = useState("");
  const [translated, setTranslated] = useState("");
  const [error, setError] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const translate = trpc.ai.translate.useMutation();

  const sourceLabel = useMemo(() => LANGS.find((l) => l.code === source)?.label ?? source, [source]);
  const targetLabel = useMemo(() => LANGS.find((l) => l.code === target)?.label ?? target, [target]);
  const supported = Boolean(getRecognition());

  useEffect(() => () => { recognitionRef.current?.stop(); window.speechSynthesis?.cancel(); }, []);

  const speak = (text: string) => {
    if (!speaking || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = target;
    utterance.rate = 1;
    utterance.onstart = () => setStatus("Reproduzindo tradução");
    utterance.onend = () => setStatus("Ouvindo novamente");
    window.speechSynthesis.speak(utterance);
  };

  const translateText = async (text: string) => {
    if (!text.trim()) return;
    setError(""); setHeard(text); setStatus(`Traduzindo para ${targetLabel}…`);
    try {
      const result = await translate.mutateAsync({ sourceLanguage: source, targetLanguage: target, text: text.trim() });
      setTranslated(result.translation);
      speak(result.translation);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível traduzir agora.");
      setStatus("Tradução indisponível");
    }
  };

  const start = () => {
    const Ctor = getRecognition();
    if (!Ctor) { setError("Seu navegador não oferece reconhecimento de voz. Você ainda pode usar o campo de texto abaixo."); return; }
    setError("");
    const recognition = new Ctor();
    recognition.lang = source; recognition.continuous = true; recognition.interimResults = true;
    recognition.onresult = (event) => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i]?.[0]?.transcript ?? "";
        if (event.results[i]?.isFinal) finalText += text;
      }
      if (finalText.trim()) void translateText(finalText);
    };
    recognition.onerror = (event) => { setError(`Microfone: ${event?.error ?? "erro desconhecido"}`); setListening(false); setStatus("Microfone parado"); };
    recognition.onend = () => {
      // Browsers may end SpeechRecognition after a pause even with continuous=true.
      // Restart while the user still has the interpreter active.
      if (recognitionRef.current === recognition) {
        try { recognition.start(); setListening(true); setStatus(`Ouvindo em ${sourceLabel}`); return; }
        catch { /* browser ended the session permanently */ }
      }
      setListening(false);
      setStatus("Pronto para interpretar");
    };
    recognitionRef.current = recognition;
    try { recognition.start(); setListening(true); setStatus(`Ouvindo em ${sourceLabel}`); } catch { setError("Não foi possível iniciar o microfone. Verifique a permissão do microfone no navegador."); setListening(false); }
  };

  const stop = () => { recognitionRef.current?.stop(); recognitionRef.current = null; setListening(false); setStatus("Intérprete pausado"); };
  const swap = () => { setSource(target); setTarget(source); setHeard(""); setTranslated(""); setError(""); setStatus("Idiomas invertidos"); };

  return <div className="vida-shell interpreter-shell">
    <header className="topbar"><Link href="/" className="brand-lockup" style={{ textDecoration: "none" }}><span className="brand-mark"><Sparkles size={17} /></span>IRIS</Link><Link href="/" className="outline-action"><ArrowLeft size={15} /> Voltar</Link></header>
    <main className="interpreter-page">
      <div className="eyebrow">IRIS INTERPRETER</div>
      <h1>Tradução <span>voz ↔ voz</span></h1>
      <p className="hero-subtitle">Interpretação bidirecional sob demanda. O processamento de áudio só é ativado quando você iniciar.</p>

      <section className="interpreter-card">
        <div className="language-row">
          <div className="language-box"><label>Você fala</label><select value={source} onChange={(e) => setSource(e.target.value as Lang)} disabled={listening}>{LANGS.map((l) => <option key={l.code} value={l.code}>{l.flag} {l.label}</option>)}</select></div>
          <button className="swap-language" onClick={swap} disabled={listening} aria-label="Inverter idiomas"><RotateCcw size={19} /></button>
          <div className="language-box"><label>IRIS responde</label><select value={target} onChange={(e) => setTarget(e.target.value as Lang)} disabled={listening}>{LANGS.map((l) => <option key={l.code} value={l.code}>{l.flag} {l.label}</option>)}</select></div>
        </div>

        <div className={`interpreter-status ${listening ? "live" : ""}`}><span className="live-dot" />{status}</div>
        <div className="interpreter-panels">
          <div className="speech-panel"><span>{sourceLabel}</span><p>{heard || "Sua fala aparecerá aqui…"}</p></div>
          <div className="speech-panel output"><span>{targetLabel}</span><p>{translated || "A tradução aparecerá aqui…"}</p>{translated && <button className="speak-again" onClick={() => speak(translated)}><Volume2 size={15} /> Ouvir novamente</button>}</div>
        </div>

        <div className="interpreter-controls">
          <Button className={listening ? "interpreter-stop" : "interpreter-start"} onClick={listening ? stop : start} disabled={translate.isPending}>
            {listening ? <><MicOff size={18} /> Parar intérprete</> : <><Mic size={18} /> Ativar intérprete</>}
          </Button>
          <button className={`voice-toggle ${speaking ? "on" : ""}`} onClick={() => setSpeaking((v) => !v)}><VolumeX size={16} /> Voz {speaking ? "ativada" : "desativada"}</button>
        </div>
        {!supported && <p className="interpreter-note">Reconhecimento de voz não está disponível neste navegador. A tradução por texto poderá ser adicionada como fallback.</p>}
        {error && <p className="interpreter-error">{error}</p>}
        <p className="interpreter-note"><Languages size={15} /> 6 pares: Português ↔ Inglês, Espanhol, Francês, Alemão, Chinês e Japonês.</p>
      </section>
    </main>
  </div>;
}
