import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { PROMPTS } from '../../config/prompts.config';
import {
    DetailedTestCase,
    HUData
} from '../../models/hu-data.model';
import { DeepSeekClientService, DeepSeekRequest, StreamEvent } from './deepseek-client.service';
import { GeminiParserService, PartialParseResult } from './gemini-parser.service';

@Injectable({
    providedIn: 'root'
})
export class DeepSeekService {

    // deepseek-chat y deepseek-reasoner fueron descontinuados (2026-07-24). El modelo
    // vigente en la API de DeepSeek es 'deepseek-flash' (DeepSeek-V4.1-Flash), que soporta
    // tanto modo thinking como non-thinking. Ver: https://api-docs.deepseek.com/quick_start/pricing
    private readonly MODEL = 'deepseek-flash';
    /**
     * Modelo usado en generación/refinamiento por streaming.
     * Vercel Hobby limita cada función serverless a 60s. Usamos 'deepseek-flash' en modo
     * non-thinking (ver PROMPTS/parámetros) para evitar que el razonamiento interno (CoT)
     * supere ese límite y corte el stream antes de emitir el JSON final.
     */
    private readonly STREAM_MODEL = 'deepseek-flash';
    /** Tope de tokens para streaming: suficiente para la matriz y acorde a los 60s. */
    private readonly STREAM_MAX_TOKENS = 8000;
    private readonly MAX_CONTINUATIONS = 2; // Máximo de llamadas de continuación
    private readonly RISK_STRATEGY_MAX_RETRIES = 1;

    constructor(
        private deepSeekClient: DeepSeekClientService,
        private parserService: GeminiParserService
    ) { }

    private getContentFromResponse(response: any): string {
        return response?.choices?.[0]?.message?.content || '';
    }

    // En modo thinking, deepseek-flash consume ~1000-2500 tokens en razonamiento interno antes de generar el JSON.
    // El JSON de risk-strategy tiene ~300-500 tokens de output. Total necesario: ~3000-4000 tokens.
    private readonly RISK_STRATEGY_MODEL = 'deepseek-flash'; // Usa deepseek-flash para evitar overhead de razonamiento

    private buildRiskStrategyPayload(promptText: string, isRetry = false): DeepSeekRequest {
        const retryInstruction = isRetry
            ? '\n\nIMPORTANTE: Tu respuesta anterior no fue un JSON válido. Devuelve ÚNICAMENTE el objeto JSON completo, iniciando con { y terminando con }, sin texto adicional.'
            : '';

        return {
            model: this.RISK_STRATEGY_MODEL,
            messages: [{ role: 'user', content: `${promptText}${retryInstruction}` }],
            temperature: isRetry ? 0.2 : 0.35,
            max_tokens: isRetry ? 3000 : 2500,
            response_format: { type: 'json_object' },
            thinking: { type: 'disabled' }
        };
    }

    private parseRiskStrategyResponse(response: any): any {
        const textContent = this.getContentFromResponse(response).trim();
        const finishReason = response?.choices?.[0]?.finish_reason || 'unknown';

        if (!textContent) {
            throw new Error(
                finishReason === 'length'
                    ? 'La IA agotó tokens antes de devolver el JSON completo.'
                    : 'La IA no devolvió contenido JSON en la respuesta.'
            );
        }

        // Si el JSON fue truncado por límite de tokens, intentar repararlo
        if (finishReason === 'length') {
            console.warn('[DeepSeek RiskStrategy] Respuesta truncada (finish_reason=length), intentando reparar JSON...');
        }

        return this.parserService.cleanAndParseJSON(textContent);
    }

    private retryRiskStrategy(promptText: string, attempt: number): Observable<any> {
        if (attempt > this.RISK_STRATEGY_MAX_RETRIES) {
            return of(null).pipe(
                map(() => {
                    throw new Error('La IA devolvió una respuesta incompleta o inválida al generar el riesgo.');
                })
            );
        }

        console.warn(`[DeepSeek RiskStrategy] Reintentando generación de JSON (${attempt}/${this.RISK_STRATEGY_MAX_RETRIES})`);

        return this.deepSeekClient.callDeepSeek(
            'generateRiskStrategy',
            this.buildRiskStrategyPayload(promptText, true)
        ).pipe(
            map(response => this.parseRiskStrategyResponse(response))
        );
    }

    public generateTestPlanSections(description: string, acceptanceCriteria: string): Observable<string> {
        const promptText = PROMPTS.SCOPE(description, acceptanceCriteria);
        const payload: DeepSeekRequest = {
            model: this.MODEL,
            messages: [{ role: 'user', content: promptText }],
            temperature: 0.3,
            max_tokens: 250,
            thinking: { type: 'disabled' }
        };

        console.log('[DeepSeek SCOPE] Enviando petición');
        return this.deepSeekClient.callDeepSeek('generateScope', payload).pipe(
            map(response => {
                const textContent = this.getContentFromResponse(response).trim();
                const limitedText = textContent.split('\n').slice(0, 4).join('\n');
                return limitedText;
            })
        );
    }

    public generateEnhancedStaticSectionContent(sectionName: string, existingContent: string, huSummary: string, huCount: number = 1): Observable<string> {
        const promptText = PROMPTS.STATIC_SECTION_ENHANCEMENT(sectionName, existingContent, huSummary, huCount);
        const payload: DeepSeekRequest = {
            // Usamos deepseek-flash: la sección estática es texto breve y en modo thinking
            // el razonamiento interno (reasoning_content) agotaba los max_tokens dejando
            // message.content = "" (finish_reason=length), lo que provocaba que la app
            // creyera que "ya estaba completa" y no actualizara el front.
            model: this.STREAM_MODEL,
            messages: [{ role: 'user', content: promptText }],
            temperature: 0.2,
            max_tokens: 2500,
            thinking: { type: 'disabled' }
        };

        return this.deepSeekClient.callDeepSeek('enhanceStaticSection', payload).pipe(
            map(response => {
                const content = this.getContentFromResponse(response).trim();
                if (!content) {
                    // No dejar pasar respuestas vacías como "sin cambios": informar el error real.
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

        return this.deepSeekClient.callDeepSeek(
            'generateRiskStrategy',
            this.buildRiskStrategyPayload(promptText)
        ).pipe(
            switchMap(response => {
                try {
                    return of(this.parseRiskStrategyResponse(response));
                } catch (error) {
                    console.warn('[DeepSeek RiskStrategy] Primera respuesta inválida, intentando una segunda vez...', error);
                    return this.retryRiskStrategy(promptText, 1);
                }
            })
        );
    }

    /**
     * Generación DIRECTA (sin CoT) - 1 sola llamada, respuestas concisas
     * Ideal para casos rápidos con 2-4 pasos máximo
     */
    public generateTestCasesDirect(
        description: string,
        acceptanceCriteria: string,
        technique: string
    ): Observable<any> {
        const promptText = PROMPTS.DIRECT_GENERATION_PROMPT(description, acceptanceCriteria, technique);
        const payload: DeepSeekRequest = {
            model: this.MODEL,
            messages: [{ role: 'user', content: promptText }],
            temperature: 0.5,
            max_tokens: 16000,
            thinking: { type: 'disabled' },
            response_format: { type: 'json_object' }
        };

        console.log('[DeepSeek Direct] 🚀 Generando casos (modo rápido)...');
        const startTime = Date.now();

        return this.deepSeekClient.callDeepSeek('generateTextCases', payload).pipe(
            map(response => {
                const textContent = this.getContentFromResponse(response).trim();
                const finishReason = response?.choices?.[0]?.finish_reason || 'unknown';
                if (!textContent) {
                    console.error(`[DeepSeek Direct] Contenido vacío (finish_reason=${finishReason})`);
                    throw {
                        userMessage: finishReason === 'length'
                            ? 'La IA agotó el presupuesto de tokens antes de generar los casos de prueba. Intenta con una HU más corta o vuelve a intentarlo.'
                            : 'La IA no devolvió contenido para los casos de prueba. Vuelve a intentarlo.',
                        technicalDetails: `content vacío (finish_reason=${finishReason})`
                    };
                }
                const finalJSON = this.parserService.cleanAndParseJSON(textContent);

                // Filtrar pasos nulos o vacíos en cada test case
                if (finalJSON && Array.isArray(finalJSON.testCases)) {
                    finalJSON.testCases = finalJSON.testCases.map((tc: any) => ({
                        ...tc,
                        steps: Array.isArray(tc.steps)
                            ? tc.steps.filter((step: any) => step && typeof step.accion === 'string' && step.accion.trim() !== '')
                            : []
                    }));
                }

                const totalTime = Date.now() - startTime;
                console.log(`[DeepSeek Direct] ✅ Completado en ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`);

                return finalJSON;
            })
        );
    }

    /**
     * Generación INTELIGENTE con continuación automática en caso de truncamiento.
     * Detecta si la respuesta fue truncada y hace una segunda llamada para completar.
     */
    public generateTestCasesSmart(
        description: string,
        acceptanceCriteria: string,
        technique: string
    ): Observable<any> {
        const promptText = PROMPTS.DIRECT_GENERATION_PROMPT(description, acceptanceCriteria, technique);
        const payload: DeepSeekRequest = {
            model: this.MODEL,
            messages: [{ role: 'user', content: promptText }],
            temperature: 0.5,
            max_tokens: 16000,
            thinking: { type: 'disabled' },
            response_format: { type: 'json_object' }
        };

        console.log('[DeepSeek Smart] 🚀 Generando casos con continuación automática...');
        const startTime = Date.now();

        return this.deepSeekClient.callDeepSeek('generateTextCases', payload).pipe(
            switchMap(response => {
                const textContent = this.getContentFromResponse(response).trim();
                const finishReason = response?.choices?.[0]?.finish_reason || 'unknown';
                if (!textContent) {
                    console.error(`[DeepSeek Smart] Contenido vacío en primera llamada (finish_reason=${finishReason})`);
                    return throwError(() => ({
                        userMessage: finishReason === 'length'
                            ? 'La IA agotó el presupuesto de tokens antes de generar los escenarios. Intenta con una HU más corta o vuelve a intentarlo.'
                            : 'La IA no devolvió contenido para los escenarios. Vuelve a intentarlo.',
                        technicalDetails: `content vacío (finish_reason=${finishReason})`
                    }));
                }
                const result: PartialParseResult = this.parserService.cleanAndParseJSONWithMeta(textContent);

                // Filtrar pasos nulos
                if (result.parsed && Array.isArray(result.parsed.testCases)) {
                    result.parsed.testCases = result.parsed.testCases.map((tc: any) => ({
                        ...tc,
                        steps: Array.isArray(tc.steps)
                            ? tc.steps.filter((step: any) => step && typeof step.accion === 'string' && step.accion.trim() !== '')
                            : []
                    }));
                }

                const totalTime = Date.now() - startTime;
                console.log(`[DeepSeek Smart] Primera llamada completada en ${totalTime}ms`);
                console.log(`[DeepSeek Smart] Test cases obtenidos: ${result.completedTestCaseCount}`);
                console.log(`[DeepSeek Smart] ¿Posiblemente truncado?: ${result.possiblyTruncated}`);

                // Si fue truncado y tenemos test cases parciales, hacer continuación
                if (result.possiblyTruncated && result.completedTestCaseCount > 0) {
                    console.log('[DeepSeek Smart] 🔄 Respuesta truncada detectada, iniciando continuación...');
                    return this.continueGeneration(
                        description, acceptanceCriteria, technique, result.parsed, 0
                    );
                }

                return of(result.parsed);
            })
        );
    }

    /**
     * Llama a la IA para generar los test cases faltantes tras un truncamiento
     */
    private continueGeneration(
        description: string,
        acceptanceCriteria: string,
        technique: string,
        accumulatedResult: any,
        continuationCount: number
    ): Observable<any> {
        if (continuationCount >= this.MAX_CONTINUATIONS) {
            console.warn(`[DeepSeek Smart] ⚠️ Máximo de continuaciones alcanzado (${this.MAX_CONTINUATIONS}). Devolviendo resultado parcial.`);
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

        const payload: DeepSeekRequest = {
            model: this.MODEL,
            messages: [{ role: 'user', content: promptText }],
            temperature: 0.3,
            max_tokens: 16000,
            thinking: { type: 'disabled' },
            response_format: { type: 'json_object' }
        };

        console.log(`[DeepSeek Smart] 🔄 Continuación ${continuationCount + 1}/${this.MAX_CONTINUATIONS}...`);

        return this.deepSeekClient.callDeepSeek('generateTextCases', payload).pipe(
            switchMap(response => {
                const textContent = this.getContentFromResponse(response).trim();
                const continuationResult = this.parserService.cleanAndParseJSONWithMeta(textContent);

                const newTestCases = continuationResult.parsed?.testCases || [];

                // Si no devolvió test cases nuevos, la cobertura está completa
                if (newTestCases.length === 0) {
                    console.log('[DeepSeek Smart] ✅ La IA indicó que no hay más test cases por generar');
                    return of(accumulatedResult);
                }

                // Filtrar pasos nulos de los nuevos test cases
                const cleanedNewCases = newTestCases.map((tc: any) => ({
                    ...tc,
                    steps: Array.isArray(tc.steps)
                        ? tc.steps.filter((step: any) => step && typeof step.accion === 'string' && step.accion.trim() !== '')
                        : []
                }));

                // Fusionar con los resultados acumulados
                accumulatedResult.testCases = [
                    ...accumulatedResult.testCases,
                    ...cleanedNewCases
                ];

                console.log(`[DeepSeek Smart] ✅ Continuación agregó ${cleanedNewCases.length} test cases. Total: ${accumulatedResult.testCases.length}`);

                // Si esta continuación también fue truncada, intentar otra
                if (continuationResult.possiblyTruncated && cleanedNewCases.length > 0) {
                    return this.continueGeneration(
                        description, acceptanceCriteria, technique, accumulatedResult, continuationCount + 1
                    );
                }

                return of(accumulatedResult);
            })
        );
    }

    /**
     * Refinamiento DIRECTO (sin CoT) - 1 sola llamada, respuestas concisas
     */
    public refineTestCasesDirect(
        originalHuInput: HUData['originalInput'],
        editedTestCases: DetailedTestCase[],
        newTechnique: string,
        userReanalysisContext: string
    ): Observable<any> {
        const currentCasesStr = JSON.stringify(editedTestCases, null, 2);
        const originalReqStr = `HU: ${originalHuInput.description}\nCA: ${originalHuInput.acceptanceCriteria}`;

        console.log('[DeepSeek Direct Refine] 📋 userReanalysisContext recibido:', JSON.stringify(userReanalysisContext));
        console.log('[DeepSeek Direct Refine] 📋 técnica:', newTechnique);
        console.log('[DeepSeek Direct Refine] 📋 casos actuales:', editedTestCases?.length ?? 0);

        const promptText = PROMPTS.DIRECT_REFINE_PROMPT(originalReqStr, currentCasesStr, userReanalysisContext, newTechnique);
        const payload: DeepSeekRequest = {
            model: this.MODEL,
            messages: [{ role: 'user', content: promptText }],
            temperature: 0.3,
            max_tokens: 16000,
            thinking: { type: 'disabled' },
            response_format: { type: 'json_object' }
        };

        console.log('[DeepSeek Direct Refine] 🚀 Refinando casos (modo rápido)...');
        const startTime = Date.now();

        return this.deepSeekClient.callDeepSeek('refineDetailedTestCases', payload).pipe(
            map(response => {
                const textContent = this.getContentFromResponse(response).trim();
                const finishReason = response?.choices?.[0]?.finish_reason || 'unknown';
                if (!textContent) {
                    console.error(`[DeepSeek Direct Refine] Contenido vacío (finish_reason=${finishReason})`);
                    throw {
                        userMessage: finishReason === 'length'
                            ? 'La IA agotó el presupuesto de tokens antes de completar el refinamiento. Intenta nuevamente.'
                            : 'La IA no devolvió contenido para el refinamiento. Vuelve a intentarlo.',
                        technicalDetails: `content vacío (finish_reason=${finishReason})`
                    };
                }
                const finalJSON = this.parserService.cleanAndParseJSON(textContent);

                const totalTime = Date.now() - startTime;
                console.log(`[DeepSeek Direct Refine] ✅ Completado en ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`);

                return finalJSON;
            })
        );
    }

    /**
     * Generación en modo STREAM — emite tokens en tiempo real.
     * Retorna Observable<StreamEvent> con reasoning y content acumulados.
     * El último evento tiene done=true y content contiene el JSON completo.
     */
    public generateTestCasesSmartStream(
        description: string,
        acceptanceCriteria: string,
        technique: string,
        userRequest: string = ''
    ): Observable<StreamEvent> {
        const promptText = PROMPTS.DIRECT_GENERATION_PROMPT(description, acceptanceCriteria, technique, userRequest);
        const payload: DeepSeekRequest = {
            model: this.STREAM_MODEL,
            messages: [{ role: 'user', content: promptText }],
            temperature: 0.5,
            max_tokens: this.STREAM_MAX_TOKENS,
            stream: true,
            thinking: { type: 'disabled' }
        };

        console.log('[DeepSeek Stream] 🚀 Iniciando generación con streaming...');
        return this.deepSeekClient.callDeepSeekStream('generateTextCases', payload);
    }

    /**
     * Refinamiento en modo STREAM — emite tokens en tiempo real.
     */
    public refineTestCasesDirectStream(
        originalHuInput: HUData['originalInput'],
        editedTestCases: DetailedTestCase[],
        newTechnique: string,
        userReanalysisContext: string
    ): Observable<StreamEvent> {
        const currentCasesStr = JSON.stringify(editedTestCases, null, 2);
        const originalReqStr = `HU: ${originalHuInput.description}\nCA: ${originalHuInput.acceptanceCriteria}`;

        const promptText = PROMPTS.DIRECT_REFINE_PROMPT(originalReqStr, currentCasesStr, userReanalysisContext, newTechnique);
        const payload: DeepSeekRequest = {
            model: this.STREAM_MODEL,
            messages: [{ role: 'user', content: promptText }],
            temperature: 0.3,
            max_tokens: this.STREAM_MAX_TOKENS,
            stream: true,
            thinking: { type: 'disabled' }
        };

        console.log('[DeepSeek Stream] 🔄 Iniciando refinamiento con streaming...');
        return this.deepSeekClient.callDeepSeekStream('refineDetailedTestCases', payload);
    }

}
