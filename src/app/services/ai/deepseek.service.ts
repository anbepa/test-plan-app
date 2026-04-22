import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { PROMPTS } from '../../config/prompts.config';
import {
    DetailedTestCase,
    HUData
} from '../../models/hu-data.model';
import { DeepSeekClientService, DeepSeekRequest } from './deepseek-client.service';
import { GeminiParserService, PartialParseResult } from './gemini-parser.service';

@Injectable({
    providedIn: 'root'
})
export class DeepSeekService {

    private readonly MODEL = 'deepseek-reasoner';
    private readonly MAX_CONTINUATIONS = 2; // Máximo de llamadas de continuación

    constructor(
        private deepSeekClient: DeepSeekClientService,
        private parserService: GeminiParserService
    ) { }

    private getContentFromResponse(response: any): string {
        return response?.choices?.[0]?.message?.content || '';
    }

    public generateTestPlanSections(description: string, acceptanceCriteria: string): Observable<string> {
        const promptText = PROMPTS.SCOPE(description, acceptanceCriteria);
        const payload: DeepSeekRequest = {
            model: this.MODEL,
            messages: [{ role: 'user', content: promptText }],
            temperature: 0.3,
            max_tokens: 250
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

    public generateEnhancedStaticSectionContent(sectionName: string, existingContent: string, huSummary: string): Observable<string> {
        const promptText = PROMPTS.STATIC_SECTION_ENHANCEMENT(sectionName, existingContent, huSummary);
        const payload: DeepSeekRequest = {
            model: this.MODEL,
            messages: [{ role: 'user', content: promptText }],
            temperature: 0.2,
            max_tokens: 180
        };

        return this.deepSeekClient.callDeepSeek('enhanceStaticSection', payload).pipe(
            map(response => this.getContentFromResponse(response).trim())
        );
    }

    public generateRiskStrategy(huSummary: string, availableScenarios: string[]): Observable<any> {
        const promptText = PROMPTS.RISK_STRATEGY_PROMPT(huSummary, availableScenarios);
        const payload: DeepSeekRequest = {
            model: this.MODEL,
            messages: [{ role: 'user', content: promptText }],
            temperature: 0.6,
            max_tokens: 900
        };

        return this.deepSeekClient.callDeepSeek('generateRiskStrategy', payload).pipe(
            map(response => {
                const textContent = this.getContentFromResponse(response).trim();
                return this.parserService.cleanAndParseJSON(textContent);
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
            temperature: 0.3,
            max_tokens: 16000
        };

        console.log('[DeepSeek Direct] 🚀 Generando casos (modo rápido)...');
        const startTime = Date.now();

        return this.deepSeekClient.callDeepSeek('generateTextCases', payload).pipe(
            map(response => {
                const textContent = this.getContentFromResponse(response).trim();
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
            temperature: 0.3,
            max_tokens: 16000
        };

        console.log('[DeepSeek Smart] 🚀 Generando casos con continuación automática...');
        const startTime = Date.now();

        return this.deepSeekClient.callDeepSeek('generateTextCases', payload).pipe(
            switchMap(response => {
                const textContent = this.getContentFromResponse(response).trim();
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

        const existingTitles = (accumulatedResult.testCases || []).map((tc: any) => tc.title);
        const promptText = PROMPTS.CONTINUATION_PROMPT(description, acceptanceCriteria, technique, existingTitles);

        const payload: DeepSeekRequest = {
            model: this.MODEL,
            messages: [{ role: 'user', content: promptText }],
            temperature: 0.3,
            max_tokens: 16000
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

        const promptText = PROMPTS.DIRECT_REFINE_PROMPT(originalReqStr, currentCasesStr, userReanalysisContext, newTechnique);
        const payload: DeepSeekRequest = {
            model: this.MODEL,
            messages: [{ role: 'user', content: promptText }],
            temperature: 0.3,
            max_tokens: 16000
        };

        console.log('[DeepSeek Direct Refine] 🚀 Refinando casos (modo rápido)...');
        const startTime = Date.now();

        return this.deepSeekClient.callDeepSeek('refineDetailedTestCases', payload).pipe(
            map(response => {
                const textContent = this.getContentFromResponse(response).trim();
                const finalJSON = this.parserService.cleanAndParseJSON(textContent);

                const totalTime = Date.now() - startTime;
                console.log(`[DeepSeek Direct Refine] ✅ Completado en ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`);

                return finalJSON;
            })
        );
    }

}
