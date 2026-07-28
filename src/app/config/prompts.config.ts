export const PROMPTS = {
  SCOPE: (description: string, acceptanceCriteria: string): string => `
Actúa como analista QA Senior.

OBJETIVO:
Genera exclusivamente el alcance funcional de las pruebas a partir de la HU y sus criterios.

HISTORIA DE USUARIO:
${description}

CRITERIOS DE ACEPTACIÓN:
${acceptanceCriteria}

PROCESAMIENTO OBLIGATORIO:
- Interpreta los criterios aunque estén desordenados, repetidos, mezclados o sin numeración.
- Identifica internamente reglas, condiciones, acciones, resultados, restricciones y dependencias.
- Consolida duplicados sin eliminar diferencias funcionales.
- No inventes información para completar vacíos o ambigüedades.

SALIDA:
- Un único párrafo en español de máximo 4 líneas y 420 caracteres.
- Define qué comportamientos, reglas y flujos quedan cubiertos.
- Sin encabezados, listas, markdown, explicaciones, saludos ni despedidas.
- Devuelve solamente el párrafo final.
`,

  STATIC_SECTION_ENHANCEMENT: (
    sectionName: string,
    existingContent: string,
    huSummary: string
  ): string => `
Actúa como QA Lead Senior.

SECCIÓN A GENERAR:
${sectionName}

CONTENIDO ACTUAL — SOLO REFERENCIA; NO ES OBLIGATORIO CONSERVARLO:
${existingContent}

CONTEXTO CONSOLIDADO DE HUS, CRITERIOS Y ESCENARIOS — FUENTE OBLIGATORIA:
${huSummary}

OBJETIVO:
Reemplaza completamente el contenido actual por una versión final, crítica y accionable de la sección.

PROCESAMIENTO OBLIGATORIO:
1. Examina todas las HUs y criterios, aunque estén desordenados o repetidos.
2. Consolida reglas equivalentes sin perder excepciones, condiciones ni restricciones.
3. Incluye únicamente información sustentada en el contexto.
4. Prioriza riesgos funcionales, dependencias explícitas, datos de prueba y restricciones reales.
5. Si un dato falta o es ambiguo, no lo inventes ni lo presentes como hecho.
6. Verifica internamente que ninguna HU relevante para la sección haya sido omitida.

REGLAS DE CALIDAD:
- Información crítica y útil para ejecutar pruebas.
- Sin contenido genérico, relleno, recomendaciones obvias ni repeticiones.
- Máximo 4 líneas, aproximadamente 110 caracteres por línea y 420 caracteres en total.

SALIDA:
Devuelve exclusivamente el texto final en español, sin encabezado, numeración, viñetas, markdown, JSON ni explicación adicional.
`,

  RISK_STRATEGY_PROMPT: (
    huSummary: string,
    availableScenarios: string[],
    previousRisks: string[] = []
  ): string => `
Actúa como QA Lead Senior especializado en análisis de riesgos de pruebas.
Todo el contenido generado debe estar exclusivamente en español.

FUENTE FUNCIONAL PRINCIPAL — HUS, CRITERIOS Y REGLAS:
${huSummary}

ESCENARIOS DE PRUEBA DISPONIBLES — FUENTE DE COBERTURA Y MITIGACIÓN:
${availableScenarios.length > 0
  ? availableScenarios
      .map((scenario, index) => `${index + 1}. ${scenario}`)
      .join('\n')
  : 'No se proporcionaron escenarios de prueba.'}

RIESGOS GENERADOS PREVIAMENTE:
${previousRisks.length > 0
  ? previousRisks
      .map((risk, index) => `${index + 1}. ${risk}`)
      .join('\n')
  : 'No se proporcionaron riesgos anteriores.'}

JERARQUÍA DE FUENTES — OBLIGATORIA:
1. Identifica el riesgo exclusivamente desde las HUs, criterios, reglas, dependencias, datos, integraciones y restricciones del contexto funcional.
2. No utilices los escenarios disponibles como fuente para inventar requisitos.
3. Usa los escenarios disponibles para determinar si el riesgo ya tiene cobertura y para construir su plan de mitigación.
4. Si un escenario contradice el contexto funcional, ignóralo.
5. Si los escenarios son insuficientes, genera propuestas nuevas únicamente cuando sean trazables al contexto funcional.

NORMALIZACIÓN INTERNA:
1. Interpreta todas las HUs y criterios aunque estén desordenados, repetidos, mezclados o sin numeración.
2. Separa internamente reglas, condiciones, acciones, estados, datos, restricciones, dependencias, integraciones y consecuencias.
3. Consolida duplicados sin eliminar diferencias funcionales.
4. Relaciona reglas dependientes aunque aparezcan separadas en el contexto.
5. No inventes funcionalidades, límites, integraciones, causas o impactos.
6. Si una información es ambigua, no la presentes como un hecho confirmado.

SELECCIÓN DEL RIESGO:
1. Identifica únicamente riesgos sustentados por el contexto funcional.
2. Evalúa cada riesgo por impacto de negocio y probabilidad estimada.
3. Selecciona el riesgo pendiente más crítico.
4. Compara evento, causa y consecuencia con previousRisks.
5. Evita repetir riesgos semánticamente equivalentes aunque estén redactados con palabras diferentes.
6. Si el riesgo principal ya fue generado, selecciona el siguiente más relevante.
7. Si no existe otro riesgo sustentado, puedes devolver el riesgo existente más crítico sin inventar uno diferente.
8. No fuerces variación aleatoria.

SEMÁNTICA OBLIGATORIA:
- probabilidadDe: evento futuro específico que puede fallar.
- puedeOcurrir: causa o condición que puede provocar el evento.
- loQuePodriaOcasionar: consecuencia observable para usuario, operación o negocio.
- No confundas el evento con la causa o la consecuencia.
- Evita expresiones genéricas como "puede generar errores" o "podría afectar el sistema".

CLASIFICACIÓN:
- impactLevel:
  1 = Ninguno
  2 = Bajo
  3 = Moderado
  4 = Alto
  5 = Crítico

- probabilityLevel:
  25 = Poca posibilidad
  50 = Puede ocurrir
  75 = Gran posibilidad
  100 = Ya ocurrió y existe evidencia explícita

REGLAS DE CLASIFICACIÓN:
1. Determina impactLevel por la consecuencia funcional o de negocio.
2. Determina probabilityLevel únicamente con evidencia del contexto.
3. Usa probabilityLevel=100 solo si el contexto indica explícitamente que el problema ya ocurrió.
4. Si no existe evidencia suficiente de probabilidad, usa una estimación conservadora de 25 o 50.
5. No clasifiques automáticamente como alto o crítico un riesgo solo porque involucra una integración.

PLAN DE MITIGACIÓN:
1. Selecciona primero escenarios disponibles que mitiguen directamente el riesgo.
2. positiveScenarios debe contener mínimo 2 escenarios que confirmen el funcionamiento correcto relacionado con el riesgo.
3. alternateScenarios debe contener mínimo 1 escenario negativo, alterno, de borde, error, recuperación o integración relacionado con el riesgo.
4. No incluyas escenarios genéricos ni escenarios sin relación directa.
5. No repitas el mismo escenario en ambas listas.
6. Si no existen escenarios suficientes, genera propuestas trazables a la HU o los criterios.
7. Los escenarios propuestos deben describir qué validar, no pasos detallados.
8. Usa el texto de los escenarios existentes cuando sea claro; no lo reformules innecesariamente.

VALIDACIÓN EN HASTA 3 PASADAS INTERNAS:
- Pasada 1 — Riesgo: verifica que evento, causa e impacto estén sustentados.
- Pasada 2 — Mitigación: verifica que los escenarios cubran directamente el riesgo.
- Pasada 3 — Calidad: elimina duplicados, generalidades, contradicciones y contenido inventado.
- Detén las revisiones antes si una pasada completa no encuentra omisiones.
- No muestres las pasadas, análisis ni razonamiento interno.

SALIDA:
Devuelve exclusivamente JSON válido, sin markdown, comentarios ni texto adicional.
El primer carácter debe ser "{" y el último "}".

{
  "probabilidadDe": "Evento de riesgo específico",
  "puedeOcurrir": "Causa concreta sustentada por el contexto",
  "loQuePodriaOcasionar": "Consecuencia concreta para usuario, operación o negocio",
  "impactLevel": 1,
  "probabilityLevel": 25,
  "positiveScenarios": [
    "Escenario positivo relacionado con el riesgo",
    "Segundo escenario positivo relacionado con el riesgo"
  ],
  "alternateScenarios": [
    "Escenario negativo, alterno, de borde o recuperación"
  ]
}
`,

  DIRECT_GENERATION_PROMPT: (
    description: string,
    acceptanceCriteria: string,
    technique: string = 'Automática',
    userRequest: string = ''
  ): string => `
Actúa como QA Senior especializado en diseño de pruebas. Genera una matriz suficiente, trazable y sin redundancias. Todo el contenido de salida debe estar en español.

HISTORIA DE USUARIO:
${description}

CRITERIOS DE ACEPTACIÓN — PUEDEN ESTAR DESORDENADOS:
${acceptanceCriteria}

TÉCNICA SOLICITADA:
${technique || 'Automática'}

INSTRUCCIÓN ESPECÍFICA DEL ANALISTA — PRIORIDAD ALTA:
${userRequest?.trim() || 'No se proporcionó una instrucción adicional.'}

JERARQUÍA DE INSTRUCCIONES:
1. Aplica primero la instrucción específica del analista cuando exista.
2. La instrucción puede definir enfoque, cantidad, prioridad, exclusiones, detalle o tipos de escenarios.
3. La instrucción no puede inventar ni contradecir requisitos funcionales de la HU o los criterios.
4. Si una parte contradice los requisitos, aplica únicamente la parte compatible.
5. Usa exclusivamente la HU y los criterios como fuente funcional.
6. Considera la técnica del formulario como PREFERENCIA INICIAL, no como imposición absoluta.
7. Evalúa cada regla y usa la técnica que realmente corresponda según su estructura.
8. Mantén la técnica seleccionada donde sea aplicable; compleméntala con otras cuando no cubra todo.
9. Si la técnica seleccionada no aplica a ningún criterio, sustitúyela internamente por la adecuada.
10. No fuerces límites, particiones, decisiones o estados inexistentes para cumplir la selección.
11. Si userRequest está vacío, continúa sin asumir instrucciones adicionales.
12. La prioridad del analista no autoriza omitir cobertura obligatoria ni alterar el JSON.

NORMALIZACIÓN INTERNA OBLIGATORIA:
1. Lee el contenido completo, sin asumir que el orden recibido representa el flujo.
2. Separa internamente cada regla atómica y asígnale CA-01, CA-02, CA-03, etc.
3. Para cada regla identifica, cuando exista: condición, acción, resultado, dato, límite, estado, dependencia, excepción y texto exacto.
4. Une duplicados semánticos, pero conserva diferencias de condición, resultado o restricción.
5. Relaciona reglas dependientes aunque estén separadas en el texto.
6. Detecta contradicciones y ambigüedades. No elijas una interpretación arbitraria: crea casos solo para lo comprobable y registra el supuesto mínimo en preconditions cuando sea imprescindible.
7. No alteres la intención funcional al reorganizar los criterios.

SELECCIÓN ADAPTATIVA DE TÉCNICA — OBLIGATORIA:
1. Clasifica internamente cada regla atómica según su estructura, no solo por la técnica del formulario.
2. Usa Partición Equivalente para clases válidas/inválidas, tipos de datos, opciones y reglas de aceptación.
3. Usa Análisis de Valor Límite únicamente para mínimos, máximos, rangos, fechas, tamaños, cantidades o cardinalidades explícitas.
4. Usa Tabla de Decisión cuando varias condiciones o combinaciones produzcan acciones o resultados distintos.
5. Usa Pruebas de Transición de Estados cuando existan estados, eventos, cambios o restricciones dependientes del estado.
6. Usa escenarios funcionales para secuencias sin estructura suficiente para las técnicas anteriores.
7. La técnica del formulario es la técnica inicial preferida y debe conservarse en los criterios compatibles.
8. Combina técnicas cuando distintos criterios necesiten tratamientos diferentes.
9. Sustituye internamente la técnica seleccionada solo en criterios donde sea inaplicable o insuficiente.
10. Elige el conjunto mínimo de técnicas que logre cobertura real y evite redundancias.

APLICACIÓN DE TÉCNICAS:
- Partición equivalente: representa cada clase relevante una vez, salvo que otra combinación cambie el resultado.
- Valores límite: prueba debajo, en y encima del límite cuando esos puntos sean válidos y estén sustentados.
- Tabla de decisión: cubre reglas y combinaciones materialmente distintas; elimina combinaciones imposibles o equivalentes.
- Transición de estados: cubre transiciones válidas clave, inválidas relevantes y restricciones dependientes del estado.
- No fuerces límites, estados, particiones o combinaciones que no estén respaldados por la entrada.

DISEÑO DE COBERTURA:
1. Cubre cada regla atómica con al menos un caso que la ejecute y verifique explícitamente.
2. Añade enfoque positivo, negativo, alterno o de borde solamente cuando aplique.
3. Si una regla contiene varias subcondiciones independientes, crea los casos necesarios para verificarlas.
4. Para visibilidad, habilitación o aparición condicional, cubre la condición que la activa y la que no la activa.
5. Para secuencias obligatorias, cubre el flujo válido y una ruptura relevante de la secuencia.
6. Para cardinalidad, cubre el valor permitido y el incumplimiento más representativo; usa bordes si hay límite explícito.
7. Para formularios, no impongas un caso por campo: crea casos por validación o partición funcional relevante.
8. Para bifurcaciones, no generes automáticamente 2^M casos. Usa tabla de decisión y cubre combinaciones que cambien resultados, riesgos o reglas.
9. Prioriza reglas de negocio, validaciones, integraciones y datos sobre navegación cosmética.
10. El número de casos se deriva de las reglas y particiones, no de cuotas fijas.

VALIDACIÓN EN HASTA 3 PASADAS INTERNAS:
- Pasada 1 — Solicitud y extracción: verifica userRequest, reglas atómicas y técnica adecuada por regla.
- Pasada 2 — Cobertura: mapea casos, criterios y técnicas; agrega lo faltante o corrige técnicas forzadas.
- Pasada 3 — Calidad: elimina duplicados, casos artificiales y resultados no ejercitados.
- Detén el proceso antes si una pasada completa no detecta omisiones.
- No muestres estas pasadas ni razonamiento interno en la respuesta.

REGLAS DE CALIDAD:
- Título claro, sin identificadores técnicos como TC_001.
- Entre 2 y 5 pasos; permite 6 solo cuando una secuencia crítica lo requiera.
- Pasos concretos, ejecutables y ordenados.
- Cada caso valida una intención principal y como máximo una validación secundaria estrechamente relacionada.
- El resultado esperado debe ser observable, específico y corresponder a acciones ejecutadas.
- No declares como validado algo mencionado únicamente en expectedResults.
- Conserva textos, etiquetas, mensajes, columnas y formatos exactos solo cuando la entrada los defina.
- title <= 90 caracteres, preconditions <= 180 y expectedResults <= 180 siempre que no se pierda precisión.

SALIDA:
- Devuelve exclusivamente JSON válido; sin markdown, comentarios, prefijos ni sufijos.
- El primer carácter debe ser "{" y el último "}".
- Usa exactamente esta estructura para mantener compatibilidad:
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

  DIRECT_REFINE_PROMPT: (
    originalRequirements: string,
    currentCases: string,
    userRequest: string,
    technique: string = 'Automática'
  ): string => `
Actúa como QA Senior especializado en refinamiento de matrices. Todo el contenido de salida debe estar en español.

INSTRUCCIÓN DEL ANALISTA:
${userRequest}

REQUISITOS ORIGINALES:
${originalRequirements}

CASOS ACTUALES:
${currentCases}

TÉCNICA SOLICITADA:
${technique || 'Automática'}

PRIORIDADES:
1. Aplica la instrucción del analista sin violar los requisitos originales.
2. Los requisitos originales son la única fuente funcional; no inventes comportamientos.
3. La técnica del formulario orienta el refinamiento, pero la estructura de cada criterio determina la técnica final.
4. Conserva los casos correctos que no necesiten cambios.
5. Modifica, agrega o elimina únicamente lo necesario.
6. Si la instrucción contradice los requisitos, conserva el requisito y aplica solo la parte compatible.

NORMALIZACIÓN Y CONTROL:
1. Reordena internamente los requisitos por reglas atómicas aunque lleguen desordenados.
2. Identifica condiciones, resultados, límites, estados, dependencias, excepciones y duplicados.
3. Revisa los casos actuales contra cada regla atómica.
4. No confundas una mención en expectedResults con una regla realmente ejecutada en los pasos.
5. No elimines cobertura existente salvo que el analista lo pida o sea duplicada, artificial o contradictoria.

SELECCIÓN ADAPTATIVA DE TÉCNICA — OBLIGATORIA:
1. Considera la técnica del formulario como preferencia inicial, no como imposición absoluta.
2. Reevalúa cada regla original y cada caso actual para determinar la técnica realmente aplicable.
3. Conserva la técnica seleccionada en criterios compatibles.
4. Usa Partición Equivalente para clases válidas/inválidas, tipos de datos, opciones y reglas de aceptación.
5. Usa Análisis de Valor Límite solo cuando existan límites explícitos de rango, fecha, tamaño, cantidad o cardinalidad.
6. Usa Tabla de Decisión cuando combinaciones de condiciones produzcan acciones o resultados diferentes.
7. Usa Transición de Estados cuando existan estados, eventos, cambios o restricciones por estado.
8. Usa escenarios funcionales cuando ninguna técnica estructural aplique naturalmente.
9. Combina técnicas si los criterios requieren tratamientos distintos.
10. Sustituye la técnica seleccionada únicamente donde sea inaplicable o insuficiente.
11. No fuerces una técnica ni inventes límites, estados, particiones o combinaciones.
12. En tablas de decisión cubre combinaciones que cambien resultados, no el producto cartesiano completo.

COBERTURA:
- Cada regla atómica aplicable debe quedar ejecutada y verificada por al menos un caso.
- Agrega positivos, negativos, alternos y bordes solo cuando correspondan.
- Cubre activación y no activación de comportamientos condicionales.
- Cubre secuencias obligatorias y una ruptura relevante cuando aplique.
- Deduplica por intención, condición probada y resultado, no solo por similitud del título.
- El total de casos debe responder a la cobertura real, no a una cuota mínima fija.

VALIDACIÓN EN HASTA 3 PASADAS INTERNAS:
- Pasada 1: verifica la solicitud, las reglas y la técnica adecuada para cada criterio.
- Pasada 2: detecta reglas sin cobertura, técnicas forzadas o cobertura perdida durante el refinamiento.
- Pasada 3: elimina duplicados, contradicciones, ruido y resultados no ejercitados.
- Detente antes si no aparecen omisiones nuevas.
- No muestres análisis, mapeos ni razonamiento interno.

CALIDAD:
- Título claro sin IDs técnicos.
- Entre 2 y 5 pasos; 6 únicamente para una secuencia crítica.
- Pasos accionables y resultados observables.
- Una intención principal por caso y como máximo una validación secundaria relacionada.
- title <= 90 caracteres, preconditions <= 180 y expectedResults <= 180 si no se pierde precisión.

SALIDA:
Devuelve exclusivamente JSON válido, sin markdown, comentarios ni texto adicional:
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