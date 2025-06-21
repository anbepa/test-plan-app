// src/app/models/hu-data.model.ts

// Definiciones para Casos de Prueba Detallados
export interface TestCaseStep {
  numero_paso: number;
  accion: string;
}

export interface DetailedTestCase {
  title: string;
  preconditions: string;
  steps: TestCaseStep[];
  expectedResults: string;
}

// --- Interfaces para Análisis de Flujo ---
export interface FlowAnalysisStep {
  numero_paso: number;
  descripcion_accion_observada: string;
  imagen_referencia_entrada: string;
  elemento_clave_y_ubicacion_aproximada: string;
  dato_de_entrada_paso?: string;
  resultado_esperado_paso: string;
  resultado_obtenido_paso_y_estado: string;
  imagen_referencia_salida?: string;
  userStepContext?: string;
}

export interface FlowAnalysisReportItem {
  Nombre_del_Escenario: string;
  Pasos_Analizados: FlowAnalysisStep[];
  Resultado_Esperado_General_Flujo: string;
  Conclusion_General_Flujo: string;
}

// --- Interfaces para Reporte de Bugs (Comparación de Flujos) ---
export interface BugReportStep {
  numero_paso: number;
  descripcion: string;
}

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
  imagen_referencia_flujo_a?: string;
  imagen_referencia_flujo_b?: string;
  descripcion_diferencia_general?: string;
}

// --- INTERFAZ ENRIQUECIDA PARA ANOTACIONES DE IMAGEN ---
export interface ImageAnnotation {
  sequence: number;
  description: string;
  x: number; // Normalizado (0-1)
  y: number; // Normalizado (0-1)
  width: number; // Normalizado (0-1)
  height: number; // Normalizado (0-1)
  type: 'trigger' | 'input' | 'verification' | 'observation'; // Tipo semántico de la anotación
  imageFilename?: string;
  flowType?: 'A' | 'B';
  imageIndex?: number;
  elementType?: string; // (Opcional, de la IA) Ej: 'Botón', 'Campo de Entrada'
  elementValue?: string; // (Opcional, de la IA o usuario) Ej: 'admin', 'Login exitoso'
}

// --- INTERFACES PARA EL NUEVO FLUJO GUIADO ---
export interface AIPreAnalysisResult {
    description: string;
    elements: { element: string, type: string }[];
}

export interface GuidedFlowStepContext {
    step: number;
    image: {
        file: File;
        base64: string;
        mimeType: string;
        filename: string;
        preview: string | ArrayBuffer;
        annotatedPreview?: string | ArrayBuffer;
    };
    aiPreAnalysis: AIPreAnalysisResult | null;
    userDescription: string;
    annotations: ImageAnnotation[];
}


// --- Tipo para el Modo de Generación ---
export type GenerationMode = 'text' | 'image' | 'flowAnalysis' | 'flowComparison';

// --- Interfaz Principal HUData ---
export interface HUData {
  originalInput: {
    id: string;
    title: string;
    sprint: string;
    description?: string;
    acceptanceCriteria?: string;
    selectedTechnique: string;
    generationMode: GenerationMode;
    imagesBase64?: string[];
    imageMimeTypes?: string[];
    imageFilenames?: string[];
    imagesBase64FlowA?: string[];
    imageMimeTypesFlowA?: string[];
    imageFilenamesFlowA?: string[];
    imagesBase64FlowB?: string[];
    imageMimeTypesFlowB?: string[];
    imageFilenamesFlowB?: string[];
    annotationsFlowA?: ImageAnnotation[];
    annotationsFlowB?: ImageAnnotation[];

    // NUEVO: Para almacenar el resultado del flujo guiado
    guidedFlowSteps?: GuidedFlowStepContext[];
  };
  id: string;
  title: string;
  sprint: string;
  generatedScope: string;
  detailedTestCases: DetailedTestCase[];
  generatedTestCaseTitles: string;

  editingScope: boolean;
  loadingScope: boolean;
  errorScope: string | null;
  isScopeDetailsOpen: boolean;

  editingScenarios: boolean;
  loadingScenarios: boolean;
  errorScenarios: string | null;
  showRegenTechniquePicker: boolean;
  regenSelectedTechnique: string;
  userTestCaseReanalysisContext: string;
  isScenariosDetailsOpen: boolean;
  isEditingDetailedTestCases?: boolean;

  flowAnalysisReport?: FlowAnalysisReportItem[];
  loadingFlowAnalysis?: boolean;
  errorFlowAnalysis?: string | null;
  isFlowAnalysisDetailsOpen?: boolean;
  isEditingFlowReportDetails?: boolean;
  userReanalysisContext?: string;
  
  bugComparisonReport?: BugReportItem[];
  loadingBugComparison?: boolean;
  errorBugComparison?: string | null;
  isBugComparisonDetailsOpen?: boolean;
  userBugComparisonReanalysisContext?: string;
}