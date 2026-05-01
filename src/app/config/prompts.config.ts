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

CONTEXTO CONSOLIDADO (TODAS las HUs del plan, criterios y escenarios):
${huSummary}

ESCENARIOS DISPONIBLES PARA PLAN DE MITIGACIÓN (usa solo estos textos):
${availableScenarios.length > 0 ? availableScenarios.map((s, i) => `${i + 1}. ${s}`).join('\n') : 'Sin escenarios explícitos'}

INSTRUCCIONES DE ANÁLISIS (OBLIGATORIAS):
1) Analiza TODAS y cada una de las HUs listadas en el contexto, sin omitir ninguna.
2) Identifica el riesgo MÁS CRÍTICO del conjunto completo, considerando todas las HUs.
3) El riesgo elegido debe variar en cada ejecución: si el riesgo principal ya es conocido, selecciona el SIGUIENTE más relevante o un ángulo de riesgo distinto (funcional, de integración, de datos, de rendimiento, etc.).
4) La variación entre llamadas es OBLIGATORIA: "loQuePodriaOcasionar" debe reflejar una consecuencia de negocio DIFERENTE y ESPECÍFICA cada vez.

OBJETIVO:
- Generar un item de "Riesgos Para la Estrategia de Pruebas" basado estrictamente en el contexto.
- "probabilidadDe": el EVENTO de riesgo (qué podría fallar).
- "puedeOcurrir": la CAUSA (por qué podría ocurrir).
- "loQuePodriaOcasionar": la CONSECUENCIA de negocio (impacto real y diferenciado si ocurre).

CLASIFICACIÓN DEL RIESGO:
- impactLevel: entero entre 1 y 5
  1=Ninguno, 2=Bajo, 3=Moderado, 4=Alto, 5=Crítico
- probabilityLevel: uno de [25, 50, 75, 100]
  25=Poca posibilidad de ocurrir
  50=Puede ocurrir
  75=Gran posibilidad de ocurrir
  100=Ocurrido (Issue)

PLAN DE MITIGACIÓN:
- positiveScenarios: mínimo 2 escenarios positivos relacionados con el riesgo identificado.
- alternateScenarios: mínimo 1 escenario alterno de cobertura.
- Prioriza escenarios que existan en la lista disponible.

REGLAS:
1) No inventes funcionalidades fuera del contexto de las HUs.
2) Sé concreto y accionable. El campo "loQuePodriaOcasionar" debe ser específico y diferente en cada generación.
3) Textos cortos, claros y sin relleno.
4) Si faltan escenarios disponibles, genera propuestas coherentes con las HU/CA.

FORMATO DE SALIDA (OBLIGATORIO):
Devuelve SOLO JSON válido, sin markdown, sin comentarios, sin texto extra:
{
  "probabilidadDe": "Evento de riesgo específico",
  "puedeOcurrir": "Causa raíz",
  "loQuePodriaOcasionar": "Consecuencia de negocio concreta y diferenciada",
  "impactLevel": 1,
  "probabilityLevel": 25,
  "positiveScenarios": ["Escenario positivo 1", "Escenario positivo 2"],
  "alternateScenarios": ["Escenario alterno 1"]
}
`,

  // --- PROMPT PARA GENERACIÓN DIRECTA (SIN CoT) ---

  DIRECT_GENERATION_PROMPT: (description: string, acceptanceCriteria: string, technique: string): string => `
Actúa como QA Senior. Genera casos de prueba aplicando "${technique}" con COBERTURA SUFICIENTE y sin ruido.

HU:
${description}

CA:
${acceptanceCriteria}

REGLAS DE TÉCNICA (obligatorias):
1) Aplica la técnica "${technique}" de forma real, no solo nominal.
2) Si la técnica es "Partición Equivalente" o "Equivalent Partitioning":
   - Identifica internamente clases de equivalencia válidas e inválidas por campo, condición y regla de negocio.
   - Genera escenarios representativos por clase, evitando repetir casos de la misma partición sin valor adicional.
   - Para cada validación, restricción, habilitación, aparición o cardinalidad relevante, intenta cubrir al menos una partición válida y una inválida cuando aplique.
   - Si una regla define opciones permitidas/no permitidas, cubre la clase válida y al menos una clase inválida representativa.
3) Si la técnica es "Análisis de Valor Límite" o "Boundary Value Analysis":
   - Identifica límites mínimos, máximos y puntos críticos explícitos o claramente inferibles del CA.
   - Prioriza casos en: por debajo del límite, en el límite y por encima del límite.
   - Si hay límites de fecha, cantidad, tamaño, longitud, rango o cardinalidad, priorízalos sobre casos funcionales genéricos.
   - No inventes límites no sustentados por HU o CA.
   - Si una regla no tiene borde claro, cúbrela funcionalmente sin forzar un caso de valor límite artificial.
4) Si la técnica es "Tabla de Decisión" o "Decision Table":
   - Identifica condiciones y acciones.
   - Genera el conjunto mínimo de combinaciones que cubra reglas, cruces relevantes, conflictos y decisiones de negocio.
   - Si hay reglas mutuamente excluyentes, dependientes o condicionales, deben quedar reflejadas en combinaciones distintas cuando aplique.
   - Evita explosión combinatoria innecesaria.
5) Si la técnica es "Pruebas de Transición de Estados" o "State Transition Testing":
   - Identifica estados, eventos/disparadores, transiciones válidas, transiciones inválidas y restricciones por estado.
   - Cubre al menos transiciones válidas clave, inválidas relevantes y comportamiento dependiente del estado.
   - Si una acción cambia el estado de la pantalla, del proceso o de la disponibilidad de controles, modela esa transición en los casos.
6) Si alguna parte de los CA no aplica naturalmente a la técnica seleccionada, cúbrela funcionalmente sin forzar casos artificiales ni perder trazabilidad.

ANÁLISIS PRELIMINAR DE PARTICIONES (OBLIGATORIO - ANTES DE GENERAR):
Antes de generar cualquier caso de prueba, haz esto internamente:
1) Lee cada CA completo e identifica TODAS sus dimensiones:
   - ¿Tiene bifurcaciones explícitas? (Si/No, Válido/Inválido, etc.) → Cada rama = 1 partición
   - ¿Define límites? (mínimo, máximo, rango, cantidad) → 3 particiones (por debajo/dentro/encima)
   - ¿Define estados o transiciones? → 1 partición por estado clave
   - ¿Define aparición condicional, habilitación o visibilidad? → 1 partición válida + 1 inválida
   - ¿Define cardinalidad? (solo uno, múltiples, cantidad fija) → 1 partición por restricción
   - ¿Define combinaciones de reglas? (ej: Si X y Z entonces Y) → 1 partición por combinación relevante
2) ENUMERA TODAS las particiones identificadas (no internamente, mapea explícitamente)
3) Cuenta el TOTAL de particiones
4) Identifica combinaciones CRÍTICAS entre particiones (ej: Validación OK × Reembolso Si, Validación FAIL × Reembolso No)
5) El NÚMERO MÍNIMO de casos debe cubrir:
   - Todas las particiones individuales representativas
   - Las combinaciones críticas identificadas
   - Este mínimo NO es máximo: si necesitas más, GENERA MÁS

PRIORIZACIÓN DE ESCENARIOS (obligatoria):
1) Primero cubre reglas de negocio y validaciones usando la técnica seleccionada.
2) Después cubre navegación, redirección o flujo solo si aporta cobertura real a un CA o habilita una validación obligatoria.
3) No consumas casos en flujos cosméticos si existen validaciones, combinaciones, límites, transiciones o reglas de negocio sin cubrir.

REGLAS DE COBERTURA (obligatorias):
1) Analiza cada criterio de aceptación (CA) y clasifícalo por complejidad (baja/media/alta/muy alta).
2) Define MÍNIMO de casos (sin máximos restrictivos):
   - Baja (1-2 CA simples): MÍNIMO 4 casos
   - Media (3-5 CA, algunas reglas complejas): MÍNIMO 10 casos
   - Alta (6-10 CA con múltiples bifurcaciones): MÍNIMO 18 casos
   - Muy Alta (10+ CA complejos con combinaciones): MÍNIMO 25+ casos
   Si el análisis de particiones indica más casos necesarios, GENERA MÁS sin límite superior.
3) Cobertura por criterio: para cada CA distintivo intenta cubrir con enfoque positivo, negativo y alterno.
4) Si dos o más CA son ambiguos, solapados o muy similares, agrúpalos y cúbrelos con un conjunto completo de escenarios (no mínimo).
5) Cada CA (o grupo equivalente) debe quedar cubierto EXPLÍCITAMENTE por al menos 1 caso, y si es complejo (múltiples reglas), por MÚLTIPLES casos.
6) Incluye Happy Path, negativos relevantes, alternos y bordes reales cuando aporten valor según la técnica.
7) No generes escenarios cosméticos o redundantes.
8) Si un escenario es parecido a otro, conserva solo el más crítico y elimina duplicados.
9) Antes de responder, valida que no existan casos duplicados ni cobertura artificial inflada.
10) Si una regla define cardinalidad o cantidad permitida (por ejemplo: solo una selección, solo un archivo, máximo 1000 registros), genera MÍNIMO 1 caso por restricción (y de valor límite si aplica).
11) Si una regla define condiciones de aparición, habilitación, activación o visibilidad, incluye MÍNIMO una condición válida y una inválida cuando aplique.
12) Si un CA describe una secuencia obligatoria de eventos (validación → habilitación → apertura → mostrado), cubre MÍNIMO 1 caso completo + 1 que quiebre la secuencia.

VALIDACIÓN FINAL DE COBERTURA (OBLIGATORIA - ANTES DE RESPONDER):
1) Crea un mapeo interno: Cada caso generado → CA(s) que cubre
2) Para cada CA del original:
   - ¿Tiene cobertura positiva? SI / NO
   - ¿Tiene cobertura negativa (si aplica)? SI / NO
   - ¿Tiene cobertura alterno (si aplica)? SI / NO
3) Si algún CA tiene algún "NO" donde debería ser "SI", GENERA casos adicionales
4) Si un CA tiene N subcondiciones o reglas distintas (ej: "Si X validado entonces [mostrar Y] y [habilitar Z] y [cambiar estado a W]"):
   - Verifica que los PASOS de tus casos ejercitan CADA una de esas reglas SEPARADAMENTE o en combinación LÓGICA
   - Si falta una regla, crea caso adicional específico para ella
5) Si una pantalla o formulario tiene N campos, hay MÍNIMO N casos que ejercitan cada campo por lo menos en una validación
6) Si hay M bifurcaciones independientes (Si/No, OK/FAIL), hay MÍNIMO 2^M casos (o menos si hay relaciones de dependencia que reducen combinaciones)
7) Verifica el TOTAL de casos generados: ¿Es consistente con la complejidad analizada? Si parece bajo comparado con # de particiones, aumenta.

VALIDACIÓN DE COBERTURA (obligatoria):
1) Verifica internamente que cada CA textual quede cubierto explícitamente por al menos 1 caso.
2) Si un CA contiene múltiples reglas distintas (por ejemplo: condición de aparición + restricción + mensaje + redirección), no lo des por cubierto con un único caso genérico si las reglas requieren validaciones separadas.
3) Si los CA especifican textos, títulos, etiquetas, columnas, nombres de archivo, formatos, mensajes o restricciones exactas, genera casos que los validen explícitamente cuando sean obligatorios para la funcionalidad.
4) No marques como cubierto un comportamiento que solo aparezca mencionado en el expectedResults pero no haya sido realmente ejercitado en los pasos.
5) Si una técnica requiere representatividad estructural (particiones, bordes, combinaciones o transiciones), verifica internamente que los casos devueltos reflejen esa estructura y no solo cobertura funcional general.

REGLAS DE CALIDAD:
- Título claro SIN IDs técnicos (TC_001, etc).
- 2-5 pasos por caso (6 solo si es crítico por negocio/regla).
- Pasos accionables y concretos (sin texto vacío).
- Resultado esperado verificable y específico.
- Deduplica: si dos casos prueban lo mismo, conserva el más representativo.
- No agrupes en el resultado esperado comportamientos no ejecutados o no verificados en los pasos.
- Cada caso debe validar una intención principal y, como máximo, una validación secundaria estrechamente relacionada.
- Si un expectedResults menciona más de una validación relevante, los pasos deben ejercitar explícitamente todas esas validaciones.

OPTIMIZACIÓN DE TOKENS:
- Sé conciso: evita explicaciones narrativas.
- Usa textos breves: title <= 90 chars, preconditions <= 180 chars, expectedResults <= 180 chars.

FORMATO DE SALIDA:
- Responde SOLO JSON válido, sin markdown, sin comentarios, sin texto extra.
- El primer carácter de la respuesta debe ser "{" y el último debe ser "}".
- No uses bloques de código, no uses \`\`\`json, no uses prefijos ni sufijos.
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

  // Refinamiento directo (sin CoT) — igual que DIRECT_GENERATION_PROMPT + contexto del analista
  DIRECT_REFINE_PROMPT: (originalRequirements: string, currentCases: string, userRequest: string, technique: string): string => `
Actúa como QA Senior. Tienes los casos de prueba actuales y una instrucción específica del analista. Tu tarea es aplicar esa instrucción y devolver el conjunto de casos refinado.

INSTRUCCIÓN DEL ANALISTA (prioridad máxima — ejecútala de forma literal antes que cualquier otra regla):
"${userRequest}"

HU y CA de referencia:
${originalRequirements}

Casos Actuales:
${currentCases}

REGLAS DE TÉCNICA (obligatorias, subordinadas a la instrucción del analista):
1) Aplica la técnica "${technique}" de forma real, no solo nominal.
2) Si la técnica es "Partición Equivalente" o "Equivalent Partitioning":
   - Identifica internamente clases de equivalencia válidas e inválidas por campo, condición y regla de negocio.
   - Genera escenarios representativos por clase, evitando repetir casos de la misma partición sin valor adicional.
   - Para cada validación, restricción, habilitación, aparición o cardinalidad relevante, intenta cubrir al menos una partición válida y una inválida cuando aplique.
   - Si una regla define opciones permitidas/no permitidas, cubre la clase válida y al menos una clase inválida representativa.
3) Si la técnica es "Análisis de Valor Límite" o "Boundary Value Analysis":
   - Identifica límites mínimos, máximos y puntos críticos explícitos o claramente inferibles del CA.
   - Prioriza casos en: por debajo del límite, en el límite y por encima del límite.
   - Si hay límites de fecha, cantidad, tamaño, longitud, rango o cardinalidad, priorízalos sobre casos funcionales genéricos.
   - No inventes límites no sustentados por HU o CA.
   - Si una regla no tiene borde claro, cúbrela funcionalmente sin forzar un caso de valor límite artificial.
4) Si la técnica es "Tabla de Decisión" o "Decision Table":
   - Identifica condiciones y acciones.
   - Genera el conjunto mínimo de combinaciones que cubra reglas, cruces relevantes, conflictos y decisiones de negocio.
   - Si hay reglas mutuamente excluyentes, dependientes o condicionales, deben quedar reflejadas en combinaciones distintas cuando aplique.
   - Evita explosión combinatoria innecesaria.
5) Si la técnica es "Pruebas de Transición de Estados" o "State Transition Testing":
   - Identifica estados, eventos/disparadores, transiciones válidas, transiciones inválidas y restricciones por estado.
   - Cubre al menos transiciones válidas clave, inválidas relevantes y comportamiento dependiente del estado.
   - Si una acción cambia el estado de la pantalla, del proceso o de la disponibilidad de controles, modela esa transición en los casos.
6) Si alguna parte de los CA no aplica naturalmente a la técnica seleccionada, cúbrela funcionalmente sin forzar casos artificiales ni perder trazabilidad.

ANÁLISIS PRELIMINAR DE PARTICIONES (OBLIGATORIO - ANTES DE GENERAR):
Antes de generar cualquier caso de prueba, haz esto internamente:
1) Lee cada CA completo e identifica TODAS sus dimensiones:
   - ¿Tiene bifurcaciones explícitas? (Si/No, Válido/Inválido, etc.) → Cada rama = 1 partición
   - ¿Define límites? (mínimo, máximo, rango, cantidad) → 3 particiones (por debajo/dentro/encima)
   - ¿Define estados o transiciones? → 1 partición por estado clave
   - ¿Define aparición condicional, habilitación o visibilidad? → 1 partición válida + 1 inválida
   - ¿Define cardinalidad? (solo uno, múltiples, cantidad fija) → 1 partición por restricción
   - ¿Define combinaciones de reglas? (ej: Si X y Z entonces Y) → 1 partición por combinación relevante
2) ENUMERA TODAS las particiones identificadas (no internamente, mapea explícitamente)
3) Cuenta el TOTAL de particiones
4) Identifica combinaciones CRÍTICAS entre particiones (ej: Validación OK × Reembolso Si, Validación FAIL × Reembolso No)
5) El NÚMERO MÍNIMO de casos debe cubrir:
   - Todas las particiones individuales representativas
   - Las combinaciones críticas identificadas
   - Este mínimo NO es máximo: si necesitas más, GENERA MÁS

PRIORIZACIÓN DE ESCENARIOS (obligatoria):
1) Primero cubre reglas de negocio y validaciones usando la técnica seleccionada.
2) Después cubre navegación, redirección o flujo solo si aporta cobertura real a un CA o habilita una validación obligatoria.
3) No consumas casos en flujos cosméticos si existen validaciones, combinaciones, límites, transiciones o reglas de negocio sin cubrir.

REGLAS DE COBERTURA (obligatorias):
1) Analiza cada criterio de aceptación (CA) y clasifícalo por complejidad (baja/media/alta/muy alta).
2) Define MÍNIMO de casos (sin máximos restrictivos):
   - Baja (1-2 CA simples): MÍNIMO 4 casos
   - Media (3-5 CA, algunas reglas complejas): MÍNIMO 10 casos
   - Alta (6-10 CA con múltiples bifurcaciones): MÍNIMO 18 casos
   - Muy Alta (10+ CA complejos con combinaciones): MÍNIMO 25+ casos
   Si el análisis de particiones indica más casos necesarios, GENERA MÁS sin límite superior.
3) Cobertura por criterio: para cada CA distintivo intenta cubrir con enfoque positivo, negativo y alterno.
4) Si dos o más CA son ambiguos, solapados o muy similares, agrúpalos y cúbrelos con un conjunto completo de escenarios (no mínimo).
5) Cada CA (o grupo equivalente) debe quedar cubierto EXPLÍCITAMENTE por al menos 1 caso, y si es complejo (múltiples reglas), por MÚLTIPLES casos.
6) Incluye Happy Path, negativos relevantes, alternos y bordes reales cuando aporten valor según la técnica.
7) No generes escenarios cosméticos o redundantes.
8) Si un escenario es parecido a otro, conserva solo el más crítico y elimina duplicados.
9) Antes de responder, valida que no existan casos duplicados ni cobertura artificial inflada.
10) Si una regla define cardinalidad o cantidad permitida (por ejemplo: solo una selección, solo un archivo, máximo 1000 registros), genera MÍNIMO 1 caso por restricción (y de valor límite si aplica).
11) Si una regla define condiciones de aparición, habilitación, activación o visibilidad, incluye MÍNIMO una condición válida y una inválida cuando aplique.
12) Si un CA describe una secuencia obligatoria de eventos (validación → habilitación → apertura → mostrado), cubre MÍNIMO 1 caso completo + 1 que quiebre la secuencia.

VALIDACIÓN FINAL DE COBERTURA (OBLIGATORIA - ANTES DE RESPONDER):
1) Crea un mapeo interno: Cada caso generado → CA(s) que cubre
2) Para cada CA del original:
   - ¿Tiene cobertura positiva? SI / NO
   - ¿Tiene cobertura negativa (si aplica)? SI / NO
   - ¿Tiene cobertura alterno (si aplica)? SI / NO
3) Si algún CA tiene algún "NO" donde debería ser "SI", GENERA casos adicionales
4) Si un CA tiene N subcondiciones o reglas distintas (ej: "Si X validado entonces [mostrar Y] y [habilitar Z] y [cambiar estado a W]"):
   - Verifica que los PASOS de tus casos ejercitan CADA una de esas reglas SEPARADAMENTE o en combinación LÓGICA
   - Si falta una regla, crea caso adicional específico para ella
5) Si una pantalla o formulario tiene N campos, hay MÍNIMO N casos que ejercitan cada campo por lo menos en una validación
6) Si hay M bifurcaciones independientes (Si/No, OK/FAIL), hay MÍNIMO 2^M casos (o menos si hay relaciones de dependencia que reducen combinaciones)
7) Verifica el TOTAL de casos generados: ¿Es consistente con la complejidad analizada? Si parece bajo comparado con # de particiones, aumenta.

VALIDACIÓN DE COBERTURA (obligatoria):
1) Verifica internamente que cada CA textual quede cubierto explícitamente por al menos 1 caso.
2) Si un CA contiene múltiples reglas distintas (por ejemplo: condición de aparición + restricción + mensaje + redirección), no lo des por cubierto con un único caso genérico si las reglas requieren validaciones separadas.
3) Si los CA especifican textos, títulos, etiquetas, columnas, nombres de archivo, formatos, mensajes o restricciones exactas, genera casos que los validen explícitamente cuando sean obligatorios para la funcionalidad.
4) No marques como cubierto un comportamiento que solo aparezca mencionado en el expectedResults pero no haya sido realmente ejercitado en los pasos.
5) Si una técnica requiere representatividad estructural (particiones, bordes, combinaciones o transiciones), verifica internamente que los casos devueltos reflejen esa estructura y no solo cobertura funcional general.

REGLAS DE CALIDAD:
- Título claro SIN IDs técnicos (TC_001, etc).
- 2-5 pasos por caso (6 solo si es crítico por negocio/regla).
- Pasos accionables y concretos (sin texto vacío).
- Resultado esperado verificable y específico.
- Deduplica: si dos casos prueban lo mismo, conserva el más representativo.
- No agrupes en el resultado esperado comportamientos no ejecutados o no verificados en los pasos.
- Cada caso debe validar una intención principal y, como máximo, una validación secundaria estrechamente relacionada.
- Si un expectedResults menciona más de una validación relevante, los pasos deben ejercitar explícitamente todas esas validaciones.

OPTIMIZACIÓN DE TOKENS:
- Sé conciso: evita explicaciones narrativas.
- Usa textos breves: title <= 90 chars, preconditions <= 180 chars, expectedResults <= 180 chars.

FORMATO DE SALIDA:
- Responde SOLO JSON válido, sin markdown, sin comentarios, sin texto extra.
- El primer carácter de la respuesta debe ser "{" y el último debe ser "}".
- No uses bloques de código, no uses \`\`\`json, no uses prefijos ni sufijos.
- Verifica internamente que TODOS los CA tengan cobertura antes de responder.
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