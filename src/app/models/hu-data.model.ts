import { DetailedTestCase } from '../services/gemini.service';

// MODIFIED: Added 'flowComparison'
export type GenerationMode = 'text' | 'image' | 'flowAnalysis' | 'flowComparison';

export interface FlowAnalysisStep {
  numero_paso: number;
  descripcion_accion_observada: string;
  imagen_referencia_entrada: string;
  elemento_clave_y_ubicacion_aproximada: string;
  dato_de_entrada_paso?: string;
  resultado_esperado_paso: string;
  resultado_obtenido_paso_y_estado: string;
}

export interface FlowAnalysisReportItem {
  Nombre_del_Escenario: string;
  Pasos_Analizados: FlowAnalysisStep[];
  Resultado_Esperado_General_Flujo: string;
  Conclusion_General_Flujo: string;
}

// NEW: BugReportStep interface
export interface BugReportStep {
  numero_paso: number;
  descripcion: string;
}

// NEW: BugReportItem interface
export interface BugReportItem {
  titulo_bug: string;
  id_bug: string;
  prioridad: 'Baja' | 'Media' | 'Alta' | 'Crítica' | string;
  severidad: 'Menor' | 'Moderada' | 'Mayor' | 'Crítica' | string;
  reportado_por?: string;
  fecha_reporte?: string;
  version_entorno?: {
    aplicacion?: string;
    sistema_operativo?: string;
    navegador?: string;
    ambiente?: string;
  };
  pasos_para_reproducir: BugReportStep[];
  resultado_esperado: string;
  resultado_actual: string;
  imagen_referencia_flujo_a?: string; // e.g., "Imagen A.1"
  imagen_referencia_flujo_b?: string; // e.g., "Imagen B.1"
  descripcion_diferencia_general?: string;
}


export interface HUData {
  originalInput: {
    id: string;
    title: string;
    sprint: string;
    description?: string;
    acceptanceCriteria?: string;
    selectedTechnique: string;
    generationMode: GenerationMode;

    // For 'image' and 'flowAnalysis'
    imagesBase64?: string[];
    imageMimeTypes?: string[];

    // NEW: For 'flowComparison'
    imagesBase64FlowA?: string[];
    imageMimeTypesFlowA?: string[];
    imagesBase64FlowB?: string[];
    imageMimeTypesFlowB?: string[];
  };
  id: string;
  title: string;
  sprint: string;

  generatedScope: string;
  detailedTestCases: DetailedTestCase[];
  generatedTestCaseTitles: string;

  editingScope: boolean;
  editingScenarios: boolean;

  loadingScope: boolean;
  errorScope: string | null;
  loadingScenarios: boolean;
  errorScenarios: string | null;

  showRegenTechniquePicker: boolean;
  regenSelectedTechnique: string;

  isScopeDetailsOpen: boolean;
  isScenariosDetailsOpen: boolean;

  flowAnalysisReport?: FlowAnalysisReportItem[];
  loadingFlowAnalysis?: boolean;
  errorFlowAnalysis?: string | null;
  isFlowAnalysisDetailsOpen?: boolean;
  isEditingFlowReportDetails?: boolean;

  // NEW: For 'flowComparison' results
  bugComparisonReport?: BugReportItem[];
  loadingBugComparison?: boolean;
  errorBugComparison?: string | null;
  isBugComparisonDetailsOpen?: boolean;
}