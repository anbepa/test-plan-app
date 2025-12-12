import { VercelRequest, VercelResponse } from '@vercel/node';
import fetch from 'node-fetch';

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1000; // 1 segundo entre peticiones para DeepSeek (ajustar según rate limits)

async function waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;

    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
        const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
        console.log(`[Rate Limiting] Esperando ${waitTime}ms antes de la siguiente petición (DeepSeek)`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    lastRequestTime = Date.now();
}

async function callDeepSeekWithRetry(
    apiKey: string,
    apiBody: any,
    maxRetries = 3
): Promise<any> {
    let lastError: Error | null = null;
    const url = 'https://api.deepseek.com/chat/completions';

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await waitForRateLimit();

            console.log(`[API] Calling DeepSeek (Attempt ${attempt}/${maxRetries})`);

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify(apiBody)
            });

            const responseData = await response.json();

            if (!response.ok) {
                throw new Error(JSON.stringify(responseData));
            }

            console.log(`[SUCCESS] Respuesta de DeepSeek exitosa en intento ${attempt}`);
            return responseData;

        } catch (error: any) {
            lastError = error;
            const errorMessage = error?.message || String(error);
            const isRateLimit = errorMessage.includes('429') ||
                errorMessage.includes('Too Many Requests');

            if (isRateLimit) {
                if (attempt < maxRetries) {
                    const backoffTime = Math.pow(2, attempt) * 2000;
                    console.log(`[WARNING] Error 429 detectado. Reintentando en ${backoffTime}ms (intento ${attempt}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, backoffTime));
                    continue;
                }
            } else {
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

    if (errorMessage.includes('429')) {
        return {
            userMessage: 'El servicio de DeepSeek está ocupado. Por favor, espera unos segundos.',
            technicalDetails: 'Error 429: Rate limit excedido'
        };
    }

    if (errorMessage.includes('401')) {
        return {
            userMessage: 'Error de autenticación con DeepSeek. Verifica la API Key.',
            technicalDetails: 'Error 401: Unauthorized'
        };
    }

    if (errorMessage.includes('insufficient_balance')) { // Común en DeepSeek
        return {
            userMessage: 'Saldo insuficiente en la cuenta de DeepSeek.',
            technicalDetails: 'Error: Insufficient Balance'
        };
    }

    return {
        userMessage: 'Ocurrió un error al procesar tu solicitud con DeepSeek.',
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
        const apiKey = process.env['DEEPSEEK_API_KEY'];

        if (!apiKey) {
            console.error('[ERROR] DEEPSEEK_API_KEY no configurada');
            return response.status(500).json({
                error: 'DEEPSEEK_API_KEY not configured',
                userMessage: 'La API key de DeepSeek no está configurada.',
                technicalDetails: 'Variable de entorno DEEPSEEK_API_KEY no encontrada'
            });
        }

        const { payload, action } = request.body;
        let apiBody;

        if (payload) {
            apiBody = payload;
            console.log(`[INFO] Procesando acción: ${action || 'no especificada'}`);
        } else {
            apiBody = request.body;
        }

        // Basic validation for DeepSeek structure
        if (!apiBody.messages || !apiBody.model) {
            // Si falta el modelo, usar el configurado en variables de entorno
            if (!apiBody.model) {
                apiBody.model = process.env['DEEPSEEK_MODEL'] || 'deepseek-chat';
            }
            if (!apiBody.messages) {
                return response.status(400).json({
                    error: 'Bad Request',
                    userMessage: 'La solicitud no contiene "messages".',
                    technicalDetails: 'Missing required field: messages'
                });
            }
        }

        const result = await callDeepSeekWithRetry(
            apiKey,
            apiBody
        );

        return response.status(200).json(result);

    } catch (error: any) {
        console.error('[ERROR] DeepSeek API error:', error);
        const { userMessage, technicalDetails } = getErrorMessage(error);
        return response.status(500).json({
            error: userMessage,
            userMessage: userMessage,
            technicalDetails: technicalDetails,
            timestamp: new Date().toISOString()
        });
    }
}
