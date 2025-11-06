import { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenerativeAI } from '@google/generative-ai';

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 3000;

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

async function callGeminiWithRetry(
  genAI: GoogleGenerativeAI,
  model: string,
  contents: any,
  generationConfig: any,
  maxRetries = 3
): Promise<any> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await waitForRateLimit();
      
      const geminiModel = genAI.getGenerativeModel({ model });
      const result = await geminiModel.generateContent({
        contents,
        generationConfig
      });
      
      console.log(`[SUCCESS] Respuesta de Gemini exitosa en intento ${attempt}`);
      return result.response;
      
    } catch (error: any) {
      lastError = error;
      const errorMessage = error?.message || String(error);
      
      if (errorMessage.includes('429') || errorMessage.includes('Resource exhausted')) {
        if (attempt < maxRetries) {
          const backoffTime = Math.pow(2, attempt) * 2500;
          console.log(`[WARNING] Error 429 detectado. Reintentando en ${backoffTime}ms (intento ${attempt}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, backoffTime));
          continue;
        }
      } else {
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
  
  if (errorMessage.includes('401') || errorMessage.includes('API key')) {
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
  
  if (errorMessage.includes('timeout') || errorMessage.includes('network') || errorMessage.includes('ECONNREFUSED')) {
    return {
      userMessage: 'No se pudo conectar con el servicio de IA. Verifica tu conexión a internet e intenta nuevamente.',
      technicalDetails: 'Error de red: Timeout o conexión rechazada'
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
    const model = 'gemini-2.0-flash';

    if (!apiKey) {
      console.error('[ERROR] GEMINI_API_KEY no configurada');
      return response.status(500).json({ 
        error: 'GEMINI_API_KEY not configured',
        userMessage: 'La API key de Gemini no está configurada. Contacta al administrador.',
        technicalDetails: 'Variable de entorno GEMINI_API_KEY no encontrada'
      });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    let contents, generationConfig;
    
    if (request.body.payload) {
      contents = request.body.payload.contents;
      generationConfig = request.body.payload.generationConfig;
      console.log(`[INFO] Procesando acción: ${request.body.action || 'no especificada'}`);
    } else {
      contents = request.body.contents;
      generationConfig = request.body.generationConfig;
    }
    
    if (!contents || !generationConfig) {
      return response.status(400).json({
        error: 'Bad Request',
        userMessage: 'La solicitud no contiene los datos necesarios (contents y generationConfig).',
        technicalDetails: 'Missing required fields: contents or generationConfig'
      });
    }

    const result = await callGeminiWithRetry(
      genAI,
      model,
      contents,
      generationConfig
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
