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
Actúa como QA Lead Senior.
Debes generar una versión FINAL de la sección "${sectionName}" de un plan de pruebas.

CONTENIDO ACTUAL (solo referencia, no lo conserves):
${existingContent}

CONTEXTO CONSOLIDADO DE HUs Y ESCENARIOS (fuente obligatoria):
${huSummary}

OBJETIVO:
- REEMPLAZAR por completo el contenido actual de la sección "${sectionName}".
- Basarte en TODAS las HUs y escenarios relevantes del contexto consolidado.
- Si hay N HUs, la sección debe reflejar cobertura para esas N HUs (sin listar todo literalmente).

REGLAS ESTRICTAS DE CALIDAD:
1) Incluye solo información crítica y accionable para ejecución de pruebas.
2) Prioriza riesgos funcionales, dependencias, datos de prueba y restricciones reales.
3) No agregues texto genérico, relleno, frases vacías o recomendaciones obvias.
4) No inventes sistemas, flujos o dependencias no mencionadas en el contexto.
5) Si falta contexto para un punto, NO lo incluyas.

OPTIMIZACIÓN DE TOKENS:
- Máximo 4 líneas.
- Cada línea <= 110 caracteres aprox.
- Frases directas, sin narrativas largas ni explicaciones.
- Evita repeticiones semánticas.

REGLA DE BREVEDAD (OBLIGATORIA):
- Si una idea no es crítica para ejecución/riesgo, elimínala.
- No superes 420 caracteres totales.

FORMATO DE SALIDA OBLIGATORIO:
- Devuelve SOLO el texto final de la sección (sin encabezados, sin markdown, sin bullets numerados, sin explicación extra).
- Usa saltos de línea simples entre ideas.
- No devuelvas JSON.

AHORA GENERA la sección final para "${sectionName}".
`,

  RISK_STRATEGY_PROMPT: (huSummary: string, availableScenarios: string[]): string => `
Actúa como QA Lead Senior especializado en gestión de riesgos de pruebas.

CONTEXTO CONSOLIDADO (HUs, criterios y escenarios):
${huSummary}

ESCENARIOS DISPONIBLES PARA PLAN DE MITIGACIÓN (usa solo estos textos):
${availableScenarios.length > 0 ? availableScenarios.map((s, i) => `${i + 1}. ${s}`).join('\n') : 'Sin escenarios explícitos'}

OBJETIVO:
- Generar un item de "Riesgos Para la Estrategia de Pruebas" basado estrictamente en el contexto.
- "probabilidadDe" debe describir el EVENTO de riesgo.
- "puedeOcurrir" debe describir la CAUSA.
- "loQuePodriaOcasionar" debe describir la CONSECUENCIA.

CLASIFICACIÓN DEL RIESGO:
- impactLevel: entero entre 1 y 5
  1=Ninguno, 2=Bajo, 3=Moderado, 4=Alto, 5=Crítico
- probabilityLevel: uno de [25, 50, 75, 100]
  25=Poca posibilidad de ocurrir
  50=Puede ocurrir
  75=Gran posibilidad de ocurrir
  100=Ocurrido (Issue)

PLAN DE MITIGACIÓN:
- positiveScenarios: mínimo 2 escenarios positivos de cobertura.
- alternateScenarios: mínimo 1 escenario alterno de cobertura.
- Prioriza escenarios que existan en la lista disponible.

REGLAS:
1) No inventes funcionalidades fuera del contexto.
2) Sé concreto y accionable.
3) Textos cortos, claros y sin relleno.
4) Si faltan escenarios disponibles, genera propuestas coherentes con HU/CA.

FORMATO DE SALIDA (OBLIGATORIO):
Devuelve SOLO JSON válido, sin markdown, sin comentarios, sin texto extra:
{
  "probabilidadDe": "Evento",
  "puedeOcurrir": "Causa",
  "loQuePodriaOcasionar": "Consecuencia",
  "impactLevel": 1,
  "probabilityLevel": 25,
  "positiveScenarios": ["Escenario positivo 1", "Escenario positivo 2"],
  "alternateScenarios": ["Escenario alterno 1"]
}
`,

  // --- PROMPT PARA GENERACIÓN DIRECTA (SIN CoT) ---

  DIRECT_GENERATION_PROMPT: (description: string, acceptanceCriteria: string, technique: string, context?: string): string => `
Actúa como QA Senior. Genera casos de prueba aplicando "${technique}" con COBERTURA SUFICIENTE y sin ruido.

HU:
${description}

CA:
${acceptanceCriteria}

${context ? `CONTEXTO DEL ANALISTA (PRIORIDAD MÁXIMA):\n"${context}"\n\nJERARQUÍA DE DECISIÓN (OBLIGATORIA):\n1) Este CONTEXTO DEL ANALISTA tiene prioridad máxima para seleccionar, enfocar y ordenar los escenarios.\n2) Luego aplica HU + Criterios de Aceptación para asegurar cobertura funcional.\n3) Después aplica la técnica ISTQB para estructurar los casos.\n\nREGLAS DE PRIORIDAD DEL CONTEXTO:\n- Si el contexto pide ajustar, ampliar, reducir o priorizar algo, debes obedecerlo primero.\n- No ignores ni diluyas este contexto con preferencias genéricas.\n- Si hay conflicto entre este contexto y una regla secundaria, prevalece este contexto (siempre que no viole los Criterios de Aceptación).\n` : ''}
REGLAS DE COBERTURA (obligatorias):
1) Analiza cada criterio de aceptación (CA) y clasifícalo por complejidad (baja/media/alta).
2) Define cantidad de casos con regla híbrida:
   - Baja: 3-5 casos
   - Media: 5-8 casos
   - Alta: 8-12 casos
  - Si el alcance real requiere menos, devuelve menos.
  - Si el alcance real requiere más, puedes superar 10 casos.
  - NO uses siempre el máximo: la cantidad final debe justificarse por cobertura efectiva de CA.
3) Cobertura por criterio: para cada CA distintivo intenta cubrir con enfoque positivo, negativo y alterno.
4) Si dos o más CA son ambiguos, solapados o muy similares, agrúpalos y cúbrelos con un mismo conjunto mínimo de escenarios.
5) Cada CA (o grupo equivalente) debe quedar cubierto al menos por 1 caso.
6) Incluye Happy Path, negativos relevantes, alternos y bordes reales.
7) No generes escenarios cosméticos o redundantes.
8) Si un escenario es parecido a otro, conserva solo el más crítico y elimina duplicados.
9) Antes de responder, valida que no existan casos duplicados ni cobertura artificial inflada.

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
6) Recalcula la cantidad final según cobertura real (no por inercia del número actual).
7) No mantengas 10 casos por defecto; mantén solo los necesarios para cubrir CA con calidad.
8) Si falta cobertura, incrementa casos; si sobra solapamiento, reduce casos.
9) Para cada CA distintivo, procura cobertura en enfoque positivo, negativo y alterno.
10) Si hay CA ambiguos o muy parecidos, consolídalos y evita generar escenarios repetidos.
11) Si dos escenarios prueban prácticamente lo mismo, deja solo el más crítico.

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
