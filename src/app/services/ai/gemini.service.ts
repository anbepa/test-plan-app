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
    return this.geminiClient.callGemini('generateScope', geminiPayload).pipe(
      map(response => {
        const textContent = this.geminiParser.getTextFromParts(response?.candidates?.[0]?.content?.parts).trim();
        const limitedText = textContent.split('\n').slice(0, 4).join('\n');
        return limitedText;
      })
    );
  }

  public generateEnhancedStaticSectionContent(sectionName: string, existingContent: string, huSummary: string, huCount: number = 1): Observable<string> {
    const promptText: string = PROMPTS.STATIC_SECTION_ENHANCEMENT(sectionName, existingContent, huSummary, huCount);
    const geminiPayload: any = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: { maxOutputTokens: 700, temperature: 0.2 }
    };
    return this.geminiClient.callGemini('enhanceStaticSection', geminiPayload).pipe(
      map(response => this.geminiParser.getTextFromParts(response?.candidates?.[0]?.content?.parts).trim())
    );
  }

  public generateRiskStrategy(huSummary: string, availableScenarios: string[], huCount: number = 1, previousRisks: string[] = []): Observable<any> {
    const promptText = PROMPTS.RISK_STRATEGY_PROMPT(huSummary, availableScenarios, previousRisks, huCount);
    const payload: any = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: {
        maxOutputTokens: 4000,
        temperature: 0.35,
        responseMimeType: 'application/json'
      }
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

        // Si fue truncado y tenemos test cases parciales, hacer continuación
        if (result.possiblyTruncated && result.completedTestCaseCount > 0) {
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


    return this.geminiClient.callGemini('generateTextCases', payload).pipe(
      switchMap(response => {
        const textContent = this.geminiParser.getTextFromParts(response?.candidates?.[0]?.content?.parts).trim();
        const continuationResult = this.geminiParser.cleanAndParseJSONWithMeta(textContent);

        const newTestCases = continuationResult.parsed?.testCases || [];

        // Si no devolvió test cases nuevos, la cobertura está completa
        if (newTestCases.length === 0) {
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


    const promptText = PROMPTS.DIRECT_REFINE_PROMPT(originalReqStr, currentCasesStr, userReanalysisContext, newTechnique, originalHuInput.codeContext, originalHuInput.contextSource);
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
