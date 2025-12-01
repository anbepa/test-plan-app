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

export interface CoTStepResult {
  step: 'ARCHITECT' | 'GENERATOR' | 'AUDITOR';
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  data?: any;
  message?: string;
}

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
   * Generación de Casos de Prueba con Chain of Thought (3 Fases)
   */
  public generateTestCasesCoT(
    description: string,
    acceptanceCriteria: string,
    technique: string,
    additionalContext?: string
  ): Observable<CoTStepResult> {
    const timestamp = new Date().toISOString();
    const contextWithTimestamp = `${additionalContext || ''}\n\n[Generación solicitada en: ${timestamp}]`.trim();

    return new Observable<CoTStepResult>(observer => {
      (async () => {
        try {
          // --- FASE 1: EL ARQUITECTO ---
          observer.next({ step: 'ARCHITECT', status: 'in_progress', message: 'El Arquitecto está analizando la estrategia...' });

          const architectPrompt = PROMPTS.ARCHITECT_PROMPT(description, acceptanceCriteria, technique, contextWithTimestamp);

          // DEBUG: Loguear el prompt completo
          console.log('[DEBUG] Description:', description);
          console.log('[DEBUG] Acceptance Criteria:', acceptanceCriteria);
          console.log('[DEBUG] Technique:', technique);
          console.log('[DEBUG] Architect Prompt (primeros 1000 chars):', architectPrompt.substring(0, 1000));

          const architectPayload = {
            contents: [{ parts: [{ text: architectPrompt }] }],
            generationConfig: {
              maxOutputTokens: 2000,
              temperature: 0.5,
              responseMimeType: 'application/json'
            }
          };

          const architectResponse = await this.geminiClient.callGemini('generateTextCases', architectPayload).toPromise();
          const architectText = this.geminiParser.getTextFromParts(architectResponse?.candidates?.[0]?.content?.parts).trim();
          const architectJSON = this.geminiParser.cleanAndParseJSON(architectText);

          observer.next({ step: 'ARCHITECT', status: 'completed', data: architectJSON, message: 'Estrategia definida.' });

          // Espera de 5 segundos
          await new Promise(resolve => setTimeout(resolve, 5000));

          // --- FASE 2: EL GENERADOR ---
          observer.next({ step: 'GENERATOR', status: 'in_progress', message: 'El Generador está escribiendo los casos de prueba...' });

          const generatorPrompt = PROMPTS.GENERATOR_COT_PROMPT(JSON.stringify(architectJSON), technique);
          const generatorPayload = {
            contents: [{ parts: [{ text: generatorPrompt }] }],
            generationConfig: {
              maxOutputTokens: 16384,
              temperature: 0.7,
              responseMimeType: 'application/json'
            }
          };

          const generatorResponse = await this.geminiClient.callGemini('generateTextCases', generatorPayload).toPromise();
          const generatorText = this.geminiParser.getTextFromParts(generatorResponse?.candidates?.[0]?.content?.parts).trim();
          // No parseamos todavía, pasamos el texto crudo al Auditor para que él valide

          observer.next({ step: 'GENERATOR', status: 'completed', data: { rawText: generatorText }, message: 'Casos generados preliminarmente.' });

          // Espera de 5 segundos
          await new Promise(resolve => setTimeout(resolve, 5000));

          // --- FASE 3: EL AUDITOR ---
          observer.next({ step: 'AUDITOR', status: 'in_progress', message: 'El Auditor está revisando y puliendo los casos...' });

          const auditorPrompt = PROMPTS.AUDITOR_PROMPT(
            `HU: ${description}\nCA: ${acceptanceCriteria}`,
            JSON.stringify(architectJSON),
            generatorText
          );
          const auditorPayload = {
            contents: [{ parts: [{ text: auditorPrompt }] }],
            generationConfig: {
              maxOutputTokens: 16384,
              temperature: 0.3,
              responseMimeType: 'application/json'
            }
          };

          const auditorResponse = await this.geminiClient.callGemini('generateTextCases', auditorPayload).toPromise();
          const auditorText = this.geminiParser.getTextFromParts(auditorResponse?.candidates?.[0]?.content?.parts).trim();
          const finalJSON = this.geminiParser.cleanAndParseJSON(auditorText);

          // IMPORTANTE: Preservar el alcance detallado definido por el Arquitecto
          // El Generador/Auditor a veces lo simplifican demasiado (ej: "Alcance completo")
          if (architectJSON && architectJSON.scope_definition) {
            console.log('[CoT] Restaurando definición de alcance del Arquitecto');
            finalJSON.scope = architectJSON.scope_definition;
          }

          observer.next({ step: 'AUDITOR', status: 'completed', data: finalJSON, message: 'Proceso finalizado con éxito.' });
          observer.complete();

        } catch (error: any) {
          console.error('[CoT Error]', error);
          observer.error(error);
        }
      })();
    });
  }

  /**
   * Refinamiento de Casos de Prueba con Chain of Thought (3 Fases)
   */
  public refineTestCasesCoT(
    originalHuInput: HUData['originalInput'],
    editedTestCases: DetailedTestCase[],
    newTechnique: string,
    userReanalysisContext: string
  ): Observable<CoTStepResult> {
    return new Observable<CoTStepResult>(observer => {
      (async () => {
        try {
          const currentCasesStr = JSON.stringify(editedTestCases, null, 2);
          const originalReqStr = `Historia de Usuario: ${originalHuInput.description}\nCriterios de Aceptación: ${originalHuInput.acceptanceCriteria}`;

          // --- FASE 1: ARQUITECTO DE REFINAMIENTO ---
          observer.next({ step: 'ARCHITECT', status: 'in_progress', message: 'Analizando solicitud de cambios...' });

          const architectPrompt = PROMPTS.REFINE_ARCHITECT_PROMPT(originalReqStr, currentCasesStr, userReanalysisContext, newTechnique);
          const architectPayload = {
            contents: [{ parts: [{ text: architectPrompt }] }],
            generationConfig: {
              maxOutputTokens: 2000,
              temperature: 0.5,
              responseMimeType: 'application/json'
            }
          };

          const architectResponse = await this.geminiClient.callGemini('refineDetailedTestCases', architectPayload).toPromise();
          const architectText = this.geminiParser.getTextFromParts(architectResponse?.candidates?.[0]?.content?.parts).trim();
          const architectJSON = this.geminiParser.cleanAndParseJSON(architectText);

          observer.next({ step: 'ARCHITECT', status: 'completed', data: architectJSON, message: 'Directivas de cambio definidas.' });

          await new Promise(resolve => setTimeout(resolve, 5000));

          // --- FASE 2: GENERADOR DE REFINAMIENTO ---
          observer.next({ step: 'GENERATOR', status: 'in_progress', message: 'Aplicando cambios a los casos de prueba...' });

          const generatorPrompt = PROMPTS.REFINE_GENERATOR_PROMPT(originalReqStr, JSON.stringify(architectJSON), currentCasesStr);
          const generatorPayload = {
            contents: [{ parts: [{ text: generatorPrompt }] }],
            generationConfig: {
              maxOutputTokens: 16384,
              temperature: 0.7,
              responseMimeType: 'application/json'
            }
          };

          const generatorResponse = await this.geminiClient.callGemini('refineDetailedTestCases', generatorPayload).toPromise();
          const generatorText = this.geminiParser.getTextFromParts(generatorResponse?.candidates?.[0]?.content?.parts).trim();

          observer.next({ step: 'GENERATOR', status: 'completed', data: { rawText: generatorText }, message: 'Cambios aplicados.' });

          await new Promise(resolve => setTimeout(resolve, 5000));

          // --- FASE 3: AUDITOR DE REFINAMIENTO ---
          observer.next({ step: 'AUDITOR', status: 'in_progress', message: 'Verificando cumplimiento de la solicitud...' });

          const auditorPrompt = PROMPTS.REFINE_AUDITOR_PROMPT(originalReqStr, userReanalysisContext, generatorText);
          const auditorPayload = {
            contents: [{ parts: [{ text: auditorPrompt }] }],
            generationConfig: {
              maxOutputTokens: 16384,
              temperature: 0.3,
              responseMimeType: 'application/json'
            }
          };

          const auditorResponse = await this.geminiClient.callGemini('refineDetailedTestCases', auditorPayload).toPromise();
          const auditorText = this.geminiParser.getTextFromParts(auditorResponse?.candidates?.[0]?.content?.parts).trim();
          const finalJSON = this.geminiParser.cleanAndParseJSON(auditorText);

          observer.next({ step: 'AUDITOR', status: 'completed', data: finalJSON, message: 'Refinamiento verificado.' });
          observer.complete();

        } catch (error: any) {
          console.error('[CoT Refinement Error]', error);
          observer.error(error);
        }
      })();
    });
  }
}
