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

  // FASE 1: EL ARQUITECTO (ISTQB Test Analysis)
  ARCHITECT_PROMPT: (description: string, acceptanceCriteria: string, technique: string, additionalContext?: string): string => `
QA Lead - ISTQB Test Analysis. Identifica Condiciones de Prueba para COBERTURA TOTAL.

**ENTRADA:**
HU: ${description}
CA: ${acceptanceCriteria}
Técnica: "${technique}"
${additionalContext ? `Contexto: ${additionalContext}` : ''}

**PROCESO:**
1. Desglose: Analiza cada CA individualmente
2. Condiciones: Define validaciones (Happy Path, Excepciones, Bordes)
3. Si un CA tiene múltiples reglas, sepáralas
4. Aplica "${technique}" para variaciones
5. Agrupa solo validaciones triviales

**SALIDA JSON:**
{
  "analysis_summary": "Resumen",
  "scope_definition": "Alcance",
  "test_conditions": ["Condición 1 (CA1): ...", "Condición 2 (CA1-Excepción): ..."],
  "design_strategy": ["Estrategia 1: ...", "Estrategia 2: ..."]
}
`,

  // FASE 2: EL GENERADOR (ISTQB Test Design & Implementation)
  GENERATOR_COT_PROMPT: (architectOutputJSON: string, technique: string): string => `
QA Senior - ISTQB Test Design. Genera casos DETALLADOS y COMPLETOS. GARANTIZA COBERTURA.

**ANÁLISIS:**
${architectOutputJSON}

**Técnica:** "${technique}"

**REGLAS:**
1. Cada test_condition = 1 caso (o foco principal)
2. NO agrupes si causa confusión
3. Título: Frase descriptiva en español SIN códigos/IDs/numeración (ej: "Validar inicio de sesión exitoso")
4. Pasos: Acciones exactas, NUNCA vacíos
5. Resultados: Qué sucede tras pasos, NUNCA vacío

**SALIDA JSON:**
{
  "testCases": [
    {
      "title": "Frase descriptiva",
      "preconditions": "Condiciones previas",
      "steps": [{"numero_paso": 1, "accion": "Acción detallada"}],
      "expectedResults": "Resultado esperado"
    }
  ]
}
`,

  // FASE 3: EL AUDITOR (ISTQB Review & Optimization)
  AUDITOR_PROMPT: (originalInput: string, architectStrategy: string, generatedCases: string): string => `
Auditor QA - REVISIÓN DE COBERTURA Y CALIDAD. NO FALTEN PRUEBAS. INFO COMPLETA.

**ENTRADA:**
HU: ${originalInput}
Análisis: ${architectStrategy}
Casos: ${generatedCases}

**AUDITORÍA:**
1. Trazabilidad: ¿Todos los CA cubiertos?
2. Huecos: Si Arquitecto identificó N condiciones, valida N casos
3. CALIDAD CRÍTICA:
   - Todos los casos tienen title/steps/expectedResults
   - LIMPIA títulos: elimina IDs técnicos (TC_001, 1., etc). Solo descripción
   - Corrige pasos vacíos/"Paso no descrito"
   - Llena title/expectedResults vacíos
   - Scope detallado (no "Alcance completo")

**SALIDA JSON VALIDADO:**
{
  "scope": "Descripción detallada",
  "testCases": [
    {
      "title": "Título limpio",
      "preconditions": "Precondiciones",
      "steps": [{"numero_paso": 1, "accion": "Acción validada"}],
      "expectedResults": "Resultado validado"
    }
  ]
}
`,

  // --- PROMPTS PARA REFINAMIENTO (CoT) ---

  // FASE 1: ARQUITECTO DE REFINAMIENTO
  REFINE_ARCHITECT_PROMPT: (originalRequirements: string, currentCases: string, userContext: string, technique: string): string => `
Arquitecto Refinamiento - ISTQB Test Analyst. Decide estrategia de actualización.

**ENTRADAS:**
Requisitos: ${originalRequirements}
Casos Actuales: ${currentCases}
Solicitud: "${userContext}"
Técnica: "${technique}"

**LÓGICA:**
Analiza casos actuales vs generación estándar.

- **ESCENARIO A (Regeneración):** Casos genéricos/vacíos/sin modificar + usuario pide técnica específica = RE-CREAR suite desde cero
- **ESCENARIO B (Refinamiento):** Casos modificados manualmente = MEJORAR borrador respetando trabajo del usuario

**SALIDA JSON:**
{
  "refinement_analysis": "Escenario A o B detectado",
  "strategy_type": "REGENERATE" | "REFINE",
  "change_directives": ["Directiva 1: ...", "Directiva 2: ..."]
}
`,

  // FASE 2: GENERADOR DE REFINAMIENTO
  REFINE_GENERATOR_PROMPT: (originalRequirements: string, architectOutput: string, currentCases: string): string => `
Generador Refinamiento - ISTQB Test Designer. Ejecuta directivas para suite de ALTA CALIDAD.

**REQUISITOS:** ${originalRequirements}
**DIRECTIVAS:** ${architectOutput}
**CASOS ACTUALES:** ${currentCases}

**INSTRUCCIONES:**
1. Integridad: NINGÚN campo vacío o "Paso no descrito"
2. Si "REGENERATE": Genera desde cero con acciones claras
3. Si "REFINE": Mejora casos. Completa pasos vacíos con lógica de requisitos. NO elimines detalles del usuario
4. Limpieza: Títulos legibles SIN IDs técnicos (TC_001, etc)

**SALIDA JSON:**
{
  "testCases": [
    {
      "title": "Título limpio",
      "preconditions": "...",
      "steps": [{"numero_paso": 1, "accion": "Acción detallada"}],
      "expectedResults": "Resultado completo"
    }
  ]
}
`,

  // FASE 3: AUDITOR DE REFINAMIENTO
  REFINE_AUDITOR_PROMPT: (originalRequirements: string, userRequest: string, refinedCases: string): string => `
Auditor Refinamiento - ISTQB Reviewer. Verifica calidad, completitud y cobertura final.

**REQUISITOS:** ${originalRequirements}
**SOLICITUD:** "${userRequest}"
**CASOS REFINADOS:** ${refinedCases}

**AUDITORÍA:**
1. Completitud: ¿Títulos/pasos/resultados vacíos o "Paso no descrito"? CORRÍGELOS
2. Limpieza: Títulos SIN IDs técnicos (TC_001, etc). Solo descripción
3. Trazabilidad: ¿Cubren requisitos originales?
4. Solicitud: ¿Se aplicó técnica/contexto?

**SALIDA JSON:**
{
  "testCases": [
    // Array final validado y completado
  ]
}
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
      "preconditions": "Condiciones previas",
      "steps": [{"numero_paso": 1, "accion": "Acción específica"}],
      "expectedResults": "Resultado esperado concreto"
    }
  ]
}
`
};
