export const PROMPTS = {
  SCOPE: (description: string, acceptanceCriteria: string): string => `
Eres un analista de QA experimentado.
Genera la sección de ALCANCE para un plan de pruebas.
Basándote EXCLUSIVAMENTE en la siguiente Historia de Usuario y Criterios de Aceptación, redacta UN PÁRRAFO CONCISO (máximo 4 líneas) que defina CLARAMENTE el alcance de las pruebas.
RESTRICCIONES:
- NO incluyas encabezados, títulos (ej: "ALCANCE:", "Alcance de Pruebas"), ni marcadores (ej: "##ALCANCE##").
- NO uses viñetas, enumeraciones, ni listas.
- NO uses introducciones, explicaciones, saludos, despedidas o cualquier texto conversacional.
- La respuesta debe ser SOLAMENTE el párrafo del alcance.
Historia de Usuario:
${description}
Criterios de Aceptación:
${acceptanceCriteria}
`,

  STATIC_SECTION_ENHANCEMENT: (sectionName: string, existingContent: string, huSummary: string): string => `
Eres un asistente de QA experto. Tu tarea es MEJORAR y EXPANDIR una sección específica de un plan de pruebas.
**Sección a Mejorar:** "${sectionName}"
**Contenido Existente (si lo hay, podría estar vacío o ser un placeholder):**
${existingContent}
**Resumen de Historias de Usuario/Flujos en el Plan (para contexto):**
${huSummary}
**INSTRUCCIONES:**
1.  **ANALIZA EL CONTEXTO:** Considera el resumen de HUs/Flujos para que tu contribución sea relevante.
2.  **MEJORA Y EXPANDE:** Si el contenido existente es un placeholder (ej: "No se probarán...", "No tener los permisos...") o está vacío, genera contenido nuevo y relevante para la sección "${sectionName}" basado en el contexto general. Si ya hay contenido, añade 2-3 puntos o ideas adicionales que lo complementen, sin repetir lo existente.
3.  **FORMATO:** Responde ÚNICAMENTE con el texto adicional o mejorado para la sección. No uses encabezados, títulos de sección, ni introducciones/despedidas. Si añades múltiples puntos, usa saltos de línea entre ellos.
4.  **CONCISIÓN Y RELEVANCIA:** Sé conciso y asegúrate de que tus adiciones sean relevantes para un plan de pruebas y la sección "${sectionName}".
5.  **NO REPITAS:** Si el contenido existente ya es bueno y completo para el contexto, y no puedes añadir nada valioso, responde con una cadena vacía.
**EJEMPLO DE RESPUESTA (si se añaden dos puntos a "Limitaciones"):**
Se cuenta con un ambiente de pruebas con datos limitados.
La funcionalidad X depende de un sistema externo no disponible para pruebas exhaustivas.
PROCEDE A GENERAR TU RESPUESTA PARA LA SECCIÓN "${sectionName}":
`,

  // --- PROMPTS PARA CHAIN OF THOUGHT (CoT) ---

  // FASE 1: EL ARQUITECTO (Limpieza y Estrategia)
  ARCHITECT_PROMPT: (description: string, acceptanceCriteria: string, technique: string, additionalContext?: string): string => `
Eres "El Arquitecto", un QA Lead experto en estrategia de pruebas.
Tu objetivo es DISEÑAR una estrategia de pruebas EFICIENTE y CONCISA.
**TU ENEMIGO ES LA REDUNDANCIA.** No queremos miles de casos, queremos los MEJORES casos.

**ENTRADA:**
1.  **Historia de Usuario (HU):** ${description}
2.  **Criterios de Aceptación (CA):** ${acceptanceCriteria}
3.  **Técnica Solicitada:** "${technique}"
${additionalContext ? `4.  **Contexto Adicional:** ${additionalContext}` : ''}

**TAREA:**
1.  **Analiza:** Identifica el "Happy Path" y los flujos alternativos CRÍTICOS.
2.  **AGRUPA:** Si varios criterios se pueden validar en un solo flujo lógico, AGRÚPALOS. No crees un caso por cada criterio si un solo recorrido puede cubrir 3.
3.  **FILTRA:** Descarta pruebas triviales o redundantes.
4.  **Estructura:** Genera la estrategia.

**FORMATO DE SALIDA (JSON):**
\`\`\`json
{
  "analysis_summary": "Resumen ultra-conciso (1 línea).",
  "scope_definition": "Qué entra y qué NO (conciso).",
  "key_variables": ["Var1", "Var2"],
  "strategy_directives": [
    "Instrucción 1: Cubrir Happy Path (validando CA1, CA2 y CA3 juntos)",
    "Instrucción 2: Probar error crítico X"
  ]
}
\`\`\`
`,

  // FASE 2: EL GENERADOR (Tu Prompt Maestro adaptado)
  GENERATOR_COT_PROMPT: (architectOutputJSON: string, technique: string): string => `
Eres "El Generador", un Ingeniero de QA Senior.
Tu misión: Generar casos de prueba **CONCISOS, ÚNICOS Y DIRECTOS**.
**CALIDAD SOBRE CANTIDAD.**

**ESTRATEGIA:**
\`\`\`json
${architectOutputJSON}
\`\`\`

**REGLAS DE ORO (SÍGUELAS O FALLARÁS):**
1.  **CERO REDUNDANCIA:** Si un escenario A ya valida el login, el escenario B NO debe volver a validar el login paso a paso, asume la precondición.
2.  **CONCISIÓN EXTREMA:**
    *   Pasos: Máximo 6-8 palabras por paso. "Hacer clic en Guardar" (Bien) vs "El usuario debe mover el mouse y hacer clic en el botón que dice Guardar" (Mal).
    *   Resultados: Directos al grano. "Datos guardados y alerta visible".
3.  **AGRUPACIÓN LÓGICA:** Un caso de prueba puede verificar múltiples validaciones menores si ocurren en la misma pantalla.
4.  **NO INVENTAR:** Solo lo que está en la estrategia.

**FORMATO DE SALIDA (JSON):**
\`\`\`json
{
  "testCases": [
    {
      "title": "Verificar [Acción] exitosa",
      "preconditions": "Usuario Admin logueado",
      "steps": [{"numero_paso": 1, "accion": "Ingresar datos válidos"}, {"numero_paso": 2, "accion": "Guardar"}],
      "expectedResults": "Registro creado exitosamente"
    }
  ]
}
\`\`\`
`,

  // FASE 3: EL AUDITOR (Refinamiento y Cumplimiento)
  AUDITOR_PROMPT: (originalInput: string, architectStrategy: string, generatedCases: string): string => `
Eres "El Auditor". Tu trabajo es **CORTAR GRASA**.
Recibes casos de prueba y debes eliminar TODO lo que sobre.

**ENTRADA:**
1.  **HU Original:** ${originalInput}
2.  **Estrategia:** ${architectStrategy}
3.  **Casos:** ${generatedCases}

**TAREA:**
1.  **DETECTAR DUPLICADOS:** Si dos casos prueban casi lo mismo, FUSIÓNALOS o ELIMINA el menos importante.
2.  **SIMPLIFICAR:** Si un paso es muy largo, resúmelo.
3.  **VALIDAR:** Asegura que cumplan la estrategia.

**FORMATO DE SALIDA (JSON FINAL):**
Devuelve SOLO el JSON optimizado.
\`\`\`json
{
  "scope": "Alcance conciso",
  "testCases": [
    // Casos optimizados y únicos
  ]
}
\`\`\`
`,

  // --- PROMPTS PARA REFINAMIENTO (CoT) ---

  // FASE 1: ARQUITECTO DE REFINAMIENTO
  REFINE_ARCHITECT_PROMPT: (currentCases: string, userContext: string, technique: string): string => `
Eres "El Arquitecto de Refinamiento".
El usuario quiere mejorar sus casos. Tu objetivo es interpretar qué quiere y **EVITAR QUE EL GENERADOR SE VUELVA LOCO creando duplicados.**

**CASOS ACTUALES:**
${currentCases}

**SOLICITUD (CONTEXTO):**
"${userContext}"

**TAREA:**
1.  Entiende el cambio.
2.  Si el usuario pide "Agregar X", asegúrate de decir "Agregar X SIN REPETIR lo que ya está".
3.  Si pide "Corregir Y", di "Modificar Y in-place".

**FORMATO DE SALIDA (JSON):**
\`\`\`json
{
  "refinement_analysis": "Análisis breve.",
  "change_directives": [
    "Directiva 1: Modificar caso 3 para incluir X",
    "Directiva 2: Eliminar redundancia en casos de login"
  ]
}
\`\`\`
`,

  // FASE 2: GENERADOR DE REFINAMIENTO
  REFINE_GENERATOR_PROMPT: (architectDirectives: string, currentCases: string): string => `
Eres "El Generador de Refinamiento".
Tienes una lista de casos y directivas.
**TU PRIORIDAD NÚMERO 1: NO DUPLICAR.**
**TU PRIORIDAD NÚMERO 2: MANTENERLO CONCISO.**

**DIRECTIVAS:**
${architectDirectives}

**CASOS:**
${currentCases}

**INSTRUCCIONES:**
1.  Modifica los casos existentes siempre que sea posible. NO crees nuevos a menos que sea estrictamente necesario.
2.  Si una directiva dice "probar error", mira si ya hay un caso de error y adáptalo.
3.  Mantén los textos cortos.

**FORMATO DE SALIDA (JSON):**
\`\`\`json
[
  {
    "title": "...",
    "preconditions": "...",
    "steps": [...],
    "expectedResults": "..."
  }
]
\`\`\`
`,

  // FASE 3: AUDITOR DE REFINAMIENTO
  REFINE_AUDITOR_PROMPT: (userRequest: string, refinedCases: string): string => `
Eres "El Auditor de Refinamiento".
Filtro final.
**SI VES CASOS REPETIDOS, BÓRRALOS.**
**SI VES TEXTO INNECESARIO, BÓRRALO.**

**SOLICITUD:** "${userRequest}"

**CASOS:**
${refinedCases}

**TAREA:**
Devuelve el JSON limpio, único y conciso.

**FORMATO DE SALIDA (JSON):**
\`\`\`json
[
  // Array final
]
\`\`\`
`
};
