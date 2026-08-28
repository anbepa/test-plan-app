import { Injectable, NgZone } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { from, Observable, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { PROMPTS } from '../../config/prompts.config';
import { DetailedTestCase, HUData } from '../../models/hu-data.model';
import { GeminiParserService, PartialParseResult } from './gemini-parser.service';
import { SupabaseClientService } from '../database/supabase-client.service';
import { StreamEvent } from './deepseek-client.service';

/**
 * Servicio de generación/refinamiento de casos usando GitHub Models (Copilot).
 *
 * Implementa la MISMA interfaz pública que DeepSeekService, de modo que
 * AiUnifiedService puede intercambiarlos de forma transparente. Todas las
 * llamadas van al backend propio `/api/integrations/github-models/chat`,
 * que resuelve el token del vault y el modelo seleccionado por el usuario.
 *
 * No implementa streaming (primera versión); las variantes ...Stream se
 * mantienen en DeepSeek. Si esta ruta falla, AiUnifiedService aplica el
 * fallback automático a DeepSeek.
 */
@Injectable({
    providedIn: 'root'
})
export class GitHubModelsService {

    private readonly chatUrl = '/api/integrations/github-models/chat';
    private readonly MAX_CONTINUATIONS = 2;
    // Límite de tokens por request. Con streaming (SSE) la conexión se mantiene
    // viva enviando tokens en tiempo real, así que no hay 504 aunque la respuesta
    // sea larga; se puede usar un límite alto como en DeepSeek.
    private readonly MAX_GEN_TOKENS = 8000;

    constructor(
        private http: HttpClient,
        private parserService: GeminiParserService,
        private supabaseClient: SupabaseClientService,
        private ngZone: NgZone
    ) { }

    // ---- Infra HTTP -------------------------------------------------------
    private getContentFromResponse(response: any): string {
        return response?.choices?.[0]?.message?.content || '';
    }

    /** Llama al endpoint de chat de GitHub Models con auth de Supabase. */
    private callChat(payload: {
        messages: { role: 'user' | 'system' | 'assistant'; content: string }[];
        temperature?: number;
        max_tokens?: number;
        response_format?: { type: 'json_object' | 'text' };
    }): Observable<any> {
        return from(this.buildAuthHeaders()).pipe(
            switchMap((headers) => this.http.post<any>(this.chatUrl, payload, { headers }))
        );
    }

    private async buildAuthHeaders(): Promise<HttpHeaders> {
        let { data, error } = await this.supabaseClient.supabase.auth.getSession();
        let session = data.session;

        const isExpired = !!session?.expires_at && session.expires_at * 1000 <= Date.now() + 60_000;

        if ((!session?.access_token || isExpired) && !error) {
            const refreshed = await this.supabaseClient.supabase.auth.refreshSession();
            session = refreshed.data.session ?? null;
            error = refreshed.error ?? null;
        }

        if (!session?.access_token) {
            throw new Error('Sesión inválida o expirada. Inicia sesión nuevamente.');
        }

        return new HttpHeaders({ Authorization: `Bearer ${session.access_token}` });
    }

    /** Obtiene un access_token de Supabase válido (refrescando si hace falta). */
    private async getAccessToken(): Promise<string> {
        let { data, error } = await this.supabaseClient.supabase.auth.getSession();
        let session = data.session;
        const isExpired = !!session?.expires_at && session.expires_at * 1000 <= Date.now() + 60_000;
        if ((!session?.access_token || isExpired) && !error) {
            const refreshed = await this.supabaseClient.supabase.auth.refreshSession();
            session = refreshed.data.session ?? null;
        }
        if (!session?.access_token) {
            throw new Error('Sesión inválida o expirada. Inicia sesión nuevamente.');
        }
        return session.access_token;
    }

    /**
     * Llama al backend de GitHub Models en modo STREAM (SSE) y emite StreamEvent
     * a medida que llegan los tokens. Mismo contrato que DeepSeek.callDeepSeekStream:
     * el último evento tiene done=true con el contenido acumulado.
     */
    private callChatStream(payload: {
        messages: { role: 'user' | 'system' | 'assistant'; content: string }[];
        temperature?: number;
        max_tokens?: number;
        response_format?: { type: 'json_object' | 'text' };
    }): Observable<StreamEvent> {
        return new Observable<StreamEvent>(observer => {
            let accContent = '';
            let pendingEmit = false;
            const scheduleEmit = (done: boolean) => {
                if (done) {
                    this.ngZone.run(() => {
                        observer.next({ reasoning: '', content: accContent, done: true });
                        observer.complete();
                    });
                    return;
                }
                if (!pendingEmit) {
                    pendingEmit = true;
                    setTimeout(() => {
                        pendingEmit = false;
                        this.ngZone.run(() => {
                            observer.next({ reasoning: '', content: accContent, done: false });
                        });
                    }, 80);
                }
            };

            (async () => {
                let token: string;
                try {
                    token = await this.getAccessToken();
                } catch (err) {
                    this.ngZone.run(() => observer.error(err));
                    return;
                }

                let response: Response;
                try {
                    response = await fetch(this.chatUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${token}`
                        },
                        body: JSON.stringify({ ...payload, stream: true })
                    });
                } catch (err) {
                    this.ngZone.run(() => observer.error(err));
                    return;
                }

                if (!response.ok) {
                    let errBody: any = {};
                    try { errBody = await response.json(); } catch { /* noop */ }
                    this.ngZone.run(() => observer.error({
                        userMessage: errBody?.message || `Error ${response.status} al llamar GitHub Models`,
                        technicalDetails: JSON.stringify(errBody)
                    }));
                    return;
                }

                const reader = response.body!.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                let streamError: string | null = null;

                const processLine = (line: string) => {
                    if (!line.startsWith('data: ')) return;
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') return;
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed?.error) {
                            streamError = parsed?.message || parsed?.error?.message || 'Error del proveedor durante el stream';
                            return;
                        }
                        const delta = parsed?.choices?.[0]?.delta;
                        const contentToken: string = (delta?.content != null && delta.content !== '') ? delta.content : '';
                        if (contentToken) {
                            accContent += contentToken;
                            scheduleEmit(false);
                        }
                    } catch { /* JSON incompleto, ignorar */ }
                };

                try {
                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) break;
                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() ?? '';
                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (trimmed) processLine(trimmed);
                        }
                    }
                    if (buffer.trim()) processLine(buffer.trim());
                } catch (err) {
                    this.ngZone.run(() => observer.error(err));
                    return;
                }

                pendingEmit = false;

                if (streamError) {
                    this.ngZone.run(() => observer.error({
                        userMessage: 'La generación se interrumpió antes de finalizar. Intenta nuevamente.',
                        technicalDetails: streamError
                    }));
                    return;
                }

                if (!accContent.trim()) {
                    this.ngZone.run(() => observer.error({
                        userMessage: 'La respuesta llegó incompleta. Vuelve a intentar la generación.',
                        technicalDetails: 'El stream no devolvió contenido.'
                    }));
                    return;
                }

                scheduleEmit(true);
            })();
        });
    }

    /** Generación de casos en modo STREAM (SSE). */
    public generateTestCasesSmartStream(
        description: string,
        acceptanceCriteria: string,
        technique: string,
        _userRequest: string = ''
    ): Observable<StreamEvent> {
        const promptText = PROMPTS.DIRECT_GENERATION_PROMPT(description, acceptanceCriteria, technique);
        return this.callChatStream({
            messages: [{ role: 'user', content: promptText }],
            temperature: 0.5,
            max_tokens: this.MAX_GEN_TOKENS
        });
    }

    /** Refinamiento de casos en modo STREAM (SSE). */
    public refineTestCasesDirectStream(
        originalHuInput: HUData['originalInput'],
        editedTestCases: DetailedTestCase[],
        newTechnique: string,
        userReanalysisContext: string
    ): Observable<StreamEvent> {
        const currentCasesStr = JSON.stringify(editedTestCases, null, 2);
        const originalReqStr = `HU: ${originalHuInput.description}\nCA: ${originalHuInput.acceptanceCriteria}`;
        const promptText = PROMPTS.DIRECT_REFINE_PROMPT(originalReqStr, currentCasesStr, userReanalysisContext, newTechnique);
        return this.callChatStream({
            messages: [{ role: 'user', content: promptText }],
            temperature: 0.3,
            max_tokens: this.MAX_GEN_TOKENS
        });
    }

    // ---- API pública (igual que DeepSeekService) --------------------------

    public generateTestPlanSections(description: string, acceptanceCriteria: string): Observable<string> {
        const promptText = PROMPTS.SCOPE(description, acceptanceCriteria);
        return this.callChat({
            messages: [{ role: 'user', content: promptText }],
            temperature: 0.3,
            max_tokens: 250
        }).pipe(
            map(response => {
                const textContent = this.getContentFromResponse(response).trim();
                return textContent.split('\n').slice(0, 4).join('\n');
            })
        );
    }

    public generateEnhancedStaticSectionContent(
        sectionName: string,
        existingContent: string,
        huSummary: string,
        huCount: number = 1
    ): Observable<string> {
        const promptText = PROMPTS.STATIC_SECTION_ENHANCEMENT(sectionName, existingContent, huSummary, huCount);
        return this.callChat({
            messages: [{ role: 'user', content: promptText }],
            temperature: 0.2,
            max_tokens: 2500
        }).pipe(
            map(response => {
                const content = this.getContentFromResponse(response).trim();
                if (!content) {
                    const finishReason = response?.choices?.[0]?.finish_reason || 'desconocido';
                    throw {
                        userMessage: 'La IA no devolvió contenido para la sección. Vuelve a intentarlo.',
                        technicalDetails: `content vacío (finish_reason=${finishReason})`
                    };
                }
                return content;
            })
        );
    }

    public generateRiskStrategy(huSummary: string, availableScenarios: string[], huCount: number = 1): Observable<any> {
        const promptText = PROMPTS.RISK_STRATEGY_PROMPT(huSummary, availableScenarios, [], huCount);
        return this.callChat({
            messages: [{ role: 'user', content: promptText }],
            temperature: 0.35,
            max_tokens: 2500,
            response_format: { type: 'json_object' }
        }).pipe(
            map(response => {
                const textContent = this.getContentFromResponse(response).trim();
                if (!textContent) {
                    throw new Error('La IA no devolvió contenido JSON en la respuesta.');
                }
                return this.parserService.cleanAndParseJSON(textContent);
            })
        );
    }

    public generateTestCasesDirect(
        description: string,
        acceptanceCriteria: string,
        technique: string
    ): Observable<any> {
        const promptText = PROMPTS.DIRECT_GENERATION_PROMPT(description, acceptanceCriteria, technique);
        return this.callChat({
            messages: [{ role: 'user', content: promptText }],
            temperature: 0.5,
            max_tokens: this.MAX_GEN_TOKENS
        }).pipe(
            map(response => {
                const textContent = this.getContentFromResponse(response).trim();
                const finalJSON = this.parserService.cleanAndParseJSON(textContent);
                if (finalJSON && Array.isArray(finalJSON.testCases)) {
                    finalJSON.testCases = finalJSON.testCases.map((tc: any) => ({
                        ...tc,
                        steps: Array.isArray(tc.steps)
                            ? tc.steps.filter((step: any) => step && typeof step.accion === 'string' && step.accion.trim() !== '')
                            : []
                    }));
                }
                return finalJSON;
            })
        );
    }

    public generateTestCasesSmart(
        description: string,
        acceptanceCriteria: string,
        technique: string
    ): Observable<any> {
        const promptText = PROMPTS.DIRECT_GENERATION_PROMPT(description, acceptanceCriteria, technique);
        return this.callChat({
            messages: [{ role: 'user', content: promptText }],
            temperature: 0.5,
            max_tokens: this.MAX_GEN_TOKENS
        }).pipe(
            switchMap(response => {
                const textContent = this.getContentFromResponse(response).trim();
                const result: PartialParseResult = this.parserService.cleanAndParseJSONWithMeta(textContent);

                if (result.parsed && Array.isArray(result.parsed.testCases)) {
                    result.parsed.testCases = result.parsed.testCases.map((tc: any) => ({
                        ...tc,
                        steps: Array.isArray(tc.steps)
                            ? tc.steps.filter((step: any) => step && typeof step.accion === 'string' && step.accion.trim() !== '')
                            : []
                    }));
                }

                if (result.possiblyTruncated && result.completedTestCaseCount > 0) {
                    return this.continueGeneration(description, acceptanceCriteria, technique, result.parsed, 0);
                }
                return of(result.parsed);
            })
        );
    }

    private continueGeneration(
        description: string,
        acceptanceCriteria: string,
        technique: string,
        accumulatedResult: any,
        continuationCount: number
    ): Observable<any> {
        if (continuationCount >= this.MAX_CONTINUATIONS) {
            return of(accumulatedResult);
        }

        const currentCasesJson = JSON.stringify(accumulatedResult.testCases || [], null, 2);
        const userRequest = `Agrega los casos de prueba que faltan para completar la cobertura`;
        const promptText = PROMPTS.DIRECT_REFINE_PROMPT(
            `Descripción: ${description}\nCriterios: ${acceptanceCriteria}`,
            currentCasesJson,
            userRequest,
            technique
        );

        return this.callChat({
            messages: [{ role: 'user', content: promptText }],
            temperature: 0.3,
            max_tokens: this.MAX_GEN_TOKENS
        }).pipe(
            switchMap(response => {
                const textContent = this.getContentFromResponse(response).trim();
                const continuationResult = this.parserService.cleanAndParseJSONWithMeta(textContent);
                const newTestCases = continuationResult.parsed?.testCases || [];

                if (newTestCases.length === 0) {
                    return of(accumulatedResult);
                }

                const cleanedNewCases = newTestCases.map((tc: any) => ({
                    ...tc,
                    steps: Array.isArray(tc.steps)
                        ? tc.steps.filter((step: any) => step && typeof step.accion === 'string' && step.accion.trim() !== '')
                        : []
                }));

                accumulatedResult.testCases = [...accumulatedResult.testCases, ...cleanedNewCases];

                if (continuationResult.possiblyTruncated && cleanedNewCases.length > 0) {
                    return this.continueGeneration(description, acceptanceCriteria, technique, accumulatedResult, continuationCount + 1);
                }
                return of(accumulatedResult);
            })
        );
    }

    public refineTestCasesDirect(
        originalHuInput: HUData['originalInput'],
        editedTestCases: DetailedTestCase[],
        newTechnique: string,
        userReanalysisContext: string
    ): Observable<any> {
        const currentCasesStr = JSON.stringify(editedTestCases, null, 2);
        const originalReqStr = `HU: ${originalHuInput.description}\nCA: ${originalHuInput.acceptanceCriteria}`;
        const promptText = PROMPTS.DIRECT_REFINE_PROMPT(originalReqStr, currentCasesStr, userReanalysisContext, newTechnique);

        return this.callChat({
            messages: [{ role: 'user', content: promptText }],
            temperature: 0.3,
            max_tokens: this.MAX_GEN_TOKENS
        }).pipe(
            map(response => {
                const textContent = this.getContentFromResponse(response).trim();
                return this.parserService.cleanAndParseJSON(textContent);
            })
        );
    }
}
