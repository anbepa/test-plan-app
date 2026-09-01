// src/app/excel-matrix-exporter/excel-matrix-exporter.component.ts

import { Component, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import * as ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { HUData } from '../models/hu-data.model';
import { ToastService } from '../services/core/toast.service';

@Component({
  selector: 'app-excel-matrix-exporter',
  templateUrl: './excel-matrix-exporter.component.html',
  styleUrls: ['./excel-matrix-exporter.component.css']
})
export class ExcelMatrixExporterComponent {
  private isBrowser: boolean;

  // ── Constantes de diseño ──────────────────────────────────────────────
  /** Anchos de columna (en "caracteres" de Excel). */
  private readonly COLS = [
    { key: 'idCaso', header: 'ID Caso', width: 18 },
    { key: 'escenario', header: 'Escenario de Prueba', width: 38 },
    { key: 'precondiciones', header: 'Precondiciones', width: 34 },
    { key: 'pasos', header: 'Paso a Paso', width: 55 },
    { key: 'evidencias', header: 'Evidencias', width: 60 },
    { key: 'resultado', header: 'Resultado Esperado', width: 38 }
  ];
  /** Altura (pt) reservada por fila para pegar una imagen de evidencia grande. */
  private readonly EVIDENCE_ROW_HEIGHT = 220;
  /** Altura (pt) de la fila de encabezado. */
  private readonly HEADER_ROW_HEIGHT = 34;

  // Paleta corporativa
  private readonly C = {
    headerBg: 'FF1D4ED8',       // Azul encabezado
    headerText: 'FFFFFFFF',
    idBg: 'FFEFF6FF',
    idText: 'FF1E3A8A',
    scenarioBg: 'FFF8FAFC',
    scenarioText: 'FF0F172A',
    contentText: 'FF1F2937',
    rowWhite: 'FFFFFFFF',
    rowAlt: 'FFF3F6FB',
    evidenceBg: 'FFFBFDFF',
    evidenceHint: 'FF9CA3AF',
    border: 'FFCBD5E1',
    borderStrong: 'FF94A3B8'
  };

  constructor(
    @Inject(PLATFORM_ID) private platformId: Object,
    private toastService: ToastService
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  /**
   * Genera y descarga un archivo Excel (.xlsx) con la matriz de casos de prueba.
   * Usa ExcelJS para aplicar estilos reales: ajuste de texto (wrapText), bordes,
   * colores alternos, anchos y alturas de fila, además de combinaciones de celda.
   */
  public async generateMatrixExcel(hu: HUData): Promise<void> {
    if (!this.isBrowser || !hu || !hu.detailedTestCases || hu.detailedTestCases.length === 0) {
      console.warn('No hay datos válidos para generar la matriz Excel.');
      this.toastService.warning('No hay casos de prueba para exportar');
      return;
    }

    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Test Plan App';
      workbook.created = new Date();

      // Nombre de hoja (máx. 31 caracteres, sin caracteres inválidos)
      let sheetName = `${hu.id}`.replace(/[\\/?*[\]:]/g, '-');
      if (sheetName.length > 31) sheetName = sheetName.substring(0, 31);

      const sheet = workbook.addWorksheet(sheetName, {
        views: [{ state: 'frozen', ySplit: 1 }], // Congelar encabezado
        pageSetup: { fitToPage: true, fitToWidth: 1, fitToHeight: 0, orientation: 'landscape' }
      });

      // ── Configurar columnas ──────────────────────────────────────────
      sheet.columns = this.COLS.map(c => ({ key: c.key, width: c.width }));

      // ── Fila de encabezado ───────────────────────────────────────────
      const headerRow = sheet.addRow(this.COLS.map(c => c.header));
      headerRow.height = this.HEADER_ROW_HEIGHT;
      headerRow.eachCell(cell => {
        cell.font = { bold: true, color: { argb: this.C.headerText }, size: 12, name: 'Calibri' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: this.C.headerBg } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = this.allBorders('medium', 'FF1E3A8A');
      });

      // ── Filas de contenido ───────────────────────────────────────────
      const merges: Array<{ top: number; bottom: number }> = [];
      let currentRow = 2; // Fila 1 = encabezado

      hu.detailedTestCases.forEach((tc, tcIdx) => {
        const idCaso = `${hu.id}_CP${tcIdx + 1}`;
        const steps = tc.steps || [];
        const startRow = currentRow;

        const rowsToAdd = steps.length > 0
          ? steps.map((s, i) => `${i + 1}. ${s.accion || ''}`)
          : ['Sin pasos definidos'];

        rowsToAdd.forEach((pasoTexto, idx) => {
          const first = idx === 0;
          const row = sheet.addRow({
            idCaso: first ? idCaso : '',
            escenario: first ? (tc.title || '') : '',
            precondiciones: first ? (tc.preconditions || '') : '',
            pasos: pasoTexto,
            evidencias: '',
            resultado: first ? (tc.expectedResults || '') : ''
          });

          // Altura de fila: la mayor entre el espacio para la imagen de evidencia
          // y la altura estimada según el texto más largo de la fila.
          const textHeight = this.estimateRowHeight([
            { text: pasoTexto, width: this.COLS[3].width },
            { text: first ? (tc.title || '') : '', width: this.COLS[1].width },
            { text: first ? (tc.preconditions || '') : '', width: this.COLS[2].width },
            { text: first ? (tc.expectedResults || '') : '', width: this.COLS[5].width }
          ]);
          row.height = Math.max(this.EVIDENCE_ROW_HEIGHT, textHeight);

          currentRow++;
        });

        if (rowsToAdd.length > 1) {
          merges.push({ top: startRow, bottom: currentRow - 1 });
        }
      });

      // ── Combinar celdas verticales (ID, Escenario, Precondiciones, Resultado) ──
      merges.forEach(({ top, bottom }) => {
        sheet.mergeCells(top, 1, bottom, 1); // A - ID
        sheet.mergeCells(top, 2, bottom, 2); // B - Escenario
        sheet.mergeCells(top, 3, bottom, 3); // C - Precondiciones
        sheet.mergeCells(top, 6, bottom, 6); // F - Resultado
      });

      // ── Aplicar estilos a las celdas de contenido ────────────────────
      const lastRow = sheet.rowCount;
      for (let r = 2; r <= lastRow; r++) {
        const isAlt = (r - 1) % 2 === 0;
        const rowBg = isAlt ? this.C.rowAlt : this.C.rowWhite;

        for (let c = 1; c <= 6; c++) {
          const cell = sheet.getCell(r, c);
          cell.border = this.allBorders('thin', this.C.border);

          if (c === 1) {
            // ID Caso
            cell.font = { bold: true, color: { argb: this.C.idText }, size: 11 };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: this.C.idBg } };
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
          } else if (c === 2) {
            // Escenario de Prueba
            cell.font = { bold: true, color: { argb: this.C.scenarioText }, size: 11 };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: this.C.scenarioBg } };
            cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
          } else if (c === 5) {
            // Evidencias (placeholder amplio para pegar imagen)
            cell.font = { italic: true, color: { argb: this.C.evidenceHint }, size: 9 };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: this.C.evidenceBg } };
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            if (!cell.value) cell.value = 'Pegar imagen de evidencia aquí';
          } else {
            // Precondiciones (3), Pasos (4), Resultado (6)
            cell.font = { color: { argb: this.C.contentText }, size: 10 };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
            cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
          }
        }
      }

      // ── Autofiltro sobre el encabezado ───────────────────────────────
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 6 } };

      // ── Generar y descargar ──────────────────────────────────────────
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const rawFileName = `Matriz - ${hu.title}.xlsx`;
      const fileName = rawFileName.replace(/[\\/:*?"<>|]/g, '-').trim();
      saveAs(blob, fileName);

      console.log(`✅ Archivo Excel generado con ExcelJS: ${fileName}`);
      this.toastService.success('Archivo Excel generado exitosamente');
    } catch (error) {
      console.error('❌ Error generando archivo Excel:', error);
      this.toastService.error('Error al generar el archivo Excel: ' + (error as Error).message);
    }
  }

  // ── Utilidades ─────────────────────────────────────────────────────────

  /** Devuelve un objeto de bordes uniformes para las 4 aristas. */
  private allBorders(style: 'thin' | 'medium', argb: string): Partial<ExcelJS.Borders> {
    const b: Partial<ExcelJS.Border> = { style, color: { argb } };
    return { top: b, bottom: b, left: b, right: b };
  }

  /**
   * Estima la altura (pt) necesaria para una fila según el texto de sus celdas
   * y el ancho de columna, considerando el ajuste de texto (wrapText).
   */
  private estimateRowHeight(cells: Array<{ text: string; width: number }>): number {
    const LINE_HEIGHT = 15;   // pt aprox. por línea de texto
    const MIN_HEIGHT = 40;    // pt mínimo
    let maxLines = 1;

    for (const { text, width } of cells) {
      if (!text) continue;
      // Caracteres aproximados por línea según el ancho de columna
      const charsPerLine = Math.max(8, Math.floor(width * 1.05));
      // Contar líneas explícitas y por desbordamiento
      const explicitLines = text.split(/\r?\n/);
      let lines = 0;
      for (const l of explicitLines) {
        lines += Math.max(1, Math.ceil(l.length / charsPerLine));
      }
      maxLines = Math.max(maxLines, lines);
    }
    return Math.max(MIN_HEIGHT, maxLines * LINE_HEIGHT + 10);
  }

  /**
   * Método legacy mantenido para compatibilidad
   * @deprecated Usar generateMatrixExcel en su lugar
   */
  public generateMatrixHtml(hu: HUData): string {
    console.warn('generateMatrixHtml está deprecado. Usa generateMatrixExcel en su lugar.');
    void this.generateMatrixExcel(hu);
    return '';
  }
}
