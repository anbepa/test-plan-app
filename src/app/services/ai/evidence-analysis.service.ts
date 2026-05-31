import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { GeminiClientService } from './gemini-client.service';
import { PROMPT_FLOW_ANALYSIS_FROM_IMAGES, PROMPT_REFINE_FLOW_ANALYSIS_FROM_IMAGES_AND_CONTEXT } from './evidence-prompts.config';
import * as XLSX from 'xlsx';

export interface EvidenceFile {
  name: string;
  dataURL: string;
  type: string;
  isVideo: boolean;
  size?: number;
  publicUrl?: string; // URL opcional si ya está subida a Supabase
}

@Injectable({
  providedIn: 'root'
})
export class EvidenceAnalysisService {
  constructor(private geminiClient: GeminiClientService) { }

  private async convertSpreadsheetToText(file: EvidenceFile): Promise<string> {
    if (!file.dataURL) {
      if (file.publicUrl) {
        try {
          const res = await fetch(file.publicUrl);
          const arrayBuffer = await res.arrayBuffer();
          return this.parseArrayBufferToText(arrayBuffer, file.name);
        } catch (e: any) {
          console.error('Error fetching publicUrl to convert to text:', e);
          return `[Error al leer el archivo ${file.name}: ${e.message || e}]`;
        }
      }
      return '';
    }

    try {
      const matches = file.dataURL.match(/^data:([^;]+);base64,(.+)$/);
      const base64Data = matches ? matches[2] : file.dataURL;
      const binaryString = atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return this.parseArrayBufferToText(bytes.buffer, file.name);
    } catch (e: any) {
      console.error('Error decodificando base64 a text:', e);
      return `[Error al decodificar el archivo ${file.name}]`;
    }
  }

  private parseArrayBufferToText(arrayBuffer: ArrayBuffer, fileName: string): string {
    const isCSV = fileName.toLowerCase().endsWith('.csv');
    try {
      if (isCSV) {
        let text: string;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(arrayBuffer);
        } catch (e) {
          text = new TextDecoder('windows-1252').decode(arrayBuffer);
        }
        return `Nombre del archivo: ${fileName}\nContenido CSV:\n${text}`;
      } else {
        const data = new Uint8Array(arrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        let resultText = `Nombre del archivo: ${fileName}\n`;
        
        workbook.SheetNames.forEach(sheetName => {
          const worksheet = workbook.Sheets[sheetName];
          const csvText = XLSX.utils.sheet_to_csv(worksheet);
          resultText += `--- Hoja: ${sheetName} ---\n${csvText}\n`;
        });
        return resultText;
      }
    } catch (error: any) {
      console.error('Error parseando planilla a texto:', error);
      return `[Error al interpretar la planilla ${fileName}: ${error.message || error}]`;
    }
  }

  private async prepareParts(context: string, evidences: EvidenceFile[]): Promise<any[]> {
    const promptText = PROMPT_FLOW_ANALYSIS_FROM_IMAGES(context);
    const parts: any[] = [
      { text: promptText }
    ];

    for (let i = 0; i < evidences.length; i++) {
      const file = evidences[i];
      const isCSV = file.type?.includes('csv') || file.name?.toLowerCase().endsWith('.csv');
      const isXLSX = file.type?.includes('sheet') || file.type?.includes('excel') || file.name?.toLowerCase().endsWith('.xlsx');

      parts.push({
        text: `\n\n--- INICIO EVIDENCIA ${i + 1} (${file.name}) ---\n`
      });

      if (isCSV || isXLSX) {
        const textContent = await this.convertSpreadsheetToText(file);
        parts.push({
          text: `[Evidencia de datos adjunta]\n${textContent}\n`
        });
      } else {
        if (file.publicUrl) {
          parts.push({
            image_url: file.publicUrl
          });
        } else if (file.dataURL) {
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
    }

    return parts;
  }

  public analyzeEvidences(context: string, evidences: EvidenceFile[]): Observable<any> {
    return new Observable(observer => {
      this.prepareParts(context, evidences).then(parts => {
        const payload: any = {
          contents: [{ role: 'user', parts }],
          generationConfig: { temperature: 0.1 }
        };

        if (context.trim()) {
          payload.system_instruction = {
            parts: [{ text: `🛑🛑🛑 INSTRUCCIÓN DE PRIORIDAD MÁXIMA DEL USUARIO 🛑🛑🛑\nEl usuario ha especificado las siguientes instrucciones OBLIGATORIAS que debes aplicar a todo tu análisis:\n"${context.trim()}"\nSi hay alguna contradicción entre estas instrucciones y lo que observas en las evidencias, PREVALECEN LAS INSTRUCCIONES DEL USUARIO.` }]
          };
        }

        this.geminiClient.callGemini('generateTextCases', payload).subscribe({
          next: response => {
            let textContent = '';
            if (response.candidates && response.candidates[0]?.content?.parts) {
              textContent = response.candidates[0].content.parts.map((p: any) => p.text).join('');
            }
            try {
              observer.next(this.parseAndExtractJson(textContent));
              observer.complete();
            } catch (e) {
              observer.error(e);
            }
          },
          error: err => observer.error(err)
        });
      }).catch(err => observer.error(err));
    });
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
      const hasDoc = images.some(img => 
        img.file_type?.includes('csv') || 
        img.file_type?.includes('sheet') || 
        img.file_type?.includes('excel') ||
        img.file_name?.toLowerCase().endsWith('.csv') ||
        img.file_name?.toLowerCase().endsWith('.xlsx')
      );

      if (!hasDoc && images.length > 0 && images.every(img => img.image_url)) {
        observer.next(images.map(img => ({ image_url: img.image_url })));
        observer.complete();
        return;
      }

      const imagePromises = images.map(async (img: any) => {
        try {
          const res = await fetch(img.image_url);
          const arrayBuffer = await res.arrayBuffer();

          const isCSV = img.file_type?.includes('csv') || img.file_name?.toLowerCase().endsWith('.csv');
          const isXLSX = img.file_type?.includes('sheet') || img.file_type?.includes('excel') || img.file_name?.toLowerCase().endsWith('.xlsx');

          if (isCSV || isXLSX) {
            const docText = this.parseArrayBufferToText(arrayBuffer, img.file_name || 'documento');
            return {
              isDoc: true,
              docText: docText,
              mime_type: img.file_type,
              data: ''
            };
          } else {
            return new Promise<any>((resolve) => {
              const blob = new Blob([arrayBuffer], { type: img.file_type || 'image/jpeg' });
              const reader = new FileReader();
              reader.onloadend = () => {
                const base64 = (reader.result as string).split(',')[1];
                resolve({ mime_type: blob.type, data: base64 });
              };
              reader.readAsDataURL(blob);
            });
          }
        } catch (e) { 
          console.error('Error fetching image for refinement:', e);
          return null; 
        }
      });

      Promise.all(imagePromises).then(data => {
        observer.next(data.filter(d => d !== null));
        observer.complete();
      });
    });

    return new Observable(observer => {
      fetchImages$.subscribe(imageData => {
        // Estructura de partes para maximizar la atención en la instrucción
        const parts: any[] = [
          { text: promptText }
        ];

        imageData.forEach((d, i) => {
          parts.push({
            text: `\n\n--- INICIO EVIDENCIA ${i + 1} ---\n`
          });
          if (d.isDoc) {
            parts.push({ text: `[Evidencia de datos adjunta]\n${d.docText}\n` });
          } else {
            if (d.image_url) {
              parts.push({ image_url: d.image_url });
            } else {
              parts.push({ inline_data: d });
            }
          }
        });

        const payload: any = {
          contents: [{ role: 'user', parts }],
          generationConfig: {
            temperature: 0.1,
            topP: 0.95,
            topK: 40
          }
        };

        if (instruction.trim()) {
          payload.system_instruction = {
            parts: [{ text: `🛑🛑🛑 INSTRUCCIÓN DE REFINAMIENTO (PRIORIDAD ABSOLUTA) 🛑🛑🛑\nEl usuario exige que modifiques el reporte estrictamente de acuerdo a esta instrucción:\n"${instruction.trim()}"\nNingún resultado anterior ni evidencia visual debe sobreponerse a esta orden.` }]
          };
        }

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
