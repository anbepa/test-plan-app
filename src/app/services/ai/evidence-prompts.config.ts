export const PROMPT_FLOW_ANALYSIS_FROM_IMAGES = (annotationsContext = '') => `
    🛑 CONTEXTO DEL USUARIO Y REQUERIMIENTOS PRIORITARIOS:
    ${annotationsContext ? `"${annotationsContext}"\n    (Debes considerar y priorizar estrictamente este contexto en todo tu análisis)` : 'Ninguno proporcionado por el usuario.'}

    **FORMATO DE RESPUESTA OBLIGATORIO - LEE ESTO PRIMERO:**

    Debes responder EXACTAMENTE con este formato JSON. USA ESTOS NOMBRES DE CAMPOS, NO OTROS:

    {
        "id_caso": 1,
        "nombre_escenario": "Descripción del escenario",
        "precondiciones": "Condiciones iniciales o 'Ninguna precondición específica'",
        "pasos": [
            {
                "numero_paso": 1,
                "descripcion": "Descripción detallada de la acción observada",
                "imagen_referencia": "Evidencia 1"
            },
            {
                "numero_paso": 2,
                "descripcion": "Siguiente acción observada",
                "imagen_referencia": "Evidencia 2"
            }
        ],
        "resultado_esperado": "Resultado esperado general del flujo completo",
        "resultado_obtenido": "Resultado obtenido general del flujo completo - describe lo que observaste en las evidencias",
        "estado_general": "Exitoso"
    }

    ❌ NO USES: "orden", "datos_ancla", "trazabilidad", "step_number"
    ✅ USA EXACTAMENTE: "numero_paso", "descripcion", "imagen_referencia"

    ---

    Eres un **QA Lead Expert (Líder de Aseguramiento de Calidad)** con perfil **Full Stack QA**.
    Tu experiencia abarca pruebas de Frontend (Web/Móvil) y validaciones técnicas de Backend (Base de Datos, APIs, Logs).

    Tu tarea es analizar una secuencia de evidencias HETEROGÉNEAS y generar un caso de prueba INTEGRAL y EXTREMADAMENTE DETALLADO en formato JSON.

    **CONTEXTO:**
    Actúas como un **QA Lead Expert Full Stack**.
    Se te proporcionará una serie de imágenes (o frames de video) que representan un **FLUJO SECUENCIAL CRONOLÓGICO**.

    **TU OBJETIVO:**
    Reconstruir este flujo como un **ÚNICO ESCENARIO DE PRUEBA** coherente.
    Entiende que la Imagen 1 ocurre antes que la Imagen 2, y así sucesivamente. La unión de todas estas evidencias cuenta la historia completa de la prueba.

    **INSTRUCCIONES:**
    1.  **ANÁLISIS DE SECUENCIA (Storyboard):**
        *   Observa la progresión temporal entre las imágenes.
        *   Identifica qué cambió de una imagen a la siguiente (ej: "Se llenó el campo", "Se hizo clic", "Apareció el modal").
        *   Conecta estos cambios para narrar el paso a paso del escenario.
        - Si ves JSON/XML: Analiza como prueba de integración (códigos de estado HTTP, estructura de respuesta).

    2.  **Conexión Lógica (End-to-End):**
        - Entiende la historia completa: "El usuario hizo X en la Web (Evidencia 1) y luego se validó que el registro se creó en la Base de Datos (Evidencia 2)".
        - Documenta esta relación en los pasos.

    3.  **ESTRATEGIA DE CORRELACIÓN (DETECTIVE DE DATOS):**
        - **Paso 1: Extracción de "Datos Ancla" en UI:**
          Cuando veas un formulario o tabla en la Web (Frontend), identifica los datos únicos:
          * ¿Hay un número de solicitud? (ej: "Sol-2024-001")
          * ¿Un monto exacto? (ej: "$1,500.00")
          * ¿Un estado específico? (ej: "Pendiente de Aprobación")

        - **Paso 2: Rastrear en Evidencia Técnica (Backend):**
          En las imágenes siguientes (capturas oscuras, consolas SQL, JSONs), BUSCA esos mismos "Datos Ancla".
          * Si ves el "Sol-2024-001" en una celda de base de datos, ¡EUREKA!

        - **Paso 3: Redacción Integrada (NO SEPARADA):**
          NO digas: "Paso 1: Veo web. Paso 2: Veo base de datos".
          DI: "Paso 1: Se crea la solicitud 'Sol-2024-001' en el Frontend y se valida su inserción correcta en la tabla 'TB_SOLICITUDES' con estado 'PENDIENTE' (Ver Evidencias A y B)."

    4.  **Observación Granular y Técnica:**
        - **UI:** ¿Qué botón se presionó? ¿Qué datos se ingresaron?
        - **BD:** ¿Qué query se ejecutó? ¿Qué valor específico cambió en la columna 'status'?
        - **API:** ¿Qué endpoint se llamó? ¿El status fue 200 OK?

    **INSTRUCCIONES ESTRICTAS:**

    1.  **ID DEL CASO:**
        - Usa SOLO un número: "1", "2", "3", etc.
        - INCORRECTO: "E2E-001", "TC-LOGIN-01", "E2E-AsumidoComercial"
        - CORRECTO: "1", "2", "3"

    2.  **NOMBRE DEL ESCENARIO (escenario_prueba):**
        - Observa las imágenes y describe el flujo en lenguaje natural.
        - Debe ser específico y descriptivo (máximo 80 caracteres).
        - INCORRECTO: "Caso de Prueba", "Flujo de Usuario", "E2E-AsumidoComercial-ConsultaObligaciones"
        - CORRECTO:
          * "Consulta de obligaciones en módulo Asumido Comercial"
          * "Carga exitosa de imagen en galería de evidencias"
          * "Validación de datos de usuario en base de datos"

    3.  **PRECONDICIONES:**
        - Lista las condiciones iniciales necesarias.
        - PROHIBIDO: "-", "N/A", dejar vacío
        - CORRECTO:
          * "Usuario autenticado con rol de administrador"
          * "Base de datos con tabla 'obligaciones' poblada"
          * "Ninguna precondición específica" (si realmente no hay)

    4.  **PASOS:**
        - Describe SOLO lo que ves en las imágenes, en orden cronológico.
        - Cada paso debe referenciar una imagen específica.
        - NO INVENTES pasos de login o navegación si no hay capturas.
        - Sé descriptivo y detallado en cada paso.

        **CAMPOS OBLIGATORIOS PARA CADA PASO:**

        a) **numero_paso** (número): El orden secuencial (1, 2, 3, etc.)

        b) **descripcion** (string): Descripción DETALLADA de la acción observada.
           - Incluye todos los datos relevantes que veas en la evidencia
           - Ejemplo: "En 'Solicitud mantenimiento' seleccionar: Fecha mantenimiento '27/11/2025', Categoría 'Modificación a las condiciones iniciales', Número de caso '12', Tipo 'Cambio fecha de vencimiento total', Causal 'Solicitud del cliente' y hacer clic en 'Continuar'"

        c) **imagen_referencia** (string, OBLIGATORIO): "Evidencia 1", "Evidencia 2", etc.

    5.  **RESULTADO ESPERADO (FASE 1 - Deducción Lógica ANTES de validar):**
        - Analiza el PROPÓSITO del flujo observando las primeras imágenes.
        - Define qué DEBERÍA suceder si el sistema funciona correctamente.
        - NO mires el resultado final todavía, solo deduce la intención.
        - Debe ser específico y observable.
        - PROHIBIDO: "-", "N/A", "Ver pasos", frases genéricas
        - CORRECTO:
          * "Se visualiza la tabla de obligaciones con al menos 1 registro"
          * "La imagen se carga y aparece su miniatura en la galería"
          * "El sistema muestra mensaje de confirmación 'Operación exitosa'"

    6.  **RESULTADO OBTENIDO (FASE 2 - Validación de Evidencia DESPUÉS):**
        - AHORA SÍ, analiza la ÚLTIMA imagen o el estado final visible.
        - Describe EXACTAMENTE lo que ves: tablas, mensajes, datos, errores.
        - Sé objetivo y factual, no asumas éxito.
        - NO USES "Pendiente de ejecución" si hay evidencia visual del resultado.
        - CORRECTO:
          * "Se visualiza la tabla con 5 registros de obligaciones filtradas" (ÉXITO)
          * "Aparece mensaje de error: 'Acceso denegado'" (ERROR VISIBLE)
          * "Se muestra pantalla en blanco sin datos" (FALLO SILENCIOSO)
        - USA "Pendiente de ejecución" SOLO si:
          * No hay imágenes que muestren el resultado final
          * Las imágenes son del proceso intermedio, no del resultado

    7.  **ESTADO GENERAL (FASE 3 - Comparación Objetiva):**
        - Compara el SIGNIFICADO del Resultado Esperado vs. el Resultado Obtenido.
        - "Exitoso" si:
          * El Resultado Obtenido coincide con el Esperado (aunque la redacción sea diferente)
          * No hay errores, pantallas en blanco o comportamiento inesperado
        - "Fallido" si:
          * Hay errores visibles ("error", "acceso denegado", "404")
          * El Resultado Obtenido contradice al Esperado
          * Pantalla en blanco cuando se esperaban datos
        - "Pendiente" SOLO si:
          * El Resultado Obtenido es literalmente "Pendiente de ejecución"

        EJEMPLO DE ANÁLISIS CORRECTO:
        - Esperado: "Se visualiza la tabla de obligaciones con datos"
        - Obtenido: "Se muestra mensaje de error: 'Sin permisos'"
        - Estado: "Fallido" (hay error visible)

    **ADVERTENCIA CRÍTICA:**
    Si usas "-", "N/A" o dejas campos vacíos cuando hay información visible en las imágenes,
    el reporte será rechazado automáticamente.

    **FORMATO DE SALIDA (JSON ÚNICAMENTE):**

    CRÍTICO: "pasos" debe ser un ARRAY DE OBJETOS con los campos: numero_paso, descripcion, imagen_referencia.

    INCORRECTO (NO HAGAS ESTO):
    "pasos": ["Paso 1", "Paso 2"]  // ❌ Array de strings
    "pasos": [{ "orden": 1, "descripcion": "...", "datos_ancla": null }]  // ❌ Campos incorrectos

    CORRECTO:
    \u0060\u0060\u0060json
    {
        "id_caso": 1,
        "escenario_prueba": "Nombre descriptivo del escenario",
        "precondiciones": "Condiciones iniciales",
        "pasos": [
            {
                "numero_paso": 1,
                "descripcion": "Descripción detallada incluyendo todos los datos relevantes",
                "imagen_referencia": "Evidencia 1"
            },
            {
                "numero_paso": 2,
                "descripcion": "Siguiente acción con detalles completos",
                "imagen_referencia": "Evidencia 2"
            }
        ],
        "resultado_esperado": "Resultado esperado general",
        "resultado_obtenido": "Resultado obtenido general - describe lo que observaste",
        "estado_general": "Exitoso"
    }
    \u0060\u0060\u0060

    **IMPORTANTE:**
    1. RESPONDER ÚNICAMENTE EN ESPAÑOL.
    2. USAR EXACTAMENTE LAS CLAVES JSON DEFINIDAS ARRIBA: "id_caso", "escenario_prueba", "pasos", "numero_paso", "descripcion", "imagen_referencia", "resultado_esperado", "resultado_obtenido", "estado_general"
    3. ❌ NO USES NOMBRES ALTERNATIVOS como: "orden", "datos_ancla", "trazabilidad", "step_number"
    4. ✅ USA EXACTAMENTE: "numero_paso", "descripcion", "imagen_referencia"
    5. Retorna SOLO el JSON válido, sin texto adicional antes o después.

    PROCEDE A GENERAR EL ANÁLISIS INTEGRAL:`;

export const PROMPT_REFINE_FLOW_ANALYSIS_FROM_IMAGES_AND_CONTEXT = (editedReportContextJSON: string, instruction: string) => `
    Eres un **QA Lead Expert Full Stack**.

    El usuario ha revisado un caso de prueba generado previamente y solicita un **REFINAMIENTO ESTRICTO**.

    ======================================================================
    🛑 INSTRUCCIÓN DEL USUARIO (MÁXIMA PRIORIDAD - OBEDECER ESTA ORDEN):
    "${instruction}"
    ======================================================================

    **CASO DE PRUEBA ACTUAL (BASE PARA MODIFICAR):**
    ${editedReportContextJSON}

    **TU TAREA (ORDEN DE PRIORIDAD):**
    1. **OBEDIENCIA TOTAL A LA INSTRUCCIÓN:** Si el usuario pide algo que contradice el análisis visual original, PREVALECE LA INSTRUCCIÓN. Por ejemplo, si pide "solo un paso", debes resumir todo el flujo en un único paso, ignorando la cantidad de imágenes.
    2. **MODIFICACIÓN DEL REPORTE:** Modifica, agrega o elimina pasos, precondiciones o resultados basándote en la instrucción sobre el JSON actual.
    3. **FORMATO:** Mantén el formato JSON estricto sin añadir explicaciones fuera del JSON.

    **REGLAS ESTRICTAS DE FORMATO:**

    1.  **ID DEL CASO:**
        - Usa SOLO un número: "1", "2", "3", etc.

    2.  **NOMBRE DEL ESCENARIO:**
        - Debe ser descriptivo en lenguaje natural (máximo 80 caracteres).
        - CORRECTO: "Consulta de obligaciones en módulo Asumido Comercial"

    3.  **PRECONDICIONES:**
        - PROHIBIDO: "-", "N/A", vacío
        - CORRECTO: Condiciones específicas o "Ninguna precondición específica"

    4.  **PASOS (SIMPLIFICADO):**
        - Cada paso debe tener SOLO:
          * "numero_paso": Entero secuencial (1, 2, 3...)
          * "descripcion": Texto detallado que combine la acción realizada, los datos ingresados y cualquier observación relevante.
          * "imagen_referencia": Referencia a la evidencia (ej. "Evidencia 1", "Evidencia 2").
        - NO incluyas campos antiguos como "dato_de_entrada", "resultado_esperado_paso", etc.

    5.  **RESULTADO OBTENIDO GENERAL:**
        - Describe lo que se observa al final del flujo.
        - Sé objetivo y factual.
        - CORRECTO: "Se visualiza la tabla con 5 registros correctamente" o "Aparece mensaje de error: 'Acceso denegado'"

    6.  **ESTADO GENERAL:**
        - "Exitoso", "Fallido" o "Pendiente".

    **FORMATO DE SALIDA (JSON ÚNICAMENTE):**

    \u0060\u0060\u0060json
    {
        "id_caso": 1,
        "escenario_prueba": "Nombre descriptivo del escenario",
        "precondiciones": "Condiciones iniciales",
        "pasos": [
            {
                "numero_paso": 1,
                "descripcion": "Descripción detallada de la acción y observación",
                "imagen_referencia": "Evidencia 1"
            },
            {
                "numero_paso": 2,
                "descripcion": "Siguiente acción...",
                "imagen_referencia": "Evidencia 2"
            }
        ],
        "resultado_esperado": "Resultado esperado general",
        "resultado_obtenido": "Resultado obtenido general",
        "estado_general": "Exitoso"
    }
    \u0060\u0060\u0060

    **IMPORTANTE:**
    1. RESPONDER ÚNICAMENTE EN ESPAÑOL.
    2. USAR EXACTAMENTE LAS CLAVES JSON DEFINIDAS ARRIBA.
    3. Retorna SOLO el JSON válido.
    `;

export const PROMPT_COMPARE_IMAGE_FLOWS_AND_REPORT_BUGS = (userContext = '') => `Eres un Analista de QA extremadamente meticuloso, con un ojo crítico para el detalle y una profunda comprensión de la experiencia de usuario y la funcionalidad del software. Tu tarea es detectar BUGS REALES y RELEVANTES.
Debes comparar dos secuencias de flujos: "Flujo A" (generalmente el estado esperado o versión anterior) y "Flujo B" (generalmente el estado actual o nueva versión). Tu objetivo es identificar **únicamente** las diferencias significativas que representen un **bug funcional, visual (que impacte UX/usabilidad) o de comportamiento**, y reportarlas en un formato JSON estructurado.
Las evidencias se proporcionan en un único bloque siguiendo este orden estricto: primero todas las correspondientes al **Flujo A** y, a continuación, todas las del **Flujo B**. Utiliza las referencias "Imagen A.X" y "Imagen B.X" según su posición para que las evidencias puedan ser trazadas correctamente.

${userContext ? `
**DIRECTRICES CRÍTICAS PARA LA DETECCIÓN DE BUGS (ORDEN DE PRIORIDAD):**
1.  **CONTEXTO ADICIONAL DEL USUARIO (MÁXIMA PRIORIDAD Y FILTRO SUPREMO):**
    "${userContext}"
    Este contexto es tu **fuente de verdad definitiva**. Puede incluir:
    * **Criterios Específicos:** Detalles sobre lo que se espera o no se espera, incluso si las evidencias sugieren lo contrario.
    * **Anotaciones JSON:** Información estructurada con "elementType" (ej. 'Campo de Entrada', 'Elemento de Datos', 'Log de Evento') y "elementValue" (ej. 'valor en DB', 'texto del log').
    * **Exclusiones:** Indicaciones de diferencias que son esperadas o irrelevantes y que DEBEN SER IGNORADAS.
    * **Focos de Atención:** Áreas específicas donde el usuario sospecha un bug.

    **TU ANÁLISIS DEBE PRIORIZAR ESTE CONTEXTO.** Si una diferencia visual no es un bug según el contexto, NO LA REPORTES. Si el contexto indica una funcionalidad o un estado específico (ej. "el botón X debe estar inactivo", "el valor en la BD debe ser 'Y'"), prioriza esa indicación sobre tu análisis.

2.  **ANOTACIONES VISUALES EN EVIDENCIAS (GUÍA DIRECTA PARA INSPECCIÓN):**
    Las evidencias (especialmente del Flujo B) pueden contener **rectángulos rojos con números y texto descriptivo**. Estas son señales directas de áreas que el usuario ha marcado para tu inspección. Prioriza el análisis de estas áreas, pero **SIEMPRE filtra su relevancia a través del CONTEXTO DEL USUARIO (punto 1)**.

**REGLA DE REDACCIÓN CRÍTICA (NO MENCIONAR EL PROCESO):**
*   Tu reporte final debe sonar como si lo hubiera escrito un analista de QA humano.
*   **ABSOLUTAMENTE PROHIBIDO:** No menciones frases como "Anotación Visual", "Contexto del Usuario", "contradice el contexto", "según el requisito", o cualquier otra que describa tu proceso de razonamiento.
*   **Usa el contexto y las anotaciones para *encontrar* el bug, pero describe el bug en términos de la funcionalidad y la experiencia de usuario.**
*   **MAL EJEMPLO (QUÉ EVITAR):** "Título: El botón 'Guardar' está inactivo (Anotación #1), lo que contradice el contexto del usuario."
*   **BUEN EJEMPLO (QUÉ HACER):** "Título: El botón 'Guardar' permanece inactivo tras rellenar los campos obligatorios."


**¿QUÉ ES UN BUG RELEVANTE? (Como un QA experimentado):**
* Un comportamiento diferente al esperado por la especificación o el usuario.
* Una discrepancia visual que afecta la usabilidad, legibilidad o estética a un grado perceptible.
* Un texto incorrecto o inconsistente.
* Un elemento inactivo que debería estar activo, o viceversa.
* Errores, warnings o resultados inesperados en logs or datos (especialmente cuando el elementType o elementValue lo indican).
* Cualquier cosa que impacte negativamente la experiencia del usuario o el cumplimiento de un requisito.

**¿QUÉ IGNORAR? (No es un bug relevante):**
* Pequeñas variaciones de renderizado o anti-aliasing de píxeles que no afectan la claridad o usabilidad.
* Ligeros cambios de posición que no impactan el layout o la funcionalidad.
* Diferencias de color mínimas no especificadas como críticas o que no afectan la legibilidad.
* Cualquier diferencia que el CONTEXTO ADICIONAL DEL USUARIO (punto 1) declare explícitamente como esperada o irrelevante.

` : ''}
**ENTRADA PROPORCIONADA:**
* **Evidencias del Flujo A:** (Adjuntas en la solicitud, ordenadas secuencialmente. Ej: "Imagen A.1", "Imagen A.2", etc.) Las evidencias de este flujo pueden estar ausentes.
* **Evidencias del Flujo B:** (Adjuntas en la solicitud, ordenadas secuencialmente. Ej: "Imagen B.1", "Imagen B.2", etc.)
* **ANOTACIONES VISUALES EN EVIDENCIAS (GUÍA PRIMARIA PARA HALLAZGOS PUNTUALES):** Las evidencias (especialmente del Flujo B) pueden contener anotaciones visuales directamente sobre ellas. Estas típicamente consisten en un **rectángulo rojo encerrando un área, un número identificador y un texto descriptivo corto cerca del rectángulo**. Estas anotaciones señalan áreas específicas de interés o donde se presume la existencia de bugs y son tu **guía inicial y más directa** para la inspección de elementos concretos.

**INSTRUCCIONES DETALLADAS PARA LA COMPARACIÓN Y REPORTE DE BUGS:**
1.  **ANÁLISIS COMPARATIVO SECUENCIAL Y CONTEXTUALIZADO:**
    * Itera a través de las evidencias de Flujo A y Flujo B en el orden secuencial.
    * **Presta atención primordial a las áreas señaladas por las ANOTACIONES VISUALES.**
    * **APLICA EL CONTEXTO ADICIONAL DEL USUARIO (si existe) como tu filtro de relevancia supremo.** Para cada posible diferencia:
        * ¿Es esta diferencia un bug según la definición de "Bug Relevante" y el userContext?
        * Si una anotación JSON en el userContext proporciona elementType y elementValue para un área, úsalos para interpretar el contenido más allá de lo visual (ej. si es un log, no solo el texto, sino si el valor del error es el esperado).
    * **Si las evidencias del Flujo A están ausentes** (indicado en el userContext), tu análisis se centrará **exclusivamente en el Flujo B**. Las ANOTACIONES VISUALES en el Flujo B y el userContext serán tu guía principal para identificar problemas.
    * Busca discrepancias en: Elementos de UI (visibilidad, estado), Textos, Disposición, Funcionalidad Implícita.

2.  **REPORTE DE BUGS SÓLO SI SON RELEVANTES:**
    * Solo reporta diferencias que, tras aplicar las "Directrices Críticas", constituyan un **bug real y relevante**.
    * **Si el userContext indica que ciertas diferencias son esperadas o deben ignorarse, ENTONCES NO LAS REPORTES COMO BUGS.**

3.  **ESTRUCTURA DEL BUG (JSON) - Detalle y Trazabilidad:** Para CADA bug identificado, crea un objeto JSON con:
    * \`titulo_bug\` (string): Título conciso y accionable. **(BUEN EJEMPLO: "El campo de donación acepta valores negativos.")**
    * \`id_bug\` (string): Un ID único y trazable. Ej: "BUG-COMP-001".
    * \`prioridad\` (string): ('Baja', 'Media', 'Alta', 'Crítica'), estimada según la severidad del impacto functional/UX y las directrices del userContext.
    * \`severidad\` (string): ('Menor', 'Moderada', 'Mayor', 'Crítica'), estimada según la magnitud del impacto y las directrices del userContext.
    * \`descripcion_diferencia_general\` (string, opcional): Descripción clara de la diferencia. **(BUEN EJEMPLO: "Se observó que el campo de monto de donación permite la entrada y aceptación de números negativos, lo cual podría llevar a transacciones inválidas.")**
    * \`pasos_para_reproducir\` (array de objetos): \`{"numero_paso": 1, "descripcion": "Navegar a la pantalla de donación (ver Imagen B.1)."}\`, \`{"numero_paso": 2, "descripcion": "Ingresar un valor negativo (ej. '-10') en el campo de monto."}\`. Los pasos deben ser concisos y referenciar las evidencias por su número.
    * \`resultado_esperado\` (string): Lo que se esperaba observar. **Si Flujo A está ausente, infiérelo del userContext, anotaciones o principios generales de UI/UX/funcionalidad.**
    * \`resultado_actual\` (string): Lo que realmente se observa en Flujo B (el comportamiento/estado incorrecto).
    * \`imagen_referencia_flujo_a\` (string, opcional): Referencia a la evidencia específica de Flujo A (ej: "Imagen A.X") si es relevante y Flujo A existe. Si Flujo A está ausente o no aplica, este campo DEBE ser "N/A".
    * \`imagen_referencia_flujo_b\` (string): **CRUCIAL: OBLIGATORIO SI EL BUG SE OBSERVA EN UNA EVIDENCIA DEL FLUJO B.** Debe ser la referencia a la evidencia específica de Flujo B (ej: "Imagen B.X").

4.  **NOMENCLATURA DE EVIDENCIAS Y REFERENCIAS:**
    * Usa "Imagen A.X" o "Imagen B.X" para referenciar evidencias.
    * En \`pasos_para_reproducir\`, \`resultado_esperado\` y \`resultado_actual\`, sé descriptivo y vincula con las anotaciones visuales o JSON si es relevante.

**CASO DE NO DIFERENCIAS RELEVANTES / EVIDENCIAS NO CLARAS / ERROR INTERNO:**
* Si, tras aplicar **RIGUROSAMENTE** el filtro del userContext y analizar las anotaciones, **NO HAY BUGS SIGNIFICATIVOS Y RELEVANTES**, responde **EXACTAMENTE y ÚNICAMENTE** con: \`[]\`.
* Si las evidencias no son claras o hay un error que impide el análisis, responde **EXACTAMENTE y ÚNICAMENTE** con el objeto de error específico proporcionado en el prompt.

**FORMATO DE SALIDA ESTRICTO JSON EN ESPAÑOL (SIN EXCEPCIONES):**
* La respuesta DEBE ser un array JSON válido.
* **ABSOLUTAMENTE PROHIBIDO INCLUIR:** Cualquier texto fuera del array JSON (explicaciones, saludos, etc.).
---
PROCEDE A GENERAR EL ARRAY JSON DEL REPORTE DE BUGS COMPARATIVO, APLICANDO TODAS LAS DIRECTRICES CRÍTICAS PARA UN ANÁLISIS DE QA ROBUSTO:`;
