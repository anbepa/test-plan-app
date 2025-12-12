import { VercelRequest, VercelResponse } from '@vercel/node';
import fetch from 'node-fetch';

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 5000; // 5 segundos entre peticiones
const MODEL_VERSION = process.env['GEMINI_MODEL'] || 'gemini-2.5-flash-lite';

async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
    console.log(`[Rate Limiting] Esperando ${waitTime}ms antes de la siguiente petición`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  lastRequestTime = Date.now();
}

async function callGeminiRestWithRetry(
  apiKey: string,
  apiBody: any,
  maxRetries = 3
): Promise<any> {
  let lastError: Error | null = null;
  const url = `https://generativelanguage.googleapis.com/v1/models/${MODEL_VERSION}:generateContent?key=${apiKey}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await waitForRateLimit();

      console.log(`[API] Calling Gemini ${MODEL_VERSION} (Attempt ${attempt}/${maxRetries})`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(apiBody)
      });

      const responseData = await response.json();

      if (!response.ok) {
        throw new Error(JSON.stringify(responseData));
      }

      console.log(`[SUCCESS] Respuesta de Gemini exitosa en intento ${attempt}`);
      return responseData;

    } catch (error: any) {
      lastError = error;
      const errorMessage = error?.message || String(error);
      const isRateLimit = errorMessage.includes('429') ||
        errorMessage.includes('Resource exhausted') ||
        errorMessage.includes('Too Many Requests');

      if (isRateLimit) {
        if (attempt < maxRetries) {
          const backoffTime = Math.pow(2, attempt) * 2500;
          console.log(`[WARNING] Error 429 detectado. Reintentando en ${backoffTime}ms (intento ${attempt}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, backoffTime));
          continue;
        }
      } else {
        // Si no es error de rate limit, rompemos el loop (salvo que queramos reintentar errores 5xx también)
        if (attempt < maxRetries && (errorMessage.includes('500') || errorMessage.includes('Internal Server Error'))) {
          const backoffTime = Math.pow(2, attempt) * 1000;
          console.log(`[WARNING] Error 500 detectado. Reintentando en ${backoffTime}ms`);
          await new Promise(resolve => setTimeout(resolve, backoffTime));
          continue;
        }
        break;
      }
    }
  }

  throw lastError;
}

function getErrorMessage(error: any): { userMessage: string; technicalDetails: string } {
  const errorMessage = error?.message || String(error);

  if (errorMessage.includes('429') || errorMessage.includes('Resource exhausted')) {
    return {
      userMessage: 'El servicio de IA está experimentando un alto volumen de solicitudes. Por favor, espera unos segundos e intenta nuevamente.',
      technicalDetails: 'Error 429: Rate limit excedido'
    };
  }

  if (errorMessage.includes('401') || errorMessage.includes('key')) {
    return {
      userMessage: 'Error de autenticación con el servicio de IA. Verifica la configuración de la API key.',
      technicalDetails: 'Error 401: API key inválida o no configurada'
    };
  }

  if (errorMessage.includes('403')) {
    return {
      userMessage: 'No tienes permisos para acceder al servicio de IA. Verifica tu API key y los permisos de la cuenta.',
      technicalDetails: 'Error 403: Acceso denegado'
    };
  }

  if (errorMessage.includes('500') || errorMessage.includes('Internal Server Error')) {
    return {
      userMessage: 'El servicio de IA está experimentando problemas técnicos. Por favor, intenta nuevamente en unos minutos.',
      technicalDetails: 'Error 500: Error interno del servidor de IA'
    };
  }

  return {
    userMessage: 'Ocurrió un error al procesar tu solicitud. Por favor, intenta nuevamente.',
    technicalDetails: errorMessage.substring(0, 200)
  };
}

export default async function handler(
  request: VercelRequest,
  response: VercelResponse
) {
  if (request.method !== 'POST') {
    return response.status(405).json({
      error: 'Método no permitido. Solo se aceptan peticiones POST.',
      userMessage: 'Método no permitido'
    });
  }

  try {
    const apiKey = process.env['GEMINI_API_KEY'];

    if (!apiKey) {
      console.error('[ERROR] GEMINI_API_KEY no configurada');
      return response.status(500).json({
        error: 'GEMINI_API_KEY not configured',
        userMessage: 'La API key de Gemini no está configurada. Contacta al administrador.',
        technicalDetails: 'Variable de entorno GEMINI_API_KEY no encontrada'
      });
    }

    // Extract payload similar to local server logic
    const { payload, action } = request.body;
    // Extract contents/config from either payload wrapper (frontend service) or direct body
    let apiBody;

    if (payload) {
      apiBody = payload;
      console.log(`[INFO] Procesando acción: ${action || 'no especificada'}`);
    } else {
      apiBody = request.body;
    }

    // Basic validation
    if (!apiBody.contents || !apiBody.generationConfig) {
      return response.status(400).json({
        error: 'Bad Request',
        userMessage: 'La solicitud no contiene los datos necesarios (contents y generationConfig).',
        technicalDetails: 'Missing required fields: contents or generationConfig'
      });
    }

    const result = await callGeminiRestWithRetry(
      apiKey,
      apiBody
    );

    return response.status(200).json(result);

  } catch (error: any) {
    console.error('[ERROR] Gemini API error:', error);

    const { userMessage, technicalDetails } = getErrorMessage(error);

    return response.status(500).json({
      error: userMessage,
      userMessage: userMessage,
      technicalDetails: technicalDetails,
      timestamp: new Date().toISOString()
    });
  }
}
