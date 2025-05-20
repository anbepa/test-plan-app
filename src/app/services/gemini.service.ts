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
  [key: string]: any; // Para otras propiedades que puedan venir
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: any;
  [key: string]: any; // Para otras propiedades que puedan venir
}
// Interfaz para manejar la estructura de error de la API de Gemini
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

  private apiUrl = environment.geminiApiUrl;
  private apiKey = environment.geminiApiKey;

  // --- Prompts Optimizados ---

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

private readonly PROMPT_SCENARIOS = (description: string, acceptanceCriteria: string, technique: string) => `
Eres un Ingeniero de QA experto en el diseño de pruebas de caja negra.
Tu tarea es generar escenarios de prueba CLAROS, CONCISOS y ACCIONABLES.

**ENTRADA PROPORCIONADA:**
1.  **Historia de Usuario (HU):** ${description}
2.  **Criterios de Aceptación (CA):** ${acceptanceCriteria}
3.  **Técnica de Diseño de Pruebas de Caja Negra a Aplicar:** "${technique}"

**INSTRUCCIONES FUNDAMENTALES PARA EL DISEÑO DE ESCENARIOS:**

1.  **COMPRENSIÓN PROFUNDA:** Analiza minuciosamente la HU y CADA UNO de los CA. Los escenarios deben cubrir los aspectos funcionales descritos.
2.  **APLICACIÓN ESTRICTA DE LA TÉCNICA "${technique}":**
    *   Debes basar tu razonamiento y la generación de escenarios DIRECTAMENTE en los principios de la técnica "${technique}".
    *   Considera lo siguiente según la técnica:
        *   Si la técnica es **"Partición de Equivalencia"**: Identifica los diferentes conjuntos de datos de entrada/salida (válidos e inválidos) mencionados o implícitos en los CA. Crea escenarios que prueben al menos un valor representativo de cada partición identificada. Busca condiciones o rangos en los CA.
        *   Si la técnica es **"Análisis de Valores Límite"**: Enfócate en los bordes o límites de los rangos de datos numéricos o conjuntos ordenados definidos o implícitos en los CA. Genera escenarios para los valores en el límite, inmediatamente por debajo del límite inferior válido, e inmediatamente por encima del límite superior válido.
        *   Si la técnica es **"Tablas de Decisión"**: Identifica las condiciones lógicas y las acciones resultantes descritas en los CA. Si múltiples condiciones interactúan para producir diferentes resultados, diseña escenarios que cubran las combinaciones significativas de estas condiciones (reglas de la tabla de decisión).
        *   Si la técnica es **"Transición de Estados"**: Identifica los diferentes estados del sistema o de un objeto, y los eventos o acciones (descritos en los CA) que causan transiciones entre estos estados. Crea escenarios para probar secuencias válidas e inválidas de transiciones de estado.
        *   Si la técnica es **"Casos de Uso"**: Considera la HU como el flujo principal. Deriva escenarios directamente de los CA, cubriendo tanto el flujo exitoso como los flujos alternativos o de error especificados en ellos.
        *   Si la técnica es **"Adivinación de Errores"**: Basándote en tu experiencia y en la HU/CA, identifica áreas propensas a errores comunes que podrían no estar explícitamente cubiertas por otras técnicas (ej., entradas vacías si los CA no lo especifican, formatos de datos inesperados, secuencias de acciones inusuales, uso de caracteres especiales). Sé específico sobre el error potencial.
        *   Si la técnica es **"Pruebas de Pares (Pairwise Testing)"**: Si los CA describen múltiples parámetros de entrada o configuraciones independientes que pueden combinarse, genera escenarios que prueben todas las interacciones entre *pares* de valores de estos parámetros de la forma más eficiente posible, en lugar de todas las combinaciones exhaustivas.
    *   Los escenarios DEBEN ser una consecuencia lógica de aplicar "${technique}" a la HU y CA. NO inventes funcionalidad que no esté descrita.
3.  **DERIVACIÓN DIRECTA:** CADA escenario generado debe poder rastrearse y justificarse EXCLUSIVAMENTE a partir de la HU, los CA y la aplicación de la técnica "${technique}". NO añadas escenarios basados en suposiciones externas.
4.  **FORMATO DE SALIDA ESTRICTO (SIN EXCEPCIONES):**
    *   Cada escenario debe iniciar en una **NUEVA LÍNEA**.
    *   Precede cada escenario **ÚNICAMENTE con un guion y un espacio** (ej: "- Verificar el inicio de sesión exitoso con credenciales válidas.").
    *   **El título de cada escenario DEBE COMENZAR con un verbo en infinitivo o imperativo** (ej: "Verificar", "Validar", "Asegurar", "Intentar", "Comprobar", "Realizar").
    *   La respuesta debe contener **SOLAMENTE** la lista de escenarios.
    *   **ABSOLUTAMENTE PROHIBIDO INCLUIR:** numeración adicional (ej: "1.", "a)"), introducciones, explicaciones previas o posteriores, conclusiones, resúmenes, saludos, despedidas, títulos generales (como "ESCENARIOS DE PRUEBA:"), o cualquier otro texto que no sea la lista de escenarios con el formato especificado.
5.  **CONCISIÓN Y ACCIÓN:** Los escenarios deben ser breves, directos al punto y describir una acción verificable o una condición a probar.
6.  **COBERTURA ADECUADA:** Intenta generar un conjunto de escenarios que cubran razonablemente los CA a través de la lente de la técnica "${technique}", evitando la redundancia excesiva. Busca escenarios *distintos* y *significativos*. Prioriza la calidad sobre la cantidad si es necesario.
7.  **CASO DE NO APLICABILIDAD / INFORMACIÓN INSUFICIENTE:** Si consideras que la técnica "${technique}" no es genuinamente aplicable a la HU/CA proporcionadas para generar escenarios significativos, o si la información es claramente insuficiente para aplicar la técnica de forma efectiva, responde **EXACTAMENTE** y ÚNICAMENTE con el siguiente texto:
    "No se pudieron generar escenarios con la información proporcionada y la técnica especificada."

---
PROCEDE A GENERAR LA LISTA DE ESCENARIOS BASADA EN LA HU, LOS CA Y LA TÉCNICA "${technique}":
`;

  constructor(private http: HttpClient) { }

  // *** Método para generar la sección de Alcance ***
  generateTestPlanSections(description: string, acceptanceCriteria: string): Observable<string> {
    const promptText = this.PROMPT_SCOPE(description, acceptanceCriteria);
    const body: GeminiRequestBody = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: {
        maxOutputTokens: 100, // Reducido para forzar la concisión de 4 líneas.
        temperature: 0.4 // Más bajo para una respuesta más directa y menos "creativa"
      }
      // Considera añadir safetySettings si es necesario para tu caso de uso
      // safetySettings: [
      //   { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      //   { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      //   // ... otros ajustes de seguridad
      // ]
    };

    const urlWithKey = `${this.apiUrl}?key=${this.apiKey}`;

    return this.http.post<GeminiResponse>(urlWithKey, body).pipe(
      map(response => {
        const text = response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        // El prompt ya pide un máximo de 4 líneas, pero como una salvaguarda adicional:
        return text.trim().split('\n').slice(0, 4).join('\n');
      }),
      catchError(this.handleError)
    );
  }

  // *** Método para generar la lista de Escenarios ***
  generateScenarios(description: string, acceptanceCriteria: string, technique: string): Observable<string[]> {
    const promptText = this.PROMPT_SCENARIOS(description, acceptanceCriteria, technique);
    const body: GeminiRequestBody = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: {
        maxOutputTokens: 500, // Ajustado para permitir más escenarios sin ser excesivo
        temperature: 0.7 // Mantiene un equilibrio entre creatividad y adherencia
      }
      // Considera añadir safetySettings aquí también si es necesario
    };

    const urlWithKey = `${this.apiUrl}?key=${this.apiKey}`;

    return this.http.post<GeminiResponse>(urlWithKey, body).pipe(
      map(response => {
        const fullText = response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

        if (fullText === "No se pudieron generar escenarios con la información proporcionada.") {
          return [fullText]; // Devuelve el mensaje específico como un único ítem
        }

        const scenarios = fullText
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.startsWith('- '))
          .map(line => line.substring(2).trim()) // Elimina "- " del inicio
          .filter(line => line.length > 0);

        if (scenarios.length === 0 && fullText.length > 0 && !fullText.includes("No se pudieron generar escenarios")) {
          // Si no se pudieron parsear escenarios pero hubo texto, devuelve el texto como fallback.
          // Esto puede pasar si el modelo no sigue el formato al 100%.
          console.warn("Los escenarios no pudieron ser parseados como una lista con '- '. Devolviendo el texto crudo como un único escenario.");
          return [fullText];
        }

        if (scenarios.length === 0) {
          // Si no hay escenarios y no es el mensaje específico, devuelve un mensaje genérico.
          console.warn("La API no devolvió escenarios o el formato fue inesperado.");
          return ['No se pudieron generar escenarios o la respuesta no tuvo el formato esperado.'];
        }

        return scenarios;
      }),
      catchError(this.handleError)
    );
  }

  // *** Manejador de errores centralizado ***
  private handleError(error: HttpErrorResponse): Observable<never> {
    let errorMessage = 'Ocurrió un error desconocido en la comunicación con la API de Gemini.';
    console.error('Error de API capturado:', error);

    if (error.error instanceof ErrorEvent) {
      // Error del lado del cliente o de red
      errorMessage = `Error del cliente o de red: ${error.error.message}`;
    } else {
      // Error del lado del servidor (HTTP)
      const geminiApiError = error.error as GeminiErrorResponse;
      if (geminiApiError?.error?.message) {
        errorMessage = `Error de la API de Gemini (${error.status} - ${geminiApiError.error.status || 'N/A'}): ${geminiApiError.error.message}`;
        if (geminiApiError.error.details && geminiApiError.error.details.length > 0) {
          errorMessage += ` Detalles: ${geminiApiError.error.details.map(d => d.reason || JSON.stringify(d)).join(', ')}`;
        }
      } else if (typeof error.error === 'string' && error.error.length > 0 && error.error.length < 500) { // Evitar mensajes de error HTML muy largos
        // A veces la API puede devolver un error como string simple
        errorMessage = `Error HTTP (${error.status}): ${error.statusText} - Respuesta: ${error.error}`;
      }
      else {
        errorMessage = `Error HTTP (${error.status}): ${error.statusText}. No se pudo obtener un mensaje detallado del cuerpo del error.`;
      }
    }
    return throwError(() => new Error(errorMessage)); // Devolver un objeto Error
  }
}