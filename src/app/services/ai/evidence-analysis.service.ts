import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { GeminiClientService } from './gemini-client.service';
import { PROMPT_FLOW_ANALYSIS_FROM_IMAGES, PROMPT_REFINE_FLOW_ANALYSIS_FROM_IMAGES_AND_CONTEXT } from './evidence-prompts.config';

export interface EvidenceFile {
  name: string;
  dataURL: string;
  type: string;
  isVideo: boolean;
  size?: number;
}

@Injectable({
  providedIn: 'root'
})
export class EvidenceAnalysisService {
  constructor(private geminiClient: GeminiClientService) { }

  public analyzeEvidences(context: string, evidences: EvidenceFile[]): Observable<any> {
    const promptText = PROMPT_FLOW_ANALYSIS_FROM_IMAGES(context);
    const contents = [{
      role: 'user',
      parts: [
        { text: promptText }
      ] as any[]
    }];

    for (const file of evidences) {
      if (file.dataURL) {
        const matches = file.dataURL.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          contents[0].parts.push({
            inline_data: {
              mime_type: matches[1],
              data: matches[2]
            }
          });
        }
      }
    }

    const payload = {
      contents,
      generationConfig: {
        temperature: 0.2,
      }
    };

    return this.geminiClient.callGemini('generateTextCases', payload).pipe(
      map(response => {
        let textContent = '';
        if (response.candidates && response.candidates[0]?.content?.parts) {
          textContent = response.candidates[0].content.parts.map((p: any) => p.text).join('');
        }
        
        let cleanedJsonText = textContent;
        const jsonBlockMatch = textContent.match(/```json\s*([\s\S]*?)\s*```/);

        if (jsonBlockMatch) {
            cleanedJsonText = jsonBlockMatch[1];
        } else {
            const firstBracket = textContent.indexOf('[');
            const firstBrace = textContent.indexOf('{');
            const lastBracket = textContent.lastIndexOf(']');
            const lastBrace = textContent.lastIndexOf('}');

            const start = (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) ? firstBracket : firstBrace;
            const end = (lastBracket !== -1 && (lastBrace === -1 || lastBracket > lastBrace)) ? lastBracket : lastBrace;

            if (start !== -1 && end !== -1 && end > start) {
                cleanedJsonText = textContent.substring(start, end + 1);
            }
        }

        try {
            return JSON.parse(cleanedJsonText);
        } catch (e) {
            throw new Error("La respuesta de la IA no contiene un JSON válido.");
        }
      })
    );
  }

  public refineAnalysis(originalReport: any, instruction: string): Observable<any> {
    // Clonar el reporte para no modificar el original en el estado local
    const reportForPrompt = JSON.parse(JSON.stringify(originalReport));
    
    // Incluir la instrucción del usuario dentro del JSON como campo específico
    // Tal cual lo hace el proyecto de referencia
    reportForPrompt.user_provided_additional_context = instruction.trim();

    // Eliminar campos que no necesitamos enviar a la IA (como blob URLs o metadatos internos)
    delete reportForPrompt.id;
    delete reportForPrompt.created_at;
    delete reportForPrompt.updated_at;
    delete reportForPrompt.user_id;

    const promptText = PROMPT_REFINE_FLOW_ANALYSIS_FROM_IMAGES_AND_CONTEXT(JSON.stringify(reportForPrompt, null, 2));
    const payload = {
      contents: [{
        role: 'user',
        parts: [{ text: promptText }]
      }],
      generationConfig: { 
        temperature: 0.1,
        topP: 0.95,
        topK: 40
      }
    };

    return this.geminiClient.callGemini('generateTextCases', payload).pipe(
      map(response => {
        let textContent = '';
        if (response.candidates && response.candidates[0]?.content?.parts) {
          textContent = response.candidates[0].content.parts.map((p: any) => p.text).join('');
        }
        return this.parseAndExtractJson(textContent);
      })
    );
  }

  private parseAndExtractJson(textContent: string): any {
    let cleanedJsonText = textContent;
    const jsonBlockMatch = textContent.match(/```json\s*([\s\S]*?)\s*```/);

    if (jsonBlockMatch) {
      cleanedJsonText = jsonBlockMatch[1];
    } else {
      const firstBrace = textContent.indexOf('{');
      const lastBrace = textContent.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleanedJsonText = textContent.substring(firstBrace, lastBrace + 1);
      }
    }

    try {
      return JSON.parse(cleanedJsonText);
    } catch (e) {
      throw new Error("La respuesta de la IA no contiene un JSON válido.");
    }
  }
}
