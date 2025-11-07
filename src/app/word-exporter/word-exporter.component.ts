import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, UnderlineType, TabStopPosition, TabStopType } from 'docx';
import { saveAs } from 'file-saver';
import { ToastService } from '../services/toast.service';
import { HUData } from '../models/hu-data.model';

@Component({
  selector: 'app-word-exporter',
  imports: [CommonModule],
  templateUrl: './word-exporter.component.html',
  styleUrl: './word-exporter.component.css'
})
export class WordExporterComponent {
  @Input() testPlanTitle: string = '';
  @Input() repositoryLink: string = '';
  @Input() outOfScopeContent: string = '';
  @Input() strategyContent: string = '';
  @Input() limitationsContent: string = '';
  @Input() assumptionsContent: string = '';
  @Input() teamContent: string = '';
  @Input() huList: HUData[] = [];

  isExporting: boolean = false;
  private toastService = inject(ToastService);

  // Función helper para convertir pulgadas a twips (unidad de Word)
  private convertInchesToTwip(inches: number): number {
    return Math.round(inches * 1440);
  }

  // Función helper para sangría APA estándar (0.25 pulgadas)
  private getAPAIndent(): number {
    return this.convertInchesToTwip(0.25);
  }

  async exportToWord(): Promise<void> {
    if (!this.testPlanTitle || this.huList.length === 0) {
      this.toastService.warning('No hay información completa para generar el documento');
      return;
    }

    try {
      this.isExporting = true;

      // Generar contenido usando la misma lógica que updatePreview() del test-plan-viewer
      const docContent = this.generateWordContent();

      // Crear documento Word con formato APA
      const doc = new Document({
        sections: [
          {
            properties: {
              page: {
                margin: {
                  top: this.convertInchesToTwip(1),
                  right: this.convertInchesToTwip(1),
                  bottom: this.convertInchesToTwip(1),
                  left: this.convertInchesToTwip(1),
                },
              },
            },
            children: docContent,
          },
        ],
      });

      // Generar y descargar archivo
      const blob = await Packer.toBlob(doc);
      const fileName = `Plan_de_Pruebas_${this.testPlanTitle.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().getTime()}.docx`;
      
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      
      window.URL.revokeObjectURL(url);
      
      this.toastService.success('Documento Word descargado exitosamente con formato APA');
    } catch (error) {
      console.error('Error exportando a Word:', error);
      this.toastService.error('Error al generar el documento Word');
    } finally {
      this.isExporting = false;
    }
  }

  private generateWordContent(): Paragraph[] {
    const content: Paragraph[] = [];

    // === USAR LA MISMA LÓGICA QUE updatePreview() ===

    // Título principal (H1)
    content.push(
      new Paragraph({
        text: `Plan de Pruebas: ${this.testPlanTitle}`,
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { after: 400, before: 200 },
      })
    );

    // Repositorio al inicio (sin título de sección) - MISMO ORDEN QUE PREVIEW
    content.push(
      new Paragraph({
        children: [
          new TextRun({ text: "Repositorio: ", bold: true }),
          new TextRun({ text: this.repositoryLink || 'No especificado' }),
        ],
        spacing: { after: 240 },
      })
    );

    // 1. ALCANCE - Lista de HUs con su alcance - MISMO ORDEN QUE PREVIEW
    content.push(
      new Paragraph({
        text: "1. ALCANCE",
        heading: HeadingLevel.HEADING_2,
        spacing: { after: 240, before: 400 },
      })
    );

    this.huList.forEach(hu => {
      // Título de HU
      content.push(
        new Paragraph({
          children: [
            new TextRun({ text: `HU ${hu.id}`, bold: true }),
          ],
          spacing: { after: 120 },
        })
      );
      
      // Contenido del alcance - usar generatedScope como en preview
      if (hu.generatedScope) {
        content.push(
          new Paragraph({
            text: hu.generatedScope,
            spacing: { after: 240 },
            indent: { firstLine: this.getAPAIndent() },
          })
        );
      } else {
        content.push(
          new Paragraph({
            text: "No se generó alcance para esta HU.",
            spacing: { after: 240 },
            indent: { firstLine: this.getAPAIndent() },
          })
        );
      }
    });

    // 2. Fuera de Alcance - MISMO ORDEN QUE PREVIEW
    content.push(
      new Paragraph({
        text: "2. Fuera de Alcance",
        heading: HeadingLevel.HEADING_2,
        spacing: { after: 240, before: 400 },
      })
    );
    content.push(
      new Paragraph({
        text: this.outOfScopeContent || 'No especificado',
        spacing: { after: 240 },
        indent: { firstLine: this.getAPAIndent() },
      })
    );

    // 3. Estrategia - MISMO ORDEN QUE PREVIEW
    content.push(
      new Paragraph({
        text: "3. Estrategia",
        heading: HeadingLevel.HEADING_2,
        spacing: { after: 240, before: 400 },
      })
    );
    content.push(
      new Paragraph({
        text: this.strategyContent || 'No especificada',
        spacing: { after: 240 },
        indent: { firstLine: this.getAPAIndent() },
      })
    );

    // 4. Casos de Prueba - Por HU, solo nombre del escenario - MISMO ORDEN QUE PREVIEW
    content.push(
      new Paragraph({
        text: "4. Casos de Prueba",
        heading: HeadingLevel.HEADING_2,
        spacing: { after: 240, before: 400 },
      })
    );

    this.huList.forEach(hu => {
      // Título HU (H3)
      content.push(
        new Paragraph({
          text: `ID ${hu.id}: ${hu.title}`,
          heading: HeadingLevel.HEADING_3,
          spacing: { after: 120, before: 200 },
        })
      );

      // Lista de casos de prueba
      if (hu.detailedTestCases && hu.detailedTestCases.length > 0) {
        hu.detailedTestCases.forEach((tc) => {
          content.push(
            new Paragraph({
              text: tc.title,
              bullet: { level: 0 },
              spacing: { after: 120 },
            })
          );
        });
      } else {
        content.push(
          new Paragraph({
            text: "No hay casos de prueba para esta HU.",
            spacing: { after: 120 },
            indent: { firstLine: this.getAPAIndent() },
          })
        );
      }
    });

    // 5. Limitaciones - MISMO ORDEN QUE PREVIEW
    content.push(
      new Paragraph({
        text: "5. Limitaciones",
        heading: HeadingLevel.HEADING_2,
        spacing: { after: 240, before: 400 },
      })
    );
    content.push(
      new Paragraph({
        text: this.limitationsContent || 'No especificadas',
        spacing: { after: 240 },
        indent: { firstLine: this.getAPAIndent() },
      })
    );

    // 6. Supuestos - MISMO ORDEN QUE PREVIEW
    content.push(
      new Paragraph({
        text: "6. Supuestos",
        heading: HeadingLevel.HEADING_2,
        spacing: { after: 240, before: 400 },
      })
    );
    content.push(
      new Paragraph({
        text: this.assumptionsContent || 'No especificados',
        spacing: { after: 240 },
        indent: { firstLine: this.getAPAIndent() },
      })
    );

    // 7. Equipo de trabajo - MISMO ORDEN QUE PREVIEW
    content.push(
      new Paragraph({
        text: "7. Equipo de trabajo",
        heading: HeadingLevel.HEADING_2,
        spacing: { after: 240, before: 400 },
      })
    );
    content.push(
      new Paragraph({
        text: this.teamContent || 'No especificado',
        spacing: { after: 240 },
        indent: { firstLine: this.getAPAIndent() },
      })
    );

    return content;
  }  private generateHuContent(): Paragraph[] {
    const paragraphs: Paragraph[] = [];

    this.huList.forEach(hu => {
      // Título de la HU
      paragraphs.push(
        new Paragraph({
          style: "Heading3",
          children: [
            new TextRun({
              text: `ID ${hu.id}: ${hu.title}`,
              bold: true,
              italics: true,
            }),
          ],
        })
      );

      // Contenido de la HU (descripción)
      if (hu.originalInput?.description) {
        paragraphs.push(
          new Paragraph({
            style: "APAParagraph", 
            children: [
              new TextRun({
                text: hu.originalInput.description,
              }),
            ],
          })
        );
      }

      // Criterios de aceptación
      if (hu.originalInput?.acceptanceCriteria) {
        paragraphs.push(
          new Paragraph({
            style: "APAParagraph",
            children: [
              new TextRun({
                text: `Criterios de aceptación: ${hu.originalInput.acceptanceCriteria}`,
              }),
            ],
          })
        );
      }

      // Alcance generado
      if (hu.generatedScope) {
        paragraphs.push(
          new Paragraph({
            style: "APAParagraph",
            children: [
              new TextRun({
                text: `Alcance: ${hu.generatedScope}`,
              }),
            ],
          })
        );
      }
    });

    return paragraphs;
  }

  private generateTestCasesContent(): Paragraph[] {
    const paragraphs: Paragraph[] = [];

    this.huList.forEach(hu => {
      // Título de la HU para casos de prueba
      paragraphs.push(
        new Paragraph({
          style: "Heading3",
          children: [
            new TextRun({
              text: `ID ${hu.id}: ${hu.title}`,
              bold: true,
              italics: true,
            }),
          ],
        })
      );

      // Casos de prueba
      if (hu.detailedTestCases && hu.detailedTestCases.length > 0) {
        hu.detailedTestCases.forEach((tc: any, index: number) => {
          paragraphs.push(
            new Paragraph({
              style: "APAParagraph",
              children: [
                new TextRun({
                  text: `     • ${tc.title}`,
                }),
              ],
            })
          );
        });
      } else {
        paragraphs.push(
          new Paragraph({
            style: "APAParagraph",
            children: [
              new TextRun({
                text: "     No hay casos de prueba para esta HU.",
              }),
            ],
          })
        );
      }
    });

    return paragraphs;
  }
}
