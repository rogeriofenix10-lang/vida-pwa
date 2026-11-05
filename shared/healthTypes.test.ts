import { describe, it, expect } from "vitest";
import type {
  HealthExamDocument,
  HealthMarkerEntry,
  HealthSecurityGovernance,
  BloodTypeInfo,
  BloodPressureMeasurement
} from "./healthTypes";

describe("Health Architecture Specification Tests", () => {
  it("valida estrutura tipada de documento de exame suportando PDF, JPG e PNG", () => {
    const pdfDoc: HealthExamDocument = {
      id: "doc-1",
      fileName: "hemograma_completo.pdf",
      fileFormat: "pdf",
      mimeType: "application/pdf",
      fileSizeBytes: 245000,
      uploadedAt: "2026-09-27T10:00:00Z",
      status: "armazenado",
      extractedMarkersCount: 4
    };

    const imgDoc: HealthExamDocument = {
      id: "doc-2",
      fileName: "exame_sangue.png",
      fileFormat: "png",
      mimeType: "image/png",
      fileSizeBytes: 1200000,
      uploadedAt: "2026-09-27T10:05:00Z",
      status: "armazenado",
      extractedMarkersCount: 2
    };

    expect(pdfDoc.fileFormat).toBe("pdf");
    expect(imgDoc.fileFormat).toBe("png");
    expect(pdfDoc.status).toBe("armazenado");
  });

  it("garante formato correto da tabela estruturada (Marcador | Data | Resultado | Unidade | Referência)", () => {
    const entry: HealthMarkerEntry = {
      id: "marker-1",
      category: "glicemia",
      markerName: "Glicemia de Jejum",
      date: "2026-09-20",
      result: 92,
      unit: "mg/dL",
      referenceRange: "70 a 99 mg/dL",
      status: "normal"
    };

    expect(entry.markerName).toBe("Glicemia de Jejum");
    expect(entry.date).toBe("2026-09-20");
    expect(entry.result).toBe(92);
    expect(entry.unit).toBe("mg/dL");
    expect(entry.referenceRange).toBe("70 a 99 mg/dL");
  });

  it("garante preservação de tipo sanguíneo e pressão arterial", () => {
    const blood: BloodTypeInfo = {
      abo: "O",
      rhFactor: "positivo",
      informedAt: "2026-09-27"
    };

    const bp: BloodPressureMeasurement = {
      id: "bp-1",
      systolic: 120,
      diastolic: 80,
      measuredAt: "2026-09-27T08:30:00Z"
    };

    expect(blood.abo).toBe("O");
    expect(blood.rhFactor).toBe("positivo");
    expect(bp.systolic).toBe(120);
    expect(bp.diastolic).toBe(80);
  });

  it("garante rigor nas políticas de governança e privacidade da IRIS", () => {
    const security: HealthSecurityGovernance = {
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
        sendToThirdPartiesWithoutConsent: false
      }
    };

    expect(security.privacyLevel).toBe("privado_estrito");
    expect(security.canRead).toBe(true);
    expect(security.canOrganize).toBe(true);
    expect(security.canExplain).toBe(true);
    expect(security.canCompare).toBe(true);
    expect(security.canShowTrends).toBe(true);
    expect(security.prohibitedActions.inventDiagnosis).toBe(false);
    expect(security.prohibitedActions.modifyResults).toBe(false);
    expect(security.prohibitedActions.deleteDocumentsWithoutConsent).toBe(false);
    expect(security.prohibitedActions.shareData).toBe(false);
    expect(security.prohibitedActions.sendToThirdPartiesWithoutConsent).toBe(false);
  });
});
