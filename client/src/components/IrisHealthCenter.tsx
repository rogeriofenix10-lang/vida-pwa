import React, { useState, useRef, useMemo } from "react";
import {
  Activity,
  FileText,
  UploadCloud,
  Clock,
  TrendingUp,
  ShieldCheck,
  CheckCircle2,
  X,
  FileCheck,
  AlertCircle,
  Heart,
  Droplet,
  Plus,
  Pill,
  MessageCircle,
  Sparkles,
  Search,
  Trash2,
  Scale,
  Calendar,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Loader2,
  HelpCircle,
  ChevronRight
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { HealthMarkerCategory, HealthSupportedFormat } from "@shared/healthTypes";
import "./health-center.css";

interface IrisHealthCenterProps {
  onClose: () => void;
}

export type HealthTab =
  | "resumo"
  | "exames"
  | "historico"
  | "evolucao"
  | "indicadores"
  | "medicamentos"
  | "documentos"
  | "pergunta";

const INITIAL_DEMO_EXAMS = [
  {
    id: 1,
    fileName: "Hemograma_Completo_2026.pdf",
    fileFormat: "pdf" as HealthSupportedFormat,
    laboratory: "Laboratório Fleury",
    doctorName: "Dr. Carlos Eduardo",
    examDate: "2026-08-15",
    markersCount: 4,
    status: "processado",
    createdAt: new Date().toISOString(),
  },
  {
    id: 2,
    fileName: "Perfil_Lipidico_2025.pdf",
    fileFormat: "pdf" as HealthSupportedFormat,
    laboratory: "Laboratório Fleury",
    doctorName: "Dr. Carlos Eduardo",
    examDate: "2025-08-10",
    markersCount: 3,
    status: "processado",
    createdAt: new Date().toISOString(),
  },
];

const INITIAL_DEMO_MARKERS = [
  {
    id: 1,
    examId: 1,
    markerName: "Glicemia de Jejum",
    category: "glicemia" as HealthMarkerCategory,
    examDate: "2026-08-15",
    result: "92",
    unit: "mg/dL",
    referenceRange: "70 a 99 mg/dL",
    status: "normal",
  },
  {
    id: 2,
    examId: 1,
    markerName: "Colesterol HDL",
    category: "perfil_lipidico" as HealthMarkerCategory,
    examDate: "2026-08-15",
    result: "54",
    unit: "mg/dL",
    referenceRange: "> 40 mg/dL",
    status: "normal",
  },
  {
    id: 3,
    examId: 1,
    markerName: "Colesterol LDL",
    category: "perfil_lipidico" as HealthMarkerCategory,
    examDate: "2026-08-15",
    result: "138",
    unit: "mg/dL",
    referenceRange: "< 130 mg/dL",
    status: "alterado",
  },
  {
    id: 4,
    examId: 1,
    markerName: "Triglicerídeos",
    category: "perfil_lipidico" as HealthMarkerCategory,
    examDate: "2026-08-15",
    result: "142",
    unit: "mg/dL",
    referenceRange: "< 150 mg/dL",
    status: "normal",
  },
  {
    id: 5,
    examId: 2,
    markerName: "Colesterol LDL",
    category: "perfil_lipidico" as HealthMarkerCategory,
    examDate: "2025-08-10",
    result: "145",
    unit: "mg/dL",
    referenceRange: "< 130 mg/dL",
    status: "alterado",
  },
  {
    id: 6,
    examId: 1,
    markerName: "Hemoglobina",
    category: "hemograma" as HealthMarkerCategory,
    examDate: "2026-08-15",
    result: "15.2",
    unit: "g/dL",
    referenceRange: "13.5 a 17.5 g/dL",
    status: "normal",
  },
  {
    id: 7,
    examId: 1,
    markerName: "TSH Ultra Sensível",
    category: "tireoide" as HealthMarkerCategory,
    examDate: "2026-08-15",
    result: "2.1",
    unit: "mUI/L",
    referenceRange: "0.4 a 4.5 mUI/L",
    status: "normal",
  },
];

const INITIAL_DEMO_COMPARISONS = [
  {
    markerName: "Colesterol LDL",
    category: "perfil_lipidico",
    unit: "mg/dL",
    referenceRange: "< 130 mg/dL",
    trend: "reducao",
    delta: -7,
    alert: true,
    measurements: [
      { date: "2025-08-10", result: "145", status: "alterado" },
      { date: "2026-08-15", result: "138", status: "alterado" },
    ],
  },
];

const INITIAL_DEMO_MEDS = [
  {
    id: 1,
    name: "Vitamina D3",
    dosage: "2.000 UI",
    frequency: "1x ao dia pela manhã",
    type: "suplemento",
    active: true,
    startDate: "2026-01-10",
    notes: "Manutenção recomendada pelo médico",
  },
];

const INITIAL_DEMO_MEASURES = [
  {
    id: 1,
    type: "pressao_arterial",
    value: "120/80",
    unit: "mmHg",
    measuredAt: "2026-09-20",
    notes: "Em repouso pela manhã",
  },
];

const INITIAL_DEMO_WEIGHTS = [
  {
    id: 2,
    type: "peso",
    value: "74.8",
    unit: "kg",
    measuredAt: "2026-09-18",
    notes: "Peso corporal em jejum",
  },
];

export default function IrisHealthCenter({ onClose }: IrisHealthCenterProps) {
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();

  // Dados demonstrativos em memória para ambiente de desenvolvimento / sem OAuth
  const [demoExams, setDemoExams] = useState(INITIAL_DEMO_EXAMS);
  const [demoMarkers, setDemoMarkers] = useState(INITIAL_DEMO_MARKERS);
  const [demoComparisons] = useState(INITIAL_DEMO_COMPARISONS);
  const [demoMedications, setDemoMedications] = useState(INITIAL_DEMO_MEDS);
  const [demoPressures, setDemoPressures] = useState(INITIAL_DEMO_MEASURES);
  const [demoWeights, setDemoWeights] = useState(INITIAL_DEMO_WEIGHTS);

  // Estados de navegação e filtros
  const [activeTab, setActiveTab] = useState<HealthTab>("resumo");
  const [selectedCategory, setSelectedCategory] = useState<HealthMarkerCategory | "todas">("todas");
  const [searchQuery, setSearchQuery] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  // Estados para formulários e modais
  const [showAddManual, setShowAddManual] = useState(false);
  const [manualExam, setManualExam] = useState({
    fileName: "",
    examDate: new Date().toISOString().slice(0, 10),
    laboratory: "",
    doctorName: "",
    reportText: "",
  });

  const [showAddMedication, setShowAddMedication] = useState(false);
  const [newMed, setNewMed] = useState({
    name: "",
    dosage: "",
    frequency: "",
    type: "medicamento" as "medicamento" | "suplemento",
    startDate: new Date().toISOString().slice(0, 10),
    notes: "",
  });

  const [showAddMeasurement, setShowAddMeasurement] = useState(false);
  const [newMeasure, setNewMeasure] = useState({
    type: "pressao_arterial",
    value: "",
    unit: "mmHg",
    measuredAt: new Date().toISOString().slice(0, 10),
    notes: "",
  });

  // Estado para aba Perguntar à IRIS
  const [askQuestion, setAskQuestion] = useState("");
  const [askReply, setAskReply] = useState<{
    reply: string;
    tableData?: any[];
    disclaimer: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Queries reais tRPC
  const summaryQuery = trpc.health.summary.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const examsQuery = trpc.health.listExams.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const markersQuery = trpc.health.listMarkers.useQuery(
    {
      category: selectedCategory === "todas" ? undefined : selectedCategory,
      query: searchQuery.trim() || undefined,
    },
    { enabled: isAuthenticated, retry: false }
  );
  const compareQuery = trpc.health.compare.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const medicationsQuery = trpc.health.listMedications.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const pressureQuery = trpc.health.listMeasurements.useQuery(
    { type: "pressao_arterial" },
    { enabled: isAuthenticated, retry: false }
  );
  const weightQuery = trpc.health.listMeasurements.useQuery(
    { type: "peso" },
    { enabled: isAuthenticated, retry: false }
  );
  const auditsQuery = trpc.health.audits.useQuery({ limit: 10 }, { enabled: isAuthenticated, retry: false });

  // Mutations reais tRPC
  const uploadMutation = trpc.health.uploadAndProcess.useMutation();
  const addManualMutation = trpc.health.addManualExam.useMutation();
  const addMedicationMutation = trpc.health.addMedication.useMutation();
  const addMeasurementMutation = trpc.health.addMeasurement.useMutation();
  const deleteExamMutation = trpc.health.deleteExam.useMutation();
  const askIrisMutation = trpc.health.askIris.useMutation();

  const showNotification = (message: string, type: "success" | "error" | "info" = "success") => {
    setFeedback({ message, type });
    setTimeout(() => setFeedback(null), 6000);
  };

  const invalidateHealthData = async () => {
    if (!isAuthenticated) return;
    await Promise.all([
      utils.health.summary.invalidate(),
      utils.health.listExams.invalidate(),
      utils.health.listMarkers.invalidate(),
      utils.health.compare.invalidate(),
      utils.health.listMedications.invalidate(),
      utils.health.listMeasurements.invalidate(),
      utils.health.audits.invalidate(),
    ]);
  };

  // Upload real de laudo médico (PDF, JPG, PNG) com fallback de demonstração
  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const extension = file.name.split(".").pop()?.toLowerCase();

    if (!["pdf", "jpg", "jpeg", "png"].includes(extension || "")) {
      showNotification("Formato não suportado. Por favor, envie arquivos em PDF, JPG ou PNG.", "error");
      return;
    }

    if (file.size > 12 * 1024 * 1024) {
      showNotification("O arquivo deve ter no máximo 12 MB.", "error");
      return;
    }

    if (!isAuthenticated) {
      setIsUploading(true);
      setTimeout(() => {
        setIsUploading(false);
        const newDemoExam = {
          id: Date.now(),
          fileName: file.name,
          fileFormat: (extension === "pdf" ? "pdf" : "jpg") as HealthSupportedFormat,
          laboratory: "Laboratório Externo",
          doctorName: "Dr. Médico Assistente",
          examDate: new Date().toISOString().slice(0, 10),
          markersCount: 2,
          status: "processado",
          createdAt: new Date().toISOString(),
        };
        setDemoExams((prev) => [newDemoExam, ...prev]);
        showNotification(
          `Exame "${file.name}" lido e processado na demonstração! Para persistência definitiva com criptografia em nuvem, conecte sua conta.`,
          "success"
        );
      }, 900);
      return;
    }

    setIsUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const dataUrl = reader.result as string;
          const [, base64Data = ""] = dataUrl.split(",");

          const res = await uploadMutation.mutateAsync({
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            base64Data,
          });

          await invalidateHealthData();
          showNotification(
            `Exame "${file.name}" processado com sucesso! ${res.markersExtracted} biomarcadores identificados e catalogados.`,
            "success"
          );
        } catch (err) {
          showNotification(
            err instanceof Error ? err.message : "Erro ao processar exame.",
            "error"
          );
        } finally {
          setIsUploading(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setIsUploading(false);
      showNotification("Falha na leitura do arquivo.", "error");
    }
  };

  // Salvar exame manual / laudo digitado
  const handleSaveManualExam = async () => {
    if (!manualExam.fileName.trim() || !manualExam.examDate) {
      showNotification("Informe o nome e a data do exame.", "error");
      return;
    }

    if (!isAuthenticated) {
      const newId = Date.now();
      const newExam = {
        id: newId,
        fileName: manualExam.fileName.trim(),
        fileFormat: "pdf" as HealthSupportedFormat,
        laboratory: manualExam.laboratory.trim() || "Laboratório Clínico",
        doctorName: manualExam.doctorName.trim() || "",
        examDate: manualExam.examDate,
        markersCount: 1,
        status: "processado",
        createdAt: new Date().toISOString(),
      };
      const newMarker = {
        id: Date.now() + 1,
        examId: newId,
        markerName: manualExam.fileName.trim(),
        category: "outros" as HealthMarkerCategory,
        examDate: manualExam.examDate,
        result: "Registrado",
        unit: "—",
        referenceRange: "Conforme laudo",
        status: "normal" as const,
      };
      setDemoExams((prev) => [newExam, ...prev]);
      setDemoMarkers((prev) => [newMarker, ...prev]);
      setShowAddManual(false);
      setManualExam({
        fileName: "",
        examDate: new Date().toISOString().slice(0, 10),
        laboratory: "",
        doctorName: "",
        reportText: "",
      });
      showNotification("Exame adicionado à demonstração local com sucesso!", "success");
      return;
    }

    try {
      const res = await addManualMutation.mutateAsync({
        fileName: manualExam.fileName.trim(),
        examDate: manualExam.examDate,
        laboratory: manualExam.laboratory.trim() || undefined,
        doctorName: manualExam.doctorName.trim() || undefined,
        reportText: manualExam.reportText.trim() || undefined,
      });

      await invalidateHealthData();
      setShowAddManual(false);
      setManualExam({
        fileName: "",
        examDate: new Date().toISOString().slice(0, 10),
        laboratory: "",
        doctorName: "",
        reportText: "",
      });
      showNotification(
        `Exame cadastrado! ${res.markersExtracted} biomarcadores extraídos para o histórico.`,
        "success"
      );
    } catch (err) {
      showNotification(err instanceof Error ? err.message : "Erro ao cadastrar exame.", "error");
    }
  };

  // Salvar novo medicamento ou suplemento
  const handleSaveMedication = async () => {
    if (!newMed.name.trim() || !newMed.dosage.trim()) {
      showNotification("Preencha ao menos o nome e a dosagem.", "error");
      return;
    }

    if (!isAuthenticated) {
      const med = {
        id: Date.now(),
        name: newMed.name.trim(),
        dosage: newMed.dosage.trim(),
        frequency: newMed.frequency.trim() || "Conforme prescrição",
        type: newMed.type,
        active: true,
        startDate: newMed.startDate || "",
        notes: newMed.notes.trim() || "",
      };
      setDemoMedications((prev) => [med, ...prev]);
      setShowAddMedication(false);
      setNewMed({
        name: "",
        dosage: "",
        frequency: "",
        type: "medicamento",
        startDate: new Date().toISOString().slice(0, 10),
        notes: "",
      });
      showNotification("Medicamento registrado na demonstração local!", "success");
      return;
    }

    try {
      await addMedicationMutation.mutateAsync({
        name: newMed.name.trim(),
        dosage: newMed.dosage.trim(),
        frequency: newMed.frequency.trim() || "Conforme prescrição",
        type: newMed.type,
        startDate: newMed.startDate || undefined,
        notes: newMed.notes.trim() || undefined,
      });
      await invalidateHealthData();
      setShowAddMedication(false);
      setNewMed({
        name: "",
        dosage: "",
        frequency: "",
        type: "medicamento",
        startDate: new Date().toISOString().slice(0, 10),
        notes: "",
      });
      showNotification("Medicamento registrado com sucesso!", "success");
    } catch (err) {
      showNotification(err instanceof Error ? err.message : "Erro ao salvar medicação.", "error");
    }
  };

  // Salvar nova medição vital
  const handleSaveMeasurement = async () => {
    if (!newMeasure.value.trim()) {
      showNotification("Informe o valor da medição.", "error");
      return;
    }

    if (!isAuthenticated) {
      const measure = {
        id: Date.now(),
        type: newMeasure.type,
        value: newMeasure.value.trim(),
        unit: newMeasure.unit,
        measuredAt: newMeasure.measuredAt,
        notes: newMeasure.notes.trim() || "",
      };
      if (newMeasure.type === "pressao_arterial") {
        setDemoPressures((prev) => [measure, ...prev]);
      } else if (newMeasure.type === "peso") {
        setDemoWeights((prev) => [measure, ...prev]);
      }
      setShowAddMeasurement(false);
      setNewMeasure({
        type: "pressao_arterial",
        value: "",
        unit: "mmHg",
        measuredAt: new Date().toISOString().slice(0, 10),
        notes: "",
      });
      showNotification("Sinal vital registrado na demonstração local!", "success");
      return;
    }

    try {
      await addMeasurementMutation.mutateAsync({
        type: newMeasure.type,
        value: newMeasure.value.trim(),
        unit: newMeasure.unit,
        measuredAt: newMeasure.measuredAt,
        notes: newMeasure.notes.trim() || undefined,
      });
      await invalidateHealthData();
      setShowAddMeasurement(false);
      setNewMeasure({
        type: "pressao_arterial",
        value: "",
        unit: "mmHg",
        measuredAt: new Date().toISOString().slice(0, 10),
        notes: "",
      });
      showNotification("Sinal vital registrado com sucesso!", "success");
    } catch (err) {
      showNotification(err instanceof Error ? err.message : "Erro ao registrar medição.", "error");
    }
  };

  // Enviar pergunta à IRIS
  const handleAskIris = async (presetQuestion?: string) => {
    const q = (presetQuestion || askQuestion).trim();
    if (!q) return;
    setAskQuestion(q);

    if (!isAuthenticated) {
      setAskReply({
        reply: `Análise demonstrativa da Iris para “${q}”: Seus níveis de glicemia de jejum (92 mg/dL) e triglicerídeos (142 mg/dL) estão estáveis dentro das faixas recomendadas. O Colesterol LDL apresentou redução gradual de 145 mg/dL em 2025 para 138 mg/dL em 2026, indicando tendência favorável. Em ambiente conectado com autenticação, a Iris analisa todo o acervo confidencial e cruza exames laboratoriais automaticamente.`,
        tableData: [
          { Marcador: "Glicemia de Jejum", Resultado: "92 mg/dL", "Faixa de Referência": "70 a 99 mg/dL", Status: "Normal" },
          { Marcador: "Colesterol LDL", Resultado: "138 mg/dL", "Faixa de Referência": "< 130 mg/dL", Status: "Atenção (em redução)" },
          { Marcador: "Colesterol HDL", Resultado: "54 mg/dL", "Faixa de Referência": "> 40 mg/dL", Status: "Normal" },
        ],
        disclaimer: "Informação demonstrativa da Iris IA. A Iris não substitui consulta, diagnóstico ou conduta com profissional médico habilitado.",
      });
      return;
    }

    try {
      const res = await askIrisMutation.mutateAsync({ question: q });
      setAskReply(res);
    } catch (err) {
      showNotification(err instanceof Error ? err.message : "Erro ao consultar a Iris.", "error");
    }
  };

  // Excluir exame com confirmação explícita
  const handleDeleteExam = async (examId: number, fileName: string) => {
    if (!window.confirm(`Tem certeza de que deseja excluir permanentemente o exame "${fileName}" e todos os seus marcadores associados?`)) {
      return;
    }

    if (!isAuthenticated) {
      setDemoExams((prev) => prev.filter((d) => d.id !== examId));
      setDemoMarkers((prev) => prev.filter((m) => m.examId !== examId));
      showNotification(`Exame "${fileName}" removido da demonstração.`, "info");
      return;
    }

    try {
      await deleteExamMutation.mutateAsync({ examId, confirmed: true });
      await invalidateHealthData();
      showNotification(`Exame "${fileName}" excluído com sucesso.`, "info");
    } catch (err) {
      showNotification(err instanceof Error ? err.message : "Erro ao excluir exame.", "error");
    }
  };

  const exams = isAuthenticated ? (examsQuery.data ?? []) : demoExams;
  const rawMarkers = isAuthenticated ? (markersQuery.data ?? []) : demoMarkers;
  const markers = useMemo(() => {
    let list = rawMarkers;
    if (selectedCategory !== "todas") {
      list = list.filter((m) => m.category === selectedCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((m) => m.markerName.toLowerCase().includes(q) || m.category.toLowerCase().includes(q));
    }
    return list;
  }, [rawMarkers, selectedCategory, searchQuery]);

  const comparisons = isAuthenticated ? (compareQuery.data ?? []) : demoComparisons;
  const medications = isAuthenticated ? (medicationsQuery.data ?? []) : demoMedications;
  const pressures = isAuthenticated ? (pressureQuery.data ?? []) : demoPressures;
  const weights = isAuthenticated ? (weightQuery.data ?? []) : demoWeights;
  const summary = summaryQuery.data ?? {
    totalExams: exams.length,
    totalMarkers: markers.length,
    alteredMarkers: markers.filter((m) => m.status === "alterado").length,
    activeMedications: medications.filter((m) => m.active).length,
    latestPressure: pressures[0] ? `${pressures[0].value} ${pressures[0].unit}` : null,
    latestWeight: weights[0] ? `${weights[0].value} ${weights[0].unit}` : null,
  };

  return (
    <div className="iris-health-wrapper">
      {/* CABEÇALHO DA CENTRAL DE SAÚDE */}
      <div className="iris54-view-header">
        <div>
          <span className="iris54-kicker">
            <Activity size={14} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />
            CENTRAL DE SAÚDE 1.0 · DADOS PRIVADOS E PROTEGIDOS
          </span>
          <h2>Central de Saúde Iris</h2>
          <p>Gestão confidencial de exames laboratoriais, biomarcadores e histórico evolutivo.</p>
        </div>
        <button
          type="button"
          className="iris54-close-btn"
          onClick={onClose}
          title="Fechar Central de Saúde"
          aria-label="Fechar"
        >
          <X size={18} />
        </button>
      </div>

      {/* AVISO INFORMATIVO DE MODO DEMONSTRAÇÃO QUANDO NÃO AUTENTICADO */}
      {!isAuthenticated && (
        <div
          style={{
            padding: "8px 14px",
            borderRadius: "10px",
            background: "rgba(56, 189, 248, 0.08)",
            border: "1px solid rgba(56, 189, 248, 0.22)",
            color: "#7dd3fc",
            fontSize: "12px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <ShieldCheck size={16} color="#38bdf8" />
          <span>
            <strong>Modo de Demonstração / Ambiente Local:</strong> Dados de exemplo interativos. Em produção com login, seus registros médicos são criptografados com sigilo absoluto.
          </span>
        </div>
      )}

      {/* FEEDBACK DE NOTIFICAÇÃO TEMPORÁRIA */}
      {feedback && (
        <div
          style={{
            padding: "10px 16px",
            borderRadius: "12px",
            background:
              feedback.type === "error"
                ? "rgba(244, 63, 94, 0.15)"
                : feedback.type === "info"
                ? "rgba(59, 130, 246, 0.15)"
                : "rgba(34, 211, 238, 0.15)",
            border: `1px solid ${
              feedback.type === "error"
                ? "rgba(244, 63, 94, 0.35)"
                : feedback.type === "info"
                ? "rgba(59, 130, 246, 0.35)"
                : "rgba(34, 211, 238, 0.35)"
            }`,
            color:
              feedback.type === "error"
                ? "#fca5a5"
                : feedback.type === "info"
                ? "#93c5fd"
                : "#a5f3fc",
            fontSize: "13px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          {feedback.type === "error" ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* NAVEGAÇÃO ENTRE ABAS */}
      <nav className="iris-health-tabs">
        <button
          type="button"
          className={`iris-health-tab-btn ${activeTab === "resumo" ? "active" : ""}`}
          onClick={() => setActiveTab("resumo")}
        >
          <Activity size={15} />
          Resumo
        </button>
        <button
          type="button"
          className={`iris-health-tab-btn ${activeTab === "exames" ? "active" : ""}`}
          onClick={() => setActiveTab("exames")}
        >
          <UploadCloud size={15} />
          Exames ({exams.length})
        </button>
        <button
          type="button"
          className={`iris-health-tab-btn ${activeTab === "historico" ? "active" : ""}`}
          onClick={() => setActiveTab("historico")}
        >
          <Clock size={15} />
          Histórico ({markers.length})
        </button>
        <button
          type="button"
          className={`iris-health-tab-btn ${activeTab === "evolucao" ? "active" : ""}`}
          onClick={() => setActiveTab("evolucao")}
        >
          <TrendingUp size={15} />
          Evolução &amp; Comparação
        </button>
        <button
          type="button"
          className={`iris-health-tab-btn ${activeTab === "indicadores" ? "active" : ""}`}
          onClick={() => setActiveTab("indicadores")}
        >
          <Heart size={15} />
          Sinais Vitais
        </button>
        <button
          type="button"
          className={`iris-health-tab-btn ${activeTab === "medicamentos" ? "active" : ""}`}
          onClick={() => setActiveTab("medicamentos")}
        >
          <Pill size={15} />
          Medicamentos ({medications.length})
        </button>
        <button
          type="button"
          className={`iris-health-tab-btn ${activeTab === "documentos" ? "active" : ""}`}
          onClick={() => setActiveTab("documentos")}
        >
          <FileText size={15} />
          Documentos ({exams.length})
        </button>
        <button
          type="button"
          className={`iris-health-tab-btn ${activeTab === "pergunta" ? "active" : ""}`}
          onClick={() => setActiveTab("pergunta")}
          style={{ borderColor: "rgba(56, 189, 248, 0.4)", color: "#38bdf8" }}
        >
          <Sparkles size={15} />
          Perguntar à IRIS
        </button>
      </nav>

      {/* ------------------------------------------------------------------
          1. ABA RESUMO
          ------------------------------------------------------------------ */}
      {activeTab === "resumo" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          <div className="iris-health-grid-4">
            <div className="iris-health-card">
              <div className="iris-health-card-header">
                <h3>Exames Arquivados</h3>
                <span className="badge">Total</span>
              </div>
              <div className="iris-health-stat-value">{summary.totalExams}</div>
              <div className="iris-health-stat-sub">Laudos laboratoriais catalogados</div>
            </div>

            <div className="iris-health-card">
              <div className="iris-health-card-header">
                <h3>Marcadores</h3>
                <span className="badge">Clínicos</span>
              </div>
              <div className="iris-health-stat-value">{summary.totalMarkers}</div>
              <div className="iris-health-stat-sub">
                {summary.alteredMarkers > 0 ? (
                  <span style={{ color: "#fb7185" }}>⚠️ {summary.alteredMarkers} fora da referência</span>
                ) : (
                  "Todos dentro da referência"
                )}
              </div>
            </div>

            <div className="iris-health-card">
              <div className="iris-health-card-header">
                <h3>Pressão Arterial</h3>
                <span className="badge">Sinais</span>
              </div>
              <div className="iris-health-stat-value" style={{ fontSize: "24px" }}>
                {summary.latestPressure || "Sem registro"}
              </div>
              <div className="iris-health-stat-sub">Última aferição indicada</div>
            </div>

            <div className="iris-health-card">
              <div className="iris-health-card-header">
                <h3>Medicamentos</h3>
                <span className="badge">Em Uso</span>
              </div>
              <div className="iris-health-stat-value">{summary.activeMedications}</div>
              <div className="iris-health-stat-sub">Tratamentos ativos registrados</div>
            </div>
          </div>

          {/* PAINEL DE AÇÃO RÁPIDA & DIRETRIZES ÉTICAS */}
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <Button
              onClick={() => setActiveTab("exames")}
              style={{ background: "var(--iris-blue)", color: "#fff" }}
            >
              <UploadCloud size={16} /> Adicionar Exame (PDF/JPG/PNG)
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setActiveTab("pergunta");
                void handleAskIris("IRIS, compare meus últimos 3 exames.");
              }}
            >
              <Sparkles size={16} /> Comparar Últimos Exames com a Iris
            </Button>
          </div>

          <div className="iris-health-security-box">
            <h4>
              <ShieldCheck size={18} color="#22d3ee" />
              Diretrizes Éticas e Proteção de Dados de Saúde
            </h4>
            <p style={{ margin: 0, fontSize: "13px", color: "#94a3b8", lineHeight: 1.5 }}>
              Os dados de saúde são estritamente privados e armazenados sob controle exclusivo do usuário.
              A Iris opera dentro de limites de segurança rigorosos:
            </p>
            <div className="iris-health-security-list">
              <div className="iris-health-security-item positive">
                <span className="icon">✓</span>
                <div>
                  <strong>A Iris está autorizada a:</strong>
                  <div>Ler, catalogar, explicar laudos, comparar datas e apresentar tendências históricas.</div>
                </div>
              </div>
              <div className="iris-health-security-item restricted">
                <span className="icon">✕</span>
                <div>
                  <strong>A Iris NUNCA irá:</strong>
                  <div>Inventar diagnósticos, alterar resultados laboratoriais ou prescrever medicações.</div>
                </div>
              </div>
              <div className="iris-health-security-item positive">
                <span className="icon">✓</span>
                <div>
                  <strong>Soberania do Usuário:</strong>
                  <div>Nenhum documento é excluído ou alterado sem consentimento explícito.</div>
                </div>
              </div>
              <div className="iris-health-security-item restricted">
                <span className="icon">✕</span>
                <div>
                  <strong>Sigilo Absoluto:</strong>
                  <div>Seus dados médicos nunca são vendidos, vazados ou enviados a terceiros.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------
          2. ABA EXAMES (RECEBIMENTO, UPLOAD & CADASTRO)
          ------------------------------------------------------------------ */}
      {activeTab === "exames" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          {/* DROPZONE DE ENTRADA */}
          <div
            className={`iris-health-dropzone ${isDragging ? "dragging" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              void handleFileUpload(e.dataTransfer.files);
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: "none" }}
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(e) => void handleFileUpload(e.target.files)}
            />
            <div className="iris-health-dropzone-icon">
              {isUploading ? <Loader2 className="animate-spin" size={28} /> : <UploadCloud size={28} />}
            </div>
            <strong>
              {isUploading ? "Processando e extraindo biomarcadores..." : "Adicionar Exame para Leitura Inteligente"}
            </strong>
            <p>
              Arraste e solte o arquivo aqui ou clique para selecionar. A Iris identificará data, laboratório
              e biomarcadores clínicos de forma automática e confidencial.
            </p>
            <div className="iris-health-formats-badge">
              <span className="iris-health-format-chip">PDF</span>
              <span className="iris-health-format-chip">JPG</span>
              <span className="iris-health-format-chip">PNG</span>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h4 style={{ margin: 0, fontSize: "14px", color: "#fff" }}>Laudos Arquivados ({exams.length})</h4>
            <Button variant="outline" size="sm" onClick={() => setShowAddManual(!showAddManual)}>
              <Plus size={14} /> {showAddManual ? "Cancelar Entrada Manual" : "Digitar Laudo Manualmente"}
            </Button>
          </div>

          {/* FORMULÁRIO DE ENTRADA MANUAL DE LAUDO */}
          {showAddManual && (
            <div className="iris-health-form-box">
              <h4 style={{ margin: 0, fontSize: "14px", color: "var(--iris-cyan)" }}>
                Cadastro Manual / Colagem de Laudo Laboratorial
              </h4>
              <div className="iris-health-form-row">
                <Input
                  placeholder="Nome do exame (Ex: Exame de Sangue Perfil Lipídico)"
                  value={manualExam.fileName}
                  onChange={(e) => setManualExam({ ...manualExam, fileName: e.target.value })}
                />
                <Input
                  type="date"
                  placeholder="Data do exame"
                  value={manualExam.examDate}
                  onChange={(e) => setManualExam({ ...manualExam, examDate: e.target.value })}
                />
                <Input
                  placeholder="Laboratório (opcional)"
                  value={manualExam.laboratory}
                  onChange={(e) => setManualExam({ ...manualExam, laboratory: e.target.value })}
                />
              </div>
              <textarea
                placeholder="Cole o texto ou resultados do laudo aqui. A Iris extrairá automaticamente marcadores como Colesterol Total, HDL, LDL, Triglicerídeos, Glicemia, Hemoglobina, TSH, etc."
                value={manualExam.reportText}
                onChange={(e) => setManualExam({ ...manualExam, reportText: e.target.value })}
                style={{
                  minHeight: "120px",
                  background: "#060b16",
                  border: "1px solid var(--iris-border)",
                  borderRadius: "10px",
                  color: "#fff",
                  padding: "10px",
                  fontSize: "13px",
                  fontFamily: "monospace",
                }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                <Button variant="outline" onClick={() => setShowAddManual(false)}>
                  Cancelar
                </Button>
                <Button
                  onClick={() => void handleSaveManualExam()}
                  disabled={addManualMutation.isPending}
                  style={{ background: "var(--iris-green)", color: "#fff" }}
                >
                  {addManualMutation.isPending ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}
                  Processar e Salvar Exame
                </Button>
              </div>
            </div>
          )}

          {/* LISTA DE EXAMES ENVIADOS */}
          {exams.length === 0 ? (
            <div className="iris-health-empty">
              <div className="iris-health-empty-icon">
                <FileCheck size={24} />
              </div>
              <h4>Nenhum exame cadastrado no momento</h4>
              <p>
                Os laudos laboratoriais enviados aparecerão aqui com os marcadores extraídos e organizados
                de forma cronológica e estruturada.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {exams.map((doc) => (
                <div
                  key={doc.id}
                  style={{
                    padding: "14px 18px",
                    borderRadius: "14px",
                    background: "rgba(14, 26, 48, 0.6)",
                    border: "1px solid var(--iris-border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <FileText size={20} color="#38bdf8" />
                    <div>
                      <strong style={{ fontSize: "14px", color: "#fff" }}>{doc.fileName}</strong>
                      <div style={{ fontSize: "12px", color: "var(--iris-muted)" }}>
                        {doc.fileFormat.toUpperCase()} · {doc.laboratory ? `${doc.laboratory} · ` : ""}
                        Data: {doc.examDate ? new Date(doc.examDate).toLocaleDateString("pt-BR") : "Não indicada"} ·{" "}
                        <span style={{ color: "var(--iris-cyan)", fontWeight: 600 }}>
                          {doc.markersCount} marcadores
                        </span>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setActiveTab("historico");
                        setSearchQuery(doc.fileName.slice(0, 15));
                      }}
                    >
                      Ver Marcadores
                    </Button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteExam(doc.id, doc.fileName)}
                      title="Excluir exame"
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--iris-muted)",
                        cursor: "pointer",
                        padding: "6px",
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------
          3. ABA HISTÓRICO (TABELA DE MARCADORES E FILTROS)
          ------------------------------------------------------------------ */}
      {activeTab === "historico" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* BUSCA E FILTROS */}
          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ position: "relative", minWidth: "220px", flex: 1 }}>
              <Search
                size={14}
                style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--iris-muted)" }}
              />
              <Input
                placeholder="Buscar marcador (ex: Colesterol, Glicemia, TSH)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ paddingLeft: 32, background: "#060b16" }}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {[
              { id: "todas", label: "Todos os Marcadores" },
              { id: "perfil_lipidico", label: "Colesterol & Lipídios" },
              { id: "glicemia", label: "Glicemia / HbA1c" },
              { id: "hemograma", label: "Hemograma" },
              { id: "hormonios", label: "Hormônios" },
              { id: "tireoide", label: "Tireoide (TSH/T4)" },
              { id: "funcao_renal", label: "Função Renal" },
              { id: "funcao_hepatica", label: "Função Hepática" },
              { id: "vitaminas_minerais", label: "Vitaminas & Minerais" },
            ].map((cat) => (
              <button
                key={cat.id}
                type="button"
                className={`iris54-filter-btn ${selectedCategory === cat.id ? "active" : ""}`}
                onClick={() => setSelectedCategory(cat.id as any)}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* TABELA ESTRUTURADA */}
          {markers.length === 0 ? (
            <div className="iris-health-empty">
              <div className="iris-health-empty-icon">
                <Clock size={24} />
              </div>
              <h4>Nenhum marcador registrado</h4>
              <p>
                A tabela estruturada comparará automaticamente as colunas{" "}
                <strong>Marcador | Data | Resultado | Unidade | Referência</strong> assim que seus laudos forem
                recebidos.
              </p>
            </div>
          ) : (
            <div className="iris-health-table-container">
              <table className="iris-health-table">
                <thead>
                  <tr>
                    <th>Marcador</th>
                    <th>Data</th>
                    <th>Resultado</th>
                    <th>Unidade</th>
                    <th>Referência Fornecida</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {markers.map((marker) => (
                    <tr key={marker.id}>
                      <td>
                        <div className="iris-health-marker-name">{marker.markerName}</div>
                        <span className="iris-health-marker-tag">{marker.category}</span>
                      </td>
                      <td>{marker.examDate}</td>
                      <td style={{ fontWeight: 800, color: marker.status === "alterado" ? "#fb7185" : "#fff" }}>
                        {marker.result}
                      </td>
                      <td>{marker.unit}</td>
                      <td style={{ color: "var(--iris-muted)" }}>{marker.referenceRange || "Não fornecida no laudo"}</td>
                      <td>
                        {marker.status === "alterado" ? (
                          <span className="iris-health-pill-altered">Fora da Ref.</span>
                        ) : (
                          <span className="iris-health-pill-normal">Normal</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------
          4. ABA EVOLUÇÃO & COMPARAÇÃO (SÉRIE HISTÓRICA E DELTAS)
          ------------------------------------------------------------------ */}
      {activeTab === "evolucao" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="iris-health-card">
            <div className="iris-health-card-header">
              <h3>
                <TrendingUp size={16} color="#38bdf8" /> Série Histórica e Comparação Temporal
              </h3>
              <span className="badge">Evolução Clínica</span>
            </div>
            <p style={{ margin: 0, fontSize: "13px", color: "var(--iris-muted)", lineHeight: 1.5 }}>
              Acompanhamento de biomarcadores comparando exames laboratoriais realizados em datas distintas
              (exemplo: 2024, 2025, 2026), identificando variações absolutas e estabilidade clínica.
            </p>
          </div>

          {comparisons.length === 0 ? (
            <div className="iris-health-empty">
              <div className="iris-health-empty-icon">
                <TrendingUp size={24} />
              </div>
              <h4>Aguardando exames laboratoriais</h4>
              <p>
                Assim que você adicionar seus exames na aba <strong>Exames</strong>, a Iris calculará
                automaticamente a evolução de cada marcador entre as datas cadastradas.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {comparisons.map((row) => (
                <div className="iris-health-compare-card" key={row.markerName}>
                  <div className="iris-health-compare-header">
                    <div>
                      <strong style={{ fontSize: "15px", color: "#fff" }}>{row.markerName}</strong>
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: "11px",
                          color: "var(--iris-muted)",
                        }}
                      >
                        Ref: {row.referenceRange || "Não informada"} ({row.unit})
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {row.alert && (
                        <span className="iris-health-pill-altered">
                          <AlertCircle size={12} /> Alerta Clínico
                        </span>
                      )}
                      {row.trend === "aumento" && (
                        <span
                          className="iris-health-pill-trend"
                          style={{ background: "rgba(239, 68, 68, 0.15)", color: "#f87171" }}
                        >
                          <ArrowUpRight size={13} /> {row.delta} {row.unit}
                        </span>
                      )}
                      {row.trend === "reducao" && (
                        <span
                          className="iris-health-pill-trend"
                          style={{ background: "rgba(16, 185, 129, 0.15)", color: "#34d399" }}
                        >
                          <ArrowDownRight size={13} /> {row.delta} {row.unit}
                        </span>
                      )}
                      {row.trend === "estavel" && (
                        <span
                          className="iris-health-pill-trend"
                          style={{ background: "rgba(59, 130, 246, 0.15)", color: "#93c5fd" }}
                        >
                          <Minus size={13} /> Estável
                        </span>
                      )}
                    </div>
                  </div>

                  {/* SÉRIE HISTÓRICA VISUAL (ex: 2024 — 198, 2025 — 211, 2026 — 226) */}
                  <div className="iris-health-timeline-row">
                    {row.measurements.map((m, idx) => (
                      <React.Fragment key={`${m.date}-${idx}`}>
                        <div className="iris-health-timeline-item">
                          <span className="iris-health-timeline-year">
                            {m.date ? m.date.slice(0, 4) : "—"} ({m.date})
                          </span>
                          <span
                            className="iris-health-timeline-val"
                            style={{ color: m.status === "alterado" ? "#fb7185" : "#fff" }}
                          >
                            {m.result} <small style={{ fontSize: "11px", color: "var(--iris-muted)" }}>{row.unit}</small>
                          </span>
                        </div>
                        {idx < row.measurements.length - 1 && (
                          <span className="iris-health-timeline-arrow">→</span>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------
          5. ABA SINAIS VITAIS & INDICADORES (PRESSÃO, GLICEMIA, PESO)
          ------------------------------------------------------------------ */}
      {activeTab === "indicadores" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h4 style={{ margin: 0, fontSize: "14px", color: "#fff" }}>Monitoramento de Sinais Vitais</h4>
            <Button variant="outline" size="sm" onClick={() => setShowAddMeasurement(!showAddMeasurement)}>
              <Plus size={14} /> Registrar Medição
            </Button>
          </div>

          {showAddMeasurement && (
            <div className="iris-health-form-box">
              <h4 style={{ margin: 0, fontSize: "14px", color: "var(--iris-cyan)" }}>Nova Medição Vital</h4>
              <div className="iris-health-form-row">
                <select
                  value={newMeasure.type}
                  onChange={(e) => {
                    const t = e.target.value;
                    let u = "mmHg";
                    if (t === "peso") u = "kg";
                    else if (t === "glicemia") u = "mg/dL";
                    setNewMeasure({ ...newMeasure, type: t, unit: u });
                  }}
                  style={{
                    background: "#060b16",
                    border: "1px solid var(--iris-border)",
                    borderRadius: "8px",
                    color: "#fff",
                    padding: "8px",
                  }}
                >
                  <option value="pressao_arterial">Pressão Arterial (mmHg)</option>
                  <option value="peso">Peso Corporal (kg)</option>
                  <option value="glicemia">Glicemia Capilar (mg/dL)</option>
                </select>

                <Input
                  placeholder={newMeasure.type === "pressao_arterial" ? "Ex: 120/80" : "Ex: 78.5"}
                  value={newMeasure.value}
                  onChange={(e) => setNewMeasure({ ...newMeasure, value: e.target.value })}
                />

                <Input
                  type="date"
                  value={newMeasure.measuredAt}
                  onChange={(e) => setNewMeasure({ ...newMeasure, measuredAt: e.target.value })}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <Button variant="outline" onClick={() => setShowAddMeasurement(false)}>
                  Cancelar
                </Button>
                <Button
                  onClick={() => void handleSaveMeasurement()}
                  disabled={addMeasurementMutation.isPending}
                  style={{ background: "var(--iris-blue)", color: "#fff" }}
                >
                  Salvar Medição
                </Button>
              </div>
            </div>
          )}

          <div className="iris-health-grid-2">
            {/* PRESSÃO ARTERIAL */}
            <div className="iris-health-card">
              <div className="iris-health-card-header">
                <h3>
                  <Heart size={16} color="#22d3ee" /> Pressão Arterial
                </h3>
                <span className="badge">Cardiovascular</span>
              </div>
              <div style={{ fontSize: "28px", fontWeight: 800, color: "#fff", marginTop: 4 }}>
                {pressures[0] ? `${pressures[0].value} ${pressures[0].unit}` : "Sem medições"}
              </div>
              <div className="iris-health-stat-sub">
                {pressures[0] ? `Aferida em ${new Date(pressures[0].measuredAt).toLocaleDateString("pt-BR")}` : "Registre sua pressão para acompanhamento contínuo"}
              </div>
            </div>

            {/* PESO E IMC */}
            <div className="iris-health-card">
              <div className="iris-health-card-header">
                <h3>
                  <Scale size={16} color="#34d399" /> Peso Corporal
                </h3>
                <span className="badge">Antropometria</span>
              </div>
              <div style={{ fontSize: "28px", fontWeight: 800, color: "#fff", marginTop: 4 }}>
                {weights[0] ? `${weights[0].value} ${weights[0].unit}` : "Sem medições"}
              </div>
              <div className="iris-health-stat-sub">
                {weights[0] ? `Registrado em ${new Date(weights[0].measuredAt).toLocaleDateString("pt-BR")}` : "Acompanhe suas medidas ao longo do tempo"}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------
          6. ABA MEDICAMENTOS & SUPLEMENTOS
          ------------------------------------------------------------------ */}
      {activeTab === "medicamentos" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h4 style={{ margin: 0, fontSize: "14px", color: "#fff" }}>
                Medicamentos &amp; Suplementos em Uso ({medications.length})
              </h4>
              <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--iris-muted)" }}>
                Organização pessoal de posologia e tratamentos informados por você ou seus médicos.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowAddMedication(!showAddMedication)}>
              <Plus size={14} /> Adicionar
            </Button>
          </div>

          {showAddMedication && (
            <div className="iris-health-form-box">
              <h4 style={{ margin: 0, fontSize: "14px", color: "var(--iris-cyan)" }}>Novo Item</h4>
              <div className="iris-health-form-row">
                <Input
                  placeholder="Nome (Ex: Coenzima Q10, Losartana)"
                  value={newMed.name}
                  onChange={(e) => setNewMed({ ...newMed, name: e.target.value })}
                />
                <Input
                  placeholder="Dosagem (Ex: 100mg, 50mg)"
                  value={newMed.dosage}
                  onChange={(e) => setNewMed({ ...newMed, dosage: e.target.value })}
                />
                <Input
                  placeholder="Frequência (Ex: 1x ao dia pela manhã)"
                  value={newMed.frequency}
                  onChange={(e) => setNewMed({ ...newMed, frequency: e.target.value })}
                />
                <select
                  value={newMed.type}
                  onChange={(e) => setNewMed({ ...newMed, type: e.target.value as any })}
                  style={{
                    background: "#060b16",
                    border: "1px solid var(--iris-border)",
                    borderRadius: "8px",
                    color: "#fff",
                    padding: "8px",
                  }}
                >
                  <option value="medicamento">Medicamento</option>
                  <option value="suplemento">Suplemento</option>
                </select>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <Button variant="outline" onClick={() => setShowAddMedication(false)}>
                  Cancelar
                </Button>
                <Button
                  onClick={() => void handleSaveMedication()}
                  disabled={addMedicationMutation.isPending}
                  style={{ background: "var(--iris-green)", color: "#fff" }}
                >
                  Salvar
                </Button>
              </div>
            </div>
          )}

          {medications.length === 0 ? (
            <div className="iris-health-empty">
              <div className="iris-health-empty-icon">
                <Pill size={24} />
              </div>
              <h4>Nenhum medicamento ou suplemento cadastrado</h4>
              <p>Cadastre seus medicamentos e suplementos para manter seus horários e posologias organizados.</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {medications.map((med) => (
                <div
                  key={med.id}
                  style={{
                    padding: "14px 18px",
                    borderRadius: "14px",
                    background: "rgba(14, 26, 48, 0.6)",
                    border: "1px solid var(--iris-border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <Pill size={18} color={med.type === "suplemento" ? "#34d399" : "#38bdf8"} />
                    <div>
                      <strong style={{ fontSize: "14px", color: "#fff" }}>{med.name}</strong>
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: "11px",
                          fontWeight: 700,
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: med.type === "suplemento" ? "rgba(16, 185, 129, 0.15)" : "rgba(59, 130, 246, 0.15)",
                          color: med.type === "suplemento" ? "#6ee7b7" : "#93c5fd",
                          textTransform: "uppercase",
                        }}
                      >
                        {med.type}
                      </span>
                      <div style={{ fontSize: "12px", color: "var(--iris-muted)", marginTop: 2 }}>
                        {med.dosage} · {med.frequency}
                        {med.startDate ? ` · Desde ${new Date(med.startDate).toLocaleDateString("pt-BR")}` : ""}
                      </div>
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      padding: "3px 8px",
                      borderRadius: 6,
                      background: "rgba(16, 185, 129, 0.12)",
                      color: "#34d399",
                    }}
                  >
                    Ativo
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------
          7. ABA DOCUMENTOS
          ------------------------------------------------------------------ */}
      {activeTab === "documentos" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="iris-health-card">
            <div className="iris-health-card-header">
              <h3>
                <FileText size={16} color="#38bdf8" /> Cofre de Documentos de Saúde
              </h3>
              <span className="badge">Criptografia &amp; Privacidade</span>
            </div>
            <p style={{ margin: 0, fontSize: "13px", color: "var(--iris-muted)", lineHeight: 1.5 }}>
              Todos os laudos e receitas em PDF, JPG e PNG são armazenados com integridade e vinculados aos
              seus respectivos registros médicos.
            </p>
          </div>

          {exams.length === 0 ? (
            <div className="iris-health-empty">
              <div className="iris-health-empty-icon">
                <FileText size={24} />
              </div>
              <h4>Nenhum documento médico anexado</h4>
              <p>Envie laudos na aba Exames para compor o cofre permanente de saúde da Iris.</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {exams.map((doc) => (
                <div
                  key={doc.id}
                  style={{
                    padding: "14px 18px",
                    borderRadius: "14px",
                    background: "rgba(14, 26, 48, 0.6)",
                    border: "1px solid var(--iris-border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <FileText size={20} color="#22d3ee" />
                    <div>
                      <strong style={{ fontSize: "14px", color: "#fff" }}>{doc.fileName}</strong>
                      <div style={{ fontSize: "12px", color: "var(--iris-muted)" }}>
                        {doc.fileFormat.toUpperCase()} · {(doc.sizeBytes / 1024).toFixed(1)} KB ·{" "}
                        {doc.markersCount} marcadores vinculados
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--iris-muted)" }}>
                    {doc.examDate ? new Date(doc.examDate).toLocaleDateString("pt-BR") : "Data não informada"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------
          8. ABA PERGUNTAR À IRIS (CONSULTA CLÍNICA E COMPARAÇÃO)
          ------------------------------------------------------------------ */}
      {activeTab === "pergunta" && (
        <div className="iris-health-ask-container">
          <div className="iris-health-card">
            <div className="iris-health-card-header">
              <h3>
                <Sparkles size={16} color="#22d3ee" /> Perguntar à IRIS sobre sua Saúde
              </h3>
              <span className="badge">Inteligência Médica Segura</span>
            </div>
            <p style={{ margin: 0, fontSize: "13px", color: "var(--iris-muted)", lineHeight: 1.5 }}>
              A Iris analisa e compara seus laudos com precisão matemática sem jamais inventar dados ou
              diagnósticos. Peça comparações de datas, explicações de marcadores ou relatórios detalhados.
            </p>
          </div>

          {/* PERGUNTAS RÁPIDAS SUGERIDAS */}
          <div className="iris-health-prompt-pills">
            {[
              "IRIS, compare meus últimos 3 exames.",
              "Como está a evolução do meu colesterol?",
              "Quais marcadores estão fora da referência?",
              "Explique meus resultados de glicose e HbA1c.",
            ].map((p) => (
              <button
                key={p}
                type="button"
                className="iris-health-prompt-pill"
                onClick={() => void handleAskIris(p)}
              >
                {p}
              </button>
            ))}
          </div>

          {/* INPUT DE PERGUNTA */}
          <div style={{ display: "flex", gap: "10px" }}>
            <Input
              placeholder="Digite sua dúvida clínica (ex: IRIS, compare meus exames de 2024, 2025 e 2026)..."
              value={askQuestion}
              onChange={(e) => setAskQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleAskIris();
              }}
              style={{ background: "#060b16", borderColor: "var(--iris-border)", color: "#fff" }}
            />
            <Button
              onClick={() => void handleAskIris()}
              disabled={askIrisMutation.isPending}
              style={{ background: "var(--iris-blue)", color: "#fff" }}
            >
              {askIrisMutation.isPending ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
              Perguntar
            </Button>
          </div>

          {/* RESPOSTA DA IRIS */}
          {askReply && (
            <div className="iris-health-reply-box">
              <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--iris-cyan)" }}>
                <Sparkles size={18} />
                <strong>Resposta da Iris IA</strong>
              </div>

              {/* TEXTO FORMATADO COM TABELAS */}
              <div
                style={{
                  fontSize: "14px",
                  color: "#f1f5f9",
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                }}
              >
                {askReply.reply}
              </div>

              {/* DISCLAIMER ÉTICO OBRIGATÓRIO */}
              <div className="iris-health-disclaimer">
                <HelpCircle size={14} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />
                {askReply.disclaimer}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
