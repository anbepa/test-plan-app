import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

export interface GeminiTextPart { text: string; }
export interface GeminiContent { parts: GeminiTextPart[]; }
export interface ProxyRequestBody {
    action: 'generateScope' | 'generateTextCases' | 'enhanceStaticSection' | 'refineDetailedTestCases';
    payload: any;
}
export interface GeminiCandidate {
    content: GeminiContent;
    finishReason?: string;
    safetyRatings?: any[];
    [key: string]: any;
}
export interface GeminiResponse {
    candidates?: GeminiCandidate[];
    promptFeedback?: any;
    [key: string]: any;
}
export interface GeminiErrorDetail {
    '@type'?: string;
    reason?: string;
    domain?: string;
    metadata?: { [key: string]: string };
    [key: string]: any;
}
export interface GeminiError {
    code: number;
    message: string;
    status: string;
    details?: GeminiErrorDetail[];
    [key: string]: any;
}
export interface GeminiErrorResponse {
    error?: GeminiError;
    userMessage?: string;
    technicalDetails?: string;
}

@Injectable({
    providedIn: 'root'
})
export class GeminiClientService {

    private proxyApiUrl = environment.geminiApiUrl;
    private useProxy = environment.useGeminiProxy;

    // Sistema de cola para controlar el rate limiting en el cliente
    private requestQueue: Array<() => Promise<any>> = [];
    private isProcessingQueue = false;
    private readonly MIN_REQUEST_INTERVAL = 5000; // 5 segundos entre peticiones
    private lastRequestTime = 0;

    constructor(private http: HttpClient) { }

    /**
     * Método principal para realizar peticiones a Gemini (vía Proxy)
     * Gestiona automáticamente el rate limiting mediante una cola.
     */
    public callGemini(action: string, payload: any): Observable<GeminiResponse> {
        if (this.useProxy) {
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
            return throwError(() => new Error('[ERROR] Las llamadas directas están deshabilitadas por seguridad. Usa useProxy=true'));
        }
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
                    userMessage = '📊 Cuota excedida. Intenta más tarde.';
                    technicalDetails = 'Cuota excedida';
                } else {
                    userMessage = `⚠️ Error de IA: ${apiErrorMsg.substring(0, 100)}`;
                    technicalDetails = apiErrorMsg;
                }
            } else {
                userMessage = `Error desconocido (${errorResponse.status})`;
                technicalDetails = errorResponse.message;
            }
        }

        return throwError(() => ({
            userMessage,
            technicalDetails,
            originalError: errorResponse
        }));
    }
}
