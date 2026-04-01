import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { PROMPTS } from '../../config/prompts.config';
import {
    DetailedTestCase,
    HUData
} from '../../models/hu-data.model';
import { DeepSeekClientService, DeepSeekRequest } from './deepseek-client.service';
import { GeminiParserService } from './gemini-parser.service'; // Reusamos el parser si es útil para limpiar JSON

@Injectable({
    providedIn: 'root'
})
export class DeepSeekService {

    private readonly MODEL = 'deepseek-chat';

    constructor(
        private deepSeekClient: DeepSeekClientService,
        private parserService: GeminiParserService // Reusamos utilidades de parseo JSON
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
            temperature: 0.5,
            max_tokens: 500
        };

        return this.deepSeekClient.callDeepSeek('enhanceStaticSection', payload).pipe(
            map(response => this.getContentFromResponse(response).trim())
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
            max_tokens: 2200
        };

        console.log('[DeepSeek Direct] 🚀 Generando casos (modo rápido)...');
        const startTime = Date.now();

        return this.deepSeekClient.callDeepSeek('generateTextCases', payload).pipe(
            map(response => {
                const textContent = this.getContentFromResponse(response).trim();
                const finalJSON = this.parserService.cleanAndParseJSON(textContent);

                const totalTime = Date.now() - startTime;
                console.log(`[DeepSeek Direct] ✅ Completado en ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`);

                return finalJSON;
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
            max_tokens: 2200
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
