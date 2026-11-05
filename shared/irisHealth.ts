/**
 * IRIS HEALTH ENGINE — CENTRAL DE SAÚDE DA IRIS (FASE 11)
 *
 * Módulo de inteligência para saúde pessoal, suportando:
 * - Exames laboratoriais (Perfil lipídico, glicemia, hemograma, hormônios, tireoide, etc.)
 * - Pressão arterial
 * - Colesterol
 * - Glicemia & Hemoglobina glicada (HbA1c)
 * - Hormônios
 * - Medicamentos e suplementos
 * - Peso e evolução física
 * - Histórico cronológico e evolução comparativa
 * - Documentos de saúde
 *
 * PIPELINE OFICIAL DE DOCUMENTOS:
 * UPLOAD → LEITURA → EXTRAÇÃO → ESTRUTURAÇÃO → HISTÓRICO → INDICADORES
 *
 * DIRETRIZES ÉTICAS E DE SEGURANÇA:
 * 1. A IRIS organiza, extrai, estrutura, compara e mostra tendências e destaques.
 * 2. NUNCA diagnosticar: a IRIS não prescreve, não substitui médicos e não emite diagnósticos.
 * 3. Destacar valores fora da faixa de referência sem alarme indevido.
 * 4. Privacidade integral (privado estrito, sem envio a terceiros, sem dados em logs).
 */

import {
  type HealthMarkerCategory,
  type HealthSupportedFormat,
  type HealthMarkerEntry,
  type BloodPressureMeasurement,
  type HealthExamDocument,
  type HealthSecurityGovernance,
  type BloodTypeInfo,
} from "./healthTypes";

export interface BiomarkerDefinition {
  name: string;
  category: HealthMarkerCategory;
  aliases: RegExp[];
  defaultUnit: string;
  referenceRange: string;
  rangeMin?: number;
  rangeMax?: number;
}

export const BIOMARKER_CATALOG: BiomarkerDefinition[] = [
  // 1. Colesterol & Lipídios
  {
    name: "Colesterol Total",
    category: "perfil_lipidico",
    aliases: [/colesterol\s+total/i, /\bct\b/i],
    defaultUnit: "mg/dL",
    referenceRange: "< 190 mg/dL",
    rangeMax: 190,
  },
  {
    name: "Colesterol HDL",
    category: "perfil_lipidico",
    aliases: [/colesterol\s+hdl/i, /\bhdl[\s-]?colesterol/i, /\bhdl\b/i],
    defaultUnit: "mg/dL",
    referenceRange: "> 40 mg/dL",
    rangeMin: 40,
  },
  {
    name: "Colesterol LDL",
    category: "perfil_lipidico",
    aliases: [/colesterol\s+ldl/i, /\bldl[\s-]?colesterol/i, /\bldl\b/i],
    defaultUnit: "mg/dL",
    referenceRange: "< 130 mg/dL",
    rangeMax: 130,
  },
  {
    name: "Colesterol VLDL",
    category: "perfil_lipidico",
    aliases: [/colesterol\s+vldl/i, /\bvldl\b/i],
    defaultUnit: "mg/dL",
    referenceRange: "< 30 mg/dL",
    rangeMax: 30,
  },
  {
    name: "Triglicerídeos",
    category: "perfil_lipidico",
    aliases: [/triglicer[ií]deos/i, /triglic[eé]rides/i],
    defaultUnit: "mg/dL",
    referenceRange: "< 150 mg/dL",
    rangeMax: 150,
  },

  // 2. Glicemia & Metabolismo
  {
    name: "Glicemia de Jejum",
    category: "glicemia",
    aliases: [/glicemia\s+de\s+jejum/i, /glicose\s+de\s+jejum/i, /\bglicemia\b/i, /\bglicose\b/i],
    defaultUnit: "mg/dL",
    referenceRange: "70 a 99 mg/dL",
    rangeMin: 70,
    rangeMax: 99,
  },
  {
    name: "Hemoglobina Glicada (HbA1c)",
    category: "glicemia",
    aliases: [/hemoglobina\s+glicada/i, /glico-hemoglobina/i, /\bhba1c\b/i, /\ba1c\b/i],
    defaultUnit: "%",
    referenceRange: "< 5.7%",
    rangeMax: 5.7,
  },
  {
    name: "Insulina Basal",
    category: "glicemia",
    aliases: [/insulina\s+basal/i, /\binsulina\b/i],
    defaultUnit: "µUI/mL",
    referenceRange: "2.6 a 24.9 µUI/mL",
    rangeMin: 2.6,
    rangeMax: 24.9,
  },

  // 3. Hormônios & Tireoide
  {
    name: "TSH Ultra Sensível",
    category: "tireoide",
    aliases: [/tsh\s+ultra\s+sens[ií]vel/i, /\btsh\b/i, /horm[oô]nio\s+tireoestimulante/i],
    defaultUnit: "µUI/mL",
    referenceRange: "0.45 a 4.5 µUI/mL",
    rangeMin: 0.45,
    rangeMax: 4.5,
  },
  {
    name: "T4 Livre",
    category: "tireoide",
    aliases: [/t4\s+livre/i, /tiroxina\s+livre/i],
    defaultUnit: "ng/dL",
    referenceRange: "0.70 a 1.80 ng/dL",
    rangeMin: 0.7,
    rangeMax: 1.8,
  },
  {
    name: "Testosterona Total",
    category: "hormonios",
    aliases: [/testosterona\s+total/i, /\btestosterona\b/i],
    defaultUnit: "ng/dL",
    referenceRange: "240 a 816 ng/dL",
    rangeMin: 240,
    rangeMax: 816,
  },
  {
    name: "Cortisol Basal",
    category: "hormonios",
    aliases: [/cortisol\s+basal/i, /cortisol\s+8h/i, /\bcortisol\b/i],
    defaultUnit: "µg/dL",
    referenceRange: "6.0 a 18.4 µg/dL",
    rangeMin: 6.0,
    rangeMax: 18.4,
  },

  // 4. Hemograma Completo
  {
    name: "Hemoglobina",
    category: "hemograma",
    aliases: [/\bhemoglobina\b/i, /\bhgb\b/i],
    defaultUnit: "g/dL",
    referenceRange: "12.0 a 17.5 g/dL",
    rangeMin: 12.0,
    rangeMax: 17.5,
  },
  {
    name: "Hematócrito",
    category: "hemograma",
    aliases: [/hemat[oó]crito/i, /\bhtc\b/i],
    defaultUnit: "%",
    referenceRange: "36 a 52%",
    rangeMin: 36,
    rangeMax: 52,
  },
  {
    name: "Leucócitos Totais",
    category: "hemograma",
    aliases: [/leuc[oó]citos\s+totais/i, /\bleuc[oó]citos\b/i, /\bglobulos\s+brancos/i],
    defaultUnit: "/mm³",
    referenceRange: "4.000 a 11.000 /mm³",
    rangeMin: 4000,
    rangeMax: 11000,
  },
  {
    name: "Plaquetas",
    category: "hemograma",
    aliases: [/\bplaquetas\b/i, /contagem\s+de\s+plaquetas/i],
    defaultUnit: "/mm³",
    referenceRange: "150.000 a 450.000 /mm³",
    rangeMin: 150000,
    rangeMax: 450000,
  },

  // 5. Função Renal & Hepática
  {
    name: "Creatinina",
    category: "funcao_renal",
    aliases: [/\bcreatinina\b/i],
    defaultUnit: "mg/dL",
    referenceRange: "0.7 a 1.3 mg/dL",
    rangeMin: 0.7,
    rangeMax: 1.3,
  },
  {
    name: "Ureia",
    category: "funcao_renal",
    aliases: [/\bureia\b/i],
    defaultUnit: "mg/dL",
    referenceRange: "15 a 45 mg/dL",
    rangeMin: 15,
    rangeMax: 45,
  },
];

export interface ExtractedReportData {
  examDate?: string;
  laboratory?: string;
  doctorName?: string;
  markers: HealthMarkerEntry[];
}

export interface MarkerComparisonResult {
  markerName: string;
  category: HealthMarkerCategory;
  unit: string;
  referenceRange: string;
  values: Array<{
    date: string;
    result: string | number;
    numericValue?: number;
    status: "normal" | "alterado" | "indeterminado";
    examId?: string;
  }>;
  trend: "estavel" | "aumento" | "reducao" | "indeterminado";
  delta?: string;
  hasOutOfRange: boolean;
}

export interface HealthMedicationEntry {
  id: string;
  name: string;
  dosage: string;
  frequency: string;
  type: "medicamento" | "suplemento";
  startDate?: string;
  active: boolean;
  notes?: string;
}

export interface HealthWeightEntry {
  id: string;
  weightKg: number;
  measuredAt: string;
  notes?: string;
}

/**
 * Extrai marcadores a partir de texto de laudo clínico
 */
export function extractHealthMarkersFromText(text: string, examDateOverride?: string): ExtractedReportData {
  const lines = text.split("\n");
  let examDate = examDateOverride;
  let laboratory: string | undefined;

  // Extrair data do laudo se não fornecida
  if (!examDate) {
    const dateMatch = text.match(/\b(data\s*(?:da)?\s*(?:coleta|exame)?[:\s]*)?(\d{2})[/-](\d{2})[/-](\d{4})\b/i);
    if (dateMatch) {
      const day = dateMatch[2];
      const month = dateMatch[3];
      const year = dateMatch[4];
      examDate = `${year}-${month}-${day}`;
    } else {
      const isoMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
      if (isoMatch) {
        examDate = isoMatch[0];
      }
    }
  }

  // Extrair laboratório
  const labMatch = text.match(/laborat[óo]rio\s+([A-Za-z0-9À-ÿ\s\-]+)/i);
  if (labMatch) {
    laboratory = labMatch[1].trim().slice(0, 80);
  }

  const markers: HealthMarkerEntry[] = [];
  const foundDefNames = new Set<string>();

  for (const def of BIOMARKER_CATALOG) {
    if (foundDefNames.has(def.name)) continue;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const matchesAlias = def.aliases.some((alias) => alias.test(line));

      if (matchesAlias) {
        // Tentar extrair valor numérico na mesma linha ou na próxima
        const searchScope = `${line} ${lines[i + 1] || ""} ${lines[i + 2] || ""}`;
        const valMatch = searchScope.match(/(?:resultado[:\s]*)?(\d+(?:[.,]\d+)?)\s*(mg\/dl|µui\/ml|ng\/dl|µg\/dl|g\/dl|\/mm³|%)/i) ||
          searchScope.match(/resultado[:\s]*(\d+(?:[.,]\d+)?)/i) ||
          line.match(/(\d+(?:[.,]\d+)?)/);

        if (valMatch) {
          const rawNum = valMatch[1].replace(",", ".");
          const numVal = parseFloat(rawNum);
          if (!isNaN(numVal)) {
            let status: "normal" | "alterado" | "indeterminado" = "normal";
            if (def.rangeMax !== undefined && numVal > def.rangeMax) {
              status = "alterado";
            } else if (def.rangeMin !== undefined && numVal < def.rangeMin) {
              status = "alterado";
            }

            markers.push({
              id: `marker-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              category: def.category,
              markerName: def.name,
              date: examDate || new Date().toISOString().split("T")[0],
              result: valMatch[1],
              unit: def.defaultUnit,
              referenceRange: def.referenceRange,
              status,
            });
            foundDefNames.add(def.name);
            break;
          }
        }
      }
    }
  }

  return {
    examDate,
    laboratory,
    markers,
  };
}

/**
 * Compara marcadores ao longo do tempo e identifica tendências
 */
export function compareMarkersAcrossDates(
  markers: HealthMarkerEntry[],
  targetMarkerName: string
): MarkerComparisonResult | undefined {
  const matching = markers
    .filter((m) => m.markerName.toLowerCase() === targetMarkerName.toLowerCase())
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (matching.length === 0) return undefined;

  const first = matching[0];
  const def = BIOMARKER_CATALOG.find((d) => d.name.toLowerCase() === targetMarkerName.toLowerCase());

  const values = matching.map((m) => {
    const rawVal = typeof m.result === "number" ? m.result : parseFloat(String(m.result).replace(",", "."));
    return {
      date: m.date,
      result: m.result,
      numericValue: isNaN(rawVal) ? undefined : rawVal,
      status: m.status || "indeterminado",
      examId: m.examId,
    };
  });

  let trend: "estavel" | "aumento" | "reducao" | "indeterminado" = "estavel";
  let delta: string | undefined;

  if (values.length >= 2) {
    const firstVal = values[0].numericValue;
    const lastVal = values[values.length - 1].numericValue;
    if (firstVal !== undefined && lastVal !== undefined) {
      const diff = lastVal - firstVal;
      if (Math.abs(diff) < 0.05 * firstVal) {
        trend = "estavel";
      } else if (diff > 0) {
        trend = "aumento";
      } else {
        trend = "reducao";
      }
      delta = `${diff > 0 ? "+" : ""}${diff.toFixed(1)} ${first.unit}`;
    }
  }

  const hasOutOfRange = values.some((v) => v.status === "alterado");

  return {
    markerName: first.markerName,
    category: first.category,
    unit: first.unit,
    referenceRange: def?.referenceRange || first.referenceRange || "",
    values,
    trend,
    delta,
    hasOutOfRange,
  };
}

/**
 * Motor Central da Central de Saúde da IRIS (IrisHealthCenter)
 */
export class IrisHealthCenter {
  private documents: Map<string, HealthExamDocument> = new Map();
  private markers: HealthMarkerEntry[] = [];
  private bloodPressures: BloodPressureMeasurement[] = [];
  private medications: HealthMedicationEntry[] = [];
  private weights: HealthWeightEntry[] = [];
  private bloodType?: BloodTypeInfo;

  public readonly governance: HealthSecurityGovernance = {
    privacyLevel: "privado_estrito",
    canRead: true,
    canOrganize: true,
    canExplain: true,
    canCompare: true,
    canShowTrends: true,
    prohibitedActions: {
      inventDiagnosis: false,
      modifyResults: false,
      deleteDocumentsWithoutConsent: false,
      shareData: false,
      sendToThirdPartiesWithoutConsent: false,
    },
  };

  /**
   * Pipeline completo de documentos de saúde:
   * UPLOAD → LEITURA → EXTRAÇÃO → ESTRUTURAÇÃO → HISTÓRICO → INDICADORES
   */
  public async processHealthDocument(input: {
    fileName: string;
    fileFormat: HealthSupportedFormat;
    mimeType: string;
    fileSizeBytes: number;
    rawText: string;
    examDate?: string;
  }): Promise<{
    document: HealthExamDocument;
    extractedCount: number;
    markers: HealthMarkerEntry[];
  }> {
    const docId = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    // 1. Extração estruturada
    const extracted = extractHealthMarkersFromText(input.rawText, input.examDate);

    // 2. Criação do documento no repositório seguro
    const doc: HealthExamDocument = {
      id: docId,
      fileName: input.fileName,
      fileFormat: input.fileFormat,
      mimeType: input.mimeType,
      fileSizeBytes: input.fileSizeBytes,
      uploadedAt: now,
      examDate: extracted.examDate || input.examDate,
      laboratory: extracted.laboratory,
      status: "processado",
      extractedMarkersCount: extracted.markers.length,
      extractedMarkers: extracted.markers.map((m) => ({ ...m, examId: docId })),
      summaryNote: `Processados ${extracted.markers.length} marcadores clínicos com sucesso.`,
    };

    this.documents.set(docId, doc);

    // 3. Inserção na série histórica
    for (const marker of doc.extractedMarkers || []) {
      this.markers.push(marker);
    }

    return {
      document: doc,
      extractedCount: extracted.markers.length,
      markers: doc.extractedMarkers || [],
    };
  }

  /**
   * Registro controlado de medição de pressão arterial (requer autorização)
   */
  public recordBloodPressure(
    measurement: Omit<BloodPressureMeasurement, "id">,
    isAuthorized = false
  ): BloodPressureMeasurement {
    if (!isAuthorized) {
      throw new Error("Segurança IRIS: Registro de medição de pressão arterial exige autorização explícita.");
    }
    const item: BloodPressureMeasurement = {
      ...measurement,
      id: `bp-${Date.now()}`,
    };
    this.bloodPressures.push(item);
    return item;
  }

  /**
   * Registro controlado de medicamento ou suplemento (requer autorização)
   */
  public recordMedication(
    medication: Omit<HealthMedicationEntry, "id" | "active">,
    isAuthorized = false
  ): HealthMedicationEntry {
    if (!isAuthorized) {
      throw new Error("Segurança IRIS: Cadastro de medicamento/suplemento exige autorização explícita.");
    }
    const item: HealthMedicationEntry = {
      ...medication,
      id: `med-${Date.now()}`,
      active: true,
    };
    this.medications.push(item);
    return item;
  }

  /**
   * Registro de peso (requer autorização)
   */
  public recordWeight(
    weightKg: number,
    measuredAt = new Date().toISOString(),
    isAuthorized = false
  ): HealthWeightEntry {
    if (!isAuthorized) {
      throw new Error("Segurança IRIS: Registro de peso exige autorização explícita.");
    }
    const item: HealthWeightEntry = {
      id: `w-${Date.now()}`,
      weightKg,
      measuredAt,
    };
    this.weights.push(item);
    return item;
  }

  /**
   * Define tipo sanguíneo
   */
  public setBloodType(info: BloodTypeInfo): void {
    this.bloodType = info;
  }

  public getBloodType(): BloodTypeInfo | undefined {
    return this.bloodType;
  }

  public listDocuments(): HealthExamDocument[] {
    return Array.from(this.documents.values());
  }

  public listMarkers(category?: HealthMarkerCategory): HealthMarkerEntry[] {
    if (category) {
      return this.markers.filter((m) => m.category === category);
    }
    return [...this.markers];
  }

  public listBloodPressures(): BloodPressureMeasurement[] {
    return [...this.bloodPressures];
  }

  public listMedications(): HealthMedicationEntry[] {
    return [...this.medications];
  }

  public listWeights(): HealthWeightEntry[] {
    return [...this.weights];
  }

  /**
   * Comparação temporal de um biomarcador em múltiplos exames
   */
  public compareBiomarker(markerName: string): MarkerComparisonResult | undefined {
    return compareMarkersAcrossDates(this.markers, markerName);
  }

  /**
   * Resumo de saúde para visão geral (sem diagnóstico!)
   */
  public generateHealthSummary(): {
    documentsCount: number;
    markersCount: number;
    outOfRangeMarkers: HealthMarkerEntry[];
    medicationsCount: number;
    bloodPressureRecent?: BloodPressureMeasurement;
    disclaimer: string;
  } {
    const outOfRange = this.markers.filter((m) => m.status === "alterado");
    const recentBp = this.bloodPressures.slice(-1)[0];

    return {
      documentsCount: this.documents.size,
      markersCount: this.markers.length,
      outOfRangeMarkers: outOfRange,
      medicationsCount: this.medications.length,
      bloodPressureRecent: recentBp,
      disclaimer: "A IRIS organiza e compara seus exames, mas não substitui a avaliação do seu médico.",
    };
  }
}
