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

  SCOPE_AND_TEST_CASES_COMBINED: (description: string, acceptanceCriteria: string, technique: string, additionalContext?: string): string => `
Eres un Ingeniero de QA experto que genera ALCANCE y CASOS DE PRUEBA en un solo paso.

**PARTE 1: GENERAR ALCANCE**
Basándote EXCLUSIVAMENTE en la siguiente Historia de Usuario y Criterios de Aceptación, redacta UN PÁRRAFO CONCISO (máximo 4 líneas) que defina CLARAMENTE el alcance de las pruebas.

**PARTE 2: GENERAR CASOS DE PRUEBA DETALLADOS**
Genera casos de prueba detallados, claros, concisos y accionables aplicando la técnica "${technique}".

**ENTRADA PROPORCIONADA:**
1.  **Historia de Usuario (HU):** ${description}
2.  **Criterios de Aceptación (CA):** ${acceptanceCriteria}
3.  **Técnica de Diseño de Pruebas de Caja Negra a Aplicar:** "${technique}"
${additionalContext ? `4.  **Contexto Adicional del Usuario:** ${additionalContext}` : ''}

**INSTRUCCIONES PARA CASOS DE PRUEBA:**
1.  **COMPRENSIÓN PROFUNDA:** Analiza minuciosamente la HU, CADA UNO de los CA ${additionalContext ? 'y el CONTEXTO ADICIONAL' : ''}.
2.  **APLICACIÓN ESTRICTA DE LA TÉCNICA "${technique}":** Basa tu razonamiento DIRECTAMENTE en los principios de "${technique}". Los casos DEBEN ser una consecuencia lógica de aplicar "${technique}" a la HU, CA ${additionalContext ? 'y el CONTEXTO ADICIONAL' : ''}. NO inventes funcionalidad.
3.  **DERIVACIÓN DIRECTA:** CADA caso de prueba generado debe poder rastrearse y justificarse EXCLUSIVAMENTE a partir de la HU, los CA, la aplicación de "${technique}" ${additionalContext ? 'y el CONTEXTO ADICIONAL' : ''}.
4.  **PRECONDICIONES OBLIGATORIAS:** SIEMPRE define precondiciones específicas para cada caso de prueba. Las precondiciones deben describir el estado inicial del sistema, datos necesarios, o configuración previa requerida. Ejemplos: "Usuario autenticado con rol admin", "Base de datos con 10 productos", "Usuario sin sesión activa". NUNCA uses "N/A" o dejes las precondiciones vacías.
5.  **FORMATO DE PASOS ESTRUCTURADO:** La propiedad "steps" DEBE ser un array de objetos JSON. Cada objeto de paso debe tener las propiedades "numero_paso" (integer, secuencial iniciando en 1) y "accion" (string, descripción clara y concisa del paso).
6.  **CONCISIÓN Y ACCIÓN:** "title", "preconditions", y "expectedResults" deben ser claros y accionables. El "title" debe comenzar con un verbo.
7.  **COBERTURA ADECUADA:** Genera un conjunto de casos que cubran razonablemente los CA a través de "${technique}" ${additionalContext ? 'y considerando el CONTEXTO ADICIONAL' : ''}.

**FORMATO DE SALIDA ESTRICTO JSON (SIN EXCEPCIONES):**
Debes responder con un objeto JSON que tenga EXACTAMENTE esta estructura:
\`\`\`json
{
  "scope": "AQUÍ VA EL PÁRRAFO DE ALCANCE (máximo 4 líneas, sin títulos ni marcadores)",
  "testCases": [
    {
      "title": "Verificar login exitoso con credenciales válidas",
      "preconditions": "Usuario registrado con email: test@example.com y password: Test123",
      "steps": [
        {"numero_paso": 1, "accion": "Acceder a la página de login"},
        {"numero_paso": 2, "accion": "Ingresar email: test@example.com"},
        {"numero_paso": 3, "accion": "Ingresar password: Test123"},
        {"numero_paso": 4, "accion": "Hacer clic en botón 'Iniciar Sesión'"}
      ],
      "expectedResults": "Usuario autenticado correctamente\\nRedirección al dashboard\\nMensaje de bienvenida visible"
    }
  ]
}
\`\`\`

**RESTRICCIONES CRÍTICAS:**
- Tu respuesta DEBE comenzar con '{' y terminar con '}'.
- La propiedad "scope" debe contener SOLO el párrafo de alcance (sin encabezados, títulos, ni marcadores).
- La propiedad "testCases" debe ser un array de objetos con las propiedades: "title", "preconditions", "steps", "expectedResults".
- Cada objeto en "steps" debe tener: "numero_paso" (integer) y "accion" (string).
- **ABSOLUTAMENTE PROHIBIDO:** Incluir texto fuera del objeto JSON. No incluyas explicaciones, introducciones, saludos, despedidas, ni \`\`\`json marcadores.

**CASO DE ERROR:**
Si no puedes generar contenido válido, responde EXACTAMENTE:
\`\`\`json
{
  "scope": "No se pudo generar el alcance con la información proporcionada.",
  "testCases": [{"title": "Información Insuficiente", "preconditions": "N/A", "steps": [{"numero_paso": 1, "accion": "No se pudieron generar casos detallados basados en la información proporcionada."}], "expectedResults": "N/A"}]
}
\`\`\`

---
PROCEDE A GENERAR EL OBJETO JSON CON EL ALCANCE Y LOS CASOS DE PRUEBA:
`,

  SCENARIOS_DETAILED_TEXT_BASED: (description: string, acceptanceCriteria: string, technique: string, additionalContext?: string): string => `
Eres un Ingeniero de QA experto en el diseño de pruebas de caja negra.
Tu tarea es generar casos de prueba detallados, claros, concisos y accionables.
**ENTRADA PROPORCIONADA:**
1.  **Historia de Usuario (HU):** ${description}
2.  **Criterios de Aceptación (CA):** ${acceptanceCriteria}
3.  **Técnica de Diseño de Pruebas de Caja Negra a Aplicar:** "${technique}"
${additionalContext ? `4.  **Contexto Adicional del Usuario:** ${additionalContext}` : ''}
**INSTRUCCIONES FUNDAMENTALES PARA EL DISEÑO DE CASOS DE PRUEBA DETALLADOS:**
1.  **COMPRENSIÓN PROFUNDA:** Analiza minuciosamente la HU, CADA UNO de los CA ${additionalContext ? 'y el CONTEXTO ADICIONAL' : ''}.
2.  **APLICACIÓN ESTRICTA DE LA TÉCNICA "${technique}":** Basa tu razonamiento DIRECTAMENTE en los principios de "${technique}". Los casos DEBEN ser una consecuencia lógica de aplicar "${technique}" a la HU, CA ${additionalContext ? 'y el CONTEXTO ADICIONAL' : ''}. NO inventes funcionalidad.
3.  **DERIVACIÓN DIRECTA:** CADA caso de prueba generado debe poder rastrearse y justificarse EXCLUSIVAMENTE a partir de la HU, los CA, la aplicación de "${technique}" ${additionalContext ? 'y el CONTEXTO ADICIONAL' : ''}.
4.  **PRECONDICIONES OBLIGATORIAS:** SIEMPRE define precondiciones específicas para cada caso de prueba. Las precondiciones deben describir el estado inicial del sistema, datos necesarios, o configuración previa requerida. Ejemplos: "Usuario autenticado con rol admin", "Base de datos con 10 productos", "Usuario sin sesión activa". NUNCA uses "N/A" o dejes las precondiciones vacías.
5.  **FORMATO DE PASOS ESTRUCTURADO:** La propiedad "steps" DEBE ser un array de objetos JSON. Cada objeto de paso debe tener las propiedades "numero_paso" (integer, secuencial iniciando en 1) y "accion" (string, descripción clara y concisa del paso).
6.  **CONCISIÓN Y ACCIÓN:** "title", "preconditions", y "expectedResults" deben ser claros y accionables. El "title" debe comenzar con un verbo.
7.  **COBERTURA ADECUADA:** Genera un conjunto de casos que cubran razonablemente los CA a través de "${technique}" ${additionalContext ? 'y considerando el CONTEXTO ADICIONAL' : ''}.
8.  **CASO DE NO APLICABILIDAD / INFORMACIÓN INSUFICIENTE:** Si no puedes generar casos válidos, responde EXACTAMENTE y ÚNICAMENTE con el siguiente array JSON:
    \`\`\`json
    [{"title": "Información Insuficiente", "preconditions": "N/A", "steps": [{"numero_paso": 1, "accion": "No se pudieron generar casos detallados basados en la información proporcionada, la técnica solicitada ${additionalContext ? 'y el contexto adicional' : ''}."}], "expectedResults": "N/A"}]
    \`\`\`
**FORMATO DE SALIDA ESTRICTO JSON (SIN EXCEPCIONES):**
* La respuesta DEBE ser un array JSON válido. Tu respuesta debe comenzar con '[' y terminar con ']'.
* Cada elemento del array debe ser un objeto JSON representando un caso de prueba con las siguientes propiedades EXACTAS: "title" (string), "preconditions" (string), "steps" (ARRAY DE OBJETOS JSON), "expectedResults" (string).
* Cada objeto dentro del array "steps" debe tener las propiedades EXACTAS: "numero_paso" (integer) y "accion" (string).
* El valor de "title" DEBE COMENZAR con un verbo en infinitivo o imperativo.
* Los valores de "preconditions" y "expectedResults" pueden ser strings con múltiples líneas separadas por '\\n'. La "accion" dentro de "steps" debe ser un string conciso para un solo paso.
* **EJEMPLO DE FORMATO CORRECTO:**
\`\`\`json
[{
  "title": "Verificar login exitoso con credenciales válidas",
  "preconditions": "Usuario registrado con email: test@example.com y password: Test123",
  "steps": [
    {"numero_paso": 1, "accion": "Acceder a la página de login"},
    {"numero_paso": 2, "accion": "Ingresar email: test@example.com"},
    {"numero_paso": 3, "accion": "Ingresar password: Test123"},
    {"numero_paso": 4, "accion": "Hacer clic en botón 'Iniciar Sesión'"}
  ],
  "expectedResults": "Usuario autenticado correctamente\\nRedirección al dashboard\\nMensaje de bienvenida visible"
}]
\`\`\`
* **ABSOLUTAMENTE PROHIBIDO INCLUIR:** Cualquier texto fuera del array JSON. No incluyas explicaciones, introducciones, saludos, despedidas, ni ningún texto conversacional. Tu ÚNICA respuesta debe ser el array JSON.
---
PROCEDE A GENERAR EL ARRAY JSON DE CASOS DE PRUEBA DETALLADOS BASADA EN LA HU, LOS CA, LA TÉCNICA "${technique}" ${additionalContext ? 'Y EL CONTEXTO ADICIONAL' : ''}:
`,

  REFINE_DETAILED_TEST_CASES: (
    originalInputType: 'text' | 'image',
    originalDescription: string | undefined,
    originalAcceptanceCriteria: string | undefined,
    currentTestCasesJSON: string,
    newTechnique: string,
    additionalUserContext: string
  ): string => `
Eres un Ingeniero de QA experto y altamente colaborativo, especializado en el REFINAMIENTO PRECISO de pruebas de caja negra.
Tu tarea es tomar un conjunto de casos de prueba existentes, que PUEDEN HABER SIDO MODIFICADOS POR EL USUARIO, y refinarlos meticulosamente.
DEBES PRIORIZAR Y RESPETAR las ediciones del usuario en los casos actuales y el contexto adicional que te proporcione.
**ENTRADA PROPORCIONADA (ORDEN DE IMPORTANCIA PARA TU ANÁLISIS):**
1.  **CONTEXTO ADICIONAL DEL USUARIO PARA EL RE-ANÁLISIS (MÁXIMA PRIORIDAD):**
  ${additionalUserContext ? `   **Contenido:** "${additionalUserContext}"\n   **Instrucción:** ESTE CONTEXTO ES FUNDAMENTAL. Debes interpretarlo como una directriz directa del usuario sobre cómo quiere que se enfoquen o corrijan los casos de prueba. Cualquier modificación que realices debe estar alineada con este contexto.` : '   **Contenido:** Ninguno.\n   **Instrucción:** No se proporcionó contexto adicional específico, enfócate en los puntos siguientes.'}
2.  **CASOS DE PRUEBA ACTUALES (Editados/Validados por el Usuario - JSON):**
  \`\`\`json
  ${currentTestCasesJSON}
  \`\`\`
  **Instrucción:** Estos casos son tu PUNTO DE PARTIDA PRINCIPAL. El usuario ya los ha revisado o modificado. Tu objetivo es MEJORARLOS, CORREGIRLOS sutilmente o COMPLEMENTARLOS basándote en el CONTEXTO DEL USUARIO (punto 1) y la TÉCNICA (punto 4). NO LOS DESCARTES ni los reescribas por completo a menos que sean ABSOLUTAMENTE INCOMPATIBLES con el contexto del usuario o la técnica de forma flagrante.
3.  **TIPO DE ENTRADA ORIGINAL DE LA HU:** "${originalInputType}"
   **Descripción Original de la HU:** ${originalDescription}
   **Criterios de Aceptación Originales:** ${originalAcceptanceCriteria}
  **Instrucción:** Utiliza esta información original como REFERENCIA para asegurar la trazabilidad y coherencia, pero las directrices del CONTEXTO DEL USUARIO (punto 1) y los CASOS ACTUALES (punto 2) tienen PRECEDENCIA si hay conflicto o necesidad de adaptación.
4.  **TÉCNICA DE DISEÑO DE PRUEBAS A APLICAR/CONSIDERAR PARA EL REFINAMIENTO:** "${newTechnique}"
  **Instrucción:** Aplica los principios de esta técnica para identificar posibles mejoras, omisiones o áreas de enfoque en los CASOS ACTUALES, SIEMPRE subordinado a las indicaciones del CONTEXTO DEL USUARIO.
**INSTRUCCIONES ESPECÍFICAS PARA EL REFINAMIENTO Y REGENERACIÓN (SIGUE ESTRICTAMENTE):**
A.  **MÁXIMA FIDELIDAD AL USUARIO:**
  * **Respeta el Contexto Adicional (Punto 1):** Si el usuario indica "enfocarse en X" o "corregir Y", tus cambios DEBEN reflejarlo directamente.
  * **Conserva las Ediciones del Usuario (Punto 2):** Si un caso actual ya fue modificado por el usuario, intenta preservar esa modificación. Solo ajústala si es estrictamente necesario para cumplir con el CONTEXTO ADICIONAL o para aplicar la TÉCNICA de forma coherente. Explica implícitamente tus cambios a través de la calidad del caso refinado.
B.  **APLICACIÓN INTELIGENTE DE LA TÉCNICA (Punto 4):**
  * Usa la técnica "${newTechnique}" para evaluar los CASOS ACTUALES. ¿Hay omisiones obvias según la técnica Y el contexto del usuario? ¿Se pueden clarificar pasos o resultados esperados aplicando la técnica?
  * Añade nuevos casos SOLO si son claramente necesarios según la técnica Y el contexto del usuario, y no son redundantes con los casos actuales ya mejorados.
C.  **COHERENCIA Y TRAZABILIDAD (Punto 3):**
  * Asegura que todos los casos refinados, incluso los nuevos, sigan siendo relevantes para la funcionalidad original (descripción/CAs).
D.  **FORMATO DE SALIDA (SIN CAMBIOS):**
  * Sigue EXACTAMENTE el mismo formato JSON que los "Casos de Prueba Actuales": un array de objetos, donde cada objeto tiene "title" (string), "preconditions" (string), "steps" (array de objetos con "numero_paso" (integer) y "accion" (string)), y "expectedResults" (string).
  * Los títulos deben comenzar con un verbo. "numero_paso" debe ser secuencial iniciando en 1 para cada caso.
  * **CASO DE ERROR / NO REFINAMIENTO POSIBLE:** Si, a pesar de toda la información, y priorizando el contexto del usuario, no puedes generar un conjunto de casos refinados válidos (ej. el contexto es fundamentalmente contradictorio o la información es insuficiente), responde EXACTAMENTE y ÚNICAMENTE con el siguiente array JSON:
      \`\`\`json
      [{"title": "Refinamiento no posible con el contexto actual", "preconditions": "N/A", "steps": [{"numero_paso": 1, "accion": "No se pudieron refinar/regenerar los casos de prueba basándose en la información y el contexto proporcionados. Por favor, revise la consistencia de sus indicaciones."}], "expectedResults": "N/A"}]
      \`\`\`
**FORMATO DE SALIDA ESTRICTO JSON (SIN EXCEPCIONES):**
* La respuesta DEBE ser un array JSON válido, comenzando con '[' y terminando con ']'.
* **ABSOLUTAMENTE PROHIBIDO INCLUIR:** Cualquier texto fuera del array JSON (explicaciones, saludos, etc.).
---
PROCEDE A GENERAR EL ARRAY JSON DE CASOS DE PRUEBA DETALLADOS Y REFINADOS, DANDO MÁXIMA PRIORIDAD A LAS INDICACIONES Y MODIFICACIONES DEL USUARIO:
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
Tu objetivo NO es escribir casos de prueba todavía. Tu objetivo es ENTENDER, LIMPIAR y ESTRUCTURAR la información para que el equipo de generación pueda trabajar sin ambigüedades.

**ENTRADA:**
1.  **Historia de Usuario (HU):** ${description}
2.  **Criterios de Aceptación (CA):** ${acceptanceCriteria}
3.  **Técnica Solicitada:** "${technique}"
${additionalContext ? `4.  **Contexto Adicional:** ${additionalContext}` : ''}

**TAREA:**
1.  **Analiza:** Identifica el "Happy Path" principal y los flujos alternativos/negativos críticos.
2.  **Limpia:** Elimina ruido o información irrelevante de la HU/CA.
3.  **Decide:** Define cómo se debe aplicar la técnica "${technique}" específicamente aquí. ¿Qué variables o condiciones son claves?
4.  **Estructura:** Genera un JSON con la "Estrategia de Pruebas".

**FORMATO DE SALIDA (JSON):**
\`\`\`json
{
  "analysis_summary": "Resumen breve de lo que se va a probar (máx 2 líneas).",
  "scope_definition": "Párrafo conciso que define qué entra y qué NO entra en el alcance.",
  "key_variables": ["Variable 1 (ej: Edad)", "Variable 2 (ej: Tipo de Usuario)"],
  "strategy_directives": [
    "Instrucción 1 para el Generador (ej: Probar límites de edad 17, 18, 19)",
    "Instrucción 2 (ej: Verificar mensajes de error específicos)"
  ]
}
\`\`\`
`,

  // FASE 2: EL GENERADOR (Tu Prompt Maestro adaptado)
  GENERATOR_COT_PROMPT: (architectOutputJSON: string, technique: string): string => `
Eres "El Generador", un Ingeniero de QA Senior.
Recibes una ESTRATEGIA DE PRUEBAS definida por el Arquitecto. Tu tarea es EJECUTAR esa estrategia y escribir los casos de prueba detallados.

**ESTRATEGIA DEL ARQUITECTO:**
\`\`\`json
${architectOutputJSON}
\`\`\`

**TÉCNICA A APLICAR:** "${technique}"

**INSTRUCCIONES:**
1.  Sigue AL PIE DE LA LETRA las "strategy_directives" del Arquitecto.
2.  Usa las "key_variables" identificadas para variar tus datos de prueba.
3.  Genera casos de prueba detallados (título, precondiciones, pasos, resultados).

**FORMATO DE SALIDA (JSON):**
\`\`\`json
{
  "testCases": [
    {
      "title": "Verificar...",
      "preconditions": "...",
      "steps": [{"numero_paso": 1, "accion": "..."}],
      "expectedResults": "..."
    }
  ]
}
\`\`\`
`,

  // FASE 3: EL AUDITOR (Refinamiento y Cumplimiento)
  AUDITOR_PROMPT: (originalInput: string, architectStrategy: string, generatedCases: string): string => `
Eres "El Auditor", un QA Manager obsesionado con la calidad y el cumplimiento de requisitos.
Tu trabajo es revisar los casos de prueba generados y asegurar que cumplan con la estrategia del Arquitecto y la HU original.

**ENTRADA:**
1.  **HU Original:** ${originalInput}
2.  **Estrategia del Arquitecto:** ${architectStrategy}
3.  **Casos Generados:** ${generatedCases}

**TAREA:**
1.  **Verifica:** ¿Se siguieron todas las directivas del Arquitecto?
2.  **Corrige:** Si hay casos genéricos o pasos vagos, mejóralos. Si faltan casos críticos mencionados en la estrategia, agrégalos.
3.  **Pule:** Asegura que el lenguaje sea profesional y claro.

**FORMATO DE SALIDA (JSON FINAL):**
Devuelve el JSON final de los casos de prueba, posiblemente corregido.
\`\`\`json
{
  "scope": "El scope definido por el Arquitecto",
  "testCases": [
    // Casos de prueba validados y mejorados
  ]
}
\`\`\`
`,

  // --- PROMPTS PARA REFINAMIENTO (CoT) ---

  // FASE 1: ARQUITECTO DE REFINAMIENTO
  REFINE_ARCHITECT_PROMPT: (currentCases: string, userContext: string, technique: string): string => `
Eres "El Arquitecto de Refinamiento".
El usuario quiere modificar o mejorar un set de casos de prueba existentes.

**CASOS ACTUALES:**
${currentCases}

**SOLICITUD DEL USUARIO (CONTEXTO):**
"${userContext}"

**TÉCNICA:** "${technique}"

**TAREA:**
Analiza la solicitud del usuario. ¿Qué cambios estructurales o de enfoque se necesitan?
Define las directivas de cambio para el Generador.

**FORMATO DE SALIDA (JSON):**
\`\`\`json
{
  "refinement_analysis": "Análisis de lo que pide el usuario.",
  "change_directives": [
    "Directiva 1 (ej: Cambiar todos los usuarios a 'Admin')",
    "Directiva 2 (ej: Agregar caso de prueba para error 500)"
  ]
}
\`\`\`
`,

  // FASE 2: GENERADOR DE REFINAMIENTO
  REFINE_GENERATOR_PROMPT: (architectDirectives: string, currentCases: string): string => `
Eres "El Generador de Refinamiento".
Aplica las directivas de cambio a los casos de prueba existentes.

**DIRECTIVAS DEL ARQUITECTO:**
${architectDirectives}

**CASOS EXISTENTES:**
${currentCases}

**TAREA:**
Modifica, agrega o elimina casos según las directivas. Mantén la estructura JSON.

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
Verifica que los casos refinados realmente atiendan la solicitud del usuario.

**SOLICITUD ORIGINAL DEL USUARIO:**
"${userRequest}"

**CASOS REFINADOS:**
${refinedCases}

**TAREA:**
Asegura que la solicitud del usuario se haya cumplido. Si el usuario pidió "X", asegúrate que "X" esté presente.
Devuelve el JSON final limpio.

**FORMATO DE SALIDA (JSON):**
\`\`\`json
[
  // Array de casos de prueba finales
]
\`\`\`
**IMPORTANTE:** Tu respuesta debe contener SOLAMENTE el JSON. No incluyas texto introductorio ni explicaciones fuera del bloque JSON.
`
};
