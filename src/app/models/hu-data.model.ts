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
export type GenerationMode = 'text' | 'image';

// --- Interfaz Principal HUData ---
export interface HUData {
  id: string;
  title: string;
  sprint: string;
  originalInput: {
    generationMode: GenerationMode;
    description?: string;
    acceptanceCriteria?: string;
    imagesBase64?: string[];
    selectedTechnique?: string;
  };
  generatedScope?: string;
  generatedTestCaseTitles?: string;
  detailedTestCases?: DetailedTestCase[];
  editingScope?: boolean;
  isScopeDetailsOpen?: boolean;
  loadingScope?: boolean;
  errorScope?: string | null;
  // ... otros campos necesarios para 'text' e 'image' ...
}