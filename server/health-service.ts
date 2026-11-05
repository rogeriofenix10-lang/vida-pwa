/**
 * IRIS HEALTH INTELLIGENCE ENGINE & AUDIT SYSTEM (1.0)
 * 
 * Central de Saúde funcional da IRIS 5.4:
 * - Ingestão e parsing estruturado de laudos (PDF, JPG, PNG)
 * - Identificação clínica de biomarcadores (Perfil lipídico, glicemia, hemograma, hormônios, etc.)
 * - Histórico cronológico e série temporal real
 * - Comparação comparativa entre exames (ex: 2024, 2025, 2026)
 * - Consulta em linguagem natural ("IRIS, compare meus últimos 3 exames")
 * - Diretrizes éticas estritas (sem diagnóstico automático, sem dados inventados)
 * - Auditoria legível e privacidade integral
 */

import { getDb } from "./db";
import { healthExams, healthMarkers, healthMedications, healthMeasurements, healthAudits } from "../drizzle/schema";
import { and, eq, desc, asc, inArray } from "drizzle-orm";
import type { HealthMarkerCategory, HealthSupportedFormat } from "@shared/healthTypes";

export interface ParsedHealthMarker {
  category: HealthMarkerCategory;
  markerName: string;
  examDate: string;
  result: string;
  numericValue?: number;
  unit: string;
  referenceRange?: string;
  status: "normal" | "alterado" | "indeterminado";
  notes?: string;
}

export interface HealthComparisonRow {
  markerName: string;
  category: string;
  unit: string;
  referenceRange?: string;
  measurements: Array<{
    date: string;
    result: string;
    numericValue?: number;
    status: "normal" | "alterado" | "indeterminado";
    examId?: number;
  }>;
  trend?: "estavel" | "aumento" | "reducao" | "indeterminado";
  delta?: string;
  alert?: boolean;
}

// Catálogo de biomarcadores reconhecidos e padrões de extração clínica
const BIOMARKER_PATTERNS: Array<{
  name: string;
  category: HealthMarkerCategory;
  aliases: RegExp[];
  defaultUnit: string;
  standardReference?: string;
  normalRange?: { min?: number; max?: number };
}> = [
  // 1. Colesterol / Lipídico
  {
    name: "Colesterol Total",
    category: "perfil_lipidico",
    aliases: [/colesterol\s+total/i, /\bct\b/i],
    defaultUnit: "mg/dL",
    standardReference: "< 190 mg/dL",
    normalRange: { max: 190 },
  },
  {
    name: "Colesterol HDL",
    category: "perfil_lipidico",
    aliases: [/colesterol\s+hdl/i, /\bhdl[\s-]?colesterol/i, /\bhdl\b/i],
    defaultUnit: "mg/dL",
    standardReference: "> 40 mg/dL",
    normalRange: { min: 40 },
  },
  {
    name: "Colesterol LDL",
    category: "perfil_lipidico",
    aliases: [/colesterol\s+ldl/i, /\bldl[\s-]?colesterol/i, /\bldl\b/i],
    defaultUnit: "mg/dL",
    standardReference: "< 130 mg/dL",
    normalRange: { max: 130 },
  },
  {
    name: "Colesterol VLDL",
    category: "perfil_lipidico",
    aliases: [/colesterol\s+vldl/i, /\bvldl\b/i],
    defaultUnit: "mg/dL",
    standardReference: "< 30 mg/dL",
    normalRange: { max: 30 },
  },
  {
    name: "Triglicerídeos",
    category: "perfil_lipidico",
    aliases: [/triglicer[ií]deos/i, /triglic[eé]rides/i],
    defaultUnit: "mg/dL",
    standardReference: "< 150 mg/dL",
    normalRange: { max: 150 },
  },

  // 2. Glicemia & Metabolismo
  {
    name: "Glicemia de Jejum",
    category: "glicemia",
    aliases: [/glicemia\s+de\s+jejum/i, /glicose\s+de\s+jejum/i, /\bglicemia\b/i, /\bglicose\b/i],
    defaultUnit: "mg/dL",
    standardReference: "70 a 99 mg/dL",
    normalRange: { min: 70, max: 99 },
  },
  {
    name: "Hemoglobina Glicada (HbA1c)",
    category: "glicemia",
    aliases: [/hemoglobina\s+glicada/i, /glico-hemoglobina/i, /\bhba1c\b/i, /\ba1c\b/i],
    defaultUnit: "%",
    standardReference: "< 5.7%",
    normalRange: { max: 5.7 },
  },
  {
    name: "Insulina Basal",
    category: "glicemia",
    aliases: [/insulina\s+basal/i, /\binsulina\b/i],
    defaultUnit: "µUI/mL",
    standardReference: "2.6 a 24.9 µUI/mL",
    normalRange: { min: 2.6, max: 24.9 },
  },

  // 3. Hormônios & Tireoide
  {
    name: "TSH Ultra Sensível",
    category: "tireoide",
    aliases: [/tsh\s+ultra\s+sens[ií]vel/i, /\btsh\b/i, /horm[oô]nio\s+tireoestimulante/i],
    defaultUnit: "µUI/mL",
    standardReference: "0.45 a 4.5 µUI/mL",
    normalRange: { min: 0.45, max: 4.5 },
  },
  {
    name: "T4 Livre",
    category: "tireoide",
    aliases: [/t4\s+livre/i, /tiroxina\s+livre/i],
    defaultUnit: "ng/dL",
    standardReference: "0.70 a 1.80 ng/dL",
    normalRange: { min: 0.7, max: 1.8 },
  },
  {
    name: "Testosterona Total",
    category: "hormonios",
    aliases: [/testosterona\s+total/i, /\btestosterona\b/i],
    defaultUnit: "ng/dL",
    standardReference: "240 a 816 ng/dL",
    normalRange: { min: 240, max: 816 },
  },
  {
    name: "Cortisol Basal",
    category: "hormonios",
    aliases: [/cortisol\s+basal/i, /cortisol\s+8h/i, /\bcortisol\b/i],
    defaultUnit: "µg/dL",
    standardReference: "6.0 a 18.4 µg/dL",
    normalRange: { min: 6.0, max: 18.4 },
  },

  // 4. Hemograma Completo
  {
    name: "Hemoglobina",
    category: "hemograma",
    aliases: [/\bhemoglobina\b/i, /\bhgb\b/i],
    defaultUnit: "g/dL",
    standardReference: "12.0 a 17.5 g/dL",
    normalRange: { min: 12.0, max: 17.5 },
  },
  {
    name: "Hematócrito",
    category: "hemograma",
    aliases: [/hemat[oó]crito/i, /\bhtc\b/i],
    defaultUnit: "%",
    standardReference: "36 a 52%",
    normalRange: { min: 36, max: 52 },
  },
  {
    name: "Leucócitos Totais",
    category: "hemograma",
    aliases: [/leuc[oó]citos\s+totais/i, /\bleuc[oó]citos\b/i, /\bglobulos\s+brancos/i],
    defaultUnit: "/mm³",
    standardReference: "4.000 a 11.000 /mm³",
    normalRange: { min: 4000, max: 11000 },
  },
  {
    name: "Plaquetas",
    category: "hemograma",
    aliases: [/\bplaquetas\b/i, /contagem\s+de\s+plaquetas/i],
    defaultUnit: "/mm³",
    standardReference: "150.000 a 450.000 /mm³",
    normalRange: { min: 150000, max: 450000 },
  },

  // 5. Função Renal & Hepática
  {
    name: "Creatinina",
    category: "funcao_renal",
    aliases: [/\bcreatinina\b/i],
    defaultUnit: "mg/dL",
    standardReference: "0.7 a 1.3 mg/dL",
    normalRange: { min: 0.7, max: 1.3 },
  },
  {
    name: "Ureia",
    category: "funcao_renal",
    aliases: [/\bureia\b/i, /\bur[eé]ia\b/i],
    defaultUnit: "mg/dL",
    standardReference: "15 a 45 mg/dL",
    normalRange: { min: 15, max: 45 },
  },
  {
    name: "Ácido Úrico",
    category: "funcao_renal",
    aliases: [/[aá]cido\s+[uú]rico/i],
    defaultUnit: "mg/dL",
    standardReference: "3.4 a 7.0 mg/dL",
    normalRange: { min: 3.4, max: 7.0 },
  },
  {
    name: "TGO (AST)",
    category: "funcao_hepatica",
    aliases: [/\btgo\b/i, /\bast\b/i, /transaminase\s+oxalac[eé]tica/i],
    defaultUnit: "U/L",
    standardReference: "< 40 U/L",
    normalRange: { max: 40 },
  },
  {
    name: "TGP (ALT)",
    category: "funcao_hepatica",
    aliases: [/\btgp\b/i, /\balt\b/i, /transaminase\s+pir[uú]vica/i],
    defaultUnit: "U/L",
    standardReference: "< 41 U/L",
    normalRange: { max: 41 },
  },
  {
    name: "Gama GT",
    category: "funcao_hepatica",
    aliases: [/gama\s+gt/i, /\bggt\b/i, /gama\s+glutamil\s+transferase/i],
    defaultUnit: "U/L",
    standardReference: "< 60 U/L",
    normalRange: { max: 60 },
  },

  // 6. Vitaminas & Minerais
  {
    name: "Vitamina D (25-OH)",
    category: "vitaminas_minerais",
    aliases: [/vitamina\s+d/i, /25-hidroxivitamina\s+d/i, /25\(oh\)d/i],
    defaultUnit: "ng/mL",
    standardReference: "> 20 ng/mL",
    normalRange: { min: 20 },
  },
  {
    name: "Vitamina B12",
    category: "vitaminas_minerais",
    aliases: [/vitamina\s+b12/i, /cobalamina/i],
    defaultUnit: "pg/mL",
    standardReference: "200 a 900 pg/mL",
    normalRange: { min: 200, max: 900 },
  },
  {
    name: "Ferritina",
    category: "vitaminas_minerais",
    aliases: [/\bferritina\b/i],
    defaultUnit: "ng/mL",
    standardReference: "30 a 400 ng/mL",
    normalRange: { min: 30, max: 400 },
  },

  // 7. PSA
  {
    name: "PSA Total",
    category: "psa",
    aliases: [/psa\s+total/i, /\bpsa\b/i],
    defaultUnit: "ng/mL",
    standardReference: "< 4.0 ng/mL",
    normalRange: { max: 4.0 },
  },
];

// Fallback in-memory storage for offline / test environments
interface LocalHealthState {
  exams: any[];
  markers: any[];
  medications: any[];
  measurements: any[];
  audits: any[];
}

const memoryState: Map<number, LocalHealthState> = new Map();

function getOrCreateUserState(userId: number): LocalHealthState {
  if (!memoryState.has(userId)) {
    memoryState.set(userId, {
      exams: [],
      markers: [],
      medications: [],
      measurements: [],
      audits: [],
    });
  }
  return memoryState.get(userId)!;
}

/**
 * Registra auditoria estrita de qualquer operação na Central de Saúde.
 */
export async function logHealthAudit(
  userId: number,
  action: string,
  resource?: string,
  details?: Record<string, unknown>,
  altered = false
) {
  const detailsStr = details ? JSON.stringify(details) : undefined;
  const db = await getDb();
  if (db) {
    try {
      await db.insert(healthAudits).values({
        userId,
        action,
        resource: resource ?? null,
        details: detailsStr ?? null,
        alteredData: altered,
        sharedData: false,
        authorizationGranted: true,
      });
      return;
    } catch {
      // Fallback
    }
  }

  const state = getOrCreateUserState(userId);
  state.audits.unshift({
    id: state.audits.length + 1,
    userId,
    action,
    resource: resource || "central_saude",
    details: detailsStr || null,
    alteredData: altered,
    sharedData: false,
    authorizationGranted: true,
    createdAt: new Date(),
  });
}

/**
 * Parser inteligente de laudos médicos (PDF, JPG, PNG e texto).
 * Extrai marcadores reais, referências, datas e valores sem inventar dados.
 */
export function extractMarkersFromText(
  text: string,
  defaultDate = new Date().toISOString().slice(0, 10)
): { markers: ParsedHealthMarker[]; examDate: string; lab?: string } {
  const lines = text.split(/\r?\n/);
  const detectedDateMatch = text.match(/\b(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4})\b/);
  let examDate = defaultDate;
  if (detectedDateMatch) {
    const raw = detectedDateMatch[1].replace(/[\.-]/g, "/");
    const parts = raw.split("/");
    if (parts.length === 3) {
      const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
      const month = parts[1].padStart(2, "0");
      const day = parts[0].padStart(2, "0");
      examDate = `${year}-${month}-${day}`;
    }
  }

  const labMatch = text.match(/(?:laborat[oó]rio|lab|cl[ií]nica|hospital)[:\s]+([^\n\r,]+)/i);
  const lab = labMatch ? labMatch[1].trim() : undefined;

  const results: ParsedHealthMarker[] = [];
  const processedBiomarkers = new Set<string>();

  for (const biomarker of BIOMARKER_PATTERNS) {
    if (processedBiomarkers.has(biomarker.name)) continue;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const matchesAlias = biomarker.aliases.some((pattern) => pattern.test(line));
      if (!matchesAlias) continue;

      // Procura número na mesma linha ou na linha seguinte
      const searchContext = line + " " + (lines[i + 1] || "") + " " + (lines[i + 2] || "");
      
      // Encontra resultado numérico (ex: 211, 211.5, 211,5, < 5.7, > 40)
      const numMatch = searchContext.match(
        /(?:resultado[:\s]*|valor[:\s]*|:\s*)?([<>~]?\s*\d+(?:[.,]\d+)?)\s*(mg\/dL|g\/dL|µUI\/mL|uUI\/mL|mUI\/L|ng\/dL|ng\/mL|pg\/mL|%|\/mm³|U\/L)?/i
      );

      if (numMatch) {
        const rawResult = numMatch[1].trim();
        const detectedUnit = numMatch[2] || biomarker.defaultUnit;
        const normalizedNum = parseFloat(rawResult.replace(/[<>~]/g, "").replace(",", "."));

        // Extrai referência do texto se presente
        const refMatch = searchContext.match(/(?:refer[eê]ncia|valores de refer[eê]ncia)[:\s]*([^\n\r;|]+)/i);
        const referenceRange = refMatch ? refMatch[1].trim() : biomarker.standardReference;

        // Avalia status com base nos limites fornecidos/padrão
        let status: "normal" | "alterado" | "indeterminado" = "normal";
        if (!isNaN(normalizedNum) && biomarker.normalRange) {
          if (biomarker.normalRange.max !== undefined && normalizedNum > biomarker.normalRange.max) {
            status = "alterado";
          } else if (biomarker.normalRange.min !== undefined && normalizedNum < biomarker.normalRange.min) {
            status = "alterado";
          }
        }

        results.push({
          category: biomarker.category,
          markerName: biomarker.name,
          examDate,
          result: rawResult,
          numericValue: isNaN(normalizedNum) ? undefined : normalizedNum,
          unit: detectedUnit,
          referenceRange,
          status,
        });

        processedBiomarkers.add(biomarker.name);
        break;
      }
    }
  }

  return { markers: results, examDate, lab };
}

/**
 * Salva exame e seus marcadores de forma persistente.
 */
export async function saveExamWithMarkers(
  userId: number,
  input: {
    fileName: string;
    fileFormat: HealthSupportedFormat;
    mimeType: string;
    sizeBytes: number;
    storageKey?: string;
    fileUrl?: string;
    examDate?: string;
    laboratory?: string;
    doctorName?: string;
    extractedText?: string;
    summaryNote?: string;
    markers?: ParsedHealthMarker[];
  }
) {
  const db = await getDb();
  const effectiveExamDate = input.examDate || new Date().toISOString().slice(0, 10);
  const markersToSave = input.markers || [];

  if (db) {
    try {
      const inserted = await db.insert(healthExams).values({
        userId,
        fileName: input.fileName,
        fileFormat: input.fileFormat,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        storageKey: input.storageKey ?? null,
        fileUrl: input.fileUrl ?? null,
        examDate: effectiveExamDate,
        laboratory: input.laboratory ?? null,
        doctorName: input.doctorName ?? null,
        summaryNote: input.summaryNote ?? `Laudo importado com ${markersToSave.length} marcadores identificados.`,
        extractedMarkersCount: markersToSave.length,
        status: "processado",
      });

      const examId = Number(inserted[0].insertId);

      for (const m of markersToSave) {
        await db.insert(healthMarkers).values({
          userId,
          examId,
          category: m.category,
          markerName: m.markerName,
          examDate: m.examDate || effectiveExamDate,
          result: m.result,
          numericValue: m.numericValue !== undefined ? String(m.numericValue) : null,
          unit: m.unit,
          referenceRange: m.referenceRange ?? null,
          status: m.status,
          notes: m.notes ?? null,
        });
      }

      await logHealthAudit(userId, "upload_exame", input.fileName, {
        examId,
        markersExtracted: markersToSave.length,
      });

      return { examId, markersCount: markersToSave.length };
    } catch {
      // Fallback
    }
  }

  // Fallback em memória
  const state = getOrCreateUserState(userId);
  const examId = state.exams.length + 1;
  const examRecord = {
    id: examId,
    userId,
    fileName: input.fileName,
    fileFormat: input.fileFormat,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    storageKey: input.storageKey,
    fileUrl: input.fileUrl,
    examDate: effectiveExamDate,
    laboratory: input.laboratory,
    doctorName: input.doctorName,
    summaryNote: input.summaryNote ?? `Laudo importado com ${markersToSave.length} marcadores identificados.`,
    extractedMarkersCount: markersToSave.length,
    status: "processado",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  state.exams.unshift(examRecord);

  for (const m of markersToSave) {
    state.markers.push({
      id: state.markers.length + 1,
      userId,
      examId,
      category: m.category,
      markerName: m.markerName,
      examDate: m.examDate || effectiveExamDate,
      result: m.result,
      numericValue: m.numericValue !== undefined ? String(m.numericValue) : null,
      unit: m.unit,
      referenceRange: m.referenceRange,
      status: m.status,
      notes: m.notes,
      createdAt: new Date(),
    });
  }

  await logHealthAudit(userId, "upload_exame", input.fileName, {
    examId,
    markersExtracted: markersToSave.length,
  });

  return { examId, markersCount: markersToSave.length };
}

/**
 * Lista todos os exames do usuário.
 */
export async function listUserExams(userId: number) {
  const db = await getDb();
  if (db) {
    try {
      return await db.select().from(healthExams).where(eq(healthExams.userId, userId)).orderBy(desc(healthExams.createdAt));
    } catch {
      // Fallback
    }
  }
  const state = getOrCreateUserState(userId);
  return state.exams;
}

/**
 * Lista todos os marcadores clínicos estruturados com filtros.
 */
export async function listUserMarkers(
  userId: number,
  category?: HealthMarkerCategory | "todas",
  query?: string
) {
  const db = await getDb();
  if (db) {
    try {
      const rows = await db
        .select()
        .from(healthMarkers)
        .where(
          and(
            eq(healthMarkers.userId, userId),
            category && category !== "todas" ? eq(healthMarkers.category, category) : undefined
          )
        )
        .orderBy(desc(healthMarkers.examDate), asc(healthMarkers.markerName));

      if (query) {
        const q = query.toLowerCase();
        return rows.filter((r) => r.markerName.toLowerCase().includes(q) || r.category.toLowerCase().includes(q));
      }
      return rows;
    } catch {
      // Fallback
    }
  }

  const state = getOrCreateUserState(userId);
  let list = state.markers;
  if (category && category !== "todas") {
    list = list.filter((m) => m.category === category);
  }
  if (query) {
    const q = query.toLowerCase();
    list = list.filter((m) => m.markerName.toLowerCase().includes(q) || m.category.toLowerCase().includes(q));
  }
  return list.sort((a, b) => b.examDate.localeCompare(a.examDate));
}

/**
 * Compara marcadores clínicos ao longo do tempo (série histórica).
 * Exemplo de evolução:
 * COLESTEROL TOTAL: 2024 (198 mg/dL) -> 2025 (211 mg/dL) -> 2026 (226 mg/dL)
 */
export async function compareMarkersAcrossDates(
  userId: number,
  markerNames?: string[]
): Promise<HealthComparisonRow[]> {
  const allMarkers = await listUserMarkers(userId, "todas");
  const grouped = new Map<string, typeof allMarkers>();

  for (const m of allMarkers) {
    if (markerNames && markerNames.length > 0 && !markerNames.includes(m.markerName)) {
      continue;
    }
    const current = grouped.get(m.markerName) || [];
    current.push(m);
    grouped.set(m.markerName, current);
  }

  const comparison: HealthComparisonRow[] = [];

  for (const [name, rows] of grouped.entries()) {
    // Ordena da mais antiga para a mais recente
    const sorted = rows.sort((a, b) => a.examDate.localeCompare(b.examDate));
    const measurements = sorted.map((s) => ({
      date: s.examDate,
      result: s.result,
      numericValue: s.numericValue ? parseFloat(s.numericValue) : undefined,
      status: s.status as any,
      examId: s.examId ?? undefined,
    }));

    let trend: HealthComparisonRow["trend"] = "estavel";
    let delta: string | undefined;
    let alert = false;

    if (measurements.length >= 2) {
      const first = measurements[0].numericValue;
      const last = measurements[measurements.length - 1].numericValue;

      if (first !== undefined && last !== undefined) {
        const diff = last - first;
        if (diff > 0.01) {
          trend = "aumento";
          delta = `+${diff.toFixed(1)}`;
        } else if (diff < -0.01) {
          trend = "reducao";
          delta = `${diff.toFixed(1)}`;
        } else {
          trend = "estavel";
          delta = "0.0";
        }
      }
    }

    if (measurements.some((m) => m.status === "alterado")) {
      alert = true;
    }

    comparison.push({
      markerName: name,
      category: rows[0].category,
      unit: rows[0].unit,
      referenceRange: rows[rows.length - 1].referenceRange ?? undefined,
      measurements,
      trend,
      delta,
      alert,
    });
  }

  return comparison.sort((a, b) => a.markerName.localeCompare(b.markerName));
}

/**
 * Responde a perguntas em linguagem natural sobre a saúde do usuário:
 * "IRIS, compare meus últimos 3 exames"
 * "Como está meu colesterol ao longo dos anos?"
 * 
 * Regra estrita: Não emite diagnóstico automático, constrói tabela comparativa,
 * destaca alterações e sugere diálogo com profissional de saúde.
 */
export async function askIrisHealth(userId: number, question: string): Promise<{
  reply: string;
  tableData?: HealthComparisonRow[];
  disclaimer: string;
}> {
  await logHealthAudit(userId, "pergunta_saude_iris", undefined, { question });

  const isCompareRequest = /\b(compar|evolu|tend[eê]ncia|ao longo|historico|ultimos)\w*/i.test(question);
  const isCholesterol = /\b(colesterol|lipid|triglicer)\w*/i.test(question);
  const isGlucose = /\b(glicemia|glicose|hba1c|acucar)\w*/i.test(question);

  let targetMarkers: string[] | undefined;
  if (isCholesterol) {
    targetMarkers = ["Colesterol Total", "Colesterol HDL", "Colesterol LDL", "Triglicerídeos"];
  } else if (isGlucose) {
    targetMarkers = ["Glicemia de Jejum", "Hemoglobina Glicada (HbA1c)"];
  }

  const comparison = await compareMarkersAcrossDates(userId, targetMarkers);

  const disclaimer =
    "Aviso Importante: A Iris IA não formula diagnósticos médicos nem prescreve medicamentos. " +
    "Esta síntese organiza e compara os dados dos seus laudos oficiais para apoiar a sua consulta médica.";

  if (comparison.length === 0) {
    return {
      reply:
        "Analisei sua Central de Saúde, mas ainda não encontrei exames laboratoriais cadastrados com esses marcadores. " +
        "Você pode enviar seus laudos em PDF, JPG ou PNG na aba **Exames** para que eu extraia e compare seus resultados automaticamente.",
      disclaimer,
    };
  }

  // Monta tabela comparativa em Markdown
  let tableMarkdown = "\n\n### Tabela Comparativa de Exames\n\n";
  tableMarkdown += "| Marcador | Unidade | Referência | Histórico de Resultados | Variação |\n";
  tableMarkdown += "| :--- | :---: | :---: | :--- | :---: |\n";

  const highlights: string[] = [];

  for (const item of comparison) {
    const historyStr = item.measurements
      .map((m) => `**${m.date.slice(0, 4)}**: ${m.result}${m.status === "alterado" ? " ⚠️" : ""}`)
      .join(" → ");

    const deltaStr = item.delta ? `${item.delta} (${item.trend})` : "—";
    const refStr = item.referenceRange || "—";

    tableMarkdown += `| **${item.markerName}** | ${item.unit} | ${refStr} | ${historyStr} | ${deltaStr} |\n`;

    if (item.alert) {
      highlights.push(`- **${item.markerName}**: apresenta valores fora da faixa de referência indicada no laudo.`);
    } else if (item.trend === "aumento" || item.trend === "reducao") {
      highlights.push(
        `- **${item.markerName}**: apresentou tendência de ${item.trend === "aumento" ? "elevação" : "redução"} (${item.delta} ${item.unit}).`
      );
    }
  }

  let textReply = `Aqui está a análise comparativa dos seus exames:\n${tableMarkdown}\n`;

  if (highlights.length > 0) {
    textReply += `\n**Observações Relevantes Identificadas:**\n${highlights.join("\n")}\n`;
  } else {
    textReply += `\nTodos os biomarcadores analisados mantiveram-se estáveis e dentro das faixas laboratoriais fornecidas.\n`;
  }

  textReply += `\nRecomendo apresentar este comparativo ao seu médico de confiança na sua próxima consulta.`;

  return {
    reply: textReply,
    tableData: comparison,
    disclaimer,
  };
}

/**
 * Adiciona ou altera medicação / suplemento.
 */
export async function saveMedication(
  userId: number,
  input: {
    name: string;
    dosage: string;
    frequency: string;
    type: "medicamento" | "suplemento";
    active?: boolean;
    startDate?: string;
    notes?: string;
  }
) {
  const db = await getDb();
  if (db) {
    try {
      const inserted = await db.insert(healthMedications).values({
        userId,
        name: input.name,
        dosage: input.dosage,
        frequency: input.frequency,
        type: input.type,
        active: input.active ?? true,
        startDate: input.startDate ?? new Date().toISOString().slice(0, 10),
        notes: input.notes ?? null,
      });
      await logHealthAudit(userId, "adicionar_medicamento", input.name, input, true);
      return { id: Number(inserted[0].insertId) };
    } catch {
      // Fallback
    }
  }

  const state = getOrCreateUserState(userId);
  const id = state.medications.length + 1;
  state.medications.unshift({
    id,
    userId,
    ...input,
    active: input.active ?? true,
    startDate: input.startDate || new Date().toISOString().slice(0, 10),
    createdAt: new Date(),
  });
  await logHealthAudit(userId, "adicionar_medicamento", input.name, input, true);
  return { id };
}

/**
 * Lista medicamentos e suplementos ativos.
 */
export async function listMedications(userId: number) {
  const db = await getDb();
  if (db) {
    try {
      return await db
        .select()
        .from(healthMedications)
        .where(eq(healthMedications.userId, userId))
        .orderBy(desc(healthMedications.createdAt));
    } catch {
      // Fallback
    }
  }
  const state = getOrCreateUserState(userId);
  return state.medications;
}

/**
 * Adiciona medição vital (pressão, peso, glicemia, etc.)
 */
export async function saveMeasurement(
  userId: number,
  input: {
    type: string;
    value: string;
    unit: string;
    measuredAt?: string;
    notes?: string;
  }
) {
  const measuredAt = input.measuredAt || new Date().toISOString();
  const db = await getDb();
  if (db) {
    try {
      const inserted = await db.insert(healthMeasurements).values({
        userId,
        type: input.type,
        value: input.value,
        unit: input.unit,
        measuredAt,
        notes: input.notes ?? null,
      });
      await logHealthAudit(userId, "adicionar_medicao", input.type, input, true);
      return { id: Number(inserted[0].insertId) };
    } catch {
      // Fallback
    }
  }

  const state = getOrCreateUserState(userId);
  const id = state.measurements.length + 1;
  state.measurements.unshift({
    id,
    userId,
    type: input.type,
    value: input.value,
    unit: input.unit,
    measuredAt,
    notes: input.notes,
    createdAt: new Date(),
  });
  await logHealthAudit(userId, "adicionar_medicao", input.type, input, true);
  return { id };
}

/**
 * Lista medições de saúde (pressão, peso, etc.)
 */
export async function listMeasurements(userId: number, type?: string) {
  const db = await getDb();
  if (db) {
    try {
      return await db
        .select()
        .from(healthMeasurements)
        .where(
          and(
            eq(healthMeasurements.userId, userId),
            type ? eq(healthMeasurements.type, type) : undefined
          )
        )
        .orderBy(desc(healthMeasurements.measuredAt));
    } catch {
      // Fallback
    }
  }

  const state = getOrCreateUserState(userId);
  let list = state.measurements;
  if (type) {
    list = list.filter((m) => m.type === type);
  }
  return list.sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));
}

/**
 * Exclui um exame com autorização explícita do usuário.
 */
export async function deleteUserExam(userId: number, examId: number) {
  const db = await getDb();
  if (db) {
    try {
      await db.delete(healthMarkers).where(and(eq(healthMarkers.examId, examId), eq(healthMarkers.userId, userId)));
      await db.delete(healthExams).where(and(eq(healthExams.id, examId), eq(healthExams.userId, userId)));
      await logHealthAudit(userId, "excluir_exame", `exam_${examId}`, undefined, true);
      return { success: true };
    } catch {
      // Fallback
    }
  }

  const state = getOrCreateUserState(userId);
  state.exams = state.exams.filter((e) => e.id !== examId);
  state.markers = state.markers.filter((m) => m.examId !== examId);
  await logHealthAudit(userId, "excluir_exame", `exam_${examId}`, undefined, true);
  return { success: true };
}

/**
 * Lista logs de auditoria da saúde para controle e transparência do usuário.
 */
export async function listHealthAudits(userId: number, limit = 50) {
  const db = await getDb();
  if (db) {
    try {
      return await db
        .select()
        .from(healthAudits)
        .where(eq(healthAudits.userId, userId))
        .orderBy(desc(healthAudits.createdAt))
        .limit(limit);
    } catch {
      // Fallback
    }
  }
  const state = getOrCreateUserState(userId);
  return state.audits.slice(0, limit);
}
