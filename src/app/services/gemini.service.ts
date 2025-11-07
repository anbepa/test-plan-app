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
interface GeminiContent { parts: GeminiTextPart[]; }
interface ProxyRequestBody {
  action: 'generateScope' | 'generateTextCases' | 'enhanceStaticSection' | 'refineDetailedTestCases';
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
  private useProxy = environment.useGeminiProxy;
  private directApiUrl = environment.geminiApiEndpoint;
  private apiKey = environment.geminiApiKey;

  // Sistema de cola para controlar el rate limiting en el cliente
  private requestQueue: Array<() => Promise<any>> = [];
  private isProcessingQueue = false;
  private readonly MIN_REQUEST_INTERVAL = 5000; // 5 segundos entre peticiones (aumentado para evitar 429)
  private lastRequestTime = 0;

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

  private readonly PROMPT_SCOPE_AND_TEST_CASES_COMBINED = (description: string, acceptanceCriteria: string, technique: string, additionalContext?: string): string => `
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

  /**
   * Procesa la cola de peticiones respetando el rate limit
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.requestQueue.length > 0) {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;

      // Esperar si es necesario para respetar el rate limit
      if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL) {
        const waitTime = this.MIN_REQUEST_INTERVAL - timeSinceLastRequest;
        console.log(`[Rate Limiting] Esperando ${waitTime}ms antes de la siguiente petición`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      const request = this.requestQueue.shift();
      if (request) {
        try {
          await request();
        } catch (error) {
          console.error('Error procesando petición de la cola:', error);
        }
        this.lastRequestTime = Date.now();
      }
    }

    this.isProcessingQueue = false;
  }

  /**
   * Añade una petición a la cola
   */
  private enqueueRequest<T>(requestFn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push(async () => {
        try {
          const result = await requestFn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      this.processQueue();
    });
  }

  /**
   * DEPRECADO - NO USAR
   * Este método exponía la API key en la URL.
   * TODAS las llamadas deben pasar por el proxy.
   */
  private callGeminiDirect(payload: any): Observable<GeminiResponse> {
    throw new Error('[ERROR] callGeminiDirect está deshabilitado por seguridad. Usa useProxy=true');
  }

  /**
   * Método helper para decidir si usar proxy o llamadas directas
   * Ahora incluye control de rate limiting mediante cola
   */
  private callGemini(action: string, payload: any): Observable<GeminiResponse> {
    if (this.useProxy) {
      // Usar proxy de Vercel con control de rate limiting
      const requestToProxy: ProxyRequestBody = { action: action as any, payload };
      
      // Envolver la petición HTTP en una Promise para la cola
      return new Observable<GeminiResponse>(observer => {
        this.enqueueRequest(async () => {
          try {
            const result = await this.http.post<GeminiResponse>(
              this.proxyApiUrl, 
              requestToProxy
            ).pipe(
              catchError(this.handleError)
            ).toPromise();
            
            observer.next(result!);
            observer.complete();
          } catch (error) {
            observer.error(error);
          }
        });
      });
    } else {
      // Llamada directa a Gemini (deshabilitada por seguridad)
      return this.callGeminiDirect(payload);
    }
  }

  private getTextFromParts(parts: GeminiTextPart[] | undefined): string {
    if (parts && parts.length > 0) {
      const firstPart = parts[0];
      if (firstPart && 'text' in firstPart) {
        return firstPart.text;
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
    console.log('[SCOPE] Enviando petición de alcance');
    return this.callGemini('generateScope', geminiPayload).pipe(
      map(response => {
        console.log('[SCOPE] Respuesta recibida:', response);
        const textContent = this.getTextFromParts(response?.candidates?.[0]?.content?.parts).trim();
        console.log('[SCOPE] Texto extraído:', textContent);
        const limitedText = textContent.split('\n').slice(0, 4).join('\n');
        console.log('[SCOPE] Texto limitado:', limitedText);
        return limitedText;
      }),
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

  /**
   * NUEVO MÉTODO: Genera alcance y casos de prueba en UNA SOLA petición
   * Retorna un objeto con { scope: string, testCases: DetailedTestCase[] }
   */
  public generateScopeAndTestCasesCombined(
    description: string, 
    acceptanceCriteria: string, 
    technique: string, 
    additionalContext?: string
  ): Observable<{ scope: string; testCases: DetailedTestCase[] }> {
    const promptText = this.PROMPT_SCOPE_AND_TEST_CASES_COMBINED(description, acceptanceCriteria, technique, additionalContext);
    const geminiPayload = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: { maxOutputTokens: 5000, temperature: 0.2 }
    };
    
    console.log('[COMBINED] Enviando petición combinada de alcance + casos de prueba');
    
    return new Observable<{ scope: string; testCases: DetailedTestCase[] }>(observer => {
      this.enqueueRequest(async () => {
        try {
          const apiCall = this.useProxy 
            ? this.http.post<GeminiResponse>(this.proxyApiUrl, { action: 'generateScopeAndCases', payload: geminiPayload })
            : this.callGeminiDirect(geminiPayload);
          
          const response = await apiCall.pipe(
            catchError(this.handleError)
          ).toPromise();
          
          if (!response) {
            observer.next({ 
              scope: 'No se pudo generar el alcance.',
              testCases: [{ 
                title: "Error de API", 
                preconditions: "No se recibió respuesta de la API.", 
                steps: [{numero_paso: 1, accion: "La API no devolvió ninguna respuesta."}], 
                expectedResults: "N/A" 
              }]
            });
            observer.complete();
            return;
          }
          
          const rawText = this.getTextFromParts(response?.candidates?.[0]?.content?.parts).trim() || '';
          console.log('[COMBINED] Respuesta recibida (primeros 200 chars):', rawText.substring(0, 200));
          
          if (!rawText) {
            observer.next({ 
              scope: 'Respuesta vacía de la API.',
              testCases: [{ 
                title: "Error de API", 
                preconditions: "Respuesta vacía de la API.", 
                steps: [{numero_paso: 1, accion: "Respuesta vacía de la API."}], 
                expectedResults: "N/A" 
              }]
            });
            observer.complete();
            return;
          }
          
          // Limpiar marcadores de código
          let jsonText = rawText;
          if (jsonText.startsWith("```json")) { jsonText = jsonText.substring(7); }
          if (jsonText.startsWith("```")) { jsonText = jsonText.substring(3); }
          if (jsonText.endsWith("```")) { jsonText = jsonText.substring(0, jsonText.length - 3); }
          jsonText = jsonText.trim();
          
          // Verificar que sea un objeto JSON
          if (!jsonText.startsWith("{")) {
            console.error('[COMBINED] Error: La respuesta no es un objeto JSON válido');
            observer.next({ 
              scope: 'Error de formato en la respuesta.',
              testCases: [{ 
                title: "Error de Formato", 
                preconditions: "Respuesta no fue objeto JSON.", 
                steps: [{numero_paso: 1, accion: `Respuesta cruda: ${rawText.substring(0,200)}`}], 
                expectedResults: "N/A" 
              }]
            });
            observer.complete();
            return;
          }
          
          try {
            const parsedResponse: any = JSON.parse(jsonText);
            
            // Validar estructura
            if (!parsedResponse.scope || !parsedResponse.testCases) {
              console.error('[COMBINED] Error: Respuesta JSON no tiene la estructura esperada');
              observer.next({ 
                scope: 'Error de estructura en la respuesta.',
                testCases: [{ 
                  title: "Error de Estructura", 
                  preconditions: "Respuesta JSON no tuvo formato esperado.", 
                  steps: [{numero_paso: 1, accion: `Respuesta: ${JSON.stringify(parsedResponse).substring(0,200)}`}], 
                  expectedResults: "N/A" 
                }]
              });
              observer.complete();
              return;
            }
            
            let scope = parsedResponse.scope || 'No se pudo generar el alcance.';
            let testCases: DetailedTestCase[] = [];
            
            // Limitar alcance a 4 líneas
            scope = scope.split('\n').slice(0, 4).join('\n');
            console.log('[COMBINED] Alcance extraído:', scope);
            
            // Procesar casos de prueba
            if (Array.isArray(parsedResponse.testCases) && parsedResponse.testCases.length > 0) {
              testCases = parsedResponse.testCases.map((tc: any, index: number) => {
                const detailedTc: DetailedTestCase = {
                  title: tc.title || `Caso ${index + 1}`,
                  preconditions: tc.preconditions || 'No especificadas',
                  steps: Array.isArray(tc.steps) ? tc.steps.map((s: any, i: number) => ({
                    numero_paso: s.numero_paso || (i + 1),
                    accion: s.accion || "Paso no descrito"
                  })) : [{ numero_paso: 1, accion: "Pasos en formato incorrecto" }],
                  expectedResults: tc.expectedResults || 'No especificado'
                };
                return detailedTc;
              });
              console.log('[COMBINED] Casos de prueba procesados:', testCases.length);
            } else {
              console.warn('[COMBINED] No se encontraron casos de prueba en la respuesta');
              testCases = [{ 
                title: "Sin casos de prueba", 
                preconditions: "La respuesta no incluyó casos de prueba.", 
                steps: [{numero_paso: 1, accion: "No se generaron casos de prueba."}], 
                expectedResults: "N/A" 
              }];
            }
            
            observer.next({ scope, testCases });
            observer.complete();
            
          } catch (parseError: any) {
            console.error('[COMBINED] Error al parsear JSON:', parseError);
            observer.next({ 
              scope: 'Error al procesar la respuesta.',
              testCases: [{ 
                title: "Error de Parseo JSON", 
                preconditions: "No se pudo parsear la respuesta.", 
                steps: [{numero_paso: 1, accion: `Error: ${parseError.message}`}], 
                expectedResults: "N/A" 
              }]
            });
            observer.complete();
          }
          
        } catch (error) {
          console.error('[COMBINED] Error en la petición:', error);
          observer.error(error);
        }
      });
    });
  }



  public refineDetailedTestCases(
    originalHuInput: HUData['originalInput'],
    editedTestCases: DetailedTestCase[],
    newTechnique: string,
    userReanalysisContext: string
  ): Observable<DetailedTestCase[]> {
    const currentTestCasesJSON = JSON.stringify(editedTestCases, null, 2);
    const promptText = this.PROMPT_REFINE_DETAILED_TEST_CASES(
        'text',
        originalHuInput.description,
        originalHuInput.acceptanceCriteria,
        currentTestCasesJSON,
        newTechnique,
        userReanalysisContext
    );
    const parts = [{ text: promptText }];
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
    return this.callGemini('enhanceStaticSection', geminiPayload).pipe(
        map(response => this.getTextFromParts(response?.candidates?.[0]?.content?.parts).trim()),
        catchError(this.handleError)
    );
  }

  private sendGenerationRequestThroughProxy(requestToProxy: ProxyRequestBody): Observable<DetailedTestCase[]> {
    // Usar la cola para controlar el rate limiting
    return new Observable<DetailedTestCase[]>(observer => {
      this.enqueueRequest(async () => {
        try {
          // Decidir si usar proxy o llamada directa
          const apiCall = this.useProxy 
            ? this.http.post<GeminiResponse>(this.proxyApiUrl, requestToProxy)
            : this.callGeminiDirect(requestToProxy.payload);
          
          const response = await apiCall.pipe(
            catchError(this.handleError)
          ).toPromise();
          
          if (!response) {
            observer.next([{ 
              title: "Error de API", 
              preconditions: "No se recibió respuesta de la API.", 
              steps: [{numero_paso: 1, accion: "La API no devolvió ninguna respuesta."}], 
              expectedResults: "N/A" 
            }]);
            observer.complete();
            return;
          }
          
          const rawText = this.getTextFromParts(response?.candidates?.[0]?.content?.parts).trim() || '';
          
          if (!rawText) {
            observer.next([{ 
              title: "Error de API", 
              preconditions: "Respuesta vacía de la API.", 
              steps: [{numero_paso: 1, accion: "Respuesta vacía de la API."}], 
              expectedResults: "N/A" 
            }]);
            observer.complete();
            return;
          }
          
          let jsonText = rawText;
          if (jsonText.startsWith("```json")) { jsonText = jsonText.substring(7); }
          if (jsonText.endsWith("```")) { jsonText = jsonText.substring(0, jsonText.length - 3); }
          jsonText = jsonText.trim();
          
          if (!jsonText.startsWith("[")) {
            observer.next([{ 
              title: "Error de Formato (No JSON Array)", 
              preconditions: "Respuesta no fue array JSON.", 
              steps: [{numero_paso: 1, accion: `Respuesta cruda: ${rawText.substring(0,200)}`}], 
              expectedResults: "N/A" 
            }]);
            observer.complete();
            return;
          }
          
          try {
            let parsedResponse: any[] = JSON.parse(jsonText);
            
            if (!Array.isArray(parsedResponse)) {
              observer.next([{ 
                title: "Error de Formato (No Array)", 
                preconditions: "Respuesta JSON no tuvo formato array.", 
                steps: [{numero_paso: 1, accion: `Respuesta cruda: ${rawText.substring(0,200)}`}], 
                expectedResults: "N/A" 
              }]);
              observer.complete();
              return;
            }
            
            if (parsedResponse.length === 0) {
              observer.next([]);
              observer.complete();
              return;
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
              observer.next([{
                title: parsedResponse[0].title,
                preconditions: parsedResponse[0].preconditions || "N/A",
                steps: parsedResponse[0].steps,
                expectedResults: parsedResponse[0].expectedResults || "N/A"
              }] as DetailedTestCase[]);
              observer.complete();
              return;
            }
            
            const formattedCases = parsedResponse.map((tc: any, tcIndex: number) => {
              console.log(`🔍 GEMINI TC ${tcIndex}:`, { title: tc.title, preconditions: tc.preconditions, hasSteps: Array.isArray(tc.steps) });
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
            
            observer.next(formattedCases);
            observer.complete();
            
          } catch (e: any) {
            console.error(`[GeminiService] Error parseando JSON para ${requestToProxy.action}:`, e.message, "\nRespuesta Cruda:", rawText);
            observer.next([{ 
              title: "Error de Parsing JSON", 
              preconditions: "No se pudo interpretar respuesta JSON.", 
              steps: [{numero_paso:1, accion: `Error: ${e.message}. Respuesta cruda: ${rawText.substring(0,500)}`}], 
              expectedResults: "Verificar consola." 
            }]);
            observer.complete();
          }
        } catch (error) {
          observer.error(error);
        }
      });
    });
  }

  private handleError(errorResponse: HttpErrorResponse): Observable<never> {
    let userMessage = 'Ocurrió un error al comunicarse con el servicio de IA.';
    let technicalDetails = '';
    
    console.error('Error de API capturado:', errorResponse);
    
    // Error del cliente o de red
    if (errorResponse.error instanceof ErrorEvent) { 
      userMessage = 'Error de conexión. Verifica tu conexión a internet e intenta nuevamente.';
      technicalDetails = `Error de red: ${errorResponse.error.message}`;
    } 
    // El servidor retornó un error estructurado con userMessage
    else if (errorResponse.error?.userMessage) {
      userMessage = errorResponse.error.userMessage;
      technicalDetails = errorResponse.error.technicalDetails || errorResponse.error.error || '';
    }
    // El proxy retornó un error con formato { error: string }
    else if (errorResponse.error?.error && typeof errorResponse.error.error === 'string') {
      const errorText = errorResponse.error.error;
      
      // Detectar error 429 (Too Many Requests)
      if (errorText.includes('429') || errorText.includes('Resource exhausted') || errorText.includes('Too Many Requests')) {
        userMessage = 'El servicio de IA está procesando muchas solicitudes. Por favor, espera 10-15 segundos e intenta nuevamente.';
        technicalDetails = 'Rate limit excedido (429)';
      }
      // Detectar error de API key
      else if (errorText.includes('401') || errorText.includes('API key') || errorText.includes('authentication')) {
        userMessage = 'Error de autenticación. La API key no es válida o ha expirado.';
        technicalDetails = 'Error 401: API key inválida';
      }
      // Detectar error 403
      else if (errorText.includes('403') || errorText.includes('Forbidden')) {
        userMessage = 'No tienes permisos para usar este servicio. Verifica tu cuenta de IA.';
        technicalDetails = 'Error 403: Acceso denegado';
      }
      // Detectar error 500
      else if (errorText.includes('500') || errorText.includes('Internal Server')) {
        userMessage = 'El servicio de IA está experimentando problemas. Intenta nuevamente en unos minutos.';
        technicalDetails = 'Error 500: Error interno del servidor';
      }
      // Error genérico del proxy
      else {
        userMessage = `Error al procesar la solicitud: ${errorText.substring(0, 100)}`;
        technicalDetails = errorText;
      }
    }
    // Respuesta de error en formato JSON string
    else if (errorResponse.error && typeof errorResponse.error === 'string' && 
             (errorResponse.error.includes('{') || errorResponse.error.includes('error'))) {
      try {
        const errorObj = JSON.parse(errorResponse.error);
        const geminiApiError = errorObj as GeminiErrorResponse;
        
        if (geminiApiError?.error?.message) {
          const apiErrorMsg = geminiApiError.error.message;
          
          // Parsear errores específicos de Gemini
          if (apiErrorMsg.includes('429') || apiErrorMsg.includes('Resource exhausted')) {
            userMessage = '⏱️ Límite de solicitudes alcanzado. Espera 10-15 segundos antes de continuar.';
            technicalDetails = 'Error 429: Rate limit de Gemini API';
          } else if (apiErrorMsg.includes('quota') || apiErrorMsg.includes('QUOTA_EXCEEDED')) {
            userMessage = '📊 Se alcanzó el límite de uso del servicio de IA para hoy. Intenta mañana o usa otra API key.';
            technicalDetails = 'Cuota excedida';
          } else {
            userMessage = `⚠️ ${apiErrorMsg.substring(0, 150)}`;
            technicalDetails = apiErrorMsg;
          }
        } else {
          userMessage = `Error HTTP ${errorResponse.status}: ${errorResponse.statusText}`;
          technicalDetails = JSON.stringify(errorObj).substring(0, 200);
        }
      } catch (e) {
        userMessage = `Error HTTP ${errorResponse.status}: No se pudo interpretar la respuesta del servidor.`;
        technicalDetails = errorResponse.error.substring(0, 200);
      }
    }
    // Respuesta de error como string simple
    else if (errorResponse.error && typeof errorResponse.error === 'string') {
      userMessage = `${errorResponse.error}`;
      technicalDetails = errorResponse.error;
    }
    // Error estructurado de Gemini API
    else {
      const geminiApiError = errorResponse.error as GeminiErrorResponse;
      
      if (geminiApiError?.error?.message) {
        const apiErrorMsg = geminiApiError.error.message;
        
        if (apiErrorMsg.includes('429') || apiErrorMsg.includes('Resource exhausted')) {
          userMessage = '⏱️ Demasiadas solicitudes. Espera 10-15 segundos e intenta de nuevo.';
          technicalDetails = 'Error 429: Rate limit';
        } else if (apiErrorMsg.includes('quota')) {
          userMessage = '📊 Cuota de uso excedida. Verifica los límites de tu API key.';
          technicalDetails = 'Cuota excedida';
        } else {
          userMessage = `⚠️ Error de IA: ${apiErrorMsg.substring(0, 150)}`;
          technicalDetails = apiErrorMsg;
        }
      } else if (typeof errorResponse.message === 'string') {
        userMessage = `Error HTTP ${errorResponse.status}: ${errorResponse.message}`;
        technicalDetails = errorResponse.message;
      } else {
        userMessage = `Error HTTP ${errorResponse.status}: ${errorResponse.statusText || 'Error desconocido'}`;
        technicalDetails = `Status ${errorResponse.status}`;
      }
    }
    
    // Log para debugging
    console.warn('[ERROR] Error procesado:', {
      userMessage,
      technicalDetails,
      status: errorResponse.status
    });
    
    return throwError(() => new Error(userMessage));
  }
}
