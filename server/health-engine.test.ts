import { describe, expect, it } from "vitest";
import {
  extractMarkersFromText,
  saveExamWithMarkers,
  listUserExams,
  listUserMarkers,
  compareMarkersAcrossDates,
  askIrisHealth,
  saveMedication,
  listMedications,
  saveMeasurement,
  listMeasurements,
  deleteUserExam,
  listHealthAudits,
} from "./health-service";
import { getCostStatus, assertWithinCostLimit, recordAiUsage } from "./cost-control";
import { evaluatePolicy } from "./agent-policy";
import { routeModel, classifyRoutingTask } from "./model-router";

describe("Central de Saúde da IRIS — Ingestão, Extração e Evolução Clínica", () => {
  const userId = 999;

  it("extrai marcadores reais de laudo laboratorial sem inventar dados", () => {
    const rawReport = `
      LABORATÓRIO CENTRAL DE ANÁLISES CLÍNICAS
      Data da Coleta: 15/04/2025
      Paciente: Usuário Teste

      GLICEMIA DE JEJUM
      Resultado: 92 mg/dL
      Valores de Referência: 70 a 99 mg/dL

      HEMOGLOBINA GLICADA (HbA1c)
      Resultado: 5.4 %
      Valores de Referência: < 5.7%

      COLESTEROL TOTAL
      Resultado: 211 mg/dL
      Valores de Referência: < 190 mg/dL

      COLESTEROL HDL
      Resultado: 48 mg/dL
      Valores de Referência: > 40 mg/dL

      COLESTEROL LDL
      Resultado: 138 mg/dL
      Valores de Referência: < 130 mg/dL

      TRIGLICERÍDEOS
      Resultado: 125 mg/dL
      Valores de Referência: < 150 mg/dL

      TSH ULTRA SENSÍVEL
      Resultado: 2.15 µUI/mL
      Valores de Referência: 0.45 a 4.5 µUI/mL
    `;

    const { markers, examDate, lab } = extractMarkersFromText(rawReport);

    expect(examDate).toBe("2025-04-15");
    expect(lab).toContain("CENTRAL DE ANÁLISES CLÍNICAS");
    expect(markers.length).toBeGreaterThanOrEqual(6);

    const colTotal = markers.find((m) => m.markerName === "Colesterol Total");
    expect(colTotal).toBeDefined();
    expect(colTotal?.result).toBe("211");
    expect(colTotal?.numericValue).toBe(211);
    expect(colTotal?.unit).toBe("mg/dL");
    expect(colTotal?.status).toBe("alterado"); // 211 > 190

    const glicemia = markers.find((m) => m.markerName === "Glicemia de Jejum");
    expect(glicemia).toBeDefined();
    expect(glicemia?.result).toBe("92");
    expect(glicemia?.status).toBe("normal");
  });

  it("armazena exames e marcadores estruturados de diferentes anos e permite comparação temporal", async () => {
    // Ano 2024
    await saveExamWithMarkers(userId, {
      fileName: "exame_2024.pdf",
      fileFormat: "pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      examDate: "2024-05-10",
      laboratory: "Laboratório 2024",
      markers: [
        {
          category: "perfil_lipidico",
          markerName: "Colesterol Total",
          examDate: "2024-05-10",
          result: "198",
          numericValue: 198,
          unit: "mg/dL",
          referenceRange: "< 190 mg/dL",
          status: "alterado",
        },
        {
          category: "glicemia",
          markerName: "Glicemia de Jejum",
          examDate: "2024-05-10",
          result: "88",
          numericValue: 88,
          unit: "mg/dL",
          referenceRange: "70 a 99 mg/dL",
          status: "normal",
        },
      ],
    });

    // Ano 2025
    await saveExamWithMarkers(userId, {
      fileName: "exame_2025.jpg",
      fileFormat: "jpg",
      mimeType: "image/jpeg",
      sizeBytes: 2048,
      examDate: "2025-05-10",
      laboratory: "Laboratório 2025",
      markers: [
        {
          category: "perfil_lipidico",
          markerName: "Colesterol Total",
          examDate: "2025-05-10",
          result: "211",
          numericValue: 211,
          unit: "mg/dL",
          referenceRange: "< 190 mg/dL",
          status: "alterado",
        },
        {
          category: "glicemia",
          markerName: "Glicemia de Jejum",
          examDate: "2025-05-10",
          result: "92",
          numericValue: 92,
          unit: "mg/dL",
          referenceRange: "70 a 99 mg/dL",
          status: "normal",
        },
      ],
    });

    // Ano 2026
    await saveExamWithMarkers(userId, {
      fileName: "exame_2026.png",
      fileFormat: "png",
      mimeType: "image/png",
      sizeBytes: 3072,
      examDate: "2026-05-10",
      laboratory: "Laboratório 2026",
      markers: [
        {
          category: "perfil_lipidico",
          markerName: "Colesterol Total",
          examDate: "2026-05-10",
          result: "226",
          numericValue: 226,
          unit: "mg/dL",
          referenceRange: "< 190 mg/dL",
          status: "alterado",
        },
        {
          category: "glicemia",
          markerName: "Glicemia de Jejum",
          examDate: "2026-05-10",
          result: "95",
          numericValue: 95,
          unit: "mg/dL",
          referenceRange: "70 a 99 mg/dL",
          status: "normal",
        },
      ],
    });

    const exams = await listUserExams(userId);
    expect(exams.length).toBeGreaterThanOrEqual(3);

    const comparison = await compareMarkersAcrossDates(userId, ["Colesterol Total"]);
    expect(comparison.length).toBe(1);

    const colRow = comparison[0];
    expect(colRow.markerName).toBe("Colesterol Total");
    expect(colRow.measurements.length).toBe(3);
    expect(colRow.measurements.map((m) => m.result)).toEqual(["198", "211", "226"]);
    expect(colRow.trend).toBe("aumento");
    expect(colRow.delta).toBe("+28.0");
    expect(colRow.alert).toBe(true);
  });

  it("responde em linguagem natural à pergunta 'IRIS, compare meus últimos 3 exames' com tabela e sem diagnóstico automático", async () => {
    const response = await askIrisHealth(userId, "IRIS, compare meus últimos 3 exames.");

    expect(response.reply).toContain("Tabela Comparativa de Exames");
    expect(response.reply).toContain("Colesterol Total");
    expect(response.reply).toContain("198");
    expect(response.reply).toContain("211");
    expect(response.reply).toContain("226");
    expect(response.reply).toContain("elevação");

    // Diretriz ética obrigatória: sem diagnóstico automático
    expect(response.disclaimer).toContain("Aviso Importante");
    expect(response.disclaimer).toContain("não formula diagnósticos médicos");
    expect(response.disclaimer).toContain("consulta médica");
    expect(response.reply).toContain("médico de confiança");
  });

  it("permite exclusão autorizada de exames com registro de auditoria", async () => {
    const examsBefore = await listUserExams(userId);
    const targetExam = examsBefore[0];

    const delResult = await deleteUserExam(userId, targetExam.id);
    expect(delResult.success).toBe(true);

    const audits = await listHealthAudits(userId);
    const delAudit = audits.find((a) => a.action === "excluir_exame");
    expect(delAudit).toBeDefined();
    expect(delAudit?.alteredData).toBe(true);
  });

  it("persiste medições vitais e medicamentos", async () => {
    const med = await saveMedication(userId, {
      name: "Omega 3",
      dosage: "1000mg",
      frequency: "1x ao dia",
      type: "suplemento",
    });
    expect(med.id).toBeGreaterThan(0);

    const meds = await listMedications(userId);
    expect(meds.some((m) => m.name === "Omega 3")).toBe(true);

    const meas = await saveMeasurement(userId, {
      type: "pressao_arterial",
      value: "120/80",
      unit: "mmHg",
    });
    expect(meas.id).toBeGreaterThan(0);

    const measurements = await listMeasurements(userId, "pressao_arterial");
    expect(measurements[0].value).toBe("120/80");
  });
});

describe("Controle de Custos e Governança Financeira", () => {
  it("inicia em custo zero com limite de R$ 100,00 e sem cobrança automática", () => {
    const status = getCostStatus();
    expect(status.limitBrl).toBe(100.0);
    expect(status.automaticBillingEnabled).toBe(false);
    expect(status.status).toBe("Dentro do limite");
  });

  it("bloqueia operações que ultrapassem o limite configurado", () => {
    expect(() => assertWithinCostLimit(50.0)).not.toThrow();
    expect(() => assertWithinCostLimit(105.0)).toThrow(/Operação bloqueada por governança de custos/);
  });
});

describe("Núcleo de Inteligência e Política Operacional", () => {
  it("diferencia INFORMAR, ANALISAR e PEDIR_AUTORIZACAO para ações executáveis", () => {
    // 1. Informar / Responder pergunta simples
    const infoPolicy = evaluatePolicy({
      intent: "Que horas são?",
      objective: "Saber o horário",
      entities: [],
      missingInformation: [],
      confidence: 0.95,
      riskLevel: "low",
      requiresAuthorization: false,
    });
    expect(infoPolicy.decision).toBe("respond");
    expect(infoPolicy.requiresExplicitAuthorization).toBe(false);
    expect(infoPolicy.interactionMode).toBe("INFORMAR");

    // 2. Analisar laudos ou tendências
    const analysisPolicy = evaluatePolicy({
      intent: "analisar histórico de exames",
      objective: "comparar exames clínicos",
      entities: ["exame"],
      missingInformation: [],
      confidence: 0.9,
      riskLevel: "low",
      requiresAuthorization: false,
    });
    expect(analysisPolicy.decision).toBe("respond");
    expect(analysisPolicy.interactionMode).toBe("ANALISAR");

    // 3. Modificar ou mover dados -> Exige autorização explícita!
    const modifyPolicy = evaluatePolicy({
      intent: "organizar meus documentos e apagar temporários",
      objective: "organizar e excluir",
      entities: [],
      missingInformation: [],
      confidence: 0.9,
      riskLevel: "medium",
      requiresAuthorization: true,
      organizesData: true,
    });
    expect(modifyPolicy.decision).toBe("propose");
    expect(modifyPolicy.requiresExplicitAuthorization).toBe(true);
    expect(modifyPolicy.interactionMode).toBe("PEDIR_AUTORIZACAO");
  });
});

describe("Model Router — Roteamento Inteligente", () => {
  it("classifica tarefas simples para modelo rápido e tarefas sensíveis para modelo robusto com confirmação", () => {
    const simpleTask = classifyRoutingTask({ message: "Bom dia, tudo bem?", hasAttachments: false });
    expect(simpleTask).toBe("simple_query");
    const simpleRoute = routeModel({ requested: "auto", task: simpleTask, hasAttachments: false, externalConsent: true });
    expect(simpleRoute.tier).toBe("fast");
    expect(simpleRoute.requiresConfirmation).toBe(false);

    const sensitiveTask = classifyRoutingTask({ message: "Por favor autorizar e realizar pagamento de boleto", hasAttachments: false });
    expect(sensitiveTask).toBe("sensitive_task");
    const sensitiveRoute = routeModel({ requested: "auto", task: sensitiveTask, hasAttachments: false, externalConsent: true });
    expect(sensitiveRoute.tier).toBe("sensitive_confirmed");
    expect(sensitiveRoute.requiresConfirmation).toBe(true);

    const codeTask = classifyRoutingTask({ message: "Escreva uma função TypeScript para conectar na API", hasAttachments: false });
    expect(codeTask).toBe("complex_code");

    const docTask = classifyRoutingTask({ message: "Analise o laudo em PDF em anexo", hasAttachments: false });
    expect(docTask).toBe("large_document");
  });
});
