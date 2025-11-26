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