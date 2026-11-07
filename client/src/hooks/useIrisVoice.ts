import { useCallback, useEffect, useRef, useState } from "react";

type RecognitionEvent = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [index: number]: { transcript: string };
    };
  };
};

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type RecognitionConstructor = new () => Recognition;

declare global {
  interface Window {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  }
}

export type IrisVoiceStatus =
  | "unsupported"
  | "idle"
  | "listening"
  | "wake"
  | "conversation"
  | "speaking"
  | "permission"
  | "error";

function getRecognition(): Recognition | null {
  if (typeof window === "undefined") return null;
  const Constructor =
    window.SpeechRecognition ?? window.webkitSpeechRecognition;
  return Constructor ? new Constructor() : null;
}

export function useIrisVoice(options: {
  enabled: boolean;
  wakeWord?: string;
  language?: string;
  onCommand: (command: string) => void;
  onWake?: () => void;
  onTranscript?: (transcript: string, isFinal: boolean) => void;
  onError?: (errorMessage: string) => void;
}) {
  const {
    enabled,
    wakeWord = "iris",
    language = "pt-BR",
    onCommand,
    onWake,
    onTranscript,
    onError,
  } = options;

  const recognitionRef = useRef<Recognition | null>(null);
  const restartingRef = useRef(false);
  const speakingRef = useRef(false);
  const fatalErrorRef = useRef(false);
  const lastFinalRef = useRef({ text: "", at: 0 });
  const conversationRef = useRef(false);
  const conversationTimerRef = useRef<number | null>(null);
  const lastSpokenRef = useRef({ text: "", at: 0 });
  const speechGenerationRef = useRef(0);
  const finalBufferRef = useRef("");
  const finalFlushTimerRef = useRef<number | null>(null);

  const onCommandRef = useRef(onCommand);
  const onWakeRef = useRef(onWake);
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);
  const enabledRef = useRef(enabled);
  const languageRef = useRef(language);
  const wakeWordRef = useRef(wakeWord);

  useEffect(() => {
    onCommandRef.current = onCommand;
    onWakeRef.current = onWake;
    onTranscriptRef.current = onTranscript;
    onErrorRef.current = onError;
  }, [onCommand, onWake, onTranscript, onError]);

  useEffect(() => {
    enabledRef.current = enabled;
    languageRef.current = language;
    wakeWordRef.current = wakeWord;
  }, [enabled, language, wakeWord]);

  const isBrowserSupported =
    typeof window !== "undefined" &&
    Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  const [status, setStatus] = useState<IrisVoiceStatus>(() =>
    isBrowserSupported ? "idle" : "unsupported",
  );

  const clearConversationTimer = useCallback(() => {
    if (conversationTimerRef.current !== null) {
      window.clearTimeout(conversationTimerRef.current);
      conversationTimerRef.current = null;
    }
  }, []);

  const endConversation = useCallback(() => {
    clearConversationTimer();
    conversationRef.current = false;
    if (enabledRef.current && !speakingRef.current) {
      setStatus("listening");
    } else {
      setStatus("idle");
    }
  }, [clearConversationTimer]);

  const refreshConversationTimer = useCallback(() => {
    clearConversationTimer();
    conversationTimerRef.current = window.setTimeout(
      () => endConversation(),
      14_000,
    );
  }, [clearConversationTimer, endConversation]);

  const speak = useCallback(
    (text: string) => {
      if (
        typeof window === "undefined" ||
        !("speechSynthesis" in window) ||
        !text.trim()
      )
        return;
      const normalized = text
        .toLocaleLowerCase("pt-BR")
        .replace(/\s+/g, " ")
        .trim();
      const now = Date.now();
      if (
        lastSpokenRef.current.text === normalized &&
        now - lastSpokenRef.current.at < 12_000
      )
        return;
      lastSpokenRef.current = { text: normalized, at: now };
      const generation = ++speechGenerationRef.current;
      speakingRef.current = true;
      try {
        recognitionRef.current?.stop();
      } catch {
        // Ignora erro ao pausar reconhecimento para falar
      }
      setStatus("speaking");
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text.slice(0, 2500));
      utterance.lang = languageRef.current;
      utterance.rate = 1.05;
      utterance.pitch = 1.0;

      const resumeListening = () => {
        if (generation !== speechGenerationRef.current) return;
        speakingRef.current = false;
        if (enabledRef.current) {
          conversationRef.current = true;
          setStatus("conversation");
          refreshConversationTimer();
          try {
            recognitionRef.current?.start();
          } catch {
            // Navegador pode estar reiniciando
          }
        } else {
          setStatus("idle");
        }
      };

      utterance.onend = resumeListening;
      utterance.onerror = resumeListening;
      window.speechSynthesis.speak(utterance);
    },
    [refreshConversationTimer],
  );

  const start = useCallback(
    (directMode = false) => {
      if (!isBrowserSupported) {
        setStatus("unsupported");
        onErrorRef.current?.(
          "Reconhecimento de voz não suportado neste navegador. Recomendamos o Google Chrome ou Microsoft Edge.",
        );
        return false;
      }

      fatalErrorRef.current = false;
      restartingRef.current = false;
      let recognition = recognitionRef.current;
      if (!recognition) {
        recognition = getRecognition();
        if (!recognition) {
          setStatus("unsupported");
          onErrorRef.current?.(
            "Não foi possível inicializar o motor de reconhecimento de voz.",
          );
          return false;
        }
        recognitionRef.current = recognition;
      }

      if (directMode) {
        conversationRef.current = true;
        refreshConversationTimer();
      }

      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = languageRef.current;

      const flushFinalBuffer = () => {
        if (finalFlushTimerRef.current !== null) {
          window.clearTimeout(finalFlushTimerRef.current);
          finalFlushTimerRef.current = null;
        }
        const transcript = finalBufferRef.current.trim();
        finalBufferRef.current = "";
        if (!transcript || speakingRef.current) return;

        const now = Date.now();
        const normalizedFinal = transcript
          .toLocaleLowerCase("pt-BR")
          .replace(/\s+/g, " ");
        if (
          lastFinalRef.current.text === normalizedFinal &&
          now - lastFinalRef.current.at < 2500
        )
          return;
        lastFinalRef.current = { text: normalizedFinal, at: now };

        const normalized = transcript.toLocaleLowerCase("pt-BR");
        const wake = wakeWordRef.current.toLocaleLowerCase("pt-BR");
        const wakeIndex = normalized.indexOf(wake);
        if (conversationRef.current) {
          const command =
            wakeIndex >= 0
              ? transcript
                  .slice(wakeIndex + wake.length)
                  .replace(/^[,.:;\s-]+/, "")
                  .trim()
              : transcript;
          if (command) {
            onTranscriptRef.current?.(command, true);
            onCommandRef.current(command);
          }
          setStatus("conversation");
          refreshConversationTimer();
          return;
        }
        if (wakeIndex >= 0) {
          const command = transcript
            .slice(wakeIndex + wake.length)
            .replace(/^[,.:;\s-]+/, "")
            .trim();
          conversationRef.current = true;
          setStatus("wake");
          onWakeRef.current?.();
          refreshConversationTimer();
          if (command) {
            onTranscriptRef.current?.(command, true);
            onCommandRef.current(command);
          } else {
            speak("Sim? Estou ouvindo.");
          }
        }
      };

      recognition.onresult = (event: RecognitionEvent) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const item = event.results[i];
          if (!item) continue;
          const piece = item[0]?.transcript ?? "";
          if (item.isFinal) {
            const transcript = piece.trim();
            if (!transcript || speakingRef.current) continue;
            finalBufferRef.current =
              `${finalBufferRef.current} ${transcript}`.trim();
            if (finalFlushTimerRef.current !== null)
              window.clearTimeout(finalFlushTimerRef.current);
            const stopCommand =
              /^(pare|parar|silêncio|silencio|cancele)$/i.test(
                finalBufferRef.current.trim(),
              );
            finalFlushTimerRef.current = window.setTimeout(
              flushFinalBuffer,
              stopCommand ? 80 : 1100,
            );
          } else {
            interim += piece;
          }
        }
        if ((interim || finalBufferRef.current) && !speakingRef.current) {
          onTranscriptRef.current?.(
            `${finalBufferRef.current} ${interim}`.trim(),
            false,
          );
        }
      };

      recognition.onerror = (event: { error: string }) => {
        const err = event.error;
        if (err === "not-allowed" || err === "service-not-allowed") {
          fatalErrorRef.current = true;
          restartingRef.current = true;
          setStatus("permission");
          onErrorRef.current?.(
            "Permissão para usar o microfone não foi concedida.",
          );
        } else if (err === "no-speech") {
          // Pausa momentânea na fala não é erro fatal
        } else if (err === "audio-capture") {
          fatalErrorRef.current = true;
          restartingRef.current = true;
          setStatus("error");
          onErrorRef.current?.(
            "Nenhum microfone encontrado ou dispositivo em uso.",
          );
        } else if (err !== "aborted") {
          if (err === "network") {
            fatalErrorRef.current = true;
            restartingRef.current = true;
          }
          setStatus("error");
          onErrorRef.current?.(`Falha no reconhecimento de voz (${err}).`);
        }
      };

      recognition.onend = () => {
        if (
          !fatalErrorRef.current &&
          !restartingRef.current &&
          enabledRef.current &&
          !speakingRef.current
        ) {
          window.setTimeout(() => {
            if (
              !fatalErrorRef.current &&
              !restartingRef.current &&
              enabledRef.current &&
              !speakingRef.current
            ) {
              try {
                recognitionRef.current?.start();
                setStatus(
                  conversationRef.current ? "conversation" : "listening",
                );
              } catch {
                // Já em execução
              }
            }
          }, 300);
        } else if (!enabledRef.current && !speakingRef.current) {
          setStatus("idle");
        }
      };

      try {
        recognition.start();
        setStatus(directMode ? "conversation" : "listening");
        return true;
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "InvalidStateError") {
          // Já estava ativo; confirma status
          setStatus(directMode ? "conversation" : "listening");
          return true;
        }
        setStatus("permission");
        onErrorRef.current?.("Não foi possível acessar o microfone.");
        return false;
      }
    },
    [isBrowserSupported, refreshConversationTimer, speak],
  );

  const stop = useCallback(() => {
    speechGenerationRef.current += 1;
    lastSpokenRef.current = { text: "", at: 0 };
    restartingRef.current = true;
    speakingRef.current = false;
    conversationRef.current = false;
    clearConversationTimer();
    finalBufferRef.current = "";
    if (finalFlushTimerRef.current !== null) {
      window.clearTimeout(finalFlushTimerRef.current);
      finalFlushTimerRef.current = null;
    }

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    try {
      recognitionRef.current?.stop();
    } catch {
      // Ignora erro ao parar
    }
    setStatus("idle");
    window.setTimeout(() => {
      restartingRef.current = false;
    }, 300);
  }, [clearConversationTimer]);

  useEffect(() => {
    restartingRef.current = false;
    if (!enabled) {
      try {
        recognitionRef.current?.stop();
      } catch {}
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      conversationRef.current = false;
      clearConversationTimer();
      setStatus(isBrowserSupported ? "idle" : "unsupported");
      return;
    }

    start(false);

    return () => {
      restartingRef.current = true;
      clearConversationTimer();
      try {
        recognitionRef.current?.stop();
      } catch {}
    };
  }, [enabled, isBrowserSupported, start, clearConversationTimer]);

  return {
    status,
    start,
    stop,
    speak,
    endConversation,
    supported: isBrowserSupported,
    isListening:
      status === "listening" || status === "conversation" || status === "wake",
  };
}
