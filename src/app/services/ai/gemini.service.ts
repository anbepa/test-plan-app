import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { PROMPTS } from '../../config/prompts.config';
import {
  DetailedTestCase,
  TestCaseStep,
  HUData
} from '../../models/hu-data.model';
import { GeminiClientService } from './gemini-client.service';
import { GeminiParserService, PartialParseResult } from './gemini-parser.service';

@Injectable({
  providedIn: 'root'
})
export class GeminiService {

  private readonly MAX_CONTINUATIONS = 2;

  constructor(
    private geminiClient: GeminiClientService,
    private geminiParser: GeminiParserService
  ) { }

  public generateTestPlanSections(description: string, acceptanceCriteria: string): Observable<string> {
    const promptText = PROMPTS.SCOPE(description, acceptanceCriteria);
    const geminiPayload = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: { maxOutputTokens: 250, temperature: 0.3 }
    };
    console.log('[SCOPE] Enviando petición de alcance');
    return this.geminiClient.callGemini('generateScope', geminiPayload).pipe(
      map(response => {
        console.log('[SCOPE] Respuesta recibida:', response);
        const textContent = this.geminiParser.getTextFromParts(response?.candidates?.[0]?.content?.parts).trim();
        console.log('[SCOPE] Texto extraído:', textContent);
        const limitedText = textContent.split('\n').slice(0, 4).join('\n');
        console.log('[SCOPE] Texto limitado:', limitedText);
        return limitedText;
      })
    );
  }

  public generateEnhancedStaticSectionContent(sectionName: string, existingContent: string, huSummary: string): Observable<string> {
    const promptText: string = PROMPTS.STATIC_SECTION_ENHANCEMENT(sectionName, existingContent, huSummary);
    const geminiPayload: any = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: { maxOutputTokens: 180, temperature: 0.2 }
    };
    return this.geminiClient.callGemini('enhanceStaticSection', geminiPayload).pipe(
      map(response => this.geminiParser.getTextFromParts(response?.candidates?.[0]?.content?.parts).trim())
    );
  }

  public generateRiskStrategy(huSummary: string, availableScenarios: string[]): Observable<any> {
    const promptText = PROMPTS.RISK_STRATEGY_PROMPT(huSummary, availableScenarios);
    const payload: any = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: { maxOutputTokens: 900, temperature: 0.6 }
    };

    return this.geminiClient.callGemini('generateRiskStrategy', payload).pipe(
      map(response => {
        const textContent = this.geminiParser.getTextFromParts(response?.candidates?.[0]?.content?.parts).trim();
        return this.geminiParser.cleanAndParseJSON(textContent);
      })
    );
  }

  /**
   * Generación directa de casos de prueba (sin CoT)
   */
  public generateTestCasesDirect(
    description: string,
    acceptanceCriteria: string,
    technique: string
  ): Observable<any> {
    const promptText = PROMPTS.DIRECT_GENERATION_PROMPT(description, acceptanceCriteria, technique);
    const payload: any = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: { maxOutputTokens: 8192, temperature: 0.5 }
    };

    return this.geminiClient.callGemini('generateTextCases', payload).pipe(
      map(response => {
        const textContent = this.geminiParser.getTextFromParts(response?.candidates?.[0]?.content?.parts).trim();
        return this.geminiParser.cleanAndParseJSON(textContent);
      })
    );
  }

  /**
   * Generación INTELIGENTE con continuación automática en caso de truncamiento.
   */
  public generateTestCasesSmart(
    description: string,
    acceptanceCriteria: string,
    technique: string
  ): Observable<any> {
    const promptText = PROMPTS.DIRECT_GENERATION_PROMPT(description, acceptanceCriteria, technique);
    const payload: any = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: { maxOutputTokens: 8192, temperature: 0.5 }
    };

    console.log('[Gemini Smart] 🚀 Generando casos con continuación automática...');
    const startTime = Date.now();

    return this.geminiClient.callGemini('generateTextCases', payload).pipe(
      switchMap(response => {
        const textContent = this.geminiParser.getTextFromParts(response?.candidates?.[0]?.content?.parts).trim();
        const result: PartialParseResult = this.geminiParser.cleanAndParseJSONWithMeta(textContent);

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
        console.log(`[Gemini Smart] Primera llamada completada en ${totalTime}ms`);
        console.log(`[Gemini Smart] Test cases obtenidos: ${result.completedTestCaseCount}`);
        console.log(`[Gemini Smart] ¿Posiblemente truncado?: ${result.possiblyTruncated}`);

        // Si fue truncado y tenemos test cases parciales, hacer continuación
        if (result.possiblyTruncated && result.completedTestCaseCount > 0) {
          console.log('[Gemini Smart] 🔄 Respuesta truncada detectada, iniciando continuación...');
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
      console.warn(`[Gemini Smart] ⚠️ Máximo de continuaciones alcanzado (${this.MAX_CONTINUATIONS}). Devolviendo resultado parcial.`);
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

    const payload: any = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: { maxOutputTokens: 8192, temperature: 0.3 }
    };

    console.log(`[Gemini Smart] 🔄 Continuación ${continuationCount + 1}/${this.MAX_CONTINUATIONS}...`);

    return this.geminiClient.callGemini('generateTextCases', payload).pipe(
      switchMap(response => {
        const textContent = this.geminiParser.getTextFromParts(response?.candidates?.[0]?.content?.parts).trim();
        const continuationResult = this.geminiParser.cleanAndParseJSONWithMeta(textContent);

        const newTestCases = continuationResult.parsed?.testCases || [];

        // Si no devolvió test cases nuevos, la cobertura está completa
        if (newTestCases.length === 0) {
          console.log('[Gemini Smart] ✅ La IA indicó que no hay más test cases por generar');
          return of(accumulatedResult);
        }

        // Filtrar pasos nulos
        const cleanedNewCases = newTestCases.map((tc: any) => ({
          ...tc,
          steps: Array.isArray(tc.steps)
            ? tc.steps.filter((step: any) => step && typeof step.accion === 'string' && step.accion.trim() !== '')
            : []
        }));

        // Fusionar
        accumulatedResult.testCases = [
          ...accumulatedResult.testCases,
          ...cleanedNewCases
        ];

        console.log(`[Gemini Smart] ✅ Continuación agregó ${cleanedNewCases.length} test cases. Total: ${accumulatedResult.testCases.length}`);

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
   * Refinamiento directo de casos de prueba (sin CoT)
   */
  public refineTestCasesDirect(
    originalHuInput: HUData['originalInput'],
    editedTestCases: DetailedTestCase[],
    newTechnique: string,
    userReanalysisContext: string
  ): Observable<any> {
    const currentCasesStr = JSON.stringify(editedTestCases, null, 2);
    const originalReqStr = `HU: ${originalHuInput.description}\nCA: ${originalHuInput.acceptanceCriteria}`;

    console.log('[Gemini Direct Refine] 📋 userReanalysisContext recibido:', JSON.stringify(userReanalysisContext));
    console.log('[Gemini Direct Refine] 📋 técnica:', newTechnique);
    console.log('[Gemini Direct Refine] 📋 casos actuales:', editedTestCases?.length ?? 0);

    const promptText = PROMPTS.DIRECT_REFINE_PROMPT(originalReqStr, currentCasesStr, userReanalysisContext, newTechnique);
    const payload: any = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: { maxOutputTokens: 8192, temperature: 0.3 }
    };

    return this.geminiClient.callGemini('refineDetailedTestCases', payload).pipe(
      map(response => {
        const textContent = this.geminiParser.getTextFromParts(response?.candidates?.[0]?.content?.parts).trim();
        return this.geminiParser.cleanAndParseJSON(textContent);
      })
    );
  }
}
