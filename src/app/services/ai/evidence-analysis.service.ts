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
    
    // Enviar un único bloque de texto para asegurar que Gemini respete el contexto
    const parts: any[] = [
      { text: promptText }
    ];

    for (const file of evidences) {
      if (file.dataURL) {
        const matches = file.dataURL.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          parts.push({
            inline_data: {
              mime_type: matches[1],
              data: matches[2]
            }
          });
        }
      }
    }

    const payload = {
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.1 }
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

  public refineAnalysis(originalReport: any, instruction: string): Observable<any> {
    const reportForPrompt = JSON.parse(JSON.stringify(originalReport));
    reportForPrompt.user_provided_additional_context = instruction.trim();

    delete reportForPrompt.id;
    delete reportForPrompt.created_at;
    delete reportForPrompt.updated_at;
    delete reportForPrompt.user_id;

    const promptText = PROMPT_REFINE_FLOW_ANALYSIS_FROM_IMAGES_AND_CONTEXT(JSON.stringify(reportForPrompt, null, 2), instruction.trim());
    
    // 1. Obtener imágenes ordenadas por su orden original (fuente de verdad)
    const images = [...(originalReport.report_images || [])].sort((a, b) => (a.image_order || 0) - (b.image_order || 0));
    
    const fetchImages$ = new Observable<any[]>(observer => {
      const imagePromises = images.map(async (img: any) => {
        try {
          const res = await fetch(img.image_url);
          const blob = await res.blob();
          return new Promise<{mime_type: string, data: string}>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64 = (reader.result as string).split(',')[1];
              resolve({ mime_type: blob.type, data: base64 });
            };
            reader.readAsDataURL(blob);
          });
        } catch (e) { return null; }
      });
      Promise.all(imagePromises).then(data => {
        observer.next(data.filter(d => d !== null));
        observer.complete();
      });
    });

    return new Observable(observer => {
      fetchImages$.subscribe(inlineData => {
        // Enviar un único bloque de texto para que Gemini no se confunda con el contexto
        const parts: any[] = [
          { text: promptText }
        ];
        
        inlineData.forEach(d => parts.push({ inline_data: d }));

        const payload = {
          contents: [{ role: 'user', parts }],
          generationConfig: { 
            temperature: 0.1,
            topP: 0.95,
            topK: 40
          }
        };

        this.geminiClient.callGemini('generateTextCases', payload).subscribe({
          next: response => {
            let textContent = '';
            if (response.candidates && response.candidates[0]?.content?.parts) {
              textContent = response.candidates[0].content.parts.map((p: any) => p.text).join('');
            }
            try {
              observer.next(this.parseAndExtractJson(textContent));
              observer.complete();
            } catch (e) { observer.error(e); }
          },
          error: err => observer.error(err)
        });
      });
    });
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
