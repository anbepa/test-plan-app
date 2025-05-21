// src/app/services/gemini.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

// --- Definiciones de Tipos para la API de Gemini (basado en la estructura esperada) ---
interface GeminiTextPart { text: string; }
interface GeminiContent { parts: GeminiTextPart[]; }
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

// NUEVA INTERFAZ para la estructura detallada de un escenario
export interface DetailedTestCase {
  title: string;
  preconditions: string;
  steps: string; // Podría ser un string con saltos de línea o string[] si se parsean los pasos
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

// PROMPT_SCENARIOS MODIFICADO para solicitar detalles adicionales
private readonly PROMPT_SCENARIOS_DETAILED = (description: string, acceptanceCriteria: string, technique: string) => `
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
    *   Considera lo siguiente según la técnica (ejemplos):
        *   **Partición de Equivalencia:** Identifica conjuntos de datos válidos e inválidos.
        *   **Análisis de Valores Límite:** Enfócate en bordes de rangos.
        *   **Tablas de Decisión:** Condiciones lógicas y acciones resultantes.
        *   **Transición de Estados:** Estados del sistema y eventos que causan transiciones.
    *   Los casos de prueba DEBEN ser una consecuencia lógica de aplicar "${technique}" a la HU y CA. NO inventes funcionalidad.
3.  **DERIVACIÓN DIRECTA:** CADA caso de prueba generado debe poder rastrearse y justificarse EXCLUSIVAMENTE a partir de la HU, los CA y la aplicación de la técnica "${technique}".
4.  **FORMATO DE SALIDA ESTRICTO JSON (SIN EXCEPCIONES):**
    *   La respuesta DEBE ser un array JSON válido.
    *   Cada elemento del array debe ser un objeto JSON representando un caso de prueba con las siguientes propiedades EXACTAS: "title", "preconditions", "steps", "expectedResults".
    *   Ejemplo de un elemento del array:
        {
          "title": "Verificar inicio de sesión exitoso con credenciales válidas",
          "preconditions": "El usuario existe en el sistema con credenciales correctas.\nEl sistema de autenticación está operativo.",
          "steps": "1. Navegar a la página de inicio de sesión.\n2. Ingresar nombre de usuario válido en el campo 'Usuario'.\n3. Ingresar contraseña válida en el campo 'Contraseña'.\n4. Hacer clic en el botón 'Iniciar Sesión'.",
          "expectedResults": "El usuario es redirigido al dashboard.\nSe muestra un mensaje de bienvenida personalizado."
        }
    *   Los valores de "preconditions", "steps", y "expectedResults" pueden ser strings con múltiples líneas separadas por '\\n'.
    *   El valor de "title" DEBE COMENZAR con un verbo en infinitivo o imperativo (ej: "Verificar", "Validar").
    *   **ABSOLUTAMENTE PROHIBIDO INCLUIR:** Cualquier texto fuera del array JSON, comentarios, explicaciones, introducciones, conclusiones, saludos, despedidas, o cualquier texto que no sea el array JSON de casos de prueba. La respuesta debe ser *únicamente* el array JSON.
5.  **CONCISIÓN Y ACCIÓN:**
    *   **Title:** Breve y descriptivo.
    *   **Preconditions:** Condiciones necesarias ANTES de ejecutar los pasos. Claras y concisas. Si no hay precondiciones específicas aparte de las generales del sistema, indicar "N/A" o una precondición general.
    *   **Steps:** Secuencia numerada de acciones detalladas y claras que el tester debe realizar. Usa saltos de línea '\\n' para separar cada paso.
    *   **ExpectedResults:** Resultado observable y verificable DESPUÉS de ejecutar los pasos. Claro y específico. Usa saltos de línea '\\n' para separar múltiples resultados esperados si aplica.
6.  **COBERTURA ADECUADA:** Genera un conjunto de casos de prueba que cubran razonablemente los CA a través de la lente de la técnica "${technique}".
7.  **CASO DE NO APLICABILIDAD / INFORMACIÓN INSUFICIENTE:** Si consideras que la técnica "${technique}" no es genuinamente aplicable a la HU/CA proporcionadas para generar casos de prueba significativos, o si la información es claramente insuficiente, responde **EXACTAMENTE** y ÚNICAMENTE con el siguiente array JSON:
    [
      {
        "title": "Información Insuficiente",
        "preconditions": "N/A",
        "steps": "No se pudieron generar casos de prueba detallados con la información proporcionada y la técnica especificada.",
        "expectedResults": "N/A"
      }
    ]

---
PROCEDE A GENERAR EL ARRAY JSON DE CASOS DE PRUEBA DETALLADOS BASADA EN LA HU, LOS CA Y LA TÉCNICA "${technique}":
`;

  constructor(private http: HttpClient) { }

  generateTestPlanSections(description: string, acceptanceCriteria: string): Observable<string> {
    const promptText = this.PROMPT_SCOPE(description, acceptanceCriteria);
    const body: GeminiRequestBody = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: {
        maxOutputTokens: 1500, // Aumentado ligeramente por si acaso
        temperature: 0.4
      }
    };
    const urlWithKey = `${this.apiUrl}?key=${this.apiKey}`;
    return this.http.post<GeminiResponse>(urlWithKey, body).pipe(
      map(response => {
        const text = response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return text.trim().split('\n').slice(0, 4).join('\n');
      }),
      catchError(this.handleError)
    );
  }

  // MÉTODO MODIFICADO para generar Casos de Prueba Detallados
  generateDetailedTestCases(description: string, acceptanceCriteria: string, technique: string): Observable<DetailedTestCase[]> {
    const promptText = this.PROMPT_SCENARIOS_DETAILED(description, acceptanceCriteria, technique);
    const body: GeminiRequestBody = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: {
        maxOutputTokens: 2048, // Aumentado para permitir respuestas JSON más largas
        temperature: 0.6, // Ligeramente ajustado para el formato JSON
        // responseMimeType: "application/json" // Si la API lo soporta, esto es ideal.
      },
      // safetySettings: [...] // Añadir si es necesario
    };
    const urlWithKey = `${this.apiUrl}?key=${this.apiKey}`;

    return this.http.post<GeminiResponse>(urlWithKey, body).pipe(
      map(response => {
        const rawText = response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        if (!rawText) {
          console.warn("La API no devolvió contenido para los casos de prueba detallados.");
          return [{ title: "Error de API", preconditions: "Respuesta vacía de la API.", steps: "N/A", expectedResults: "N/A" }];
        }

        try {
          // Intentar limpiar el texto si viene con ```json ... ```
          let jsonText = rawText;
          if (jsonText.startsWith("```json")) {
            jsonText = jsonText.substring(7); // Quita ```json
          }
          if (jsonText.endsWith("```")) {
            jsonText = jsonText.substring(0, jsonText.length - 3); // Quita ```
          }
          jsonText = jsonText.trim();

          const testCases: DetailedTestCase[] = JSON.parse(jsonText);
          if (!Array.isArray(testCases) || testCases.length === 0) {
            console.warn("La respuesta de la API para casos de prueba detallados no es un array JSON válido o está vacío, o el parsing falló después de la limpieza.", rawText);
            return [{ title: "Error de Formato", preconditions: "La respuesta de la API no tuvo el formato JSON esperado.", steps: rawText, expectedResults: "N/A" }];
          }
          // Validar estructura mínima de cada caso
          return testCases.map(tc => ({
            title: tc.title || "Título no proporcionado",
            preconditions: tc.preconditions || "N/A",
            steps: tc.steps || "Pasos no proporcionados",
            expectedResults: tc.expectedResults || "Resultados no proporcionados"
          }));
        } catch (e) {
          console.error("Error al parsear la respuesta JSON de casos de prueba detallados:", e, "\nRespuesta cruda:", rawText);
          return [{ title: "Error de Parsing JSON", preconditions: "No se pudo interpretar la respuesta de la API.", steps: rawText, expectedResults: "Verificar la consola para detalles del error." }];
        }
      }),
      catchError(this.handleError)
    );
  }

  private handleError(error: HttpErrorResponse): Observable<never> {
    let errorMessage = 'Ocurrió un error desconocido en la comunicación con la API de Gemini.';
    console.error('Error de API capturado:', error);

    if (error.error instanceof ErrorEvent) {
      errorMessage = `Error del cliente o de red: ${error.error.message}`;
    } else {
      const geminiApiError = error.error as GeminiErrorResponse;
      if (geminiApiError?.error?.message) {
        errorMessage = `Error de la API de Gemini (${error.status} - ${geminiApiError.error.status || 'N/A'}): ${geminiApiError.error.message}`;
        if (geminiApiError.error.details && geminiApiError.error.details.length > 0) {
          errorMessage += ` Detalles: ${geminiApiError.error.details.map(d => d.reason || JSON.stringify(d)).join(', ')}`;
        }
      } else if (typeof error.error === 'string' && error.error.length > 0 && error.error.length < 500) {
        errorMessage = `Error HTTP (${error.status}): ${error.statusText} - Respuesta: ${error.error}`;
      }
      else {
        errorMessage = `Error HTTP (${error.status}): ${error.statusText}. No se pudo obtener un mensaje detallado del cuerpo del error.`;
      }
    }
    return throwError(() => new Error(errorMessage));
  }
}