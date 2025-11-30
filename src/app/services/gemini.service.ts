// src/app/services/gemini.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, of, from, concat } from 'rxjs';
import { catchError, map, concatMap, delay, tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { PROMPTS } from '../config/prompts.config';
import {
  DetailedTestCase,
  TestCaseStep,
  HUData
} from '../models/hu-data.model';

// --- Interfaces Internas del Servicio ---
interface GeminiTextPart { text: string; }
interface GeminiContent { parts: GeminiTextPart[]; }
interface ProxyRequestBody {
  action: 'generateScope' | 'generateTextCases' | 'enhanceStaticSection' | 'refineDetailedTestCases' | 'generateScopeAndCases';
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

export interface CoTStepResult {
  step: 'ARCHITECT' | 'GENERATOR' | 'AUDITOR';
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  data?: any;
  message?: string;
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
  // Los prompts ahora se importan desde src/app/config/prompts.config.ts


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
    const promptText = PROMPTS.SCOPE(description, acceptanceCriteria);
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
    const timestamp = new Date().toISOString();
    const contextWithTimestamp = `${additionalContext || ''}\n\n[Generación solicitada en: ${timestamp}]`.trim();

    const promptText = PROMPTS.SCENARIOS_DETAILED_TEXT_BASED(description, acceptanceCriteria, technique, contextWithTimestamp);
    const geminiPayload = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: { maxOutputTokens: 4096, temperature: 0.7 }  // Aumentado de 0.2 a 0.7
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
    // Agregar timestamp para forzar variabilidad en las respuestas
    const timestamp = new Date().toISOString();
    const contextWithTimestamp = `${additionalContext || ''}\n\n[Generación solicitada en: ${timestamp}]`.trim();

    const promptText = PROMPTS.SCOPE_AND_TEST_CASES_COMBINED(description, acceptanceCriteria, technique, contextWithTimestamp);
    const geminiPayload = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: {
        maxOutputTokens: 5000,
        temperature: 0.7  // Aumentado de 0.2 a 0.7 para mayor variabilidad
      }
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
                steps: [{ numero_paso: 1, accion: "La API no devolvió ninguna respuesta." }],
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
                steps: [{ numero_paso: 1, accion: "Respuesta vacía de la API." }],
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
                steps: [{ numero_paso: 1, accion: `Respuesta cruda: ${rawText.substring(0, 200)}` }],
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
                  steps: [{ numero_paso: 1, accion: `Respuesta: ${JSON.stringify(parsedResponse).substring(0, 200)}` }],
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
                steps: [{ numero_paso: 1, accion: "No se generaron casos de prueba." }],
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
                steps: [{ numero_paso: 1, accion: `Error: ${parseError.message}` }],
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
    const timestamp = new Date().toISOString();
    const contextWithTimestamp = `${userReanalysisContext}\n\n[Refinamiento solicitado en: ${timestamp}]`.trim();

    const currentTestCasesJSON = JSON.stringify(editedTestCases, null, 2);
    const promptText = PROMPTS.REFINE_DETAILED_TEST_CASES(
      'text',
      originalHuInput.description,
      originalHuInput.acceptanceCriteria,
      currentTestCasesJSON,
      newTechnique,
      contextWithTimestamp
    );
    const parts = [{ text: promptText }];
    const geminiPayload = {
      contents: [{ parts: parts }],
      generationConfig: {
        maxOutputTokens: 8192,
        temperature: 0.7,  // Aumentado de 0.3 a 0.7
        topP: 0.95,
        topK: 40
      },
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
    const promptText: string = PROMPTS.STATIC_SECTION_ENHANCEMENT(sectionName, existingContent, huSummary);
    const geminiPayload: any = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: { maxOutputTokens: 500, temperature: 0.5 }
    };
    return this.callGemini('enhanceStaticSection', geminiPayload).pipe(
      map(response => this.getTextFromParts(response?.candidates?.[0]?.content?.parts).trim()),
      catchError(this.handleError)
    );
  }

  /**
   * Generación de Casos de Prueba con Chain of Thought (3 Fases)
   */
  public generateTestCasesCoT(
    description: string,
    acceptanceCriteria: string,
    technique: string,
    additionalContext?: string
  ): Observable<CoTStepResult> {
    const timestamp = new Date().toISOString();
    const contextWithTimestamp = `${additionalContext || ''}\n\n[Generación solicitada en: ${timestamp}]`.trim();

    return new Observable<CoTStepResult>(observer => {
      (async () => {
        try {
          // --- FASE 1: EL ARQUITECTO ---
          observer.next({ step: 'ARCHITECT', status: 'in_progress', message: 'El Arquitecto está analizando la estrategia...' });

          const architectPrompt = PROMPTS.ARCHITECT_PROMPT(description, acceptanceCriteria, technique, contextWithTimestamp);
          const architectPayload = {
            contents: [{ parts: [{ text: architectPrompt }] }],
            generationConfig: { maxOutputTokens: 2000, temperature: 0.5 }
          };

          const architectResponse = await this.callGemini('generateTextCases', architectPayload).toPromise();
          const architectText = this.getTextFromParts(architectResponse?.candidates?.[0]?.content?.parts).trim();
          const architectJSON = this.cleanAndParseJSON(architectText);

          observer.next({ step: 'ARCHITECT', status: 'completed', data: architectJSON, message: 'Estrategia definida.' });

          // Espera de 5 segundos
          await new Promise(resolve => setTimeout(resolve, 5000));

          // --- FASE 2: EL GENERADOR ---
          observer.next({ step: 'GENERATOR', status: 'in_progress', message: 'El Generador está escribiendo los casos de prueba...' });

          const generatorPrompt = PROMPTS.GENERATOR_COT_PROMPT(JSON.stringify(architectJSON), technique);
          const generatorPayload = {
            contents: [{ parts: [{ text: generatorPrompt }] }],
            generationConfig: { maxOutputTokens: 5000, temperature: 0.7 }
          };

          const generatorResponse = await this.callGemini('generateTextCases', generatorPayload).toPromise();
          const generatorText = this.getTextFromParts(generatorResponse?.candidates?.[0]?.content?.parts).trim();
          // No parseamos todavía, pasamos el texto crudo al Auditor para que él valide

          observer.next({ step: 'GENERATOR', status: 'completed', data: { rawText: generatorText }, message: 'Casos generados preliminarmente.' });

          // Espera de 5 segundos
          await new Promise(resolve => setTimeout(resolve, 5000));

          // --- FASE 3: EL AUDITOR ---
          observer.next({ step: 'AUDITOR', status: 'in_progress', message: 'El Auditor está revisando y puliendo los casos...' });

          const auditorPrompt = PROMPTS.AUDITOR_PROMPT(
            `HU: ${description}\nCA: ${acceptanceCriteria}`,
            JSON.stringify(architectJSON),
            generatorText
          );
          const auditorPayload = {
            contents: [{ parts: [{ text: auditorPrompt }] }],
            generationConfig: { maxOutputTokens: 5000, temperature: 0.3 } // Temperatura baja para rigor
          };

          const auditorResponse = await this.callGemini('generateTextCases', auditorPayload).toPromise();
          const auditorText = this.getTextFromParts(auditorResponse?.candidates?.[0]?.content?.parts).trim();
          const finalJSON = this.cleanAndParseJSON(auditorText);

          observer.next({ step: 'AUDITOR', status: 'completed', data: finalJSON, message: 'Proceso finalizado con éxito.' });
          observer.complete();

        } catch (error: any) {
          console.error('[CoT Error]', error);
          observer.error(error);
        }
      })();
    });
  }

  /**
   * Refinamiento de Casos de Prueba con Chain of Thought (3 Fases)
   */
  public refineTestCasesCoT(
    originalHuInput: HUData['originalInput'],
    editedTestCases: DetailedTestCase[],
    newTechnique: string,
    userReanalysisContext: string
  ): Observable<CoTStepResult> {
    return new Observable<CoTStepResult>(observer => {
      (async () => {
        try {
          const currentCasesStr = JSON.stringify(editedTestCases, null, 2);

          // --- FASE 1: ARQUITECTO DE REFINAMIENTO ---
          observer.next({ step: 'ARCHITECT', status: 'in_progress', message: 'Analizando solicitud de cambios...' });

          const architectPrompt = PROMPTS.REFINE_ARCHITECT_PROMPT(currentCasesStr, userReanalysisContext, newTechnique);
          const architectPayload = {
            contents: [{ parts: [{ text: architectPrompt }] }],
            generationConfig: { maxOutputTokens: 2000, temperature: 0.5 }
          };

          const architectResponse = await this.callGemini('refineDetailedTestCases', architectPayload).toPromise();
          const architectText = this.getTextFromParts(architectResponse?.candidates?.[0]?.content?.parts).trim();
          const architectJSON = this.cleanAndParseJSON(architectText);

          observer.next({ step: 'ARCHITECT', status: 'completed', data: architectJSON, message: 'Directivas de cambio definidas.' });

          await new Promise(resolve => setTimeout(resolve, 5000));

          // --- FASE 2: GENERADOR DE REFINAMIENTO ---
          observer.next({ step: 'GENERATOR', status: 'in_progress', message: 'Aplicando cambios a los casos de prueba...' });

          const generatorPrompt = PROMPTS.REFINE_GENERATOR_PROMPT(JSON.stringify(architectJSON), currentCasesStr);
          const generatorPayload = {
            contents: [{ parts: [{ text: generatorPrompt }] }],
            generationConfig: { maxOutputTokens: 5000, temperature: 0.7 }
          };

          const generatorResponse = await this.callGemini('refineDetailedTestCases', generatorPayload).toPromise();
          const generatorText = this.getTextFromParts(generatorResponse?.candidates?.[0]?.content?.parts).trim();

          observer.next({ step: 'GENERATOR', status: 'completed', data: { rawText: generatorText }, message: 'Cambios aplicados.' });

          await new Promise(resolve => setTimeout(resolve, 5000));

          // --- FASE 3: AUDITOR DE REFINAMIENTO ---
          observer.next({ step: 'AUDITOR', status: 'in_progress', message: 'Verificando cumplimiento de la solicitud...' });

          const auditorPrompt = PROMPTS.REFINE_AUDITOR_PROMPT(userReanalysisContext, generatorText);
          const auditorPayload = {
            contents: [{ parts: [{ text: auditorPrompt }] }],
            generationConfig: { maxOutputTokens: 5000, temperature: 0.3 }
          };

          const auditorResponse = await this.callGemini('refineDetailedTestCases', auditorPayload).toPromise();
          const auditorText = this.getTextFromParts(auditorResponse?.candidates?.[0]?.content?.parts).trim();
          const finalJSON = this.cleanAndParseJSON(auditorText);

          observer.next({ step: 'AUDITOR', status: 'completed', data: finalJSON, message: 'Refinamiento verificado.' });
          observer.complete();

        } catch (error: any) {
          console.error('[CoT Refinement Error]', error);
          observer.error(error);
        }
      })();
    });
  }

  private cleanAndParseJSON(rawText: string): any {
    let jsonText = rawText.trim();

    // 1. Intentar encontrar el bloque JSON usando índices de llaves/corchetes
    const firstBrace = jsonText.indexOf('{');
    const firstBracket = jsonText.indexOf('[');
    const lastBrace = jsonText.lastIndexOf('}');
    const lastBracket = jsonText.lastIndexOf(']');

    let startIndex = -1;
    let endIndex = -1;

    // Determinar si empieza con { o [
    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      startIndex = firstBrace;
      endIndex = lastBrace;
    } else if (firstBracket !== -1) {
      startIndex = firstBracket;
      endIndex = lastBracket;
    }

    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
      jsonText = jsonText.substring(startIndex, endIndex + 1);
    } else {
      // Fallback: Si no encuentra estructura clara, intentar limpiar markdown común
      if (jsonText.startsWith("```json")) { jsonText = jsonText.substring(7); }
      if (jsonText.startsWith("```")) { jsonText = jsonText.substring(3); }
      if (jsonText.endsWith("```")) { jsonText = jsonText.substring(0, jsonText.length - 3); }
    }

    try {
      return JSON.parse(jsonText);
    } catch (e) {
      console.error('Error parsing JSON. Raw text:', rawText, 'Cleaned text:', jsonText);
      throw e;
    }
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
              steps: [{ numero_paso: 1, accion: "La API no devolvió ninguna respuesta." }],
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
              steps: [{ numero_paso: 1, accion: "Respuesta vacía de la API." }],
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
              steps: [{ numero_paso: 1, accion: `Respuesta cruda: ${rawText.substring(0, 200)}` }],
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
                steps: [{ numero_paso: 1, accion: `Respuesta cruda: ${rawText.substring(0, 200)}` }],
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
                parsedResponse[0].steps = [{ numero_paso: 1, accion: parsedResponse[0].steps || (parsedResponse[0].preconditions || "Detalle no disponible en los pasos.") }];
              } else if (typeof parsedResponse[0].steps[0] === 'string') {
                parsedResponse[0].steps = [{ numero_paso: 1, accion: parsedResponse[0].steps[0] }];
              } else if (typeof parsedResponse[0].steps[0] === 'object' && !parsedResponse[0].steps[0].hasOwnProperty('accion')) {
                parsedResponse[0].steps = [{ numero_paso: 1, accion: JSON.stringify(parsedResponse[0].steps[0]) }];
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
              steps: [{ numero_paso: 1, accion: `Error: ${e.message}. Respuesta cruda: ${rawText.substring(0, 500)}` }],
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
