/**
 * IRIS VOICE PIPELINE & INTEGRATION ENGINE (FASE 11)
 *
 * Arquitetura oficial de comando por voz da IRIS:
 * VOZ
 * ↓
 * RECONHECIMENTO
 * ↓
 * INTERPRETAÇÃO
 * ↓
 * COGNITIVE ENGINE
 * ↓
 * OPERATIONAL ENGINE
 * ↓
 * EXECUÇÃO CONTROLADA
 *
 * REGRAS INVIOLÁVEIS:
 * 1. Voz NÃO é mecanismo de segurança ou autenticação privilegiada.
 * 2. Toda ação protegida (enviar, excluir, alterar, compartilhar, criar) exige autorização
 *    explícita, mesmo que acionada por comando de voz.
 * 3. Suporte aos padrões:
 *    - "IRIS, abrir interface"
 *    - "IRIS, analisar..."
 *    - "IRIS, preparar..."
 *    - "IRIS, organizar..."
 * 4. Tratamento de ambiguidade com pedido de esclarecimento.
 * 5. Cost Guard: custo zero, sem chamadas pagas.
 */

import {
  analyzeCommand,
  interpretOperationalCommand,
  type CognitiveContext,
} from "./irisCognitive";
import {
  runIris6Pipeline,
  type Iris6PipelineInput,
  type Iris6PipelineOutput,
} from "./irisExecutionEngine";
import { isOrchestratorProtectedAction } from "./irisAgentOrchestrator";

export type VoiceCommandCategory =
  | "interface"
  | "analise"
  | "preparacao"
  | "organizacao"
  | "saude"
  | "geral";

export interface VoiceRecognitionResult {
  rawTranscript: string;
  cleanCommand: string;
  wakeWordDetected: boolean;
  confidence: number;
}

export interface VoiceInterpretationResult {
  recognition: VoiceRecognitionResult;
  category: VoiceCommandCategory;
  intent: string;
  actionType: string;
  isAmbiguous: boolean;
  ambiguityReason?: string;
  requiresAuthorization: boolean;
  entities: Record<string, unknown>;
  uiAction?: {
    action: "open_interface" | "open_health" | "open_calendar" | "open_files" | "none";
    viewName?: string;
  };
}

export interface VoiceExecutionResult {
  success: boolean;
  command: string;
  interpretation: VoiceInterpretationResult;
  pipelineOutput?: Iris6PipelineOutput;
  voiceFeedback: string;
  requiresAuthorization: boolean;
  status: "completed" | "awaiting_authorization" | "ambiguous" | "blocked" | "error";
  timestamp: string;
}

/**
 * 1. RECONHECIMENTO: Higieniza o áudio transcrito, detecta a palavra de ativação e remove ruídos
 */
export function recognizeVoiceTranscript(
  rawTranscript: string,
  wakeWord = "iris",
  confidence = 0.95
): VoiceRecognitionResult {
  const trimmed = (rawTranscript || "").trim();
  const lower = trimmed.toLowerCase();

  const wakeWordPattern = new RegExp(`\\b${wakeWord}\\b`, "i");
  const wakeWordDetected = wakeWordPattern.test(lower);

  let cleanCommand = trimmed;
  if (wakeWordDetected) {
    cleanCommand = trimmed
      .replace(new RegExp(`^.*?\\b${wakeWord}\\b[,.:;\\s-]*`, "i"), "")
      .trim();
  }

  return {
    rawTranscript: trimmed,
    cleanCommand: cleanCommand || trimmed,
    wakeWordDetected,
    confidence,
  };
}

/**
 * 2. INTERPRETAÇÃO: Categoriza comando de voz e extrai intenção e ambiguidades
 */
export function interpretVoiceCommand(
  recognition: VoiceRecognitionResult,
  context: CognitiveContext = {}
): VoiceInterpretationResult {
  const cmd = recognition.cleanCommand;
  const lower = cmd.toLowerCase();

  // A. Abertura de Interface
  if (
    /\b(abrir|mostrar|exibir|ir para)\s+(interface|central|dashboard|tela principal|painel)\b/i.test(lower) ||
    lower === "abrir interface" ||
    lower === "interface"
  ) {
    return {
      recognition,
      category: "interface",
      intent: "interface_navigation",
      actionType: "consulta",
      isAmbiguous: false,
      requiresAuthorization: false,
      entities: { target: "interface_principal" },
      uiAction: { action: "open_interface", viewName: "command_center" },
    };
  }

  // A2. Abertura de Saúde
  if (/\b(abrir|mostrar|exibir)\s+(sa[úu]de|central de sa[úu]de|exames)\b/i.test(lower)) {
    return {
      recognition,
      category: "saude",
      intent: "health_navigation",
      actionType: "consulta",
      isAmbiguous: false,
      requiresAuthorization: false,
      entities: { target: "central_saude" },
      uiAction: { action: "open_health", viewName: "health_center" },
    };
  }

  // B. Detecção de Ambiguidade
  const isVagueOrganization = /^(organizar|arrumar|preparar)(\s+coisas|\s+tudo)?$/i.test(lower);
  if (isVagueOrganization) {
    return {
      recognition,
      category: "organizacao",
      intent: "organizacao_vaga",
      actionType: "organizacao",
      isAmbiguous: true,
      ambiguityReason: "Comando ambíguo: informe o que deseja organizar (ex: contas, agenda ou documentos).",
      requiresAuthorization: false,
      entities: {},
    };
  }

  // C. Classificação por categoria
  let category: VoiceCommandCategory = "geral";
  if (/^analis[aeo]r?\b/i.test(lower) || lower.includes("analisar")) {
    category = "analise";
  } else if (/^prepar[aeo]r?\b/i.test(lower) || lower.includes("preparar")) {
    category = "preparacao";
  } else if (/^organiz[aeo]r?\b/i.test(lower) || lower.includes("organizar")) {
    category = "organizacao";
  } else if (lower.includes("saúde") || lower.includes("glicemia") || lower.includes("colesterol") || lower.includes("exame")) {
    category = "saude";
  }

  // D. Motor Cognitivo e Operacional
  const cognitiveAnalysis = analyzeCommand(cmd, context);
  const operationalPlan = interpretOperationalCommand(cmd, context);

  // E. Determinação de Ação Protegida
  const isProtected =
    cognitiveAnalysis.requiresAuthorization ||
    isOrchestratorProtectedAction(cognitiveAnalysis.actionType, cognitiveAnalysis.riskLevel);

  return {
    recognition,
    category,
    intent: cognitiveAnalysis.actionType,
    actionType: cognitiveAnalysis.actionType,
    isAmbiguous: operationalPlan.isAmbiguous,
    ambiguityReason: operationalPlan.clarificationPrompt,
    requiresAuthorization: isProtected,
    entities: operationalPlan.entities.parameters,
  };
}

/**
 * 3. EXECUÇÃO CONTROLADA: Executa o comando de voz no pipeline oficial
 * Garantia absoluta: NUNCA executa ações protegidas sem autorização explícita!
 */
export async function processVoiceCommand(input: {
  transcript: string;
  confidence?: number;
  userId?: number | string;
  sessionId?: string;
  isAuthorized?: boolean;
  authorizationToken?: string;
  context?: CognitiveContext;
}): Promise<VoiceExecutionResult> {
  const recognition = recognizeVoiceTranscript(input.transcript, "iris", input.confidence);
  const interpretation = interpretVoiceCommand(recognition, input.context);

  // 1. Caso de Ambiguidade
  if (interpretation.isAmbiguous) {
    return {
      success: false,
      command: recognition.cleanCommand,
      interpretation,
      voiceFeedback: interpretation.ambiguityReason || "Comando ambíguo. Por favor, forneça mais detalhes.",
      requiresAuthorization: false,
      status: "ambiguous",
      timestamp: new Date().toISOString(),
    };
  }

  // 2. Ação de Interface direta
  if (interpretation.uiAction?.action === "open_interface") {
    return {
      success: true,
      command: recognition.cleanCommand,
      interpretation,
      voiceFeedback: "Interface principal da IRIS aberta.",
      requiresAuthorization: false,
      status: "completed",
      timestamp: new Date().toISOString(),
    };
  }

  if (interpretation.uiAction?.action === "open_health") {
    return {
      success: true,
      command: recognition.cleanCommand,
      interpretation,
      voiceFeedback: "Central de Saúde da IRIS aberta.",
      requiresAuthorization: false,
      status: "completed",
      timestamp: new Date().toISOString(),
    };
  }

  // 3. BARREIRA DE SEGURANÇA: Voz NUNCA concede autorização!
  if (interpretation.requiresAuthorization && !input.isAuthorized) {
    return {
      success: false,
      command: recognition.cleanCommand,
      interpretation,
      voiceFeedback: `Ação protegida identificada (“${interpretation.actionType}”). Por segurança, esta operação exige autorização explícita na tela.`,
      requiresAuthorization: true,
      status: "awaiting_authorization",
      timestamp: new Date().toISOString(),
    };
  }

  // 4. Executar via Pipeline IRIS 6.0
  const pipelineOutput = await runIris6Pipeline({
    command: recognition.cleanCommand,
    userId: input.userId,
    sessionId: input.sessionId,
    isAuthorized: input.isAuthorized,
    authorizationToken: input.authorizationToken,
    cognitiveContext: input.context,
  });

  let voiceFeedback = pipelineOutput.summary;
  if (pipelineOutput.state === "awaiting_authorization") {
    voiceFeedback = `Ação protegida requer sua autorização na tela: ${pipelineOutput.summary}`;
  } else if (pipelineOutput.state === "completed") {
    voiceFeedback = `Comando concluído com sucesso: ${pipelineOutput.summary}`;
  }

  return {
    success: pipelineOutput.success,
    command: recognition.cleanCommand,
    interpretation,
    pipelineOutput,
    voiceFeedback,
    requiresAuthorization: pipelineOutput.requiresAuthorization,
    status: pipelineOutput.state as any,
    timestamp: new Date().toISOString(),
  };
}
