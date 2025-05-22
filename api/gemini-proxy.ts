// /api/gemini-proxy.ts
// Este archivo asume que GEMINI_API_URL_BACKEND en tus variables de entorno
// contiene la URL COMPLETA del endpoint del modelo de Gemini,
// por ejemplo: https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent

import type { VercelRequest, VercelResponse } from '@vercel/node';

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
  const { default: fetch } = await import('node-fetch');

  if (request.method !== 'POST') {
    console.warn(`Method Not Allowed: ${request.method} for /api/gemini-proxy`);
    return response.status(405).json({ error: 'Method Not Allowed. Only POST is accepted.' });
  }

  const GEMINI_API_KEY = process.env['GEMINI_API_KEY'];
  // GEMINI_MODEL_ENDPOINT_URL se espera que sea la URL completa del endpoint del modelo desde las variables de entorno
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
    const { action, payload } = request.body as ProxyRequestBody;

    if (!action || payload === undefined) { // Comprobar payload !== undefined si puede ser null o 0
      console.warn('Bad Request: Missing action or payload in request body.', request.body);
      return response.status(400).json({ error: 'Bad Request: Missing action or payload.' });
    }

    const geminiRequestBody = payload; // El payload ya es el cuerpo que Gemini espera

    // Como GEMINI_MODEL_ENDPOINT_URL ya es la URL completa del modelo,
    // no necesitamos un 'switch' para construir la ruta del modelo aquí.
    // Sin embargo, la 'action' podría usarse para otra lógica si fuera necesario.
    // Si diferentes acciones DEBEN ir a diferentes URLs de modelo, este enfoque
    // de una única GEMINI_API_URL_BACKEND con la URL completa no será suficiente.
    // En ese caso, deberías volver al enfoque donde GEMINI_API_URL_BACKEND es solo
    // la base (https://generativelanguage.googleapis.com) y el 'switch'
    // construye el resto de la ruta del modelo.

    const fullGeminiUrl = `${GEMINI_MODEL_ENDPOINT_URL}?key=${GEMINI_API_KEY}`;

    console.log(`Proxying action "${action}" to Gemini URL: ${fullGeminiUrl}`);
    // console.log('Gemini Request Body:', JSON.stringify(geminiRequestBody, null, 2));

    const geminiApiResponse = await fetch(fullGeminiUrl, {
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
        // No era JSON
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
    console.error(`Unhandled exception in proxy function for request body:`, request.body, error);
    let errorMessage = 'Internal Server Error in proxy.';
    if (error instanceof Error) {
        errorMessage = error.message;
    } else if (typeof error === 'string') {
        errorMessage = error;
    }
    return response.status(500).json({
        error: 'Internal Server Error in proxy.',
        details: errorMessage,
        action: (request.body as ProxyRequestBody)?.action || 'unknown'
    });
  }
}