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
**EJEMPLO DE RESPUESTA (si se añaden dos puntos a "Limitaciones")**:
Se cuenta con un ambiente de pruebas con datos limitados.
La funcionalidad X depende de un sistema externo no disponible para pruebas exhaustivas.
PROCEDE A GENERAR TU RESPUESTA PARA LA SECCIÓN "${sectionName}":
`,

  // --- PROMPT PARA GENERACIÓN DIRECTA (SIN CoT) ---

  DIRECT_GENERATION_PROMPT: (description: string, acceptanceCriteria: string, technique: string): string => `
QA Senior - Genera casos de prueba CONCISOS aplicando "${technique}".

HU: ${description}
CA: ${acceptanceCriteria}

**PROCESO:**
1. Analiza CADA criterio de aceptación
2. Aplica "${technique}" para identificar escenarios clave
3. Crea casos que cubran Happy Path, Excepciones y Bordes
4. Mantén 2-4 pasos por caso (máximo)

**REGLAS CRÍTICAS:**
- Título: Frase descriptiva SIN IDs técnicos (TC_001, etc)
- Pasos: Acciones concretas, NUNCA vacíos
- Resultados: Qué sucede tras ejecutar, NUNCA vacío
- Cobertura: TODOS los CA deben estar cubiertos

**SALIDA JSON:**
{
  "scope": "Alcance: qué se prueba y qué no",
  "testCases": [
    {
      "title": "Descripción clara del escenario",
      "preconditions": "Condiciones previas necesarias",
      "steps": [{"numero_paso": 1, "accion": "Acción específica"}],
      "expectedResults": "Resultado esperado concreto"
    }
  ]
}
`,

  // Refinamiento directo (sin CoT)
  DIRECT_REFINE_PROMPT: (originalRequirements: string, currentCases: string, userRequest: string, technique: string): string => `
QA Senior - REFINA casos aplicando "${technique}". Mantén CONCISIÓN (2-4 pasos) y CALIDAD.

Requisitos Originales: ${originalRequirements}
Casos Actuales: ${currentCases}
Solicitud Usuario: "${userRequest}"

**PROCESO:**
1. Analiza qué solicita el usuario
2. Aplica "${technique}" según corresponda
3. Respeta trabajo manual del usuario (datos específicos, pasos personalizados)
4. Mejora claridad y completitud

**REGLAS CRÍTICAS:**
- Mantén 2-4 pasos por caso (máximo)
- Títulos SIN IDs técnicos (TC_001, etc)
- NUNCA dejes pasos o resultados vacíos
- Si usuario agregó datos específicos, CONSÉRVALES
- Aplica técnica solicitada sin perder contexto

**SALIDA JSON:**
{
  "testCases": [
    {
      "title": "Descripción clara del escenario",
      "preconditions": "Condiciones previas necesarias",
      "steps": [{"numero_paso": 1, "accion": "Acción específica"}],
      "expectedResults": "Resultado esperado concreto"
    }
  ]
}
`
};
