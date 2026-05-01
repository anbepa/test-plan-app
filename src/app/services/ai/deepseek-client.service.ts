import { Injectable, NgZone } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

export interface DeepSeekMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface DeepSeekRequest {
    model: string;
    messages: DeepSeekMessage[];
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
    response_format?: {
        type: 'json_object' | 'text';
    };
}

export interface DeepSeekChoice {
    index: number;
    message: DeepSeekMessage;
    finish_reason: string;
}

export interface DeepSeekUsage {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
}

export interface DeepSeekResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: DeepSeekChoice[];
    usage: DeepSeekUsage;
    [key: string]: any;
}

export interface ProxyRequestBody {
    action: 'generateScope' | 'generateTextCases' | 'enhanceStaticSection' | 'refineDetailedTestCases';
    payload: DeepSeekRequest;
}

/** Evento de stream emitido por callDeepSeekStream */
export interface StreamEvent {
    /** Tokens de razonamiento interno del modelo (CoT) */
    reasoning: string;
    /** Tokens del contenido final generado */
    content: string;
    /** true cuando el stream terminó completamente */
    done: boolean;
}

@Injectable({
    providedIn: 'root'
})
export class DeepSeekClientService {

    // Se asume que en environment existe deepSeekApiUrl o se usa una convención
    // Por ahora hardcodeamos la ruta relativa al proxy local/vercel
    private proxyApiUrl = '/api/deepseek-proxy';

    // Sistema de cola para controlar el rate limiting
    private requestQueue: Array<() => Promise<any>> = [];
    private isProcessingQueue = false;
    private readonly MIN_REQUEST_INTERVAL = 500; // Optimizado: reducido de 800ms para mayor velocidad
    private lastRequestTime = 0;

    constructor(private http: HttpClient, private ngZone: NgZone) { }

    public callDeepSeek(action: string, payload: DeepSeekRequest): Observable<DeepSeekResponse> {
        const requestToProxy: ProxyRequestBody = { action: action as any, payload };

        return new Observable<DeepSeekResponse>(observer => {
            this.enqueueRequest(async () => {
                try {
                    const result = await this.http.post<DeepSeekResponse>(
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
    }

    /**
     * Llama a DeepSeek en modo streaming (SSE).
     * Emite StreamEvent con los tokens de razonamiento y contenido a medida que llegan.
     * El último evento tiene done=true y contiene todo el texto acumulado.
     */
    public callDeepSeekStream(action: string, payload: DeepSeekRequest): Observable<StreamEvent> {
        const requestToProxy = { action, payload: { ...payload, stream: true } };

        return new Observable<StreamEvent>(observer => {
            let accReasoning = '';
            let accContent = '';
            // Throttle: emitir al UI cada N tokens para no sobrecargar change detection
            let pendingEmit = false;
            const scheduleEmit = (done: boolean) => {
                if (done) {
                    this.ngZone.run(() => {
                        observer.next({ reasoning: accReasoning, content: accContent, done: true });
                        observer.complete();
                    });
                    return;
                }
                if (!pendingEmit) {
                    pendingEmit = true;
                    // Micro-batch: emitir en el siguiente macrotask para agrupar tokens rápidos
                    setTimeout(() => {
                        pendingEmit = false;
                        this.ngZone.run(() => {
                            observer.next({ reasoning: accReasoning, content: accContent, done: false });
                        });
                    }, 80);
                }
            };

            fetch(this.proxyApiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestToProxy)
            }).then(async response => {
                if (!response.ok) {
                    let errBody: any = {};
                    try { errBody = await response.json(); } catch {}
                    this.ngZone.run(() => {
                        observer.error({
                            userMessage: errBody?.userMessage || `Error ${response.status} al llamar DeepSeek`,
                            technicalDetails: JSON.stringify(errBody)
                        });
                    });
                    return;
                }

                console.log('[DeepSeek Stream] Respuesta HTTP OK, leyendo SSE...');

                const reader = response.body!.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                let receivedAnyToken = false;

                const processLine = (line: string) => {
                    if (!line.startsWith('data: ')) return;
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') {
                        console.log('[DeepSeek Stream] [DONE] recibido');
                        return;
                    }
                    try {
                        const parsed = JSON.parse(data);
                        const delta = parsed?.choices?.[0]?.delta;
                        if (!delta) return;

                        // deepseek-reasoner emite reasoning_content (CoT) separado del content (JSON final)
                        const reasoningToken: string = (delta.reasoning_content != null && delta.reasoning_content !== '') ? delta.reasoning_content : '';
                        const contentToken: string = (delta.content != null && delta.content !== '') ? delta.content : '';

                        if (reasoningToken) {
                            accReasoning += reasoningToken;
                            receivedAnyToken = true;
                        }
                        if (contentToken) {
                            accContent += contentToken;
                            receivedAnyToken = true;
                        }

                        if (reasoningToken || contentToken) {
                            scheduleEmit(false);
                        }
                    } catch { /* JSON incompleto en el buffer, ignorar */ }
                };

                try {
                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) break;
                        buffer += decoder.decode(value, { stream: true });
                        // Un chunk puede contener múltiples líneas SSE
                        const lines = buffer.split('\n');
                        buffer = lines.pop() ?? '';
                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (trimmed) processLine(trimmed);
                        }
                    }
                    // Procesar resto del buffer si quedó algo
                    if (buffer.trim()) processLine(buffer.trim());
                    console.log(`[DeepSeek Stream] Stream completado. reasoning: ${accReasoning.length} chars, content: ${accContent.length} chars`);
                } catch (err) {
                    this.ngZone.run(() => observer.error(err));
                    return;
                }

                // Evento final con done=true (cancela el pendingEmit si existía)
                pendingEmit = false;
                scheduleEmit(true);

            }).catch(err => this.ngZone.run(() => observer.error(err)));
        });
    }

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

    private async processQueue(): Promise<void> {
        if (this.isProcessingQueue || this.requestQueue.length === 0) {
            return;
        }

        this.isProcessingQueue = true;

        while (this.requestQueue.length > 0) {
            const now = Date.now();
            const timeSinceLastRequest = now - this.lastRequestTime;

            if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL) {
                const waitTime = this.MIN_REQUEST_INTERVAL - timeSinceLastRequest;
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }

            const request = this.requestQueue.shift();
            if (request) {
                try {
                    await request();
                } catch (error) {
                    console.error('Error procesando petición DeepSeek:', error);
                }
                this.lastRequestTime = Date.now();
            }
        }

        this.isProcessingQueue = false;
    }

    private handleError(errorResponse: HttpErrorResponse): Observable<never> {
        let userMessage = 'Error en servicio DeepSeek.';
        let technicalDetails = '';

        console.error('Error DeepSeek capturado:', errorResponse);

        if (errorResponse.error?.userMessage) {
            userMessage = errorResponse.error.userMessage;
            technicalDetails = errorResponse.error.technicalDetails || '';
        } else {
            userMessage = `Error de comunicación (${errorResponse.status})`;
            technicalDetails = errorResponse.message;
        }

        return throwError(() => ({
            userMessage,
            technicalDetails,
            originalError: errorResponse
        }));
    }
}
