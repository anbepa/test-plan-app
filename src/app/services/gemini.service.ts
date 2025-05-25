// src/app/services/gemini.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { FlowAnalysisReportItem, BugReportItem } from '../models/hu-data.model';

interface GeminiTextPart { text: string; }
interface GeminiInlineDataPart { inlineData: { mimeType: string; data: string; }; }
interface GeminiContent { parts: (GeminiTextPart | GeminiInlineDataPart)[]; }
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
  action: 'generateScope' | 'generateTextCases' | 'generateImageCases' | 'enhanceStaticSection' | 'generateFlowAnalysis' | 'compareImageFlows';
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

export interface DetailedTestCase {
  title: string;
  preconditions: string;
  steps: string;
  expectedResults: string;
}


@Injectable({
  providedIn: 'root'
})
export class GeminiService {

  private proxyApiUrl = environment.geminiApiUrl;

  private readonly PROMPT_SCOPE = (description: string, acceptanceCriteria: string) => `
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

  private readonly PROMPT_SCENARIOS_DETAILED_TEXT_BASED = (description: string, acceptanceCriteria: string, technique: string) => `
Eres un Ingeniero de QA experto en el diseño de pruebas de caja negra.
Tu tarea es generar casos de prueba detallados, claros, concisos y accionables.
**ENTRADA PROPORCIONADA:**
1.  **Historia de Usuario (HU):** ${description}
2.  **Criterios de Aceptación (CA):** ${acceptanceCriteria}
3.  **Técnica de Diseño de Pruebas de Caja Negra a Aplicar:** "${technique}"

**INSTRUCCIONES FUNDAMENTALES PARA EL DISEÑO DE CASOS DE PRUEBA DETALLADOS:**
1.  **COMPRENSIÓN PROFUNDA:** Analiza minuciosamente la HU y CADA UNO de los CA. Los casos de prueba deben cubrir los aspectos funcionales descritos.
2.  **APLICACIÓN ESTRICTA DE LA TÉCNICA "${technique}":**
    *   Basa tu razonamiento y la generación de casos de prueba DIRECTAMENTE en los principios de la técnica "${technique}".
    *   Los casos de prueba DEBEN ser una consecuencia lógica de aplicar "${technique}" a la HU y CA. NO inventes funcionalidad.
3.  **DERIVACIÓN DIRECTA:** CADA caso de prueba generado debe poder rastrearse y justificarse EXCLUSIVAMENTE a partir de la HU, los CA y la aplicación de la técnica "${technique}".
4.  **CONCISIÓN Y ACCIÓN:** (Title, Preconditions, Steps, ExpectedResults deben ser claros y accionables).
5.  **COBERTURA ADECUADA:** Genera un conjunto de casos de prueba que cubran razonablemente los CA a través de la lente de la técnica "${technique}".
6.  **CASO DE NO APLICABILIDAD / INFORMACIÓN INSUFICIENTE:** Si no puedes generar casos válidos, responde EXACTAMENTE y ÚNICAMENTE con el siguiente array JSON:
    \`\`\`json
    [{"title": "Información Insuficiente", "preconditions": "N/A", "steps": "No se pudieron generar casos detallados basados en la información proporcionada y la técnica solicitada.", "expectedResults": "N/A"}]
    \`\`\`

**FORMATO DE SALIDA ESTRICTO JSON (SIN EXCEPCIONES):**
*   La respuesta DEBE ser un array JSON válido. Tu respuesta debe comenzar con '[' y terminar con ']'.
*   Cada elemento del array debe ser un objeto JSON representando un caso de prueba con las siguientes propiedades EXACTAS: "title", "preconditions", "steps", "expectedResults".
*   Ejemplo de un elemento: { "title": "Verificar inicio de sesión exitoso", "preconditions": "Usuario registrado existe y tiene credenciales válidas.", "steps": "1. Navegar a la página de login.\\n2. Ingresar usuario.\\n3. Ingresar contraseña.\\n4. Hacer clic en 'Ingresar'.", "expectedResults": "El usuario es redirigido al dashboard." }
*   Los valores de "preconditions", "steps", y "expectedResults" pueden ser strings con múltiples líneas separadas por '\\n'.
*   El valor de "title" DEBE COMENZAR con un verbo en infinitivo o imperativo.
*   **ABSOLUTAMENTE PROHIBIDO INCLUIR:** Cualquier texto fuera del array JSON. No incluyas explicaciones, introducciones, saludos, despedidas, ni ningún texto conversacional. Tu ÚNICA respuesta debe ser el array JSON.
---
PROCEDE A GENERAR EL ARRAY JSON DE CASOS DE PRUEBA DETALLADOS BASADA EN LA HU, LOS CA Y LA TÉCNICA "${technique}":
`;

private readonly PROMPT_SCENARIOS_DETAILED_IMAGE_BASED = (technique: string) => `
Eres un Ingeniero de QA experto en diseño de pruebas de caja negra y en la interpretación de interfaces de usuario a partir de imágenes.
Tu tarea es analizar LAS IMÁGENES proporcionadas, que representan un flujo de interfaz de usuario, y generar casos de prueba detallados, claros, concisos y accionables basados en la técnica de prueba especificada.
Las imágenes se proporcionan en el orden en que deben ser consideradas para el flujo.

**ENTRADA PROPORCIONADA:**
1.  **Imágenes del Flujo de Interfaz de Usuario:** (Las imágenes adjuntas en base64 en la solicitud, en orden secuencial estricto. La primera imagen es "Imagen 1", la segunda "Imagen 2", y así sucesivamente).
2.  **Técnica de Diseño de Pruebas de Caja Negra a Aplicar:** "${technique}"

**INSTRUCCIONES FUNDAMENTALES PARA EL DISEÑO DE CASOS DE PRUEBA:**
1.  **INTERPRETACIÓN VISUAL DETALLADA Y SECUENCIAL:**
    * Analiza LAS IMÁGENES minuciosamente EN EL ORDEN EXACTO en que se proporcionan. La "Imagen 1" es el inicio del flujo, la "Imagen 2" es el siguiente estado, etc.
    * Identifica elementos (botones, campos, etc.), el flujo de navegación general que representan en conjunto, acciones y resultados visuales.
    * Infiere criterios de aceptación o reglas de negocio a partir de la secuencia de imágenes si aplica.
    * Considera el texto en CADA imagen como crucial.
2.  **APLICACIÓN ESTRICTA DE LA TÉCNICA "${technique}":**
    * Basa la generación de casos en tu interpretación de las imágenes y los principios de "${technique}".
    * Aplica la técnica a elementos y flujos visuales (Partición Equivalencia, Valores Límite, etc.) considerando el conjunto de imágenes en su orden.
    * Los casos DEBEN ser consecuencia lógica de aplicar "${technique}" a la funcionalidad inferida del conjunto de imágenes. NO inventes funcionalidad no soportada por las imágenes.
3.  **DERIVACIÓN DIRECTA DE LAS IMÁGENES:** CADA caso debe justificarse por el contenido de las imágenes y la aplicación de "${technique}".
4.  **CONCISIÓN Y ACCIÓN (ENFOCADO EN LAS IMÁGENES):**
    * **Title:** Breve, descriptivo, reflejando el objetivo del caso a través del flujo de imágenes.
    * **Preconditions:** Estado ANTES de pasos, inferido del conjunto de imágenes o la imagen inicial del flujo.
    * **Steps:** Acciones CLARAS sobre elementos VISIBLES en las imágenes. Sé específico y referencia las imágenes EXCLUSIVAMENTE por su orden secuencial en la entrada (ej. "En Imagen 1...", "Después de la acción en Imagen 2, se observa en Imagen 3...").
    * **ExpectedResults:** Resultado observable DESPUÉS de pasos, posiblemente en la última imagen del flujo o como un estado final esperado.
5.  **COBERTURA ADECUADA:** Cubre funcionalidad principal e interacciones clave inferidas del conjunto de imágenes, a través de "${technique}". Prioriza escenarios que demuestren la correcta transición y funcionalidad a lo largo del flujo visual.
6.  **CASO DE IMÁGENES NO CLARAS / NO APLICABILIDAD:** Si no puedes generar casos válidos, responde EXACTAMENTE y ÚNICAMENTE con el siguiente array JSON:
    \`\`\`json
    [{"title": "Imágenes no interpretables o técnica no aplicable", "preconditions": "N/A", "steps": "No se pudieron generar casos detallados a partir del conjunto de imágenes proporcionadas y la técnica solicitada.", "expectedResults": "N/A"}]
    \`\`\`

**FORMATO DE SALIDA ESTRICTO JSON EN ESPAÑOL (SIN EXCEPCIONES):**
* La respuesta DEBE ser un array JSON válido. Tu respuesta debe comenzar con '[' y terminar con ']'.
* Cada elemento: objeto JSON con propiedades EXACTAS: **"title"**, **"preconditions"**, **"steps"**, **"expectedResults"**.
* Ejemplo de un elemento: {"title": "Verificar navegación a través de múltiples pantallas...", "preconditions": "Usuario en la pantalla inicial del flujo (Imagen 1)...", "steps": "1. Observar Imagen 1 y hacer X.\\n2. Observar Imagen 2 y hacer Y.", "expectedResults": "Sistema navega correctamente a través del flujo y muestra Z."}
* Valores pueden ser strings multilínea (separados por '\\n'). "title" DEBE comenzar con verbo.
* **ABSOLUTAMENTE PROHIBIDO TEXTO FUERA del array JSON.** No incluyas explicaciones, introducciones, saludos, despedidas, ni ningún texto conversacional. Tu ÚNICA respuesta debe ser el array JSON.
---
PROCEDE A GENERAR EL ARRAY JSON DE CASOS DE PRUEBA DETALLADOS BASADA EN LAS IMÁGENES Y LA TÉCNICA "${technique}":
`;

private readonly PROMPT_STATIC_SECTION_ENHANCEMENT = (sectionName: string, existingContent: string, huSummary: string) => `
Eres un analista de QA experimentado. Revisa la sección "${sectionName}" actual de un plan de pruebas y el resumen de las Historias de Usuario (HUs) involucradas.
Tu tarea es generar texto ADICIONAL, CONCISO y relevante para ENRIQUECER la sección "${sectionName}".
NO repitas la información ya existente en la sección actual.
La respuesta debe ser ÚNICAMENTE el texto adicional sugerido, listo para ser añadido. Evita introducciones como "Aquí tienes algunas sugerencias:" o similares. Solo el texto a añadir.

Sección Actual de "${sectionName}":
${existingContent}

Resumen de Historias de Usuario (HUs) Involucradas:
${huSummary}

---
Texto ADICIONAL sugerido para la sección "${sectionName}" (debe ser UN ÚNICO PÁRRAFO CONCISO, MÁXIMO 4 LÍNEAS, sin enumeraciones, viñetas, encabezados ni saludos. Solo el texto a añadir.):`;
private readonly PROMPT_FLOW_ANALYSIS_FROM_IMAGES = () => `
Eres un Ingeniero de QA Analista experto en la interpretación de ejecuciones de pruebas de software y en el análisis forense de interfaces de usuario a partir de secuencias de imágenes.
Tu tarea es analizar la SECUENCIA DE IMÁGENES adjunta, que representa la ejecución de un flujo de interfaz de usuario. Debes generar un informe detallado de dicha ejecución.

**ENTRADA PROPORCIONADA:**
1.  **Imágenes del Flujo de Ejecución (Screenshots):** Una secuencia de imágenes en base64. Estas imágenes están en el ORDEN CRONOLÓGICO ESTRICTO de la ejecución. Considera la primera imagen en la secuencia que recibes como "Imagen 1", la segunda como "Imagen 2", y así sucesivamente hasta la "Imagen N".

**INSTRUCCIONES FUNDAMENTALES PARA EL ANÁLISIS Y REFERENCIACIÓN:**

1.  **ANÁLISIS SECUENCIAL ESTRICTO:**
    *   Analiza CADA IMAGEN y la SECUENCIA COMPLETA minuciosamente, SIGUIENDO ESTRICTAMENTE el orden numérico en que se te proporcionan (Imagen 1, luego Imagen 2, ..., hasta Imagen N). Tu análisis de un paso DEBE basarse en la imagen o imágenes que corresponden a ese punto en la secuencia.
    *   Identifica elementos de la UI, su estado, datos visibles y cambios entre imágenes CONSECUTIVAS.

2.  **DEDUCCIÓN DEL ESCENARIO EJECUTADO (Nombre del Escenario):**
    *   Basándote en el flujo COMPLETO (analizado en orden), infiere el propósito general.

3.  **EXTRACCIÓN DEL PASO A PASO DETALLADO (Pasos Analizados):**
    *   Describe cronológicamente las acciones y observaciones.
    *   Para cada paso identificado:
        *   **REFERENCIA DE IMAGEN OBLIGATORIA Y PRECISA:** En el campo "imagen_referencia_entrada" del JSON, DEBES indicar la imagen (o rango de imágenes consecutivas) de la secuencia de entrada que es MÁS RELEVANTE para este paso. Usa el formato "Imagen X" (ej: "Imagen 1", "Imagen 3") o "Imagen X a Imagen Y" (ej: "Imagen 2 a Imagen 3") donde X e Y son los números de las imágenes según su orden de entrada.
        *   **NO INFIERAS UN ORDEN DIFERENTE AL DE ENTRADA PARA LAS REFERENCIAS.** Si el paso 1 del flujo ocurre en la primera imagen de entrada, la referencia debe ser "Imagen 1". Si el paso 2 ocurre en la segunda imagen de entrada, la referencia debe ser "Imagen 2".
        *   Describe la acción/estado.
        *   Identifica el elemento clave y su ubicación DENTRO de la imagen referenciada (ej: "botón 'Login' en Imagen 1").
        *   **DATO DE ENTRADA (Si aplica):** Si el paso implica la entrada de datos por parte del usuario (ej: escribir en un campo de texto, seleccionar una opción), describe el dato que se infiere fue ingresado. Si no hay entrada de datos directa por el usuario en este paso (ej: solo observación o clic en botón sin datos), indica "N/A".

4.  **INFERENCIA DEL RESULTADO ESPERADO.**
5.  **DETERMINACIÓN DEL RESULTADO OBTENIDO (Concluyendo 'Exitosa', 'Fallida (describir fallo)', o 'Exitosa con desviaciones').**
6.  **CASO DE IMÁGENES NO INTERPRETABLES / FLUJO INCOMPRENSIBLE:** Si la secuencia de imágenes es demasiado ambigua o no permite una deducción razonable, responde EXACTAMENTE y ÚNICAMENTE con el siguiente JSON:
    \`\`\`json
    [
      {
        "Nombre_del_Escenario": "Secuencia de imágenes no interpretable",
        "Pasos_Analizados": [
          {
            "numero_paso": 1,
            "descripcion_accion_observada": "Las imágenes proporcionadas no permiten una deducción clara de los pasos ejecutados.",
            "imagen_referencia_entrada": "N/A",
            "elemento_clave_y_ubicacion_aproximada": "N/A",
            "dato_de_entrada_paso": "N/A",
            "resultado_esperado_paso": "N/A",
            "resultado_obtenido_paso_y_estado": "Análisis no concluyente."
          }
        ],
        "Resultado_Esperado_General_Flujo": "N/A debido a la falta de interpretabilidad.",
        "Conclusion_General_Flujo": "Análisis no concluyente debido a la calidad o ambigüedad de las imágenes."
      }
    ]
    \`\`\`

**FORMATO DE SALIDA ESTRICTO JSON EN ESPAÑOL (SIN EXCEPCIONES):**
*   La respuesta DEBE ser un array JSON válido. Tu respuesta debe comenzar con '[' y terminar con ']'.
*   El objeto JSON principal debe tener las siguientes propiedades: "Nombre_del_Escenario", "Pasos_Analizados", "Resultado_Esperado_General_Flujo", "Conclusion_General_Flujo".
*   Cada objeto en "Pasos_Analizados" debe tener: "numero_paso", "descripcion_accion_observada", "imagen_referencia_entrada" (CRÍTICO: "Imagen X" o "Imagen X a Imagen Y" según orden de entrada), "elemento_clave_y_ubicacion_aproximada", "dato_de_entrada_paso" (string, puede ser "N/A"), "resultado_esperado_paso", "resultado_obtenido_paso_y_estado".
*   **ABSOLUTAMENTE PROHIBIDO TEXTO FUERA del array JSON.** No incluyas explicaciones, introducciones, saludos, despedidas, ni ningún texto conversacional. Tu ÚNICA respuesta debe ser el array JSON.
---
PROCEDE A GENERAR EL INFORME JSON. Recuerda, la referencia "Imagen X" en tu salida JSON debe corresponder estrictamente a la X-ésima imagen en la secuencia de entrada que has recibido. Incluye el campo "dato_de_entrada_paso" en cada paso.
`;

private readonly PROMPT_COMPARE_IMAGE_FLOWS_AND_REPORT_BUGS = () => `
Eres un Ingeniero de QA experto en la detección de diferencias visuales y funcionales entre dos flujos de interfaz de usuario representados por secuencias de imágenes.
Se te proporcionarán dos conjuntos de imágenes: "Imágenes Flujo A" (representa el diseño esperado o la versión de referencia) y "Imágenes Flujo B" (representa la implementación actual o la versión a comparar). Ambas secuencias de imágenes están ordenadas cronológicamente por el usuario antes de ser enviadas.

**ENTRADA PROPORCIONADA:**
1.  **Imágenes del Flujo A:** (Se adjuntarán primero, N imágenes. La primera es "Imagen A.1", la segunda "Imagen A.2", etc.)
2.  **Imágenes del Flujo B:** (Se adjuntarán después de las de Flujo A, M imágenes. La primera es "Imagen B.1", la segunda "Imagen B.2", etc.)

**TU TAREA:**
Compara el Flujo A con el Flujo B, imagen por imagen o paso a paso según corresponda, asumiendo que el usuario ha intentado alinear los flujos para que "Imagen A.X" se corresponda conceptualmente con "Imagen B.X" en la medida de lo posible.
Identifica cualquier diferencia visual significativa (colores, fuentes, alineación, elementos faltantes/adicionales, texto incorrecto) o inferencias de diferencias funcionales.
Para CADA diferencia significativa que constituya un posible bug o desviación, genera un objeto JSON con el formato especificado abajo. Si no encuentras diferencias significativas, devuelve un array JSON vacío: [].

**FORMATO DE SALIDA ESTRICTO (ARRAY DE REPORTES DE BUG EN JSON):**
Tu ÚNICA salida debe ser un array JSON. Cada elemento del array debe ser un objeto con las siguientes propiedades EXACTAS:
{
  "titulo_bug": "string", 
  "id_bug": "string", 
  "prioridad": "string", 
  "severidad": "string", 
  "descripcion_diferencia_general": "string", 
  "pasos_para_reproducir": [ 
    { "numero_paso": "integer", "descripcion": "string" } 
  ],
  "resultado_esperado": "string", 
  "resultado_actual": "string", 
  "imagen_referencia_flujo_a": "string", 
  "imagen_referencia_flujo_b": "string"
}
**ABSOLUTAMENTE NINGÚN TEXTO FUERA del array JSON.** Comienza con '[' y termina con ']'. Si no hay bugs, devuelve [].

EJEMPLO DE UN REPORTE DE BUG (si se encuentra uno):
[
  {
    "titulo_bug": "El color del botón principal es incorrecto en la pantalla de inicio",
    "id_bug": "HOME-BTN-CLR-01",
    "prioridad": "Media",
    "severidad": "Menor",
    "descripcion_diferencia_general": "El botón 'Comenzar' en la pantalla de inicio (Flujo B) es de color azul, pero en el diseño (Flujo A) se esperaba que fuera verde.",
    "pasos_para_reproducir": [
      { "numero_paso": 1, "descripcion": "Observar la pantalla de inicio correspondiente a Imagen A.1 y Imagen B.1." }
    ],
    "resultado_esperado": "El botón 'Comenzar' debe ser de color verde (#34A853) como se muestra en la Imagen A.1.",
    "resultado_actual": "El botón 'Comenzar' es de color azul (#4285F4) como se observa en la Imagen B.1.",
    "imagen_referencia_flujo_a": "Imagen A.1",
    "imagen_referencia_flujo_b": "Imagen B.1"
  }
]
---
PROCEDE A COMPARAR LOS FLUJOS Y GENERAR EL ARRAY JSON DE REPORTES DE BUGS:
`;

  constructor(private http: HttpClient) { }

  private getTextFromParts(parts: (GeminiTextPart | GeminiInlineDataPart)[] | undefined): string {
    if (parts && parts.length > 0) {
      const firstPart = parts[0];
      if (firstPart && 'text' in firstPart) {
        return (firstPart as GeminiTextPart).text;
      }
    }
    return '';
  }

  generateTestPlanSections(description: string, acceptanceCriteria: string): Observable<string> {
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

  generateDetailedTestCasesTextBased(description: string, acceptanceCriteria: string, technique: string): Observable<DetailedTestCase[]> {
    const promptText = this.PROMPT_SCENARIOS_DETAILED_TEXT_BASED(description, acceptanceCriteria, technique);
    const geminiPayload = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: { maxOutputTokens: 2048, temperature: 0.2 } 
    };
    const requestToProxy: ProxyRequestBody = { action: 'generateTextCases', payload: geminiPayload };
    return this.sendGenerationRequestThroughProxy(requestToProxy);
  }

  generateDetailedTestCasesImageBased(imagesBase64: string[], mimeTypes: string[], technique: string): Observable<DetailedTestCase[]> {
    const promptText = this.PROMPT_SCENARIOS_DETAILED_IMAGE_BASED(technique);
    const imageParts: GeminiInlineDataPart[] = imagesBase64.map((base64, index) => ({
      inlineData: { mimeType: mimeTypes[index], data: base64 }
    }));
    const geminiPayload = {
      contents: [{ parts: [{ text: promptText }, ...imageParts] }],
      generationConfig: { maxOutputTokens: 2048, temperature: 0.2, topP: 0.95, topK: 40 }, 
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

  private sendGenerationRequestThroughProxy(requestToProxy: ProxyRequestBody): Observable<DetailedTestCase[]> {
    return this.http.post<GeminiResponse>(this.proxyApiUrl, requestToProxy).pipe(
      map(response => {
        const rawText = this.getTextFromParts(response?.candidates?.[0]?.content?.parts).trim() || '';
        if (!rawText) {
          console.warn(`[GeminiService] API (via proxy) para ${requestToProxy.action} no retornó contenido.`);
          return [{ title: "Error de API", preconditions: "Respuesta vacía de la API (via proxy).", steps: `Acción: ${requestToProxy.action}`, expectedResults: "N/A" }];
        }
        
        let jsonText = rawText;
        if (jsonText.startsWith("```json")) { jsonText = jsonText.substring(7); }
        if (jsonText.endsWith("```")) { jsonText = jsonText.substring(0, jsonText.length - 3); }
        jsonText = jsonText.trim();

        if (!jsonText.startsWith("[")) {
            console.warn(`[GeminiService] Respuesta no JSON (o no array) de ${requestToProxy.action}: `, rawText);
            return [{ title: "Error de Formato (No JSON Array)", preconditions: "La respuesta de la API (via proxy) no fue un array JSON válido.", steps: rawText.substring(0,500), expectedResults: "N/A" }];
        }

        try {
          const testCases: DetailedTestCase[] = JSON.parse(jsonText);
          if (!Array.isArray(testCases)) { 
            console.warn(`[GeminiService] Respuesta JSON para ${requestToProxy.action} no es un array después de parsear.`, rawText);
             return [{ title: "Error de Formato (No Array)", preconditions: "La respuesta JSON de la API (via proxy) no tuvo el formato de array esperado.", steps: rawText.substring(0,500), expectedResults: "N/A" }];
          }
          if (testCases.length === 0) { 
             console.info(`[GeminiService] Respuesta JSON para ${requestToProxy.action} es un array vacío (puede ser normal).`, rawText);
             return [];
          }
          if (testCases.length === 1 && (testCases[0].title === "Información Insuficiente" || testCases[0].title === "Imágenes no interpretables o técnica no aplicable")) {
              return testCases; 
          }

          return testCases.map(tc => ({
            title: tc.title || "Título no proporcionado",
            preconditions: tc.preconditions || "N/A",
            steps: tc.steps || "Pasos no proporcionados",
            expectedResults: tc.expectedResults || "Resultados no proporcionados"
          }));
        } catch (e) {
          console.error(`[GeminiService] Error parseando JSON para ${requestToProxy.action}:`, e, "\nRespuesta Cruda:", rawText);
          return [{ title: "Error de Parsing JSON", preconditions: "No se pudo interpretar la respuesta JSON de la API (via proxy).", steps: rawText.substring(0,500), expectedResults: "Verificar consola." }];
        }
      }),
      catchError(this.handleError)
    );
  }

  generateFlowAnalysisFromImages(imagesBase64: string[], mimeTypes: string[]): Observable<FlowAnalysisReportItem[]> {
    const promptText = this.PROMPT_FLOW_ANALYSIS_FROM_IMAGES();
    const imageParts: GeminiInlineDataPart[] = imagesBase64.map((base64, index) => ({
      inlineData: { mimeType: mimeTypes[index], data: base64 }
    }));
    const geminiPayload = {
      contents: [{ parts: [{ text: promptText }, ...imageParts ]}],
      generationConfig: { maxOutputTokens: 4096, temperature: 0.1, topP: 0.95, topK: 40 }, 
      safetySettings: [ 
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
      ]
    };
    const requestToProxy: ProxyRequestBody = { action: 'generateFlowAnalysis', payload: geminiPayload };
    
    return this.http.post<GeminiResponse>(this.proxyApiUrl, requestToProxy).pipe(
      map(response => {
        const rawText = this.getTextFromParts(response?.candidates?.[0]?.content?.parts).trim() || '';
        if (!rawText) {
          console.warn("[GeminiService] API (via proxy) para generateFlowAnalysis no retornó contenido.");
          return [{ 
            Nombre_del_Escenario: "Error de API",
            Pasos_Analizados: [{ numero_paso: 1, descripcion_accion_observada: "Respuesta vacía de la API (via proxy).", imagen_referencia_entrada: "N/A", elemento_clave_y_ubicacion_aproximada: "N/A", dato_de_entrada_paso: "N/A", resultado_esperado_paso: "N/A", resultado_obtenido_paso_y_estado: "Análisis no concluyente."}],
            Resultado_Esperado_General_Flujo: "N/A",
            Conclusion_General_Flujo: "Error de comunicación con la API."
          }] as FlowAnalysisReportItem[];
        }

        let jsonText = rawText;
        if (jsonText.startsWith("```json")) { jsonText = jsonText.substring(7); }
        if (jsonText.endsWith("```")) { jsonText = jsonText.substring(0, jsonText.length - 3); }
        jsonText = jsonText.trim();

        if (!jsonText.startsWith("[")) {
            console.warn(`[GeminiService] Respuesta no JSON (o no array) de generateFlowAnalysis: `, rawText);
            return [{ 
                Nombre_del_Escenario: "Error de Formato (No JSON Array)",
                Pasos_Analizados: [{ numero_paso: 1, descripcion_accion_observada: "La respuesta de la API (via proxy) no fue un array JSON válido para análisis de flujo.", imagen_referencia_entrada: "N/A", elemento_clave_y_ubicacion_aproximada: rawText.substring(0,200), dato_de_entrada_paso: "N/A", resultado_esperado_paso: "N/A", resultado_obtenido_paso_y_estado: "Análisis no concluyente."}],
                Resultado_Esperado_General_Flujo: "N/A",
                Conclusion_General_Flujo: "Error de formato en la API."
            }] as FlowAnalysisReportItem[];
        }
        
        try {
          const flowAnalysisReport: FlowAnalysisReportItem[] = JSON.parse(jsonText);
          if (!Array.isArray(flowAnalysisReport)) {
             console.warn("[GeminiService] Respuesta JSON para generateFlowAnalysis no es un array después de parsear.", rawText);
             return [{ 
                Nombre_del_Escenario: "Error de Formato (No Array)",
                Pasos_Analizados: [{ numero_paso: 1, descripcion_accion_observada: "La respuesta JSON de la API (via proxy) no tuvo el formato de array esperado para análisis de flujo.", imagen_referencia_entrada: "N/A", elemento_clave_y_ubicacion_aproximada: rawText.substring(0,200), dato_de_entrada_paso: "N/A", resultado_esperado_paso: "N/A", resultado_obtenido_paso_y_estado: "Análisis no concluyente."}],
                Resultado_Esperado_General_Flujo: "N/A",
                Conclusion_General_Flujo: "Error de formato en la API."
            }] as FlowAnalysisReportItem[];
          }
           if (flowAnalysisReport.length === 0) {
               console.info("[GeminiService] Respuesta JSON para generateFlowAnalysis es un array vacío (puede ser normal si no hay pasos o errores).", rawText);
               return []; 
           }
           if (flowAnalysisReport.length === 1 && flowAnalysisReport[0].Nombre_del_Escenario === "Secuencia de imágenes no interpretable") {
               return flowAnalysisReport;
           }
           if (!flowAnalysisReport[0].Nombre_del_Escenario) { 
                console.warn("[GeminiService] Respuesta JSON para generateFlowAnalysis malformado (falta Nombre_del_Escenario).", rawText);
                 return [{ 
                    Nombre_del_Escenario: "Error de Formato (Faltan Campos)",
                    Pasos_Analizados: [{ numero_paso: 1, descripcion_accion_observada: "La respuesta JSON de la API (via proxy) está malformada.", imagen_referencia_entrada: "N/A", elemento_clave_y_ubicacion_aproximada: rawText.substring(0, 200), dato_de_entrada_paso: "N/A", resultado_esperado_paso: "N/A", resultado_obtenido_paso_y_estado: "Análisis no concluyente."}],
                    Resultado_Esperado_General_Flujo: "N/A",
                    Conclusion_General_Flujo: "Error de formato en la respuesta de la API."
                }] as FlowAnalysisReportItem[];
           }

          if (!Array.isArray(flowAnalysisReport[0].Pasos_Analizados)) {
            flowAnalysisReport[0].Pasos_Analizados = [];
          }
          flowAnalysisReport[0].Pasos_Analizados = flowAnalysisReport[0].Pasos_Analizados.map(paso => ({
            ...paso,
            dato_de_entrada_paso: paso.dato_de_entrada_paso || "N/A" 
          }));
          return flowAnalysisReport;
        } catch (e) {
          console.error("[GeminiService] Error parseando JSON para generateFlowAnalysis:", e, "\nRespuesta Cruda:", rawText);
          return [{ 
            Nombre_del_Escenario: "Error de Parsing JSON",
            Pasos_Analizados: [{ numero_paso: 1, descripcion_accion_observada: "No se pudo interpretar la respuesta JSON de la API (via proxy) para análisis de flujo.", imagen_referencia_entrada: "N/A", elemento_clave_y_ubicacion_aproximada: rawText.substring(0,500) , dato_de_entrada_paso: "N/A", resultado_esperado_paso: "N/A", resultado_obtenido_paso_y_estado: "Análisis no concluyente."}],
            Resultado_Esperado_General_Flujo: "N/A",
            Conclusion_General_Flujo: "Error al procesar la respuesta de la API."
          }] as FlowAnalysisReportItem[];
        }
      }),
      catchError(this.handleError) 
    );
  }

  public compareImageFlows(
    flowAImagesBase64: string[], flowAMimeTypes: string[],
    flowBImagesBase64: string[], flowBMimeTypes: string[]
  ): Observable<BugReportItem[]> {
      const promptText = this.PROMPT_COMPARE_IMAGE_FLOWS_AND_REPORT_BUGS();

      const flowAParts: GeminiInlineDataPart[] = flowAImagesBase64.map((base64, index) => ({
          inlineData: { mimeType: flowAMimeTypes[index], data: base64 }
      }));
      const flowBParts: GeminiInlineDataPart[] = flowBImagesBase64.map((base64, index) => ({
          inlineData: { mimeType: flowBMimeTypes[index], data: base64 }
      }));

      const geminiPayload = {
          contents: [
              {
                  parts: [
                      { text: promptText },
                      { text: "\n--- IMÁGENES FLUJO A ---" }, 
                      ...flowAParts,
                      { text: "\n--- IMÁGENES FLUJO B ---" },
                      ...flowBParts
                  ]
              }
          ],
          generationConfig: { maxOutputTokens: 8192, temperature: 0.3, topP: 0.95, topK: 40 },
          safetySettings: [
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
              { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
              { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
              { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
          ]
      };

      const requestToProxy: ProxyRequestBody = {
          action: 'compareImageFlows', 
          payload: geminiPayload
      };

      return this.http.post<GeminiResponse>(this.proxyApiUrl, requestToProxy).pipe(
          map(response => {
              const rawText = this.getTextFromParts(response?.candidates?.[0]?.content?.parts).trim() || '';
              if (!rawText) {
                  console.warn("[GeminiService] API para compareImageFlows no retornó contenido.");
                  return [{titulo_bug: "Error de API (Respuesta Vacía)", id_bug:"ERR-API-EMPTY", prioridad: "Alta", severidad: "Mayor", pasos_para_reproducir: [], resultado_actual: "La API no devolvió contenido.", resultado_esperado:"Un reporte de bugs en JSON."} as BugReportItem];
              }
              
              let jsonText = rawText;
              if (jsonText.startsWith("```json")) { jsonText = jsonText.substring(7); }
              if (jsonText.endsWith("```")) { jsonText = jsonText.substring(0, jsonText.length - 3); }
              jsonText = jsonText.trim();

              if (!jsonText.startsWith("[")) {
                 console.warn(`[GeminiService] Respuesta no JSON array de compareImageFlows: `, rawText);
                 return [{titulo_bug: "Error de Formato (No JSON Array)", id_bug:"ERR-FORMAT-IA", prioridad: "Alta", severidad: "Mayor", pasos_para_reproducir: [], resultado_actual: rawText.substring(0,100), resultado_esperado:"Un array JSON de reportes de bug."} as BugReportItem];
              }

              try {
                  const bugReports: BugReportItem[] = JSON.parse(jsonText);
                  if (!Array.isArray(bugReports)) {
                       console.warn("[GeminiService] Respuesta JSON para compareImageFlows no es un array.", rawText);
                       return [{titulo_bug: "Error de Formato (No Array)", id_bug:"ERR-FORMAT-NOARRAY", prioridad: "Alta", severidad: "Mayor", pasos_para_reproducir: [], resultado_actual: rawText.substring(0,100), resultado_esperado:"Un array JSON de reportes de bug."} as BugReportItem];
                  }
                  return bugReports.map(bug => ({ 
                    ...bug,
                    pasos_para_reproducir: Array.isArray(bug.pasos_para_reproducir) ? bug.pasos_para_reproducir : []
                  }));
              } catch (e) {
                  console.error("[GeminiService] Error parseando JSON para compareImageFlows:", e, "\nRespuesta Cruda:", rawText);
                  return [{titulo_bug: "Error de Parsing JSON", id_bug:"ERR-PARSE", prioridad: "Alta", severidad: "Mayor", pasos_para_reproducir: [], resultado_actual: rawText.substring(0,100), resultado_esperado:"Un array JSON de reportes de bug."} as BugReportItem];
              }
          }),
          catchError(this.handleError) 
      );
  }


  generateEnhancedStaticSectionContent(sectionName: string, existingContent: string, huSummary: string): Observable<string> {
    const promptText = this.PROMPT_STATIC_SECTION_ENHANCEMENT(sectionName, existingContent, huSummary);
    const geminiPayload = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: { maxOutputTokens: 300, temperature: 0.5 }
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
    if (error.error instanceof ErrorEvent) {
      errorMessage = `Error del cliente o de red: ${error.error.message}`;
    } else if (error.error && error.error.error && typeof error.error.error === 'string') { 
        errorMessage = `Error del proxy (${error.status}): ${error.error.error}`;
        if (error.error.details) {
            errorMessage += ` Detalles: ${error.error.details}`;
        }
    } else if (error.error && typeof error.error === 'string') {
        errorMessage = `Error del proxy (${error.status}): ${error.error}`;
    }
    else {
      const geminiApiError = error.error as GeminiErrorResponse; 
      if (geminiApiError?.error?.message) {
        errorMessage = `Error de API (via proxy) (${error.status} - ${geminiApiError.error.status || 'N/A'}): ${geminiApiError.error.message}`;
        if (geminiApiError.error.details?.length) {
          errorMessage += ` Detalles: ${geminiApiError.error.details.map(d => d.reason || JSON.stringify(d)).join(', ')}`;
        }
      } else if (typeof error.error === 'string' && error.error.length > 0 && error.error.length < 500) {
        errorMessage = `Error HTTP (via proxy) (${error.status}): ${error.statusText} - Respuesta: ${error.error}`;
      } else {
        errorMessage = `Error HTTP (via proxy) (${error.status}): ${error.statusText}.`;
      }
    }
    return throwError(() => new Error(errorMessage));
  }
}