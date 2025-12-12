import { Injectable } from '@angular/core';
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

    constructor(private http: HttpClient) { }

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
