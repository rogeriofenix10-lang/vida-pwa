/**
 * IRIS HEALTH INTELLIGENCE ARCHITECTURE — TYPES & SPECIFICATIONS
 * 
 * Estrutura tipada para a Central de Saúde da IRIS.
 * Suporta ingestão de laudos em PDF, JPG e PNG, extração estruturada de
 * marcadores clínicos, armazenamento de séries históricas e governança estrita de privacidade.
 */

export type HealthSupportedFormat = "pdf" | "jpg" | "jpeg" | "png";

export type HealthMarkerCategory =
  | "hemograma"
  | "glicemia"
  | "perfil_lipidico"
  | "funcao_renal"
  | "funcao_hepatica"
  | "tireoide"
  | "vitaminas_minerais"
  | "hormonios"
  | "psa"
  | "pressao_arterial"
  | "tipo_sanguineo"
  | "outros";

export interface BloodTypeInfo {
  abo?: "A" | "B" | "AB" | "O" | string;
  rhFactor?: "positivo" | "negativo" | "+" | "-" | string;
  informedAt?: string;
  sourceExamId?: string;
}

export interface BloodPressureMeasurement {
  id: string;
  systolic: number; // Ex: 120
  diastolic: number; // Ex: 80
  pulse?: number; // bpm
  measuredAt: string; // ISO-8601
  notes?: string;
  examId?: string;
}

export interface HealthMarkerEntry {
  id: string;
  category: HealthMarkerCategory;
  markerName: string; // Ex: "Glicemia de Jejum", "Hemoglobina Glicada (HbA1c)", "Colesterol HDL"
  date: string; // YYYY-MM-DD ou ISO-8601
  result: string | number; // Resultado extraído
  unit: string; // Ex: "mg/dL", "%", "g/dL", "mcg/dL", "mUI/L"
  referenceRange?: string; // Faixa de referência do laudo. Ex: "70 a 99 mg/dL"
  status?: "normal" | "alterado" | "indeterminado";
  examId?: string;
  notes?: string;
}

export interface HealthExamDocument {
  id: string;
  fileName: string;
  fileFormat: HealthSupportedFormat;
  mimeType: string;
  fileSizeBytes: number;
  uploadedAt: string; // ISO-8601
  examDate?: string; // Data do exame indicada no laudo
  laboratory?: string;
  doctorName?: string;
  status: "armazenado" | "em_leitura" | "processado" | "erro";
  extractedMarkersCount: number;
  extractedMarkers?: HealthMarkerEntry[];
  summaryNote?: string;
}

export interface HealthSecurityGovernance {
  privacyLevel: "privado_estrito";
  canRead: boolean;
  canOrganize: boolean;
  canExplain: boolean;
  canCompare: boolean;
  canShowTrends: boolean;
  prohibitedActions: {
    inventDiagnosis: false;
    modifyResults: false;
    deleteDocumentsWithoutConsent: false;
    shareData: false;
    sendToThirdPartiesWithoutConsent: false;
  };
}

export interface HealthCenterState {
  documents: HealthExamDocument[];
  markerHistory: HealthMarkerEntry[];
  bloodType?: BloodTypeInfo;
  bloodPressureHistory: BloodPressureMeasurement[];
  securityPolicy: HealthSecurityGovernance;
}
