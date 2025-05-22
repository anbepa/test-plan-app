// src/app/services/gemini.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

// --- Definiciones de Tipos para la API de Gemini ---
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
interface GeminiRequestBody {
  contents: GeminiContent[];
  generationConfig?: GeminiGenerationConfig;
  safetySettings?: GeminiSafetySetting[];
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

  private apiUrl = environment.geminiApiUrl;
  private apiKey = environment.geminiApiKey;

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
4.  **FORMATO DE SALIDA ESTRICTO JSON (SIN EXCEPCIONES):**
    *   La respuesta DEBE ser un array JSON válido.
    *   Cada elemento del array debe ser un objeto JSON representando un caso de prueba con las siguientes propiedades EXACTAS: "title", "preconditions", "steps", "expectedResults".
    *   Ejemplo: { "title": "...", "preconditions": "...", "steps": "...", "expectedResults": "..." }
    *   Los valores de "preconditions", "steps", y "expectedResults" pueden ser strings con múltiples líneas separadas por '\\n'.
    *   El valor de "title" DEBE COMENZAR con un verbo en infinitivo o imperativo.
    *   **ABSOLUTAMENTE PROHIBIDO INCLUIR:** Cualquier texto fuera del array JSON. La respuesta debe ser *únicamente* el array JSON.
5.  **CONCISIÓN Y ACCIÓN:** (Title, Preconditions, Steps, ExpectedResults deben ser claros y accionables).
6.  **COBERTURA ADECUADA:** Genera un conjunto de casos de prueba que cubran razonablemente los CA a través de la lente de la técnica "${technique}".
7.  **CASO DE NO APLICABILIDAD / INFORMACIÓN INSUFICIENTE:** Responde EXACTAMENTE y ÚNICAMENTE con: [{"title": "Información Insuficiente", "preconditions": "N/A", "steps": "No se pudieron generar casos detallados...", "expectedResults": "N/A"}]
---
PROCEDE A GENERAR EL ARRAY JSON DE CASOS DE PRUEBA DETALLADOS BASADA EN LA HU, LOS CA Y LA TÉCNICA "${technique}":
`;

private readonly PROMPT_SCENARIOS_DETAILED_IMAGE_BASED = (technique: string) => `
Eres un Ingeniero de QA experto en diseño de pruebas de caja negra y en la interpretación de interfaces de usuario a partir de imágenes.
Tu tarea es analizar la imagen proporcionada, que representa un flujo de interfaz de usuario, y generar casos de prueba detallados, claros, concisos y accionables basados en la técnica de prueba especificada.
**ENTRADA PROPORCIONADA:**
1.  **Imagen del Flujo de Interfaz de Usuario:** (La imagen adjunta en base64 en la solicitud).
2.  **Técnica de Diseño de Pruebas de Caja Negra a Aplicar:** "${technique}"
**INSTRUCCIONES FUNDAMENTALES PARA EL DISEÑO DE CASOS DE PRUEBA:**
1.  **INTERPRETACIÓN VISUAL DETALLADA:**
    * Analiza la imagen minuciosamente. Identifica elementos (botones, campos, etc.), flujo de navegación, acciones y resultados visuales.
    * Infiere criterios de aceptación o reglas de negocio.
    * Considera el texto en la imagen como crucial.
2.  **APLICACIÓN ESTRICTA DE LA TÉCNICA "${technique}":**
    * Basa la generación de casos en tu interpretación de la imagen y los principios de "${technique}".
    * Aplica la técnica a elementos y flujos visuales (Partición Equivalencia, Valores Límite, etc.).
    * Los casos DEBEN ser consecuencia lógica de aplicar "${technique}" a la funcionalidad inferida. NO inventes funcionalidad.
3.  **DERIVACIÓN DIRECTA DE LA IMAGEN:** CADA caso debe justificarse por la imagen y la aplicación de "${technique}".
4.  **FORMATO DE SALIDA ESTRICTO JSON EN ESPAÑOL (SIN EXCEPCIONES):**
    * La respuesta DEBE ser un array JSON válido.
    * Cada elemento: objeto JSON con propiedades EXACTAS: **"title"**, **"preconditions"**, **"steps"**, **"expectedResults"**.
    * Ejemplo: {"title": "Verificar navegación...", "preconditions": "Pantalla principal visible...", "steps": "1. Observar...", "expectedResults": "Sistema navega..."}
    * Valores pueden ser strings multilínea (separados por '\\n'). "title" DEBE comenzar con verbo.
    * **ABSOLUTAMENTE PROHIBIDO TEXTO FUERA del array JSON.** Respuesta: *únicamente* el array JSON.
5.  **CONCISIÓN Y ACCIÓN (ENFOCADO EN LA IMAGEN):**
    * **Title:** Breve, descriptivo.
    * **Preconditions:** Estado ANTES de pasos, inferido de imagen.
    * **Steps:** Acciones CLARAS sobre elementos VISIBLES. Sé específico.
    * **ExpectedResults:** Resultado observable DESPUÉS de pasos.
6.  **COBERTURA ADECUADA:** Cubre funcionalidad principal e interacciones clave inferidas, a través de "${technique}".
7.  **CASO DE IMAGEN NO CLARA / NO APLICABILIDAD:** Responde EXACTAMENTE y ÚNICAMENTE con: [{"title": "Imagen no interpretable o técnica no aplicable", "preconditions": "N/A", "steps": "No se pudieron generar casos detallados...", "expectedResults": "N/A"}]
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


  constructor(private http: HttpClient) { }

  private getTextFromParts(parts: (GeminiTextPart | GeminiInlineDataPart)[] | undefined): string {
    if (parts && parts.length > 0) {
      const firstPart = parts[0];
      if (firstPart && 'text' in firstPart) { // Comprobación de existencia de firstPart
        return (firstPart as GeminiTextPart).text;
      }
    }
    return '';
  }

  generateTestPlanSections(description: string, acceptanceCriteria: string): Observable<string> {
    const promptText = this.PROMPT_SCOPE(description, acceptanceCriteria);
    const body: GeminiRequestBody = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: { maxOutputTokens: 200, temperature: 0.4 }
    };
    const urlWithKey = `${this.apiUrl}?key=${this.apiKey}`;
    return this.http.post<GeminiResponse>(urlWithKey, body).pipe(
      map(response => {
        const text = this.getTextFromParts(response?.candidates?.[0]?.content?.parts);
        return text.trim().split('\n').slice(0, 4).join('\n');
      }),
      catchError(this.handleError)
    );
  }

  generateDetailedTestCasesTextBased(description: string, acceptanceCriteria: string, technique: string): Observable<DetailedTestCase[]> {
    const promptText = this.PROMPT_SCENARIOS_DETAILED_TEXT_BASED(description, acceptanceCriteria, technique);
    const body: GeminiRequestBody = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: { maxOutputTokens: 2048, temperature: 0.6 }
    };
    return this.sendGenerationRequest(body);
  }

  generateDetailedTestCasesImageBased(imageBase64: string, mimeType: string, technique: string): Observable<DetailedTestCase[]> {
    const promptText = this.PROMPT_SCENARIOS_DETAILED_IMAGE_BASED(technique);
    const body: GeminiRequestBody = {
      contents: [
        {
          parts: [
            { text: promptText },
            { inlineData: { mimeType: mimeType, data: imageBase64 } }
          ]
        }
      ],
      generationConfig: { maxOutputTokens: 2048, temperature: 0.5, topP: 0.95, topK: 40 },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
      ]
    };
    return this.sendGenerationRequest(body);
  }

  private sendGenerationRequest(body: GeminiRequestBody): Observable<DetailedTestCase[]> {
    const urlWithKey = `${this.apiUrl}?key=${this.apiKey}`;
    return this.http.post<GeminiResponse>(urlWithKey, body).pipe(
      map(response => {
        const rawText = this.getTextFromParts(response?.candidates?.[0]?.content?.parts).trim() || '';
        if (!rawText) {
          console.warn("API did not return content for detailed test cases.");
          return [{ title: "Error de API", preconditions: "Respuesta vacía de la API.", steps: "N/A", expectedResults: "N/A" }];
        }
        try {
          let jsonText = rawText;
          if (jsonText.startsWith("```json")) { jsonText = jsonText.substring(7); }
          if (jsonText.endsWith("```")) { jsonText = jsonText.substring(0, jsonText.length - 3); }
          jsonText = jsonText.trim();

          const testCases: DetailedTestCase[] = JSON.parse(jsonText);
          if (!Array.isArray(testCases) || testCases.length === 0) {
            console.warn("API response for detailed test cases is not a valid JSON array or is empty.", rawText);
            return [{ title: "Error de Formato", preconditions: "La respuesta de la API no tuvo el formato JSON esperado.", steps: rawText, expectedResults: "N/A" }];
          }
          return testCases.map(tc => ({
            title: tc.title || "Título no proporcionado",
            preconditions: tc.preconditions || "N/A",
            steps: tc.steps || "Pasos no proporcionados",
            expectedResults: tc.expectedResults || "Resultados no proporcionados"
          }));
        } catch (e) {
          console.error("Error parsing JSON response for detailed test cases:", e, "\nRaw response:", rawText);
          return [{ title: "Error de Parsing JSON", preconditions: "No se pudo interpretar la respuesta de la API.", steps: rawText, expectedResults: "Verificar consola." }];
        }
      }),
      catchError(this.handleError)
    );
  }

  generateEnhancedStaticSectionContent(sectionName: string, existingContent: string, huSummary: string): Observable<string> {
    const promptText = this.PROMPT_STATIC_SECTION_ENHANCEMENT(sectionName, existingContent, huSummary);
    const body: GeminiRequestBody = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: { maxOutputTokens: 300, temperature: 0.5 } // Adjusted for concise additions
    };
    const urlWithKey = `${this.apiUrl}?key=${this.apiKey}`;
    return this.http.post<GeminiResponse>(urlWithKey, body).pipe(
      map(response => {
        const text = this.getTextFromParts(response?.candidates?.[0]?.content?.parts);
        return text.trim();
      }),
      catchError(this.handleError)
    );
  }

  private handleError(error: HttpErrorResponse): Observable<never> {
    let errorMessage = 'Ocurrió un error desconocido en la comunicación con la API.';
    console.error('Error de API capturado:', error);
    if (error.error instanceof ErrorEvent) {
      errorMessage = `Error del cliente o de red: ${error.error.message}`;
    } else {
      const geminiApiError = error.error as GeminiErrorResponse;
      if (geminiApiError?.error?.message) {
        errorMessage = `Error de API (${error.status} - ${geminiApiError.error.status || 'N/A'}): ${geminiApiError.error.message}`;
        if (geminiApiError.error.details?.length) {
          errorMessage += ` Detalles: ${geminiApiError.error.details.map(d => d.reason || JSON.stringify(d)).join(', ')}`;
        }
      } else if (typeof error.error === 'string' && error.error.length > 0 && error.error.length < 500) {
        errorMessage = `Error HTTP (${error.status}): ${error.statusText} - Respuesta: ${error.error}`;
      } else {
        errorMessage = `Error HTTP (${error.status}): ${error.statusText}.`;
      }
    }
    return throwError(() => new Error(errorMessage));
  }
}