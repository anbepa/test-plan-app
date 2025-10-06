// src/app/services/gemini.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import {
  DetailedTestCase,
  TestCaseStep,
  HUData
} from '../models/hu-data.model';

// --- Interfaces Internas del Servicio ---
interface GeminiTextPart { text: string; }
interface GeminiInlineDataPart { inlineData: { mimeType: string; data: string; }; }
type GeminiPart = GeminiTextPart | GeminiInlineDataPart;
interface GeminiContent { parts: GeminiPart[]; }
interface ProxyRequestBody {
  action: 'generateScope' | 'generateTextCases' | 'generateImageCases' | 'enhanceStaticSection' | 'refineDetailedTestCases';
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

  // --- Definiciones de Prompts ---

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
  * **CASO DE ERROR / NO REFINAMIENTO POSIBLE:** Si, a pesar de toda la información, y priorizando el contexto del usuario, no puedes generar un conjunto de casos refinados válidos (ej. el contexto es fundamentalmente contradictorio o la información es insuficiente), responde EXACTAMENTE y ÚNICAMENTE con el siguiente array JSON:
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

  public generateDetailedTestCasesImageBased(imagesBase64: string[], technique: string, additionalContext?: string): Observable<DetailedTestCase[]> {
    const promptText = this.PROMPT_SCENARIOS_DETAILED_IMAGE_BASED(technique, additionalContext);
    const imageParts: GeminiInlineDataPart[] = imagesBase64.map((base64) => ({
      inlineData: { mimeType: 'image/png', data: base64 }
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
    if (originalHuInput.generationMode === 'image' && originalHuInput.imagesBase64) {
        const imageParts: GeminiInlineDataPart[] = originalHuInput.imagesBase64.map((base64) => ({
            inlineData: { mimeType: 'image/png', data: base64 }
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

  private handleError(errorResponse: HttpErrorResponse): Observable<never> {
    let errorMessage = 'Ocurrió un error desconocido en la comunicación con el API (via proxy).';
    console.error('Error de API (via proxy) capturado:', errorResponse);
    
    if (errorResponse.error instanceof ErrorEvent) { 
      errorMessage = `Error del cliente o de red: ${errorResponse.error.message}`; 
    } 
    else if (errorResponse.error?.error && typeof errorResponse.error.error === 'string') { 
      errorMessage = `Error del proxy (${errorResponse.status}): ${errorResponse.error.error}`; 
      if (errorResponse.error.details) errorMessage += ` Detalles: ${errorResponse.error.details}`; 
    }
    else if (errorResponse.error && typeof errorResponse.error === 'string' && (errorResponse.error.includes('{') || errorResponse.error.includes('error'))) {
        try {
            const errorObj = JSON.parse(errorResponse.error); 
            const geminiApiError = errorObj as GeminiErrorResponse;
            if (geminiApiError?.error?.message) { 
              errorMessage = `Error de API (via proxy) (${errorResponse.status} - ${geminiApiError.error.status || 'N/A'}): ${geminiApiError.error.message}`; 
              if (geminiApiError.error.details?.length) { 
                errorMessage += ` Detalles: ${geminiApiError.error.details.map(d => d.reason || JSON.stringify(d)).join(', ')}`; 
              }
            } else { 
              errorMessage = `Error HTTP (via proxy) (${errorResponse.status}): ${errorResponse.statusText} - Respuesta: ${JSON.stringify(errorObj).substring(0,200)}`;
            }
        } catch (e) { 
          errorMessage = `Error HTTP (via proxy) (${errorResponse.status}): ${errorResponse.statusText} - Respuesta: ${errorResponse.error.substring(0,200)}`;
        }
    } 
    else if (errorResponse.error && typeof errorResponse.error === 'string') { 
      errorMessage = `Error del proxy (${errorResponse.status}): ${errorResponse.error}`; 
    }
    else {
        const geminiApiError = errorResponse.error as GeminiErrorResponse;
        if (geminiApiError?.error?.message) { 
          errorMessage = `Error de API (via proxy) (${errorResponse.status} - ${geminiApiError.error.status || 'N/A'}): ${geminiApiError.error.message}`; 
          if (geminiApiError.error.details?.length) { 
            errorMessage += ` Detalles: ${geminiApiError.error.details.map(d => d.reason || JSON.stringify(d)).join(', ')}`; 
          }
        }
        else if (typeof errorResponse.message === 'string') { 
          errorMessage = `Error HTTP (via proxy) (${errorResponse.status}): ${errorResponse.message}`; 
        }
        else { 
          errorMessage = `Error HTTP (via proxy) (${errorResponse.status}): ${errorResponse.statusText}. La respuesta del servidor no pudo ser interpretada.`; 
        }
    }
    return throwError(() => new Error(errorMessage));
  }
}
