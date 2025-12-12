import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { PROMPTS } from '../../config/prompts.config';
import {
  DetailedTestCase,
  TestCaseStep,
  HUData
} from '../../models/hu-data.model';
import { GeminiClientService } from './gemini-client.service';
import { GeminiParserService } from './gemini-parser.service';

@Injectable({
  providedIn: 'root'
})
export class GeminiService {

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
      generationConfig: { maxOutputTokens: 500, temperature: 0.5 }
    };
    return this.geminiClient.callGemini('enhanceStaticSection', geminiPayload).pipe(
      map(response => this.geminiParser.getTextFromParts(response?.candidates?.[0]?.content?.parts).trim())
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
      generationConfig: { maxOutputTokens: 2000, temperature: 0.5 }
    };

    return this.geminiClient.callGemini('generateTextCases', payload).pipe(
      map(response => {
        const textContent = this.geminiParser.getTextFromParts(response?.candidates?.[0]?.content?.parts).trim();
        return this.geminiParser.cleanAndParseJSON(textContent);
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

    const promptText = PROMPTS.DIRECT_REFINE_PROMPT(originalReqStr, currentCasesStr, userReanalysisContext, newTechnique);
    const payload: any = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: { maxOutputTokens: 2000, temperature: 0.5 }
    };

    return this.geminiClient.callGemini('refineDetailedTestCases', payload).pipe(
      map(response => {
        const textContent = this.geminiParser.getTextFromParts(response?.candidates?.[0]?.content?.parts).trim();
        return this.geminiParser.cleanAndParseJSON(textContent);
      })
    );
  }
}
