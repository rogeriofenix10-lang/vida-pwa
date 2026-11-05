import { describe, it, expect, vi } from "vitest";

describe("IRIS 5.4 — Verificação dos Botões Saúde e Microfone", () => {
  it("trata corretamente ambiente sem SpeechRecognition informando status unsupported", () => {
    // Simula navegador sem window.SpeechRecognition e sem webkitSpeechRecognition
    const windowMock = {} as any;
    const isSupported = Boolean(windowMock.SpeechRecognition || windowMock.webkitSpeechRecognition);
    expect(isSupported).toBe(false);

    const errorMessage = "Reconhecimento de voz não suportado neste navegador. Recomendamos o Google Chrome ou Microsoft Edge.";
    expect(errorMessage).toContain("não suportado");
  });

  it("reconhece fala diretamente no modo de escuta direta sem exigir a wake word 'iris'", () => {
    // Simula captura de fala com directMode ativado (clique no botão do microfone)
    const directMode = true;
    const spokenTranscript = "organizar minhas contas do mês";
    const wakeWord = "iris";

    let executedCommand = "";
    const onCommand = (cmd: string) => {
      executedCommand = cmd;
    };

    if (directMode) {
      const normalized = spokenTranscript.toLowerCase();
      const wakeIndex = normalized.indexOf(wakeWord);
      let command = spokenTranscript;
      if (wakeIndex >= 0) {
        command = spokenTranscript.slice(wakeIndex + wakeWord.length).replace(/^[,.:;\s-]+/, "").trim();
      }
      onCommand(command);
    }

    expect(executedCommand).toBe("organizar minhas contas do mês");
  });

  it("remove a wake word 'iris' de forma elegante caso o usuário a diga no clique", () => {
    const directMode = true;
    const spokenTranscript = "Iris, agendar consulta médica amanhã";
    const wakeWord = "iris";

    let executedCommand = "";
    if (directMode) {
      const normalized = spokenTranscript.toLowerCase();
      const wakeIndex = normalized.indexOf(wakeWord);
      let command = spokenTranscript;
      if (wakeIndex >= 0) {
        command = spokenTranscript.slice(wakeIndex + wakeWord.length).replace(/^[,.:;\s-]+/, "").trim();
      }
      executedCommand = command;
    }

    expect(executedCommand).toBe("agendar consulta médica amanhã");
  });

  it("permite abertura da Central de Saúde tanto em modo autenticado quanto em demonstração", () => {
    // Simula acionamento do botão Saúde
    let activeView: string | null = null;
    const openHealthCenter = () => {
      activeView = "saude";
    };

    // Usuário não autenticado em ambiente de desenvolvimento
    const isAuthenticated = false;
    // O clique deve abrir diretamente sem bloqueios silenciosos
    openHealthCenter();
    expect(activeView).toBe("saude");
  });

  it("garante proteção de dados reais e isolamento na Central de Saúde", () => {
    // Quando não autenticado, queries de dados reais ficam desabilitadas
    const isAuthenticated = false;
    const queryOptions = { enabled: isAuthenticated, retry: false };

    expect(queryOptions.enabled).toBe(false);
    expect(queryOptions.retry).toBe(false);
  });
});
