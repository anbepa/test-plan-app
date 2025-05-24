// src/app/models/hu-data.model.ts
import { DetailedTestCase } from '../services/gemini.service'; // Asegúrate que la ruta es correcta

export type GenerationMode = 'text' | 'image';

export interface HUData {
  originalInput: {
    id: string;
    title: string; // El título siempre es requerido, ya sea ingresado o por defecto para imagen
    sprint: string;
    description?: string; // Opcional, solo para modo 'text'
    acceptanceCriteria?: string; // Opcional, solo para modo 'text'
    selectedTechnique: string;
    generationMode: GenerationMode;
    imagesBase64?: string[]; // Solo para modo 'image' - CHANGED
    imageMimeTypes?: string[]; // Solo para modo 'image' - CHANGED
  };
  id: string; // ID final de la HU
  title: string; // Título final de la HU
  sprint: string;

  generatedScope: string; // Solo relevante para modo 'text'
  detailedTestCases: DetailedTestCase[];
  generatedTestCaseTitles: string; // Para previsualización del plan descargable y edición de títulos

  editingScope: boolean;
  editingScenarios: boolean; // Para la edición del textarea de generatedTestCaseTitles

  loadingScope: boolean;
  errorScope: string | null;
  loadingScenarios: boolean;
  errorScenarios: string | null;

  showRegenTechniquePicker: boolean;
  regenSelectedTechnique: string;

  isScopeDetailsOpen: boolean;
  isScenariosDetailsOpen: boolean;
}