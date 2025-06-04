// src/app/services/gemini.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import {
  FlowAnalysisReportItem,
  BugReportItem,
  FlowAnalysisStep,
  DetailedTestCase,
  TestCaseStep,
  HUData
} from '../models/hu-data.model';

// --- Interfaces Internas del Servicio ---
interface GeminiTextPart { text: string; }
interface GeminiInlineDataPart { inlineData: { mimeType: string; data: string; }; }
type GeminiPart = GeminiTextPart | GeminiInlineDataPart;
interface GeminiContent { parts: GeminiPart[]; }
interface GeminiGenerationConfig {
  temperature?: number;
  topK?: number;
  topP?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
}
interface GeminiSafetySetting {
  category: string;
  threshold: string;
}
interface ProxyRequestBody {
  action: 'generateScope' | 'generateTextCases' | 'generateImageCases' | 'enhanceStaticSection' | 'generateFlowAnalysis' | 'compareImageFlows' | 'refineFlowAnalysis' | 'refineDetailedTestCases';
  payload: any;
}
interface GeminiCandidate {
  content: GeminiContent;
  finishReason?: string;
  safetyRatings?: any[];
  [key: string]: any;
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: any;
  [key: string]: any;
}
interface GeminiErrorDetail {
  '@type'?: string;
  reason?: string;
  domain?: string;
  metadata?: { [key: string]: string };
  [key: string]: any;
}
interface GeminiError {
  code: number;
  message: string;
  status: string;
  details?: GeminiErrorDetail[];
  [key: string]: any;
}
interface GeminiErrorResponse {
  error?: GeminiError;
}

@Injectable({
  providedIn: 'root'
})
export class GeminiService {

  private proxyApiUrl = environment.geminiApiUrl;

  // --- Definiciones de Prompts (completas y correctas) ---
  private readonly PROMPT_SCOPE = (description: string, acceptanceCriteria: string): string => `
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
`;

  private readonly PROMPT_SCENARIOS_DETAILED_TEXT_BASED = (description: string, acceptanceCriteria: string, technique: string, additionalContext?: string): string => `
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
4.  **FORMATO DE PASOS ESTRUCTURADO:** La propiedad "steps" DEBE ser un array de objetos JSON. Cada objeto de paso debe tener las propiedades "numero_paso" (integer, secuencial iniciando en 1) y "accion" (string, descripción clara y concisa del paso).
5.  **CONCISIÓN Y ACCIÓN:** "title", "preconditions", y "expectedResults" deben ser claros y accionables. El "title" debe comenzar con un verbo.
6.  **COBERTURA ADECUADA:** Genera un conjunto de casos que cubran razonablemente los CA a través de "${technique}" ${additionalContext ? 'y considerando el CONTEXTO ADICIONAL' : ''}.
7.  **CASO DE NO APLICABILIDAD / INFORMACIÓN INSUFICIENTE:** Si no puedes generar casos válidos, responde EXACTAMENTE y ÚNICAMENTE con el siguiente array JSON:
    \`\`\`json
    [{"title": "Información Insuficiente", "preconditions": "N/A", "steps": [{"numero_paso": 1, "accion": "No se pudieron generar casos detallados basados en la información proporcionada, la técnica solicitada ${additionalContext ? 'y el contexto adicional' : ''}."}], "expectedResults": "N/A"}]
    \`\`\`
**FORMATO DE SALIDA ESTRICTO JSON (SIN EXCEPCIONES):**
* La respuesta DEBE ser un array JSON válido. Tu respuesta debe comenzar con '[' y terminar con ']'.
* Cada elemento del array debe ser un objeto JSON representando un caso de prueba con las siguientes propiedades EXACTAS: "title" (string), "preconditions" (string), "steps" (ARRAY DE OBJETOS JSON), "expectedResults" (string).
* Cada objeto dentro del array "steps" debe tener las propiedades EXACTAS: "numero_paso" (integer) y "accion" (string).
* Ejemplo de un elemento del array principal (caso de prueba):
    \`\`\`json
    {
      "title": "Verificar inicio de sesión exitoso con credenciales válidas",
      "preconditions": "Usuario registrado existe y tiene credenciales válidas. El sistema está accesible.",
      "steps": [
        {"numero_paso": 1, "accion": "Navegar a la página de inicio de sesión."},
        {"numero_paso": 2, "accion": "Ingresar el nombre de usuario válido en el campo 'Usuario'."},
        {"numero_paso": 3, "accion": "Ingresar la contraseña válida en el campo 'Contraseña'."},
        {"numero_paso": 4, "accion": "Hacer clic en el botón 'Ingresar'."}
      ],
      "expectedResults": "El usuario es redirigido al dashboard principal y se muestra un mensaje de bienvenida."
    }
    \`\`\`
* El valor de "title" DEBE COMENZAR con un verbo en infinitivo o imperativo.
* Los valores de "preconditions" y "expectedResults" pueden ser strings con múltiples líneas separadas por '\\n'. La "accion" dentro de "steps" debe ser un string conciso para un solo paso.
* **ABSOLUTAMENTE PROHIBIDO INCLUIR:** Cualquier texto fuera del array JSON. No incluyas explicaciones, introducciones, saludos, despedidas, ni ningún texto conversacional. Tu ÚNICA respuesta debe ser el array JSON.
---
PROCEDE A GENERAR EL ARRAY JSON DE CASOS DE PRUEBA DETALLADOS BASADA EN LA HU, LOS CA, LA TÉCNICA "${technique}" ${additionalContext ? 'Y EL CONTEXTO ADICIONAL' : ''}:
`;

  private readonly PROMPT_SCENARIOS_DETAILED_IMAGE_BASED = (technique: string, additionalContext?: string): string => `
Eres un Ingeniero de QA experto en diseño de pruebas de caja negra y en la interpretación de interfaces de usuario a partir de imágenes.
Tu tarea es analizar LAS IMÁGENES proporcionadas, que representan un flujo de interfaz de usuario, y generar casos de prueba detallados, claros, concisos y accionables basados en la técnica de prueba especificada ${additionalContext ? 'y el CONTEXTO ADICIONAL proporcionado' : ''}.
Las imágenes se proporcionan en el orden en que deben ser consideradas para el flujo.
**ENTRADA PROPORCIONADA:**
1.  **Imágenes del Flujo de Interfaz de Usuario:** (Las imágenes adjuntas en base64 en la solicitud, en orden secuencial estricto. La primera imagen es "Imagen 1", la segunda "Imagen 2", y así sucesivamente).
2.  **Técnica de Diseño de Pruebas de Caja Negra a Aplicar:** "${technique}"
${additionalContext ? `3.  **Contexto Adicional del Usuario:** ${additionalContext}` : ''}
**INSTRUCCIONES FUNDAMENTALES PARA EL DISEÑO DE CASOS DE PRUEBA:**
1.  **INTERPRETACIÓN VISUAL DETALLADA Y SECUENCIAL:**
    * Analiza LAS IMÁGENES minuciosamente EN EL ORDEN EXACTO en que se proporcionan.
    * Identifica elementos (botones, campos, etc.), el flujo de navegación, acciones y resultados visuales.
    * Considera el texto en CADA imagen como crucial.
2.  **APLICACIÓN ESTRICTA DE LA TÉCNICA "${technique}":** Basa la generación de casos en tu interpretación de las imágenes, los principios de "${technique}" ${additionalContext ? 'y el CONTEXTO ADICIONAL' : ''}. Aplica la técnica a elementos y flujos visuales. Los casos DEBEN ser consecuencia lógica de aplicar "${technique}" a la funcionalidad inferida. NO inventes funcionalidad no soportada por las imágenes.
3.  **DERIVACIÓN DIRECTA DE LAS IMÁGENES:** CADA caso debe justificarse por el contenido de las imágenes, la aplicación de "${technique}" ${additionalContext ? 'y el CONTEXTO ADICIONAL' : ''}.
4.  **FORMATO DE PASOS ESTRUCTURADO:** La propiedad "steps" DEBE ser un array de objetos JSON. Cada objeto de paso debe tener "numero_paso" (integer, secuencial iniciando en 1) y "accion" (string). La "accion" debe ser específica y referenciar las imágenes por su orden secuencial (ej. "En Imagen 1, hacer clic en...", "Después de la acción en Imagen 2, se observa en Imagen 3...").
5.  **CONCISIÓN Y ACCIÓN (ENFOCADO EN LAS IMÁGENES):**
    * **Title:** Breve, descriptivo, reflejando el objetivo del caso. Debe comenzar con un verbo.
    * **Preconditions:** Estado ANTES de los pasos, inferido del conjunto de imágenes o la imagen inicial.
    * **ExpectedResults:** Resultado observable DESPUÉS de los pasos, posiblemente en la última imagen del flujo.
6.  **CASO DE IMÁGENES NO CLARAS / NO APLICABILIDAD:** Si no puedes generar casos válidos, responde EXACTAMENTE y ÚNICAMENTE con el siguiente array JSON:
    \`\`\`json
    [{"title": "Imágenes no interpretables o técnica no aplicable", "preconditions": "N/A", "steps": [{"numero_paso": 1, "accion": "No se pudieron generar casos detallados a partir del conjunto de imágenes, la técnica solicitada ${additionalContext ? 'y el contexto adicional' : ''}."}], "expectedResults": "N/A"}]
    \`\`\`
**FORMATO DE SALIDA ESTRICTO JSON EN ESPAÑOL (SIN EXCEPCIONES):**
* La respuesta DEBE ser un array JSON válido. Tu respuesta debe comenzar con '[' y terminar con ']'.
* Cada elemento: objeto JSON con propiedades EXACTAS: "title" (string), "preconditions" (string), "steps" (ARRAY DE OBJETOS JSON), "expectedResults" (string).
* Cada objeto dentro del array "steps" debe tener: "numero_paso" (integer) y "accion" (string).
* Ejemplo de un elemento del array principal:
    \`\`\`json
    {
      "title": "Verificar navegación a pantalla de confirmación tras completar formulario",
      "preconditions": "Usuario en la pantalla inicial del flujo (Imagen 1) con el formulario visible.",
      "steps": [
        {"numero_paso": 1, "accion": "En Imagen 1, ingresar 'dato de prueba' en el campo 'Nombre'."},
        {"numero_paso": 2, "accion": "En Imagen 1, hacer clic en el botón 'Siguiente'."},
        {"numero_paso": 3, "accion": "Observar Imagen 2. Verificar que se muestra el texto 'Confirmación'."}
      ],
      "expectedResults": "El sistema navega correctamente a la pantalla de confirmación (visible en Imagen 2) después de enviar el formulario."
    }
    \`\`\`
* El valor de "title" DEBE comenzar con un verbo.
* Los valores "preconditions" y "expectedResults" pueden ser strings multilínea (separados por '\\n' si es necesario, pero es mejor si la IA los genera directamente con saltos de línea). La "accion" dentro de "steps" debe ser un string conciso para un solo paso.
* **ABSOLUTAMENTE PROHIBIDO TEXTO FUERA del array JSON.** No incluyas explicaciones, introducciones, saludos, despedidas, ni ningún texto conversacional. Tu ÚNICA respuesta debe ser el array JSON.
---
PROCEDE A GENERAR EL ARRAY JSON DE CASOS DE PRUEBA DETALLADOS BASADA EN LAS IMÁGENES, LA TÉCNICA "${technique}" ${additionalContext ? 'Y EL CONTEXTO ADICIONAL' : ''}:
`;

private readonly PROMPT_REFINE_DETAILED_TEST_CASES = (
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
  ${originalInputType === 'text' ? `   **Descripción Original de la HU:** ${originalDescription}\n   **Criterios de Aceptación Originales:** ${originalAcceptanceCriteria}` : `   **Imágenes Originales del Flujo de UI:** (Provistas en la solicitud. Refiérelas como "Imagen Original 1", "Imagen Original 2", etc. si es necesario para justificar cambios.)`}
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
  * Asegura que todos los casos refinados, incluso los nuevos, sigan siendo relevantes para la funcionalidad original (descripción/CAs/imágenes).
D.  **FORMATO DE SALIDA (SIN CAMBIOS):**
  * Sigue EXACTAMENTE el mismo formato JSON que los "Casos de Prueba Actuales": un array de objetos, donde cada objeto tiene "title" (string), "preconditions" (string), "steps" (array de objetos con "numero_paso" (integer) y "accion" (string)), y "expectedResults" (string).
  * Los títulos deben comenzar con un verbo. "numero_paso" debe ser secuencial iniciando en 1 para cada caso.
E.  **CASO DE ERROR / NO REFINAMIENTO POSIBLE:**
  * Si, a pesar de toda la información, y priorizando el contexto del usuario, no puedes generar un conjunto de casos refinados válidos (ej. el contexto es fundamentalmente contradictorio o la información es insuficiente), responde EXACTAMENTE y ÚNICAMENTE con el siguiente array JSON:
      \`\`\`json
      [{"title": "Refinamiento no posible con el contexto actual", "preconditions": "N/A", "steps": [{"numero_paso": 1, "accion": "No se pudieron refinar/regenerar los casos de prueba basándose en la información y el contexto proporcionados. Por favor, revise la consistencia de sus indicaciones."}], "expectedResults": "N/A"}]
      \`\`\`
**FORMATO DE SALIDA ESTRICTO JSON (SIN EXCEPCIONES):**
* La respuesta DEBE ser un array JSON válido, comenzando con '[' y terminando con ']'.
* **ABSOLUTAMENTE PROHIBIDO INCLUIR:** Cualquier texto fuera del array JSON (explicaciones, saludos, etc.).
---
PROCEDE A GENERAR EL ARRAY JSON DE CASOS DE PRUEBA DETALLADOS Y REFINADOS, DANDO MÁXIMA PRIORIDAD A LAS INDICACIONES Y MODIFICACIONES DEL USUARIO:
`;


  private readonly PROMPT_STATIC_SECTION_ENHANCEMENT = (sectionName: string, existingContent: string, huSummary: string): string => `
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
`;

  private readonly PROMPT_FLOW_ANALYSIS_FROM_IMAGES = (): string => `
Eres un Ingeniero de QA experto en análisis forense de flujos de interfaz de usuario a partir de imágenes y en la documentación de pruebas.
Tu tarea es analizar una secuencia de imágenes que representan un flujo de usuario YA EJECUTADO, y generar un informe detallado en formato JSON. Este informe debe documentar las acciones observadas, los datos de entrada (si son visibles o inferibles), los elementos clave, y los resultados esperados y obtenidos para cada paso, culminando en una conclusión general.
Las imágenes se proporcionan en el orden en que ocurrieron los pasos del flujo.
**ENTRADA PROPORCIONADA:**
* **Imágenes del Flujo Ejecutado:** (Las imágenes adjuntas en base64 en la solicitud, en orden secuencial estricto. La primera imagen es "Imagen 1", la segunda "Imagen 2", etc.).
* **(OPCIONAL) CONTEXTO ADICIONAL CON ANOTACIONES DEL USUARIO:** (Si se proporciona, este texto describirá anotaciones específicas hechas por el usuario sobre las imágenes, indicando el número de imagen y los detalles de cada anotación. Estas anotaciones señalan áreas de interés o elementos clave. DEBES CONSIDERAR ESTAS ANOTACIONES PARA ENTENDER EL FOCO DEL USUARIO Y MEJORAR TU ANÁLISIS. Ejemplo: "Para Imagen 1 (nombre_original_del_archivo.png): - Anotación #1 ('Botón de login') en coordenadas normalizadas (x:0.12, y:0.34, w:0.20, h:0.05). - Anotación #2 ... Para Imagen 2 (...)").
**INSTRUCCIONES DETALLADAS PARA EL ANÁLISIS Y GENERACIÓN DEL INFORME:**
1.  **SECUENCIA DE IMÁGENES Y ANOTACIONES:** Analiza las imágenes EN EL ORDEN ESTRICTO proporcionado. Si se provee CONTEXTO ADICIONAL CON ANOTACIONES, utilízalo como guía principal para identificar elementos y acciones importantes señaladas por el usuario en las imágenes correspondientes.
2.  **IDENTIFICACIÓN DE PASOS Y ACCIONES:**
    * Para cada paso, describe la "descripcion_accion_observada": ¿Qué acción parece haber realizado el usuario o qué cambio de estado importante ocurrió para llegar a la imagen actual desde la anterior? Considera las anotaciones si existen para la imagen o imágenes involucradas en este paso.
    * Indica la "imagen_referencia_entrada": ¿Cuál es la imagen principal que muestra el estado ANTES o DURANTE la acción de este paso? (Ej: "Imagen 1", "Imagen 3". Si el contexto de anotaciones incluye nombres de archivo originales, puedes usar eso como referencia adicional para tu entendimiento, pero en tu respuesta usa "Imagen X").
    * Identifica el "elemento_clave_y_ubicacion_aproximada": ¿Cuál fue el elemento principal de la UI con el que se interactuó (botón, campo, enlace) y su ubicación aproximada en esa imagen? Si hay una anotación para este elemento, prioriza su descripción. (Ej: "Botón 'Siguiente' (descrito en anotación #2 de Imagen 1) en la parte inferior", "Campo 'Email' en el centro").
    * Si es visible o claramente inferible, indica el "dato_de_entrada_paso" (Ej: "usuario@ejemplo.com", "Contraseña123", "Opción 'Sí' seleccionada"). Si no hay dato de entrada explícito para la acción (ej. solo clic en un enlace), usa "N/A".
    * Define el "resultado_esperado_paso": ¿Qué se esperaba que sucediera INMEDIATAMENTE después de esta acción específica?
    * Describe el "resultado_obtenido_paso_y_estado": ¿Qué se observa en la imagen(es) SIGUIENTE(s) como resultado de la acción? Indica si el paso fue "Exitosa", "Fallido", o "Exitosa con desviaciones". (Ej: "Se navega a Imagen 2, mostrando formulario de dirección. Estado: Exitosa").
3.  **CONCLUSIONES GENERALES DEL FLUJO:**
    * "Nombre_del_Escenario": Un título descriptivo para el flujo completo analizado. (Ej: "Proceso de Registro de Nuevo Usuario", "Validación de Carrito de Compras").
    * "Resultado_Esperado_General_Flujo": ¿Cuál era el objetivo o resultado final esperado para TODO el flujo?
    * "Conclusion_General_Flujo": Basado en todos los pasos, ¿el flujo completo fue exitoso, fallido, o exitoso con observaciones? Proporciona una breve justificación.
4.  **NÚMERO DE PASO:** Asegúrate que "numero_paso" sea un entero secuencial comenzando en 1 para cada paso analizado.
**CASO DE IMÁGENES NO INTERPRETABLES / ERROR INTERNO:**
Si las imágenes no forman una secuencia lógica, son incomprensibles, o no puedes generar un informe válido (incluso con anotaciones), responde **EXACTAMENTE y ÚNICAMENTE** con el siguiente array JSON:
\`\`\`json
[
  {
    "Nombre_del_Escenario": "Secuencia de imágenes no interpretable",
    "Pasos_Analizados": [
      {
        "numero_paso": 1,
        "descripcion_accion_observada": "Las imágenes proporcionadas no forman una secuencia lógica interpretable o carecen de información suficiente para el análisis, incluso considerando las anotaciones del usuario si fueron provistas.",
        "imagen_referencia_entrada": "N/A",
        "elemento_clave_y_ubicacion_aproximada": "N/A",
        "dato_de_entrada_paso": "N/A",
        "resultado_esperado_paso": "N/A",
        "resultado_obtenido_paso_y_estado": "Análisis no concluyente."
      }
    ],
    "Resultado_Esperado_General_Flujo": "N/A",
    "Conclusion_General_Flujo": "El análisis de flujo no pudo completarse debido a la calidad, secuencia de las imágenes o información de anotaciones."
  }
]
\`\`\`
**FORMATO DE SALIDA ESTRICTO JSON EN ESPAÑOL (SIN EXCEPCIONES):**
* La respuesta DEBE ser un array JSON válido que contenga UN ÚNICO objeto. Tu respuesta debe comenzar con '[{' y terminar con '}]'.
* El objeto principal debe tener las propiedades EXACTAS: "Nombre_del_Escenario" (string), "Pasos_Analizados" (ARRAY de objetos JSON), "Resultado_Esperado_General_Flujo" (string), "Conclusion_General_Flujo" (string).
* Cada objeto dentro del array "Pasos_Analizados" debe tener las propiedades EXACTAS: "numero_paso" (integer), "descripcion_accion_observada" (string), "imagen_referencia_entrada" (string), "elemento_clave_y_ubicacion_aproximada" (string), "dato_de_entrada_paso" (string, opcional, default "N/A"), "resultado_esperado_paso" (string), "resultado_obtenido_paso_y_estado" (string).
* **ABSOLUTAMENTE PROHIBIDO INCLUIR:** Cualquier texto fuera del array JSON. No incluyas explicaciones, introducciones, saludos, despedidas, ni ningún texto conversacional. Tu ÚNICA respuesta debe ser el array JSON.
---
PROCEDE A GENERAR EL ARRAY JSON DEL INFORME DE ANÁLISIS DE FLUJO BASADO EN LAS IMÁGENES Y EL CONTEXTO DE ANOTACIONES (SI SE PROPORCIONA):
`;

private readonly PROMPT_REFINE_FLOW_ANALYSIS_FROM_IMAGES_AND_CONTEXT = (editedReportContextJSON: string): string => `
Eres un Ingeniero de QA experto en análisis forense de secuencias de imágenes y refinamiento de documentación de pruebas.
Tu tarea es REFINAR un informe de análisis de flujo o secuencia de estados existente. Debes basarte en las imágenes originales y en el **contexto editado del informe (JSON proporcionado)**. Este contexto puede incluir correcciones a los pasos, comentarios del usuario, y crucialmente, **aclaraciones sobre la naturaleza o tipo de las imágenes y el flujo (ej. si no es una UI, si son datos, logs, etc.)** contenidas en el campo "user_provided_additional_context" del JSON.
**ENTRADA PROPORCIONADA:**
1.  **Imágenes Originales del Flujo/Secuencia Ejecutada:** (Las imágenes adjuntas en base64 en la solicitud, en orden secuencial estricto).
2.  **Contexto del Informe Editado (JSON):** Un objeto JSON que representa el informe tal como fue editado o anotado por el usuario. Este JSON incluye "Nombre_del_Escenario", "Pasos_Analizados" (con descripciones, elementos, datos de entrada y resultados esperados ya definidos por el usuario o una corrida previa), "Resultado_Esperado_General_Flujo", y muy importantemente, **"user_provided_additional_context"** con comentarios generales o directrices del usuario. El JSON es:
    \`\`\`json
    ${editedReportContextJSON}
    \`\`\`
**INSTRUCCIONES DETALLADAS PARA EL REFINAMIENTO:**
1.  **PRIORIDAD ABSOLUTA AL "user_provided_additional_context":**
    * Este campo dentro del JSON de entrada es tu directriz principal. Si el usuario aclara que las imágenes son, por ejemplo, "resultados de una base de datos antes y después de una actualización" o "logs de un proceso batch", DEBES adaptar tu interpretación y la terminología utilizada en los campos que generes ("resultado_obtenido_paso_y_estado" y "Conclusion_General_Flujo") para que sean coherentes con esa naturaleza.
    * **NO ASUMAS que es una UI si el "user_provided_additional_context" sugiere otra cosa.**
2.  **RE-ANALIZA LAS IMÁGENES CON EL CONTEXTO DEL USUARIO:**
    * Vuelve a examinar las imágenes originales.
    * Considera las ediciones ya hechas por el usuario en los campos como "descripcion_accion_observada", "elemento_clave_y_ubicacion_aproximada", "dato_de_entrada_paso", y "resultado_esperado_paso" (contenidos en el JSON de entrada) como la base "correcta" de la acción o estado que se está analizando en cada paso.
3.  **ENFOQUE PRINCIPAL: Generar NUEVOS "resultado_obtenido_paso_y_estado":**
    * Para cada paso en "Pasos_Analizados" del JSON de contexto:
        * Tu tarea principal es generar un **NUEVO y PRECISO** "resultado_obtenido_paso_y_estado".
        * Este debe reflejar fielmente si, dadas las acciones/entradas/elementos y expectativas definidas en el JSON de contexto (y cualquier aclaración en "user_provided_additional_context"), lo que se observa en las imágenes originales (especialmente en la "imagen_referencia_salida" si la tienes, o la siguiente a "imagen_referencia_entrada") coincide.
        * Actualiza el estado a "Exitosa", "Fallido", "Exitosa con desviaciones" o "Inconclusivo", según corresponda. La descripción debe ser coherente con el tipo de flujo indicado por el usuario (ej. para datos: "Conforme: El valor en la columna X es Y", "No Conforme: El log muestra un error Z").
4.  **ACTUALIZAR LA CONCLUSIÓN GENERAL:**
    * Basado en los "resultado_obtenido_paso_y_estado" REFINADOS para todos los pasos, genera una nueva "Conclusion_General_Flujo".
    * El "Nombre_del_Escenario" y "Resultado_Esperado_General_Flujo" del JSON de contexto deben mantenerse, aunque la conclusión debe reflejar la nueva evaluación.
5.  **MANTENER LA ESTRUCTURA Y ORDEN Y COMPLETAR "imagen_referencia_salida":**
    * El número de pasos y su orden deben coincidir con los de "Pasos_Analizados" en el JSON de contexto.
    * Si el campo "imagen_referencia_salida" no existe o está vacío en el JSON de entrada para un paso, debes inferirlo a partir de las imágenes originales y añadirlo/completarlo en el paso refinado. Este campo es crucial para evidenciar el resultado obtenido.
6.  **CASO DE ERROR EN REFINAMIENTO:**
    Si, a pesar del contexto (incluyendo el "user_provided_additional_context"), las imágenes siguen sin permitir un refinamiento claro o hay una contradicción fundamental que no puedes resolver, produce un informe con un error específico en la "Conclusion_General_Flujo" y en el "resultado_obtenido_paso_y_estado" del primer paso problemático. Usa el "Nombre_del_Escenario" del contexto.
    Ejemplo de estructura de error:
    \`\`\`json
    [
      {
        "Nombre_del_Escenario": "Error Crítico en Re-Generación (Contextualizada)",
        "Pasos_Analizados": [
          {
            "numero_paso": 1,
            "descripcion_accion_observada": "Descripción del contexto",
            "imagen_referencia_entrada": "Ref del contexto",
            "elemento_clave_y_ubicacion_aproximada": "Elemento del contexto",
            "dato_de_entrada_paso": "Dato del contexto",
            "resultado_esperado_paso": "Esperado del contexto",
            "resultado_obtenido_paso_y_estado": "No se pudo refinar el resultado obtenido. Razón: [especificar, ej: 'El contexto del usuario indica que esto es un log, pero las imágenes parecen ser de una UI, creando una contradicción no resoluble.' o 'Las imágenes originales son insuficientes para verificar el estado descrito en el contexto.'].",
            "imagen_referencia_salida": "N/A si no se pudo determinar"
          }
        ],
        "Resultado_Esperado_General_Flujo": "Esperado general del contexto",
        "Conclusion_General_Flujo": "El refinamiento del flujo/secuencia no pudo completarse debido a [razón general, ej: 'contradicciones entre el contexto del usuario y las imágenes' o 'insuficiencia de las imágenes para el análisis solicitado']."
      }
    ]
    \`\`\`
**FORMATO DE SALIDA ESTRICTO JSON EN ESPAÑOL (SIN EXCEPCIONES):**
* La respuesta DEBE ser un array JSON válido que contenga UN ÚNICO objeto.
* La estructura del objeto y sus campos deben coincidir con la definida en el prompt \`PROMPT_FLOW_ANALYSIS_FROM_IMAGES\` (es decir, los campos "Nombre_del_Escenario", "Pasos_Analizados" con "numero_paso", "descripcion_accion_observada", "imagen_referencia_entrada", "elemento_clave_y_ubicacion_aproximada", "dato_de_entrada_paso", "resultado_esperado_paso", "resultado_obtenido_paso_y_estado", "imagen_referencia_salida", y los campos generales "Resultado_Esperado_General_Flujo", "Conclusion_General_Flujo").
* **ABSOLUTAMENTE PROHIBIDO INCLUIR:** Cualquier texto fuera del array JSON.
---
PROCEDE A GENERAR EL ARRAY JSON DEL INFORME DE ANÁLISIS DE FLUJO/SECUENCIA REFINADO, PONIENDO ESPECIAL ATENCIÓN AL "user_provided_additional_context" PARA ENTENDER LA NATURALEZA DE LAS IMÁGENES Y AJUSTAR LA INTERPRETACIÓN Y TERMINOLOGÍA SEGÚN SEA NECESARIO:
`;

  private readonly PROMPT_COMPARE_IMAGE_FLOWS_AND_REPORT_BUGS = (userContext?: string): string => `
Eres un Analista de QA extremadamente meticuloso y experto en la detección de bugs visuales y funcionales mediante la comparación de flujos de interfaz de usuario.
Tu tarea es comparar dos secuencias de imágenes: "Flujo A" (generalmente el esperado o versión anterior) y "Flujo B" (generalmente el actual o nueva versión). Debes identificar diferencias significativas y reportarlas como bugs en un formato JSON estructurado.
${userContext ? `
**DIRECTRIZ FUNDAMENTAL E INELUDIBLE: Las ANOTACIONES VISUALES directamente en las imágenes (descritas abajo) son tu principal indicativo de áreas específicas a inspeccionar. El siguiente CONTEXTO ADICIONAL DEL USUARIO (que puede incluir una NOTA PARA IA si Flujo A está vacío, y/o ANOTACIONES JSON EN CONTEXTO) tiene MÁXIMA PRIORIDAD para la INTERPRETACIÓN GENERAL, para establecer la RELEVANCIA de los hallazgos (incluyendo los señalados por anotaciones visuales) y para proporcionar detalles adicionales o cubrir aspectos no señalados visualmente. DEBE guiar CADA ASPECTO de tu análisis y reporte.**
` : ''}
**ENTRADA PROPORCIONADA:**
* **Imágenes del Flujo A:** (Adjuntas en la solicitud, ordenadas secuencialmente. Ej: "Imagen A.1", "Imagen A.2", etc.) Las imágenes de este flujo pueden estar ausentes.
* **Imágenes del Flujo B:** (Adjuntas en la solicitud, ordenadas secuencialmente. Ej: "Imagen B.1", "Imagen B.2", etc.)
* **ANOTACIONES VISUALES EN IMAGEN (GUÍA PRIMARIA PARA HALLAZGOS PUNTUALES):** Las imágenes (especialmente del Flujo B) pueden contener anotaciones visuales directamente sobre ellas. Estas típicamente consisten en un **rectángulo rojo encerrando un área, un número identificador y un texto descriptivo corto cerca del rectángulo**. Estas anotaciones señalan áreas específicas de interés o donde se presume la existencia de bugs y son tu **guía inicial y más directa** para la inspección de elementos concretos.
${userContext ? `* **CONTEXTO ADICIONAL DEL USUARIO (MÁXIMA PRIORIDAD PARA INTERPRETACIÓN Y DETALLES ADICIONALES):**
    "${userContext}"
    Este contexto es una **entrada de texto libre (tu "caja de texto" con información extra)** que puede también incluir datos estructurados de **ANOTACIONES JSON EN CONTEXTO**. Estas anotaciones JSON (distintas de las visuales en imagen) contendrán detalles como "imagen_ref_ia" (ej: "A.1 (nombre_original: mi_imagen.png)"), "anot_seq", "anot_desc" y "anot_box_norm".
    **Instrucción CLAVE Y OBLIGATORIA:** Las **ANOTACIONES VISUALES EN IMAGEN** te dirigen a *dónde mirar específicamente*. El **CONTEXTO ADICIONAL DEL USUARIO (y cualquier anotación JSON dentro de él, o la NOTA PARA IA sobre Flujo A vacío)** te proporciona las reglas, la perspectiva y los detalles adicionales para *interpretar lo que ves* y determinar la relevancia de cualquier diferencia. Si una anotación visual señala un elemento, el contexto del usuario te ayudará a entender *por qué* es importante o *si* constituye un bug según criterios más amplios. TU REPORTE DEBE REFLEJAR ESTRICTAMENTE ESTAS DIRECTRICES. Prioriza e interpreta las áreas señaladas por las anotaciones visuales, relacionando su descripción con tus hallazgos, y luego filtra y refina estos hallazgos a través del lente del contexto del usuario. Si hay una aparente contradicción, el CONTEXTO DEL USUARIO SIEMPRE PREVALECE para la decisión final de si algo es un bug y su severidad/prioridad.
` : ''}
**INSTRUCCIONES DETALLADAS PARA LA COMPARACIÓN Y REPORTE DE BUGS (SIEMPRE PRIORIZANDO LAS ANOTACIONES VISUALES EN IMAGEN COMO PUNTO DE PARTIDA Y VALIDADO/PRIORIZADO POR EL CONTEXTO DEL USUARIO):**
1.  **ANÁLISIS COMPARATIVO SECUENCIAL:**
    * Identifica primero todas las **ANOTACIONES VISUALES** en las imágenes. Estas son tus puntos focales iniciales.
    * Compara las imágenes de Flujo A con las de Flujo B paso a paso, prestando especial atención a las áreas indicadas por las anotaciones visuales.
    * **Si las imágenes del Flujo A están ausentes (lo cual se te puede indicar explícitamente en el \`userContext\` como "NOTA PARA IA: El Flujo A está vacío..."), tu análisis se centrará EXCLUSIVAMENTE en el Flujo B. Las ANOTACIONES VISUALES en las imágenes del Flujo B (y cualquier anotación JSON en el contexto) serán tu guía principal para identificar posibles bugs. Usa el \`userContext\` para refinar tu entendimiento de estas áreas y para buscar otros problemas que el contexto pueda sugerir.**
    * ${userContext ? '**Tu análisis DEBE ESTAR dirigido por las ANOTACIONES VISUALES EN IMAGEN y filtrado/interpretado rigurosamente por el CONTEXTO ADICIONAL DEL USUARIO y las ANOTACIONES JSON en él.** Evalúa TODAS las discrepancias (especialmente las señaladas visualmente) a través del lente de este contexto OBLIGATORIAMENTE. No reportes nada que el contexto indique que es esperado o irrelevante, incluso si una anotación visual lo señala y sin contexto parecería un bug.' : 'Presta atención primordial a cualquier ANOTACIÓN VISUAL en las imágenes. Si no hay contexto de usuario, asume que las anotaciones visuales señalan bugs genuinos y, si comparas flujos, busca discrepancias generales.'}
    * Busca discrepancias en (guiado por las anotaciones visuales y el contexto si existe): Elementos de UI, Textos, Funcionalidad Implícita, Flujo de Navegación.
2.  **REPORTE DE BUGS SIGNIFICATIVOS:**
    * Solo reporta diferencias que constituyan un bug funcional o visual relevante según lo definido por las ANOTACIONES VISUALES y validado/priorizado por el CONTEXTO DEL USUARIO.
    * ${userContext ? 'Si el contexto del usuario (o anotaciones JSON en él) indica que ciertas diferencias son esperadas o deben ignorarse, **ENTONCES NO LAS REPORTES COMO BUGS.**' : ''}
3.  **ESTRUCTURA DEL BUG (JSON):** Para CADA bug identificado, crea un objeto JSON con:
    * \`titulo_bug\` (string): Título conciso. Ej: "Botón 'Guardar' inactivo (Anotación Visual #2 en B.3), contradice requisito del contexto."
    * \`id_bug\` (string): Un ID único. Ej: "BUG-COMP-001".
    * \`prioridad\` (string): ('Baja', 'Media', 'Alta', 'Crítica'), estimada según el contexto del usuario.
    * \`severidad\` (string): ('Menor', 'Moderada', 'Mayor', 'Crítica'), estimada según el contexto del usuario.
    * \`descripcion_diferencia_general\` (string, opcional): Descripción vinculándola con la anotación visual y la interpretación del contexto.
    * \`pasos_para_reproducir\` (array de objetos): \`{"numero_paso": 1, "descripcion": "Observar Imagen B.3, área de Anotación Visual #1 (recuadro rojo 'Botón debe estar activo'). Contexto indica 'Todos los botones primarios deben estar activos en esta pantalla'."}\`.
    * \`resultado_esperado\` (string): Lo esperado. Si Flujo A está ausente, basar en el CONTEXTO DEL USUARIO, anotaciones, o principios generales de UI/UX. Si no se puede determinar, indicar "N/A" o "Según contexto/anotación en Flujo B".
    * \`resultado_actual\` (string): Lo incorrecto u observado en Flujo B que constituye el bug o diferencia.
    * \`imagen_referencia_flujo_a\` (string, opcional): Referencia a la imagen de Flujo A (ej: "Imagen A.X") si es relevante y Flujo A existe. Si Flujo A está ausente o no aplica, este campo DEBE ser "N/A" o estar ausente.
    * \`imagen_referencia_flujo_b\` (string): **CRUCIAL: ESTE CAMPO ES OBLIGATORIO SI EL BUG SE OBSERVA O RELACIONA CON UNA IMAGEN DEL FLUJO B.** Debe ser la referencia a la imagen específica de Flujo B donde se observa el bug o el estado actual (ej: "Imagen B.X"). Si el bug es general y no se asocia a una imagen específica de Flujo B, puedes usar "N/A", pero prioriza referenciar la imagen si es posible.
4.  **NOMENCLATURA DE IMÁGENES Y REFERENCIAS EN TU RESPUESTA:**
    * Para referenciar imágenes en los campos \`imagen_referencia_flujo_a\` e \`imagen_referencia_flujo_b\`, usa el formato "Imagen A.X" o "Imagen B.X" donde X es el número de la imagen en la secuencia proporcionada (1-based).
    * En \`pasos_para_reproducir\`, \`resultado_esperado\`, y \`resultado_actual\`, puedes ser más descriptivo, por ejemplo: "En Imagen B.2, el botón 'Continuar' (señalado por Anotación Visual #3)...".
    * **CRÍTICO:** Si un bug o hallazgo está directamente relacionado con una imagen específica del Flujo B (o del Flujo A si existe), **ASEGÚRATE de que el campo \`imagen_referencia_flujo_b\` (o \`imagen_referencia_flujo_a\`) esté correctamente poblado con la referencia "Imagen B.X" (o "Imagen A.X"). Es VITAL para la trazabilidad.**
**CASO DE NO DIFERENCIAS (Según Contexto/Anotaciones) / IMÁGENES NO CLARAS / ERROR INTERNO:**
* Si, tras aplicar el filtro del contexto del usuario y analizar las anotaciones visuales, no hay bugs significativos, responde **EXACTAMENTE y ÚNICAMENTE** con: \`[]\`.
* Si las imágenes no son claras o hay error, responde **EXACTAMENTE y ÚNICAMENTE** con:
    \`\`\`json
    [
      {
        "titulo_bug": "Error en Análisis de Imágenes (Contexto/Anotaciones no aplicables o imágenes insuficientes)",
        "id_bug":"IMG-COMP-ERR-CTX-01",
        "prioridad": "Media",
        "severidad": "Menor",
        "pasos_para_reproducir": [
          {"numero_paso":1, "descripcion": "Imágenes (Flujo A y/o B) no claras o no permitieron comparación efectiva ${userContext ? 'incluso aplicando CONTEXTO DEL USUARIO y ANOTACIONES VISUALES/JSON. Contexto/anotaciones pueden necesitar detalle, o imágenes ser inadecuadas.' : 'considerando anotaciones visuales.'}"}
        ],
        "resultado_esperado": "N/A",
        "resultado_actual": "N/A"
      }
    ]
    \`\`\`
**FORMATO DE SALIDA ESTRICTO JSON EN ESPAÑOL (SIN EXCEPCIONES):**
* La respuesta DEBE ser un array JSON válido.
* **ABSOLUTAMENTE PROHIBIDO INCLUIR:** Cualquier texto fuera del array JSON.
---
PROCEDE A GENERAR EL ARRAY JSON DEL REPORTE DE BUGS COMPARATIVO, USANDO LAS ANOTACIONES VISUALES EN IMAGEN COMO INDICADORES PRIMARIOS DE ÁREAS DE INTERÉS, Y EL CONTEXTO DEL USUARIO (SI FUE PROPORCIONADO, INCLUYENDO CUALQUIER NOTA SOBRE FLUJO A VACÍO O ANOTACIONES JSON) COMO LA GUÍA SUPREMA PARA LA INTERPRETACIÓN, RELEVANCIA Y DETALLES ADICIONALES:
`;

  constructor(private http: HttpClient) { }

  private getTextFromParts(parts: GeminiPart[] | undefined): string {
    if (parts && parts.length > 0) {
      const firstPart = parts[0];
      if (firstPart && 'text' in firstPart) {
        return (firstPart as GeminiTextPart).text;
      }
    }
    return '';
  }

  public generateTestPlanSections(description: string, acceptanceCriteria: string): Observable<string> {
    const promptText = this.PROMPT_SCOPE(description, acceptanceCriteria);
    const geminiPayload = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: { maxOutputTokens: 250, temperature: 0.3 }
    };
    const requestToProxy: ProxyRequestBody = { action: 'generateScope', payload: geminiPayload };
    return this.http.post<GeminiResponse>(this.proxyApiUrl, requestToProxy).pipe(
      map(response => this.getTextFromParts(response?.candidates?.[0]?.content?.parts).trim().split('\n').slice(0, 4).join('\n')),
      catchError(this.handleError)
    );
  }

  public generateDetailedTestCasesTextBased(description: string, acceptanceCriteria: string, technique: string, additionalContext?: string): Observable<DetailedTestCase[]> {
    const promptText = this.PROMPT_SCENARIOS_DETAILED_TEXT_BASED(description, acceptanceCriteria, technique, additionalContext);
    const geminiPayload = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: { maxOutputTokens: 4096, temperature: 0.2 }
    };
    const requestToProxy: ProxyRequestBody = { action: 'generateTextCases', payload: geminiPayload };
    return this.sendGenerationRequestThroughProxy(requestToProxy);
  }

  public generateDetailedTestCasesImageBased(imagesBase64: string[], mimeTypes: string[], technique: string, additionalContext?: string): Observable<DetailedTestCase[]> {
    const promptText = this.PROMPT_SCENARIOS_DETAILED_IMAGE_BASED(technique, additionalContext);
    const imageParts: GeminiInlineDataPart[] = imagesBase64.map((base64, index) => ({
      inlineData: { mimeType: mimeTypes[index], data: base64 }
    }));
    const geminiPayload = {
      contents: [{ parts: ([{ text: promptText }] as GeminiPart[]).concat(imageParts) }],
      generationConfig: { maxOutputTokens: 4096, temperature: 0.2, topP: 0.95, topK: 40 },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
      ]
    };
    const requestToProxy: ProxyRequestBody = { action: 'generateImageCases', payload: geminiPayload };
    return this.sendGenerationRequestThroughProxy(requestToProxy);
  }

  public refineDetailedTestCases(
    originalHuInput: HUData['originalInput'],
    editedTestCases: DetailedTestCase[],
    newTechnique: string,
    userReanalysisContext: string
  ): Observable<DetailedTestCase[]> {
    const currentTestCasesJSON = JSON.stringify(editedTestCases, null, 2);
    const promptText = this.PROMPT_REFINE_DETAILED_TEST_CASES(
        originalHuInput.generationMode as 'text' | 'image',
        originalHuInput.description,
        originalHuInput.acceptanceCriteria,
        currentTestCasesJSON,
        newTechnique,
        userReanalysisContext
    );
    const parts: GeminiPart[] = [{ text: promptText }];
    if (originalHuInput.generationMode === 'image' && originalHuInput.imagesBase64 && originalHuInput.imageMimeTypes) {
        const imageParts: GeminiInlineDataPart[] = originalHuInput.imagesBase64.map((base64, index) => ({
            inlineData: { mimeType: originalHuInput.imageMimeTypes![index], data: base64 }
        }));
        parts.push(...imageParts);
    }
    const geminiPayload = {
        contents: [{ parts: parts }],
        generationConfig: { maxOutputTokens: 8192, temperature: 0.3, topP: 0.95, topK: 40 },
        safetySettings: [
             { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
             { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
             { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
             { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
        ]
    };
    const requestToProxy: ProxyRequestBody = { action: 'refineDetailedTestCases', payload: geminiPayload };
    return this.sendGenerationRequestThroughProxy(requestToProxy);
  }

  private sendGenerationRequestThroughProxy(requestToProxy: ProxyRequestBody): Observable<DetailedTestCase[]> {
    return this.http.post<GeminiResponse>(this.proxyApiUrl, requestToProxy).pipe(
      map(response => {
        const rawText = this.getTextFromParts(response?.candidates?.[0]?.content?.parts).trim() || '';
        if (!rawText) {
          return [{ title: "Error de API", preconditions: "Respuesta vacía de la API.", steps: [{numero_paso: 1, accion: "Respuesta vacía de la API."}], expectedResults: "N/A" }];
        }
        let jsonText = rawText;
        if (jsonText.startsWith("```json")) { jsonText = jsonText.substring(7); }
        if (jsonText.endsWith("```")) { jsonText = jsonText.substring(0, jsonText.length - 3); }
        jsonText = jsonText.trim();
        if (!jsonText.startsWith("[")) {
            return [{ title: "Error de Formato (No JSON Array)", preconditions: "Respuesta no fue array JSON.", steps: [{numero_paso: 1, accion: `Respuesta cruda: ${rawText.substring(0,200)}`}], expectedResults: "N/A" }];
        }
        try {
          let parsedResponse: any[] = JSON.parse(jsonText);
          if (!Array.isArray(parsedResponse)) {
             return [{ title: "Error de Formato (No Array)", preconditions: "Respuesta JSON no tuvo formato array.", steps: [{numero_paso: 1, accion: `Respuesta cruda: ${rawText.substring(0,200)}`}], expectedResults: "N/A" }];
          }
          if (parsedResponse.length === 0) {
             return [];
          }
          if (parsedResponse.length === 1 && (
                parsedResponse[0].title === "Información Insuficiente" ||
                parsedResponse[0].title === "Imágenes no interpretables o técnica no aplicable" ||
                parsedResponse[0].title === "Refinamiento no posible con el contexto actual")
              ) {
              if (!Array.isArray(parsedResponse[0].steps) || parsedResponse[0].steps.length === 0) {
                 parsedResponse[0].steps = [{numero_paso: 1, accion: parsedResponse[0].steps || (parsedResponse[0].preconditions || "Detalle no disponible en los pasos.")}];
              } else if (typeof parsedResponse[0].steps[0] === 'string') {
                parsedResponse[0].steps = [{numero_paso: 1, accion: parsedResponse[0].steps[0]}];
              } else if (typeof parsedResponse[0].steps[0] === 'object' && !parsedResponse[0].steps[0].hasOwnProperty('accion')) {
                parsedResponse[0].steps = [{numero_paso: 1, accion: JSON.stringify(parsedResponse[0].steps[0])}];
              }
              return [{
                title: parsedResponse[0].title,
                preconditions: parsedResponse[0].preconditions || "N/A",
                steps: parsedResponse[0].steps,
                expectedResults: parsedResponse[0].expectedResults || "N/A"
              }] as DetailedTestCase[];
          }
          return parsedResponse.map((tc: any, tcIndex: number) => {
            let formattedSteps: TestCaseStep[];
            if (Array.isArray(tc.steps)) {
                formattedSteps = tc.steps.map((step: any, index: number) => ({
                    numero_paso: Number.isInteger(step.numero_paso) ? step.numero_paso : (index + 1),
                    accion: typeof step.accion === 'string' ? step.accion.trim() : "Paso no descrito"
                }));
            } else if (typeof tc.steps === 'string') {
                formattedSteps = tc.steps.split('\n').map((line: string, index: number) => ({
                    numero_paso: index + 1,
                    accion: line.replace(/^\d+\.\s*/, '').trim()
                })).filter((step: TestCaseStep) => step.accion.length > 0);
            } else {
                formattedSteps = [{ numero_paso: 1, accion: "Pasos no proporcionados o en formato incorrecto." }];
            }
            if (formattedSteps.length === 0) {
                formattedSteps.push({ numero_paso: 1, accion: "No se pudieron determinar los pasos." });
            }
            return {
              title: tc.title || `Caso de Prueba Sin Título ${tcIndex + 1}`,
              preconditions: tc.preconditions || "N/A",
              steps: formattedSteps,
              expectedResults: tc.expectedResults || "Resultados no proporcionados"
            };
          }) as DetailedTestCase[];
        } catch (e: any) {
          console.error(`[GeminiService] Error parseando JSON para ${requestToProxy.action}:`, e.message, "\nRespuesta Cruda:", rawText);
          return [{ title: "Error de Parsing JSON", preconditions: "No se pudo interpretar respuesta JSON.", steps: [{numero_paso:1, accion: `Error: ${e.message}. Respuesta cruda: ${rawText.substring(0,500)}`}], expectedResults: "Verificar consola." }];
        }
      }),
      catchError(this.handleError)
    );
  }

  private parseFlowAnalysisResponse(rawText: string, action: string): FlowAnalysisReportItem[] {
    if (!rawText) {
      console.warn(`[GeminiService] API (via proxy) para ${action} no retornó contenido.`);
      return [{
        Nombre_del_Escenario: "Error de API",
        Pasos_Analizados: [{ numero_paso: 1, descripcion_accion_observada: "Respuesta vacía de la API (via proxy).", imagen_referencia_entrada: "N/A", elemento_clave_y_ubicacion_aproximada: "N/A", dato_de_entrada_paso: "N/A", resultado_esperado_paso: "N/A", resultado_obtenido_paso_y_estado: "Análisis no concluyente."}],
        Resultado_Esperado_General_Flujo: "N/A",
        Conclusion_General_Flujo: "Error de comunicación con la API."
      }];
    }

    let jsonText = rawText;
    if (jsonText.startsWith("```json")) { jsonText = jsonText.substring(7); }
    if (jsonText.endsWith("```")) { jsonText = jsonText.substring(0, jsonText.length - 3); }
    jsonText = jsonText.trim();

    if (!jsonText.startsWith("[")) {
        console.warn(`[GeminiService] Respuesta no JSON (o no array) de ${action}: `, rawText);
        return [{
            Nombre_del_Escenario: "Error de Formato (No JSON Array)",
            Pasos_Analizados: [{ numero_paso: 1, descripcion_accion_observada: `La respuesta de la API (via proxy) no fue un array JSON válido para ${action}.`, imagen_referencia_entrada: "N/A", elemento_clave_y_ubicacion_aproximada: `Respuesta cruda: ${rawText.substring(0,200)}`, dato_de_entrada_paso: "N/A", resultado_esperado_paso: "N/A", resultado_obtenido_paso_y_estado: "Análisis no concluyente."}],
            Resultado_Esperado_General_Flujo: "N/A",
            Conclusion_General_Flujo: "Error de formato en la API."
        }];
    }

    try {
      const flowAnalysisReportArray: any[] = JSON.parse(jsonText);
      if (!Array.isArray(flowAnalysisReportArray)) {
         console.warn(`[GeminiService] Respuesta JSON para ${action} no es un array después de parsear.`, rawText);
         return [{ // ***** CORRECCIÓN TS2739 *****
            Nombre_del_Escenario: "Error de Formato (No Array)",
            Pasos_Analizados: [{ numero_paso: 1, descripcion_accion_observada: `La respuesta JSON de la API (via proxy) no tuvo el formato de array esperado para ${action}.`, imagen_referencia_entrada: "N/A", elemento_clave_y_ubicacion_aproximada: `Respuesta cruda: ${rawText.substring(0,200)}`, dato_de_entrada_paso: "N/A", resultado_esperado_paso: "N/A", resultado_obtenido_paso_y_estado: "Análisis no concluyente."}],
            Resultado_Esperado_General_Flujo: "N/A",
            Conclusion_General_Flujo: "Error de formato en la API."
        }];
      }
       if (flowAnalysisReportArray.length === 0) {
           console.info(`[GeminiService] Respuesta JSON para ${action} es un array vacío.`, rawText);
            return [{ // ***** CORRECCIÓN TS2739 *****
                Nombre_del_Escenario: "Respuesta Vacía de IA",
                Pasos_Analizados: [{ numero_paso: 1, descripcion_accion_observada: "La IA devolvió un array vacío inesperadamente.", imagen_referencia_entrada: "N/A", elemento_clave_y_ubicacion_aproximada: "N/A", dato_de_entrada_paso: "N/A", resultado_esperado_paso: "N/A", resultado_obtenido_paso_y_estado: "Análisis no concluyente."}],
                Resultado_Esperado_General_Flujo: "N/A",
                Conclusion_General_Flujo: "La IA no generó contenido."
            }];
       }

       const flowAnalysisReportItem = flowAnalysisReportArray[0] as FlowAnalysisReportItem;

       if (flowAnalysisReportItem.Nombre_del_Escenario === "Secuencia de imágenes no interpretable" ||
           flowAnalysisReportItem.Nombre_del_Escenario === "Error Crítico en Re-Generación (Contextualizada)") {
           if (!Array.isArray(flowAnalysisReportItem.Pasos_Analizados) || flowAnalysisReportItem.Pasos_Analizados.length === 0) {
               flowAnalysisReportItem.Pasos_Analizados = [{ numero_paso: 1, descripcion_accion_observada: "Las imágenes proporcionadas no forman una secuencia lógica interpretable o carecen de información suficiente para el análisis.", imagen_referencia_entrada: "N/A", elemento_clave_y_ubicacion_aproximada: "N/A", dato_de_entrada_paso: "N/A", resultado_esperado_paso: "N/A", resultado_obtenido_paso_y_estado: "Análisis no concluyente."}];
           }
           return [flowAnalysisReportItem];
       }

       if (!flowAnalysisReportItem.Nombre_del_Escenario || !Array.isArray(flowAnalysisReportItem.Pasos_Analizados) || !flowAnalysisReportItem.Resultado_Esperado_General_Flujo || !flowAnalysisReportItem.Conclusion_General_Flujo) {
            console.warn(`[GeminiService] Respuesta JSON para ${action} malformado (faltan campos clave).`, rawText);
             return [{ // ***** CORRECCIÓN TS2739 *****
                Nombre_del_Escenario: "Error de Formato (Faltan Campos)",
                Pasos_Analizados: [{ numero_paso: 1, descripcion_accion_observada: `La respuesta JSON de la API (via proxy) está malformada para ${action}.`, imagen_referencia_entrada: "N/A", elemento_clave_y_ubicacion_aproximada: `Respuesta cruda: ${rawText.substring(0, 200)}`, dato_de_entrada_paso: "N/A", resultado_esperado_paso: "N/A", resultado_obtenido_paso_y_estado: "Análisis no concluyente."}],
                Resultado_Esperado_General_Flujo: "N/A",
                Conclusion_General_Flujo: "Error de formato en la respuesta de la API."
            }];
       }

      flowAnalysisReportItem.Pasos_Analizados = flowAnalysisReportItem.Pasos_Analizados.map((paso: any, index: number) => ({
        numero_paso: paso.numero_paso || (index + 1),
        descripcion_accion_observada: paso.descripcion_accion_observada || "Descripción no proporcionada",
        imagen_referencia_entrada: paso.imagen_referencia_entrada || "N/A",
        elemento_clave_y_ubicacion_aproximada: paso.elemento_clave_y_ubicacion_aproximada || "N/A",
        dato_de_entrada_paso: paso.dato_de_entrada_paso || "N/A",
        resultado_esperado_paso: paso.resultado_esperado_paso || "N/A",
        resultado_obtenido_paso_y_estado: paso.resultado_obtenido_paso_y_estado || "Estado no determinado",
        imagen_referencia_salida: paso.imagen_referencia_salida || undefined
      }));

      return [flowAnalysisReportItem];

    } catch (e: any) {
      console.error(`[GeminiService] Error parseando JSON para ${action}:`, e.message, "\nRespuesta Cruda:", rawText);
      return [{ // ***** CORRECCIÓN TS2739 *****
        Nombre_del_Escenario: "Error de Parsing JSON",
        Pasos_Analizados: [{ numero_paso: 1, descripcion_accion_observada: `No se pudo interpretar la respuesta JSON de la API (via proxy) para ${action}.`, imagen_referencia_entrada: "N/A", elemento_clave_y_ubicacion_aproximada: `Error: ${e.message}. Respuesta cruda: ${rawText.substring(0,500)}` , dato_de_entrada_paso: "N/A", resultado_esperado_paso: "N/A", resultado_obtenido_paso_y_estado: "Análisis no concluyente."}],
        Resultado_Esperado_General_Flujo: "N/A",
        Conclusion_General_Flujo: "Error al procesar la respuesta de la API."
      }];
    }
  }

  public generateFlowAnalysisFromImages(
    imagesBase64: string[], 
    mimeTypes: string[],
    annotationsContext?: string
  ): Observable<FlowAnalysisReportItem[]> {
    let fullPromptText = this.PROMPT_FLOW_ANALYSIS_FROM_IMAGES();
    if (annotationsContext && annotationsContext.trim().length > 0) {
      fullPromptText += "\n\n" + annotationsContext.trim();
    }
    const textParts: GeminiTextPart[] = [{ text: fullPromptText }];
    const imageParts: GeminiInlineDataPart[] = imagesBase64.map((base64, index) => ({
      inlineData: { mimeType: mimeTypes[index], data: base64 }
    }));
    const geminiPayload = {
      contents: [{ parts: (textParts as GeminiPart[]).concat(imageParts) }],
      generationConfig: { maxOutputTokens: 8192, temperature: 0.1, topP: 0.95, topK: 40 },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
      ]
    };
    const requestToProxy: ProxyRequestBody = { action: 'generateFlowAnalysis', payload: geminiPayload };

    return this.http.post<GeminiResponse>(this.proxyApiUrl, requestToProxy).pipe(
      map(response => this.parseFlowAnalysisResponse(
          this.getTextFromParts(response?.candidates?.[0]?.content?.parts).trim() || '',
          'generateFlowAnalysis' // Correcta llamada
      )),
      catchError(this.handleError)
    );
  }

  public refineFlowAnalysisFromImagesAndContext(
    imagesBase64: string[],
    mimeTypes: string[],
    editedReport: FlowAnalysisReportItem,
    userReanalysisContext?: string
  ): Observable<FlowAnalysisReportItem[]> {
    const reportContextForPrompt: any = {
        Nombre_del_Escenario: editedReport.Nombre_del_Escenario,
        Pasos_Analizados: editedReport.Pasos_Analizados.map((paso: FlowAnalysisStep, index: number) => ({
            numero_paso: paso.numero_paso || index + 1,
            descripcion_accion_observada: paso.descripcion_accion_observada,
            imagen_referencia_entrada: paso.imagen_referencia_entrada,
            elemento_clave_y_ubicacion_aproximada: paso.elemento_clave_y_ubicacion_aproximada,
            dato_de_entrada_paso: paso.dato_de_entrada_paso,
            resultado_esperado_paso: paso.resultado_esperado_paso,
            imagen_referencia_salida: paso.imagen_referencia_salida || undefined
        })),
        Resultado_Esperado_General_Flujo: editedReport.Resultado_Esperado_General_Flujo
    };
    if (userReanalysisContext?.trim()) {
        reportContextForPrompt.user_provided_additional_context = userReanalysisContext.trim();
    }
    const editedReportContextJSON = JSON.stringify(reportContextForPrompt, null, 2);
    const promptText = this.PROMPT_REFINE_FLOW_ANALYSIS_FROM_IMAGES_AND_CONTEXT(editedReportContextJSON);
    const imageParts: GeminiInlineDataPart[] = imagesBase64.map((base64, index) => ({
        inlineData: { mimeType: mimeTypes[index], data: base64 }
    }));
    const geminiPayload = {
      contents: [{ parts: ([{ text: promptText }] as GeminiPart[]).concat(imageParts) }],
      generationConfig: { maxOutputTokens: 8192, temperature: 0.2, topP: 0.95, topK: 40 },
      safetySettings: [ /* ... (como antes) ... */ ]
    };
    const requestToProxy: ProxyRequestBody = { action: 'refineFlowAnalysis', payload: geminiPayload };
    return this.http.post<GeminiResponse>(this.proxyApiUrl, requestToProxy).pipe(
      map(response => this.parseFlowAnalysisResponse( 
          this.getTextFromParts(response?.candidates?.[0]?.content?.parts).trim() || '', 
          'refineFlowAnalysis' // Correcta llamada
      )),
      catchError(this.handleError)
    );
  }

  public compareImageFlows(
    flowAImagesBase64: string[], flowAMimeTypes: string[],
    flowBImagesBase64: string[], flowBMimeTypes: string[],
    userContext?: string
  ): Observable<BugReportItem[]> {
      const promptText = this.PROMPT_COMPARE_IMAGE_FLOWS_AND_REPORT_BUGS(userContext);
      const flowAParts: GeminiInlineDataPart[] = flowAImagesBase64.map((data, i) => ({ 
        inlineData: { mimeType: flowAMimeTypes[i], data }
      }));
      const flowBParts: GeminiInlineDataPart[] = flowBImagesBase64.map((data, i) => ({ 
        inlineData: { mimeType: flowBMimeTypes[i], data }
      }));
      const contentParts: GeminiPart[] = [{ text: promptText }];
      if (flowAImagesBase64.length > 0) { contentParts.push({ text: "\n--- IMÁGENES FLUJO A ---" }); contentParts.push(...flowAParts); }
      contentParts.push({ text: "\n--- IMÁGENES FLUJO B ---" }); contentParts.push(...flowBParts);
      const geminiPayload = { 
        contents: [ { parts: contentParts } ], 
        generationConfig: { maxOutputTokens: 8192, temperature: 0.3, topP: 0.95, topK: 40 }, 
        safetySettings: [ /* ... (como antes) ... */ ] 
      };
      const requestToProxy: ProxyRequestBody = { action: 'compareImageFlows', payload: geminiPayload };
      return this.http.post<GeminiResponse>(this.proxyApiUrl, requestToProxy).pipe(
          map(response => {
              const rawText = this.getTextFromParts(response?.candidates?.[0]?.content?.parts).trim() || '';
              if (!rawText) { return [{titulo_bug: "Error de API (Respuesta Vacía)", id_bug:"ERR-API-EMPTY", prioridad: "Alta", severidad: "Mayor", pasos_para_reproducir: [], resultado_actual: "API no devolvió contenido.", resultado_esperado:"Reporte JSON."} as BugReportItem]; }
              let jsonText = rawText;
              if (jsonText.startsWith("```json")){jsonText=jsonText.substring(7);} if(jsonText.endsWith("```")){jsonText=jsonText.substring(0,jsonText.length-3);} jsonText=jsonText.trim();
              if (!jsonText.startsWith("[")) { const errorTitle = rawText.length < 100 ? rawText : rawText.substring(0, 100) + "..."; return [{titulo_bug: `Error de Formato (Respuesta IA: ${errorTitle})`, id_bug:"ERR-FORMAT-IA-TEXT", prioridad: "Alta", severidad: "Mayor", pasos_para_reproducir: [], resultado_actual: `Respuesta completa: ${rawText.substring(0,200)}`, resultado_esperado:"Array JSON."} as BugReportItem]; }
              try {
                  const bugReports: any[] = JSON.parse(jsonText);
                  if (!Array.isArray(bugReports)) { return [{titulo_bug: "Error de Formato (No Array)", id_bug:"ERR-FORMAT-NOARRAY", prioridad: "Alta", severidad: "Mayor", pasos_para_reproducir: [], resultado_actual: `Respuesta cruda: ${rawText.substring(0,100)}`, resultado_esperado:"Array JSON."} as BugReportItem]; }
                  if (bugReports.length === 0) return [];
                  if (bugReports.length === 1 && (bugReports[0].titulo_bug === "Error en Análisis de Imágenes (Contexto/Anotaciones no aplicables o imágenes insuficientes)" || bugReports[0].titulo_bug === "Error en el Análisis de Imágenes para Comparación")) return bugReports as BugReportItem[];
                  return bugReports.map(bug => ({ ...bug, titulo_bug: bug.titulo_bug || "Bug sin título", id_bug: bug.id_bug || `BUG-COMP-${Date.now()}`, prioridad: bug.prioridad || "Media", severidad: bug.severidad || "Moderada", pasos_para_reproducir: Array.isArray(bug.pasos_para_reproducir) ? bug.pasos_para_reproducir.map((p:any, i:number) => ({numero_paso: p.numero_paso || i+1, descripcion: p.descripcion || "Paso no descrito"})) : [{numero_paso:1, descripcion: "Pasos no detallados"}], resultado_esperado: bug.resultado_esperado || "N/A", resultado_actual: bug.resultado_actual || "N/A", imagen_referencia_flujo_a: bug.imagen_referencia_flujo_a || "N/A", imagen_referencia_flujo_b: bug.imagen_referencia_flujo_b || "N/A" })) as BugReportItem[];
              } catch (e: any) { return [{titulo_bug: "Error de Parsing JSON", id_bug:"ERR-PARSE", prioridad: "Alta", severidad: "Mayor", pasos_para_reproducir: [], resultado_actual: `Error: ${e.message}. Respuesta cruda: ${rawText.substring(0,100)}`, resultado_esperado:"Array JSON."} as BugReportItem]; }
          }),
          catchError(this.handleError)
      );
  }

  public generateEnhancedStaticSectionContent(sectionName: string, existingContent: string, huSummary: string): Observable<string> {
    const promptText: string = this.PROMPT_STATIC_SECTION_ENHANCEMENT(sectionName, existingContent, huSummary);
    const geminiPayload: any = { 
      contents: [{ parts: [{ text: promptText }] }], 
      generationConfig: { maxOutputTokens: 500, temperature: 0.5 } 
    };
    const requestToProxy: ProxyRequestBody = { action: 'enhanceStaticSection', payload: geminiPayload };
    return this.http.post<GeminiResponse>(this.proxyApiUrl, requestToProxy).pipe(
        map(response => this.getTextFromParts(response?.candidates?.[0]?.content?.parts).trim()),
        catchError(this.handleError)
    );
  }

  private handleError(error: HttpErrorResponse): Observable<never> {
    let errorMessage = 'Ocurrió un error desconocido en la comunicación con el API (via proxy).';
    console.error('Error de API (via proxy) capturado:', error);
    if (error.error instanceof ErrorEvent) { errorMessage = `Error del cliente o de red: ${error.error.message}`; } 
    else if (error.error?.error && typeof error.error.error === 'string') { errorMessage = `Error del proxy (${error.status}): ${error.error.error}`; if (error.error.details) errorMessage += ` Detalles: ${error.error.details}`; }
    else if (error.error && typeof error.error === 'string' && (error.error.includes('{') || error.error.includes('error'))) {
        try {
            const errorObj = JSON.parse(error.error); const geminiApiError = errorObj as GeminiErrorResponse;
             if (geminiApiError?.error?.message) { errorMessage = `Error de API (via proxy) (${error.status} - ${geminiApiError.error.status || 'N/A'}): ${geminiApiError.error.message}`; if (geminiApiError.error.details?.length) { errorMessage += ` Detalles: ${geminiApiError.error.details.map(d => d.reason || JSON.stringify(d)).join(', ')}`; }
            } else { errorMessage = `Error HTTP (via proxy) (${error.status}): ${error.statusText} - Respuesta: ${JSON.stringify(errorObj).substring(0,200)}`;}
        } catch (e) { errorMessage = `Error HTTP (via proxy) (${error.status}): ${error.statusText} - Respuesta: ${error.error.substring(0,200)}`;}
    } else if (error.error && typeof error.error === 'string') { errorMessage = `Error del proxy (${error.status}): ${error.error}`; }
    else {
        const geminiApiError = error.error as GeminiErrorResponse;
        if (geminiApiError?.error?.message) { errorMessage = `Error de API (via proxy) (${error.status} - ${geminiApiError.error.status || 'N/A'}): ${geminiApiError.error.message}`; if (geminiApiError.error.details?.length) { errorMessage += ` Detalles: ${geminiApiError.error.details.map(d => d.reason || JSON.stringify(d)).join(', ')}`; }}
        else if (typeof error.message === 'string') { errorMessage = `Error HTTP (via proxy) (${error.status}): ${error.message}`; }
        else { errorMessage = `Error HTTP (via proxy) (${error.status}): ${error.statusText}. La respuesta del servidor no pudo ser interpretada.`; }
    }
    return throwError(() => new Error(errorMessage));
  }
}