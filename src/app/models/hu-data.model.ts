// src/app/models/hu-data.model.ts

// Definiciones para Casos de Prueba Detallados
export interface TestCaseStep {
  numero_paso: number;
  accion: string;
  dbId?: string;
}

export interface DetailedTestCase {
  title: string;
  preconditions: string;
  steps: TestCaseStep[];
  expectedResults: string;
  isExpanded?: boolean;
  dbId?: string;
  position?: number;
}

// --- Tipo para el Modo de Generación ---
export type GenerationMode = 'text';

// --- Interfaces para Ejecución del Plan ---
export interface ImageEvidence {
  id: string;
  stepId: string;
  fileName: string;
  base64Data: string;
  originalBase64: string;
  editorStateJson?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  timestamp: number;
}

export interface ExecutionStep {
  stepId: string;
  numero_paso: number;
  accion: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  notes?: string;
  evidenceColumns?: number;
  evidenceRows?: number;
  evidences: ImageEvidence[];
}

export interface TestCaseExecution {
  testCaseId: string;
  title: string;
  preconditions: string;
  steps: ExecutionStep[];
  expectedResults: string;
  startedAt?: number;
  completedAt?: number;
  notes?: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
}

export interface PlanExecution {
  id: string;
  huId: string;
  huTitle: string;
  testCases: TestCaseExecution[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

// --- Interfaz Principal HUData ---
export interface HUData {
  id: string;
  dbUuid?: string;
  title: string;
  sprint: string;
  originalInput: {
    generationMode: GenerationMode;
    description: string;
    acceptanceCriteria: string;
    selectedTechnique?: string;
  };
  generatedScope?: string;
  generatedTestCaseTitles?: string;
  detailedTestCases?: DetailedTestCase[];
  editingScope?: boolean;
  editingTestCases?: boolean;
  editingScenariosTestCases?: boolean;
  isScopeDetailsOpen?: boolean;
  isScenariosDetailsOpen?: boolean;
  isExpanded?: boolean;
  loadingScope?: boolean;
  errorScope?: string | null;
  refinementTechnique?: string;
  refinementContext?: string;
}