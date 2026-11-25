import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { Paragraph, Table, TableRow } from 'docx';
import { ToastService } from '../services/core/toast.service';
import { HUData } from '../models/hu-data.model';

/**
 * Módulo `docx` cargado bajo demanda en exportToWord(). Los métodos que
 * construyen el documento solo se llaman después de esa carga.
 */
let D: typeof import('docx');

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

  private normalizePdfText(value: string | undefined | null): string {
    return (value ?? '').replace(/\s+/g, ' ').trim();
  }

  private formatStepsForPdf(steps: Array<{ accion: string }> | undefined): string {
    if (!steps || steps.length === 0) {
      return 'No hay pasos definidos';
    }

    return steps
      .map((step, index) => `${index + 1}. ${this.normalizePdfText(step.accion)}`)
      .join(' ');
  }

  async downloadScenariosPdf(): Promise<void> {
    if (!this.testPlanTitle || this.huList.length === 0) {
      this.toastService.warning('No hay información completa para generar los escenarios');
      return;
    }

    try {
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable')
      ]);
      const tableRows: string[][] = [];

      this.huList.forEach(hu => {
        if (hu.detailedTestCases && hu.detailedTestCases.length > 0) {
          hu.detailedTestCases.forEach((tc, index) => {
            const idCaso = `${hu.id}_CP${index + 1}`;

            tableRows.push([
              idCaso,
              this.normalizePdfText(tc.title) || 'Sin escenario',
              this.normalizePdfText(tc.preconditions) || 'No especificadas',
              this.formatStepsForPdf(tc.steps),
              this.normalizePdfText(tc.expectedResults) || 'No especificados'
            ]);
          });
        }
      });

      if (tableRows.length === 0) {
        this.toastService.warning('No se encontraron escenarios para exportar');
        return;
      }

      const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'pt',
        format: 'a4'
      });

      const margin = 44;
      const pageWidth = doc.internal.pageSize.getWidth();
      const contentWidth = pageWidth - (margin * 2);
      const idWidth = 80;
      const scenarioWidth = 150;
      const preconditionsWidth = 170;
      const stepsWidth = 190;
      const expectedWidth = Math.max(contentWidth - (idWidth + scenarioWidth + preconditionsWidth + stepsWidth), 130);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text(`Matriz de Ejecución - ${this.testPlanTitle}`, margin, margin);

      autoTable(doc, {
        startY: margin + 20,
        margin: { top: margin, right: margin, bottom: margin, left: margin },
        head: [['ID Caso', 'Escenario', 'Precondiciones', 'Pasos', 'Resultado Esperado']],
        body: tableRows,
        theme: 'grid',
        styles: {
          font: 'helvetica',
          fontSize: 10,
          cellPadding: 6,
          overflow: 'linebreak',
          valign: 'top',
          textColor: [17, 24, 39],
          lineColor: [120, 120, 120],
          lineWidth: 0.5
        },
        headStyles: {
          fillColor: [235, 235, 235],
          textColor: [17, 24, 39],
          fontStyle: 'bold',
          halign: 'center'
        },
        columnStyles: {
          0: { cellWidth: idWidth, halign: 'center', fontStyle: 'bold' },
          1: { cellWidth: scenarioWidth },
          2: { cellWidth: preconditionsWidth },
          3: { cellWidth: stepsWidth },
          4: { cellWidth: expectedWidth }
        },
        rowPageBreak: 'avoid',
        showHead: 'everyPage'
      });

      const fileName = `Matriz_Ejecucion_${this.testPlanTitle.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().getTime()}.pdf`;
      doc.save(fileName);

      this.toastService.success('Matriz de ejecución PDF descargada exitosamente');
    } catch (error) {
      console.error('Error generando matriz de ejecución PDF:', error);
      this.toastService.error('Error al generar la matriz de ejecución PDF');
    }
  }



  async exportToWord(): Promise<void> {
    if (!this.testPlanTitle || this.huList.length === 0) {
      this.toastService.warning('No hay información completa para generar el documento');
      return;
    }

    try {
      this.isExporting = true;

      D = await import('docx');

      // Generar contenido usando la misma lógica que updatePreview() del test-plan-viewer
      const docContent = this.generateWordContent();

      // Crear documento Word con formato APA
      const doc = new D.Document({
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
      const blob = await D.Packer.toBlob(doc);
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

  private generateWordContent(): (Paragraph | Table)[] {
    const content: (Paragraph | Table)[] = [];

    // === USAR LA MISMA LÓGICA QUE updatePreview() ===

    // Título principal (H1)
    content.push(
      new D.Paragraph({
        text: `Plan de Pruebas: ${this.testPlanTitle}`,
        heading: D.HeadingLevel.HEADING_1,
        alignment: D.AlignmentType.CENTER,
        spacing: { after: 400, before: 200 },
      })
    );

    // Repositorio al inicio (sin título de sección) - MISMO ORDEN QUE PREVIEW
    content.push(
      new D.Paragraph({
        children: [
          new D.TextRun({ text: "Repositorio: ", bold: true }),
          new D.TextRun({ text: this.repositoryLink || 'No especificado' }),
        ],
        spacing: { after: 240 },
      })
    );

    // 1. ALCANCE - Lista de HUs con su alcance - MISMO ORDEN QUE PREVIEW
    content.push(
      new D.Paragraph({
        text: "1. ALCANCE",
        heading: D.HeadingLevel.HEADING_2,
        spacing: { after: 240, before: 400 },
      })
    );

    this.huList.forEach(hu => {
      // Título de HU
      content.push(
        new D.Paragraph({
          children: [
            new D.TextRun({ text: `HU ${hu.id}`, bold: true }),
          ],
          spacing: { after: 120 },
        })
      );

      // Contenido del alcance - usar generatedScope como en preview
      if (hu.generatedScope) {
        content.push(
          new D.Paragraph({
            children: [new D.TextRun({ text: hu.generatedScope })],
            spacing: { after: 240, before: 0, line: 360, lineRule: 'auto' },
            alignment: D.AlignmentType.LEFT,
            indent: { left: 0, right: 0, firstLine: 0, hanging: 0 },
            style: 'Normal',
          })
        );
      } else {
        content.push(
          new D.Paragraph({
            children: [new D.TextRun({ text: "No se generó alcance para esta HU." })],
            spacing: { after: 240, before: 0, line: 360, lineRule: 'auto' },
            alignment: D.AlignmentType.LEFT,
            indent: { left: 0, right: 0, firstLine: 0, hanging: 0 },
            style: 'Normal',
          })
        );
      }
    });

    // 2. Fuera de Alcance - MISMO ORDEN QUE PREVIEW
    content.push(
      new D.Paragraph({
        text: "2. Fuera de Alcance",
        heading: D.HeadingLevel.HEADING_2,
        spacing: { after: 240, before: 400 },
      })
    );
    content.push(
      new D.Paragraph({
        children: [new D.TextRun({ text: this.outOfScopeContent || 'No especificado' })],
        spacing: { after: 240, before: 0, line: 360, lineRule: 'auto' },
        alignment: D.AlignmentType.LEFT,
        indent: { left: 0, right: 0, firstLine: 0, hanging: 0 },
        style: 'Normal',
      })
    );

    // 3. Estrategia - MISMO ORDEN QUE PREVIEW
    content.push(
      new D.Paragraph({
        text: "3. Estrategia",
        heading: D.HeadingLevel.HEADING_2,
        spacing: { after: 240, before: 400 },
      })
    );
    content.push(
      new D.Paragraph({
        children: [new D.TextRun({ text: this.strategyContent || 'No especificada' })],
        spacing: { after: 240, before: 0, line: 360, lineRule: 'auto' },
        alignment: D.AlignmentType.LEFT,
        indent: { left: 0, right: 0, firstLine: 0, hanging: 0 },
        style: 'Normal',
      })
    );

    // 4. Casos de Prueba - Por HU, solo nombre del escenario - MISMO ORDEN QUE PREVIEW
    content.push(
      new D.Paragraph({
        text: "4. Casos de Prueba",
        heading: D.HeadingLevel.HEADING_2,
        spacing: { after: 240, before: 400 },
      })
    );

    this.huList.forEach(hu => {
    // 3. Estrategia - MISMO ORDEN QUE PREVIEW
      content.push(
        new D.Paragraph({
          text: `ID ${hu.id}: ${hu.title}`,
          heading: D.HeadingLevel.HEADING_3,
          spacing: { after: 120, before: 200 },
        })
      );

      // Lista de casos de prueba
      if (hu.detailedTestCases && hu.detailedTestCases.length > 0) {
        hu.detailedTestCases.forEach((tc) => {
          content.push(
            new D.Paragraph({
              text: tc.title,
              bullet: { level: 0 },
              spacing: { after: 120 },
            })
          );
        });
      } else {
        content.push(
          new D.Paragraph({
            text: "No hay casos de prueba para esta HU.",
            spacing: { after: 120 },
            indent: { firstLine: this.getAPAIndent() },
          })
        );
      }
    });

    // 5. Limitaciones - MISMO ORDEN QUE PREVIEW
    content.push(
      new D.Paragraph({
        text: "5. Limitaciones",
        heading: D.HeadingLevel.HEADING_2,
        spacing: { after: 240, before: 400 },
      })
    );
    content.push(
      new D.Paragraph({
        children: [new D.TextRun({ text: this.limitationsContent || 'No especificadas' })],
        spacing: { after: 240, before: 0, line: 360, lineRule: 'auto' },
        alignment: D.AlignmentType.LEFT,
        indent: { left: 0, right: 0, firstLine: 0, hanging: 0 },
        style: 'Normal',
      })
    );

    // 6. Supuestos - MISMO ORDEN QUE PREVIEW
    content.push(
      new D.Paragraph({
        text: "6. Supuestos",
        heading: D.HeadingLevel.HEADING_2,
        spacing: { after: 240, before: 400 },
      })
    );
    content.push(
      new D.Paragraph({
        children: [new D.TextRun({ text: this.assumptionsContent || 'No especificados' })],
        spacing: { after: 240, before: 0, line: 360, lineRule: 'auto' },
        alignment: D.AlignmentType.LEFT,
        indent: { left: 0, right: 0, firstLine: 0, hanging: 0 },
        style: 'Normal',
      })
    );

    // 7. Equipo de trabajo - MISMO ORDEN QUE PREVIEW
    content.push(
      new D.Paragraph({
        text: "7. Equipo de trabajo",
        heading: D.HeadingLevel.HEADING_2,
        spacing: { after: 240, before: 400 },
      })
    );
    
    // Crear tabla para equipo de trabajo
    const teamTable = this.createTeamTable();
    content.push(teamTable);

    return content;
  } private generateHuContent(): Paragraph[] {
    const paragraphs: Paragraph[] = [];

    this.huList.forEach(hu => {
      // Título de la HU
      paragraphs.push(
        new D.Paragraph({
          style: "Heading3",
          children: [
            new D.TextRun({
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
          new D.Paragraph({
            style: "APAParagraph",
            children: [
              new D.TextRun({
                text: hu.originalInput.description,
              }),
            ],
          })
        );
      }

      // Criterios de aceptación
      if (hu.originalInput?.acceptanceCriteria) {
        paragraphs.push(
          new D.Paragraph({
            style: "APAParagraph",
            children: [
              new D.TextRun({
                text: `Criterios de aceptación: ${hu.originalInput.acceptanceCriteria}`,
              }),
            ],
          })
        );
      }

      // Alcance generado
      if (hu.generatedScope) {
        paragraphs.push(
          new D.Paragraph({
            style: "APAParagraph",
            children: [
              new D.TextRun({
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
        new D.Paragraph({
          style: "Heading3",
          children: [
            new D.TextRun({
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
            new D.Paragraph({
              style: "APAParagraph",
              children: [
                new D.TextRun({
                  text: `     • ${tc.title}`,
                }),
              ],
            })
          );
        });
      } else {
        paragraphs.push(
          new D.Paragraph({
            style: "APAParagraph",
            children: [
              new D.TextRun({
                text: "     No hay casos de prueba para esta HU.",
              }),
            ],
          })
        );
      }
    });

    return paragraphs;
  }

  private createTeamTable(): Table {
    // Parsear el contenido del equipo para crear filas
    const rows: TableRow[] = [];
    
    // Encabezado de la tabla
    rows.push(
      new D.TableRow({
        children: [
          new D.TableCell({
            children: [new D.Paragraph({ children: [new D.TextRun({ text: "Rol", bold: true })], alignment: D.AlignmentType.CENTER })],
            width: { size: 30, type: D.WidthType.PERCENTAGE },
            shading: { fill: 'f0f0f0' },
          }),
          new D.TableCell({
            children: [new D.Paragraph({ children: [new D.TextRun({ text: "Nombre", bold: true })], alignment: D.AlignmentType.CENTER })],
            width: { size: 35, type: D.WidthType.PERCENTAGE },
            shading: { fill: 'f0f0f0' },
          }),
          new D.TableCell({
            children: [new D.Paragraph({ children: [new D.TextRun({ text: "Responsabilidades", bold: true })], alignment: D.AlignmentType.CENTER })],
            width: { size: 35, type: D.WidthType.PERCENTAGE },
            shading: { fill: 'f0f0f0' },
          }),
        ],
      })
    );

    // Parsear el contenido del equipo si existe
    if (this.teamContent && this.teamContent.trim()) {
      // Separar por líneas y crear filas
      const lines = this.teamContent.split('\n').filter(line => line.trim());
      
      lines.forEach(line => {
        // Parsear formato: "Rol - Empresa: Nombre" o "Rol – Empresa: Nombre"
        let rol = '';
        let nombre = '';
        
        // Buscar el separador ":" para dividir rol/empresa de nombre
        const colonIndex = line.indexOf(':');
        if (colonIndex !== -1) {
          rol = line.substring(0, colonIndex).trim();
          nombre = line.substring(colonIndex + 1).trim();
        } else {
          // Si no hay dos puntos, usar toda la línea como rol
          rol = line.trim();
          nombre = '';
        }
        
        // Asegurar que el rol no esté vacío
        if (rol) {
          rows.push(
            new D.TableRow({
              children: [
                new D.TableCell({
                  children: [new D.Paragraph({ 
                    children: [new D.TextRun({ text: rol })], 
                    alignment: D.AlignmentType.LEFT, 
                    spacing: { line: 240 },
                  })],
                  width: { size: 30, type: D.WidthType.PERCENTAGE },
                  margins: { top: 100, bottom: 100, left: 100, right: 100 },
                }),
                new D.TableCell({
                  children: [new D.Paragraph({ 
                    children: [new D.TextRun({ text: nombre })], 
                    alignment: D.AlignmentType.LEFT, 
                    spacing: { line: 240 },
                  })],
                  width: { size: 35, type: D.WidthType.PERCENTAGE },
                  margins: { top: 100, bottom: 100, left: 100, right: 100 },
                }),
                new D.TableCell({
                  children: [new D.Paragraph({ 
                    children: [new D.TextRun({ text: '' })], 
                    alignment: D.AlignmentType.LEFT, 
                    spacing: { line: 240 },
                  })],
                  width: { size: 35, type: D.WidthType.PERCENTAGE },
                  margins: { top: 100, bottom: 100, left: 100, right: 100 },
                }),
              ],
            })
          );
        }
      });
    } else {
      // Fila vacía si no hay contenido
      rows.push(
        new D.TableRow({
          children: [
            new D.TableCell({
              children: [new D.Paragraph({ children: [new D.TextRun({ text: 'No especificado' })], alignment: D.AlignmentType.LEFT })],
              width: { size: 30, type: D.WidthType.PERCENTAGE },
            }),
            new D.TableCell({
              children: [new D.Paragraph({ children: [new D.TextRun({ text: '' })], alignment: D.AlignmentType.LEFT })],
              width: { size: 35, type: D.WidthType.PERCENTAGE },
            }),
            new D.TableCell({
              children: [new D.Paragraph({ children: [new D.TextRun({ text: '' })], alignment: D.AlignmentType.LEFT })],
              width: { size: 35, type: D.WidthType.PERCENTAGE },
            }),
          ],
        })
      );
    }

    return new D.Table({
      rows: rows,
      width: { size: 100, type: D.WidthType.PERCENTAGE },
    });
  }
}
