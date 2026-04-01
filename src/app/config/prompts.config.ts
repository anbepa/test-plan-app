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
Actúa como QA Senior. Genera casos de prueba aplicando "${technique}" con COBERTURA ALTA y sin ruido.

HU:
${description}

CA:
${acceptanceCriteria}

REGLAS DE COBERTURA (obligatorias):
1) Analiza cada criterio de aceptación (CA) y clasifícalo por complejidad (baja/media/alta).
2) Define cantidad de casos con regla híbrida:
   - Baja: 3-5 casos
   - Media: 5-8 casos
   - Alta: 8-12 casos
  - Límite superior absoluto: 10 casos
3) Cada CA debe estar cubierto al menos por 1 caso.
4) Incluye Happy Path, negativos relevantes y bordes reales.
5) No generes escenarios cosméticos o redundantes.

REGLAS DE CALIDAD:
- Título claro SIN IDs técnicos (TC_001, etc).
- 2-5 pasos por caso (6 solo si es crítico por negocio/regla).
- Pasos accionables y concretos (sin texto vacío).
- Resultado esperado verificable y específico.
- Deduplica: si dos casos prueban lo mismo, conserva el más representativo.

OPTIMIZACIÓN DE TOKENS:
- Sé conciso: evita explicaciones narrativas.
- Usa textos breves: title <= 90 chars, preconditions <= 180 chars, expectedResults <= 180 chars.

FORMATO DE SALIDA:
- Responde SOLO JSON válido, sin markdown, sin comentarios, sin texto extra.
- Verifica internamente que TODOS los CA tengan cobertura antes de responder.
- Usa exactamente esta estructura:
{
  "scope": "Alcance breve de lo cubierto",
  "testCases": [
    {
      "title": "Descripción clara del escenario",
      "preconditions": "Condiciones previas necesarias",
      "steps": [
        {"numero_paso": 1, "accion": "Acción específica"}
      ],
      "expectedResults": "Resultado esperado concreto"
    }
  ]
}
`,

  // Refinamiento directo (sin CoT)
  DIRECT_REFINE_PROMPT: (originalRequirements: string, currentCases: string, userRequest: string, technique: string): string => `
Actúa como QA Senior. Refina casos existentes aplicando "${technique}" con mejor cobertura y menos ruido.

Requisitos Originales:
${originalRequirements}

Casos Actuales:
${currentCases}

Solicitud Usuario:
"${userRequest}"

REGLAS DE REFINAMIENTO (obligatorias):
1) Conserva datos manuales del usuario (valores específicos, pasos personalizados), salvo contradicción con requisitos.
2) Elimina redundantes: fusiona casos semánticamente equivalentes.
3) Corrige huecos de cobertura: cada CA debe quedar cubierto por al menos 1 caso.
4) Si la solicitud pide ampliar, añade solo escenarios de alto valor.
5) Si la solicitud pide simplificar, reduce cantidad sin perder cobertura mínima.

REGLAS DE CALIDAD:
- Títulos claros SIN IDs técnicos.
- 2-5 pasos por caso (6 solo si es crítico).
- Pasos/resultado nunca vacíos.
- expectedResults verificable y concreto.
- Ordena casos de mayor a menor riesgo funcional.

OPTIMIZACIÓN DE TOKENS:
- Sé directo y compacto.
- title <= 90 chars, preconditions <= 180 chars, expectedResults <= 180 chars.

FORMATO DE SALIDA:
- Responde SOLO JSON válido, sin markdown, sin comentarios, sin texto adicional.
- Verifica internamente cobertura completa de CA antes de responder.
- Usa exactamente esta estructura:
{
  "testCases": [
    {
      "title": "Descripción clara del escenario",
      "preconditions": "Condiciones previas necesarias",
      "steps": [
        {"numero_paso": 1, "accion": "Acción específica"}
      ],
      "expectedResults": "Resultado esperado concreto"
    }
  ]
}
`
};
