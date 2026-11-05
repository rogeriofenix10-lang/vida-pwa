/**
 * TESTES COMPLETOS DA FASE 11 — INTELIGÊNCIA AVANÇADA + VOZ + SAÚDE
 */

import { describe, expect, it } from "vitest";
import {
  IrisContextManager,
} from "./irisContext";
import {
  recognizeVoiceTranscript,
  interpretVoiceCommand,
  processVoiceCommand,
} from "./irisVoice";
import {
  IrisHealthCenter,
  extractHealthMarkersFromText,
  compareMarkersAcrossDates,
} from "./irisHealth";

describe("FASE 11 — CONTEXTO AVANÇADO + VOZ CONTROLADA + CENTRAL DE SAÚDE", () => {
  describe("11.1 Contexto e Continuidade de Tarefas", () => {
    it("preserva entidades e contexto sem permitir concessão de autorizações", () => {
      const context = new IrisContextManager({ userId: 1, sessionId: "sess-1" });

      context.recordEntities({
        targetItem: "Contrato Fornecedor",
        category: "documentos",
      });

      const entities = context.getEntities();
      expect(entities).toBeDefined();
      expect(entities?.targetItem).toBe("Contrato Fornecedor");

      // Regra inviolável: Contexto nunca concede autorização
      expect(context.canGrantAuthorization()).toBe(false);
      expect(context.canExecuteActions()).toBe(false);
    });

    it("isola contextos entre diferentes usuários e sessões", () => {
      const user1 = new IrisContextManager({ userId: 1, sessionId: "sess-1" });
      const user2 = new IrisContextManager({ userId: 2, sessionId: "sess-2" });

      user1.setContext("tema", "escuro", "conversation");
      user2.setContext("tema", "claro", "conversation");

      expect(user1.getContext("tema", "conversation")).toBe("escuro");
      expect(user2.getContext("tema", "conversation")).toBe("claro");
    });
  });

  describe("11.2 Arquitetura de Voz Controlada", () => {
    it("reconhece wake word e extrai comando limpo", () => {
      const res = recognizeVoiceTranscript("IRIS, abrir interface", "iris");
      expect(res.wakeWordDetected).toBe(true);
      expect(res.cleanCommand).toBe("abrir interface");
    });

    it("suporta comando de voz 'IRIS, abrir interface'", async () => {
      const res = await processVoiceCommand({
        transcript: "IRIS, abrir interface",
      });

      expect(res.success).toBe(true);
      expect(res.interpretation.category).toBe("interface");
      expect(res.interpretation.uiAction?.action).toBe("open_interface");
      expect(res.requiresAuthorization).toBe(false);
      expect(res.status).toBe("completed");
    });

    it("suporta comandos 'IRIS, analisar...' e 'IRIS, preparar...'", async () => {
      const analiseRes = await processVoiceCommand({
        transcript: "IRIS, analisar meus compromissos de hoje",
      });
      expect(analiseRes.interpretation.category).toBe("analise");

      const prepRes = await processVoiceCommand({
        transcript: "IRIS, preparar rascunho de e-mail para diretor@empresa.com",
      });
      expect(prepRes.interpretation.category).toBe("preparacao");
    });

    it("identifica comando ambíguo e solicita esclarecimento", async () => {
      const ambiguousRes = await processVoiceCommand({
        transcript: "IRIS, organizar coisas",
      });

      expect(ambiguousRes.success).toBe(false);
      expect(ambiguousRes.status).toBe("ambiguous");
      expect(ambiguousRes.voiceFeedback).toContain("ambíguo");
    });

    it("GARANTIA DE SEGURANÇA: Voz NUNCA substitui autorização em ações protegidas", async () => {
      // Exemplo: comando destrutivo por voz sem autorização na tela
      const deleteVoiceRes = await processVoiceCommand({
        transcript: "IRIS, excluir todas as mensagens antigas",
        isAuthorized: false,
      });

      // A voz NÃO pode autorizar automaticamente!
      expect(deleteVoiceRes.success).toBe(false);
      expect(deleteVoiceRes.requiresAuthorization).toBe(true);
      expect(deleteVoiceRes.status).toBe("awaiting_authorization");
      expect(deleteVoiceRes.voiceFeedback).toContain("autorização");
    });
  });

  describe("11.3 Central de Saúde (IrisHealthCenter)", () => {
    it("extrai e estrutura marcadores clínicos de texto de laudo", () => {
      const reportText = `
        LABORATÓRIO FLEURY
        Data da coleta: 15/05/2026
        
        GLICEMIA DE JEJUM
        Resultado: 92 mg/dL
        Valor de referência: 70 a 99 mg/dL
        
        HEMOGLOBINA GLICADA (HbA1c)
        Resultado: 5.4 %
        Valor de referência: inferior a 5.7%
        
        COLESTEROL TOTAL
        Resultado: 185 mg/dL
        Valor de referência: inferior a 190 mg/dL
        
        COLESTEROL HDL
        Resultado: 52 mg/dL
        Valor de referência: superior a 40 mg/dL
        
        COLESTEROL LDL
        Resultado: 110 mg/dL
        Valor de referência: inferior a 130 mg/dL
        
        TRIGLICERÍDEOS
        Resultado: 115 mg/dL
        Valor de referência: inferior a 150 mg/dL
        
        TSH ULTRA SENSÍVEL
        Resultado: 2.1 µUI/mL
        Valor de referência: 0.45 a 4.5 µUI/mL
      `;

      const extracted = extractHealthMarkersFromText(reportText);
      expect(extracted.laboratory).toContain("FLEURY");
      expect(extracted.markers.length).toBeGreaterThanOrEqual(6);

      const glicemia = extracted.markers.find((m) => m.markerName === "Glicemia de Jejum");
      expect(glicemia).toBeDefined();
      expect(glicemia?.status).toBe("normal");

      const hba1c = extracted.markers.find((m) => m.markerName === "Hemoglobina Glicada (HbA1c)");
      expect(hba1c).toBeDefined();
      expect(hba1c?.status).toBe("normal");
    });

    it("destaca valores fora da faixa de referência sem alarme indevido", () => {
      const reportText = `
        LABORATÓRIO CENTRAL
        Data: 2026-06-10
        COLESTEROL TOTAL
        Resultado: 235 mg/dL
        GLICEMIA DE JEJUM
        Resultado: 112 mg/dL
      `;

      const extracted = extractHealthMarkersFromText(reportText);
      const colTotal = extracted.markers.find((m) => m.markerName === "Colesterol Total");
      const glic = extracted.markers.find((m) => m.markerName === "Glicemia de Jejum");

      expect(colTotal?.status).toBe("alterado");
      expect(glic?.status).toBe("alterado");
    });

    it("compara exames históricos, mostra tendências e calcula delta", () => {
      const markers = [
        {
          id: "m-1",
          category: "glicemia" as const,
          markerName: "Glicemia de Jejum",
          date: "2024-05-10",
          result: "105",
          unit: "mg/dL",
          referenceRange: "70 a 99 mg/dL",
          status: "alterado" as const,
        },
        {
          id: "m-2",
          category: "glicemia" as const,
          markerName: "Glicemia de Jejum",
          date: "2026-05-15",
          result: "92",
          unit: "mg/dL",
          referenceRange: "70 a 99 mg/dL",
          status: "normal" as const,
        },
      ];

      const comp = compareMarkersAcrossDates(markers, "Glicemia de Jejum");
      expect(comp).toBeDefined();
      expect(comp?.trend).toBe("reducao");
      expect(comp?.delta).toBe("-13.0 mg/dL");
      expect(comp?.hasOutOfRange).toBe(true);
    });

    it("executa pipeline completo de documentos: UPLOAD → LEITURA → EXTRAÇÃO → ESTRUTURAÇÃO → HISTÓRICO → INDICADORES", async () => {
      const health = new IrisHealthCenter();

      const result = await health.processHealthDocument({
        fileName: "exame_sangue_2026.pdf",
        fileFormat: "pdf",
        mimeType: "application/pdf",
        fileSizeBytes: 204800,
        rawText: `
          LABORATÓRIO SABIN
          Data da coleta: 10/08/2026
          COLESTEROL TOTAL: 178 mg/dL
          CREATININA: 0.9 mg/dL
        `,
      });

      expect(result.document.status).toBe("processado");
      expect(result.extractedCount).toBeGreaterThanOrEqual(2);
      expect(health.listDocuments().length).toBe(1);
      expect(health.listMarkers().length).toBeGreaterThanOrEqual(2);
    });

    it("registra pressão arterial, medicamentos e peso sob autorização explícita", () => {
      const health = new IrisHealthCenter();

      // Sem autorização -> Bloqueio
      expect(() => {
        health.recordBloodPressure({ systolic: 120, diastolic: 80, pulse: 72, measuredAt: "2026-10-08T08:00:00Z" }, false);
      }).toThrow(/autorização explícita/i);

      expect(() => {
        health.recordMedication({ name: "Vitamina D3", dosage: "2000 UI", frequency: "1x ao dia", type: "suplemento" }, false);
      }).toThrow(/autorização explícita/i);

      // Com autorização -> Sucesso
      const bp = health.recordBloodPressure({ systolic: 120, diastolic: 80, pulse: 72, measuredAt: "2026-10-08T08:00:00Z" }, true);
      expect(bp.systolic).toBe(120);

      const med = health.recordMedication({ name: "Vitamina D3", dosage: "2000 UI", frequency: "1x ao dia", type: "suplemento" }, true);
      expect(med.name).toBe("Vitamina D3");

      const weight = health.recordWeight(75.5, "2026-10-08", true);
      expect(weight.weightKg).toBe(75.5);
    });

    it("DIRETRIZ ÉTICA: NUNCA diagnostica — resume e organiza apenas com aviso médico", () => {
      const health = new IrisHealthCenter();
      expect(health.governance.prohibitedActions.inventDiagnosis).toBe(false);

      const summary = health.generateHealthSummary();
      expect(summary.disclaimer).toContain("não substitui a avaliação do seu médico");
    });
  });
});
