// src/app/models/hu-data.model.ts

export interface HUData {
    // Datos de entrada originales tal como se ingresaron en el formulario
    originalInput: {
      id: string; // ID de la HU ingresado originalmente
      title: string; // Título de la HU ingresado originalmente
      sprint: string;
      description: string;
      acceptanceCriteria: string;
      selectedTechnique: string; // Técnica seleccionada cuando se AÑADIÓ la HU inicialmente
    };
    // Datos principales de la HU que se usarán en el plan consolidado
    id: string; // ID de la HU
    title: string; // Título de la HU
    sprint: string; // Sprint de la HU
  
    // Datos generados por IA para esta HU
    generatedScope: string; // Texto del alcance
    generatedScenarios: string[]; // Lista de textos completos de escenarios (ej: "Given ... When ... Then ...")
    generatedTestCaseTitles: string; // Texto formateado de títulos para el plan (ej: 1. Scenario Title\n2. Another Title)
  
    // Estado de edición para la UI (si el usuario está editando manualmente el texto generado)
    editingScope: boolean; // Indica si el alcance está en edición
    editingScenarios: boolean; // Indica si los escenarios (su representación formateada) están en edición
  
    // Estados de carga/error específicos por sección para las llamadas a la IA (regeneración)
    loadingScope: boolean; // Indica si se está regenerando el alcance de esta HU
    errorScope: string | null; // Error específico para la regeneración del alcance de esta HU
    loadingScenarios: boolean; // Indica si se están regenerando los escenarios de esta HU
    errorScenarios: string | null; // Error específico para la regeneración de escenarios de esta HU
  
    // --- Propiedades adicionales para la funcionalidad de regeneración de escenarios CON SELECCIÓN DE TÉCNICA ---
    showRegenTechniquePicker: boolean; // Controla si se muestra el selector de técnica para regeneración de escenarios en la UI de esta HU
    regenSelectedTechnique: string; // Almacena la técnica seleccionada en el picker para la regeneración actual de esta HU
    // --- Fin Propiedades para regeneración ---
  }