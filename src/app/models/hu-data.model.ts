// anbepa/test-plan-app/test-plan-app-114d3b7ac03726fd5931cc480f86ec71001e021a/src/app/models/hu-data.model.ts
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
  imagen_referencia_entrada: string; // Nombre o identificador de la imagen (ej: "Imagen 1", "A.1.png")
  elemento_clave_y_ubicacion_aproximada: string;
  dato_de_entrada_paso?: string;
  resultado_esperado_paso: string;
  resultado_obtenido_paso_y_estado: string;
  imagen_referencia_salida?: string; // Nombre o identificador de la imagen resultado del paso
  userStepContext?: string; // NUEVO: Notas del usuario para este paso específico
}

export interface FlowAnalysisReportItem {
  Nombre_del_Escenario: string;
  Pasos_Analizados: FlowAnalysisStep[];
  Resultado_Esperado_General_Flujo: string;
  Conclusion_General_Flujo: string;
  // user_provided_additional_context se usa en GeminiService como un string para el prompt,
  // no directamente en el modelo de reporte que Gemini devuelve.
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
  imagen_referencia_flujo_a?: string; // Nombre o identificador de la imagen de Flujo A
  imagen_referencia_flujo_b?: string; // Nombre o identificador de la imagen de Flujo B
  descripcion_diferencia_general?: string;
}

// --- INTERFAZ PARA ANOTACIONES DE IMAGEN ---
export interface ImageAnnotation {
  sequence: number;
  description: string;
  x: number; // Normalizado (0-1)
  y: number; // Normalizado (0-1)
  width: number; // Normalizado (0-1)
  height: number; // Normalizado (0-1)
  imageFilename?: string; // Nombre del archivo original de la imagen a la que pertenece
  flowType?: 'A' | 'B'; // Para saber a qué flujo pertenece, si es general para la HU
  imageIndex?: number; // Para saber a qué imagen dentro del flujo A o B pertenece
  elementType?: string; // NUEVO: Ej: 'Input Field', 'Button', 'Data Element', 'Log Entry'
  elementValue?: string; // NUEVO: Ej: 'user@example.com', 'Login Successful', 'Error Code: 500'
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
    imagesBase64?: string[]; // Puede ser original o anotada si es relevante para el modo
    imageMimeTypes?: string[];
    imageFilenames?: string[]; // Nombres originales de los archivos para referencia
    imagesBase64FlowA?: string[]; // Puede ser original o anotada
    imageMimeTypesFlowA?: string[];
    imageFilenamesFlowA?: string[];
    imagesBase64FlowB?: string[]; // Puede ser original o anotada
    imageMimeTypesFlowB?: string[];
    imageFilenamesFlowB?: string[];
    // Almacena todas las anotaciones, pueden ser filtradas o mapeadas después.
    // Para Gemini, el contexto adicional se construirá con esta información.
    annotationsFlowA?: ImageAnnotation[]; // Ahora se usará para cualquier flujo de análisis/comparación
    annotationsFlowB?: ImageAnnotation[]; // Para flujos de comparación
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
  userReanalysisContext?: string; // Contexto general para regenerar análisis de flujo
  // Las anotaciones por paso se almacenarán dentro de flowAnalysisReport[0].Pasos_Analizados[n].userStepContext

  bugComparisonReport?: BugReportItem[];
  loadingBugComparison?: boolean;
  errorBugComparison?: string | null;
  isBugComparisonDetailsOpen?: boolean;
  userBugComparisonReanalysisContext?: string; // Contexto para comparar flujos
}