// src/app/models/hu-data.model.ts

// Importar la nueva interfaz
import { DetailedTestCase } from '../services/gemini.service';

export interface HUData {
  originalInput: {
    id: string;
    title: string;
    sprint: string;
    description: string;
    acceptanceCriteria: string;
    selectedTechnique: string;
  };
  id: string;
  title: string;
  sprint: string;

  generatedScope: string;
  // generatedScenarios: string[]; // Ya no se usa esta, se reemplaza por detailedTestCases
  generatedTestCaseTitles: string; // Se seguirá usando para la previsualización del plan
  detailedTestCases: DetailedTestCase[]; // NUEVA propiedad para los casos de prueba detallados

  editingScope: boolean;
  editingScenarios: boolean; // Se puede mantener para la edición del texto general de casos

  loadingScope: boolean;
  errorScope: string | null;
  loadingScenarios: boolean; // Se usará para la carga de detailedTestCases
  errorScenarios: string | null; // Error para detailedTestCases

  showRegenTechniquePicker: boolean;
  regenSelectedTechnique: string;

  isScopeDetailsOpen: boolean;
  isScenariosDetailsOpen: boolean;
}