// /api/gemini-proxy.ts
// Este archivo asume que GEMINI_API_URL_BACKEND en tus variables de entorno
// contiene la URL COMPLETA del endpoint del modelo de Gemini,
// por ejemplo: https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent

import type { VercelRequest, VercelResponse } from '@vercel/node';

// --- INICIO DE LA MODIFICACIÓN ---
// Usar require para node-fetch v2.x
// Asegúrate de haber instalado node-fetch@2 (ej. npm install node-fetch@2.6.7)
// y @types/node-fetch@^2 si usas TypeScript intensivamente con sus tipos.
const fetch = require('node-fetch');
// --- FIN DE LA MODIFICACIÓN ---

// Tipos que tu frontend (GeminiService) envía al proxy
interface ProxyRequestBody {
  action: string; // Permite cualquier string, pero tu servicio usará valores específicos
  payload: any;   // El contenido específico para esa acción (el body que iba a Gemini)
}

// Tipos para la respuesta de Gemini (simplificado)
interface GeminiTextPart { text: string; }
interface GeminiInlineDataPart { inlineData: { mimeType: string; data: string; }; }
interface GeminiContent { parts: (GeminiTextPart | GeminiInlineDataPart)[]; }
interface GeminiCandidate {
  content: GeminiContent;
  finishReason?: string;
  safetyRatings?: any[];
}
interface GeminiApiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: any;
}
interface GeminiApiErrorDetail {
  '@type'?: string;
  reason?: string;
  domain?: string;
  metadata?: { [key: string]: string };
}
interface GeminiApiError {
  code: number;
  message: string;
  status: string;
  details?: GeminiApiErrorDetail[];
}
interface GeminiApiErrorResponse {
  error?: GeminiApiError;
}

export default async function handler(
  request: VercelRequest,
  response: VercelResponse
) {
  // El bloque try-catch para la importación de fetch ya no es necesario aquí,
  // ya que require() es síncrono y está en el scope del módulo.

  if (request.method !== 'POST') {
    console.warn(`Method Not Allowed: ${request.method} for /api/gemini-proxy`);
    return response.status(405).json({ error: 'Method Not Allowed. Only POST is accepted.' });
  }

  const GEMINI_API_KEY = process.env['GEMINI_API_KEY'];
  const GEMINI_MODEL_ENDPOINT_URL = process.env['GEMINI_API_URL_BACKEND'];

  if (!GEMINI_API_KEY) {
    console.error('CRITICAL: GEMINI_API_KEY is not defined in environment variables.');
    return response.status(500).json({ error: 'Server configuration error: Missing API Key.' });
  }
  if (!GEMINI_MODEL_ENDPOINT_URL) {
    console.error('CRITICAL: GEMINI_API_URL_BACKEND (expected to be full model endpoint URL) is not defined.');
    return response.status(500).json({ error: 'Server configuration error: Missing Model Endpoint URL.' });
  }

  try {
    // Es buena práctica parsear el body dentro del try-catch si no estás seguro de que Vercel siempre lo haga
    // y para manejar errores de JSON malformado.
    let parsedBody: ProxyRequestBody;
    if (typeof request.body === 'string' && request.body.length > 0) { // Comprobar si es un string no vacío
        try {
            parsedBody = JSON.parse(request.body);
        } catch (parseError: any) {
            console.warn('Bad Request: Could not parse request body as JSON.', { body: request.body, error: parseError.message });
            return response.status(400).json({ error: 'Bad Request: Invalid JSON body.' });
        }
    } else if (typeof request.body === 'object' && request.body !== null) {
        parsedBody = request.body as ProxyRequestBody;
    } else {
        console.warn('Bad Request: Request body is empty or not a recognized type.', { body: request.body });
        return response.status(400).json({ error: 'Bad Request: Missing or invalid request body.' });
    }

    const { action, payload } = parsedBody;

    if (!action || payload === undefined) {
      console.warn('Bad Request: Missing action or payload in request body.', { action, payloadExists: payload !== undefined });
      return response.status(400).json({ error: 'Bad Request: Missing action or payload.' });
    }

    const geminiRequestBody = payload;
    const fullGeminiUrl = `${GEMINI_MODEL_ENDPOINT_URL}?key=${GEMINI_API_KEY}`;

    console.log(`Proxying action "${action}" to Gemini URL: ${fullGeminiUrl}`);
    // console.log('Gemini Request Body:', JSON.stringify(geminiRequestBody, null, 2)); // Descomentar para depuración detallada

    const geminiApiResponse = await fetch(fullGeminiUrl, { // 'fetch' aquí es la constante definida con require()
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(geminiRequestBody),
    });

    const responseBodyText = await geminiApiResponse.text();

    if (!geminiApiResponse.ok) {
      console.error(
        `Gemini API Error for action "${action}": HTTP ${geminiApiResponse.status}`,
        `URL: ${fullGeminiUrl}`,
        `Response Body: ${responseBodyText}`
      );
      let errorDetails: string | GeminiApiError = responseBodyText;
      try {
        const parsedError = JSON.parse(responseBodyText) as GeminiApiErrorResponse;
        if (parsedError.error) {
            errorDetails = parsedError.error;
        }
      } catch (e) {
        // No era JSON o no tenía la estructura esperada
      }
      return response.status(geminiApiResponse.status).json({
        error: `Error from Gemini API (HTTP ${geminiApiResponse.status})`,
        action: action,
        details: errorDetails
      });
    }

    try {
        const data = JSON.parse(responseBodyText) as GeminiApiResponse;
        return response.status(200).json(data);
    } catch (e: any) {
        console.error(
            `Error parsing successful Gemini API response as JSON for action "${action}":`,
            e.message,
            `Raw Response Body: ${responseBodyText}`
        );
        return response.status(500).json({
            error: 'Error parsing successful Gemini API response. The response was not valid JSON.',
            action: action,
            rawResponse: responseBodyText
        });
    }

  } catch (error: any) {
    // Este catch general es para errores inesperados en tu lógica del proxy.
    console.error(`Unhandled exception in proxy function:`, { requestBody: request.body, error: error.message, stack: error.stack });
    let errorMessage = 'Internal Server Error in proxy.';
    if (error instanceof Error) {
        errorMessage = error.message;
    } else if (typeof error === 'string') {
        errorMessage = error;
    }
    return response.status(500).json({
        error: 'Internal Server Error in proxy.',
        details: errorMessage,
        action: (request.body as ProxyRequestBody)?.action || 'unknown' // Intenta obtener la acción si es posible
    });
  }
}