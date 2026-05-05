// src/app/excel-matrix-exporter/excel-matrix-exporter.component.ts

import { Component, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import * as XLSX from 'xlsx';
import { HUData } from '../models/hu-data.model';
import { ToastService } from '../services/core/toast.service';

@Component({
  selector: 'app-excel-matrix-exporter',
  templateUrl: './excel-matrix-exporter.component.html',
  styleUrls: ['./excel-matrix-exporter.component.css']
})
export class ExcelMatrixExporterComponent {
  private isBrowser: boolean;

  constructor(
    @Inject(PLATFORM_ID) private platformId: Object,
    private toastService: ToastService
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  /**
   * Genera y descarga un archivo Excel (.xlsx) con la matriz de casos de prueba
   * Diseño visual mejorado: bordes sutiles, colores alternos, negrillas, numeración automática
   */
  public generateMatrixExcel(hu: HUData): void {
    if (!this.isBrowser || !hu || !hu.detailedTestCases) {
      console.warn('No hay datos válidos para generar la matriz Excel.');
      this.toastService.warning('No hay casos de prueba para exportar');
      return;
    }

    try {
      // Crear libro de Excel
      const workbook = XLSX.utils.book_new();

      // Crear hoja con el nombre de la HU (máximo 31 caracteres permitidos por Excel)
      let sheetName = `${hu.id}`;
      if (sheetName.length > 31) {
        sheetName = sheetName.substring(0, 31);
      }
      const worksheetData: any[][] = [];

      // ========== HEADER DE LA TABLA ==========
      // Fila 1: Encabezados de la tabla
      worksheetData.push([
        'ID Caso',
        'Escenario de Prueba',
        'Precondiciones',
        'Paso a Paso',
        'Evidencias',
        'Resultado Esperado'
      ]);

      // ========== CONTENIDO DE CASOS DE PRUEBA ==========
      const merges: XLSX.Range[] = [];
      const rowHeights: any[] = [
        { hpt: 30 }   // Fila 1: Encabezados
      ];

      let currentRow = 1; // Empezar después del header (fila 1 = índice 0)

      // Procesar cada caso de prueba
      hu.detailedTestCases.forEach((tc, tcIdx) => {
        const idCaso = `${hu.id}_CP${tcIdx + 1}`;
        const steps = tc.steps || [];
        const startRow = currentRow;

        if (steps.length === 0) {
          // Si no hay pasos, agregar una fila simple
          worksheetData.push([
            idCaso,
            tc.title || '',
            tc.preconditions || '',
            'Sin pasos definidos',
            '',
            tc.expectedResults || ''
          ]);
          rowHeights.push({ hpt: 100 }); // Altura expandible para evidencias
          currentRow++;
        } else {
          // Por cada paso, crear UNA fila con numeración automática
          steps.forEach((step, stepIdx) => {
            // Numeración automática: "1. ", "2. ", etc.
            const pasoNumerado = `${stepIdx + 1}. ${step.accion}`;

            if (stepIdx === 0) {
              // Primera fila del caso con toda la info
              worksheetData.push([
                idCaso,
                tc.title || '',
                tc.preconditions || '',
                pasoNumerado,
                '', // Celda expandible para evidencia
                tc.expectedResults || ''
              ]);
            } else {
              // Filas subsiguientes solo con paso numerado y evidencia
              worksheetData.push([
                '', // ID vacío (será combinado)
                '', // Escenario vacío (será combinado)
                '', // Precondiciones vacío (será combinado)
                pasoNumerado,
                '', // Celda expandible para evidencia
                '' // Resultado vacío (será combinado)
              ]);
            }

            // Altura expandible automática para evidencias (mínimo 100pt)
            rowHeights.push({ hpt: 100 });
            currentRow++;
          });
        }

        // Calcular cuántas filas ocupa este caso
        const totalRows = steps.length > 0 ? steps.length : 1;
        const endRow = currentRow - 1;

        // Combinar celdas verticalmente
        if (totalRows > 1) {
          merges.push({ s: { r: startRow, c: 0 }, e: { r: endRow, c: 0 } }); // ID
          merges.push({ s: { r: startRow, c: 1 }, e: { r: endRow, c: 1 } }); // Escenario
          merges.push({ s: { r: startRow, c: 2 }, e: { r: endRow, c: 2 } }); // Precondiciones
          merges.push({ s: { r: startRow, c: 5 }, e: { r: endRow, c: 5 } }); // Resultado
        }
      });

      // Crear la hoja de trabajo
      const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

      // Establecer anchos de columna optimizados
      worksheet['!cols'] = [
        { wch: 16 },  // ID Caso
        { wch: 32 },  // Escenario de Prueba
        { wch: 28 },  // Precondiciones
        { wch: 50 },  // Paso a Paso (más ancho)
        { wch: 45 },  // Evidencias (expandible)
        { wch: 32 }   // Resultado Esperado
      ];

      // Establecer alturas de filas
      worksheet['!rows'] = rowHeights;

      // Aplicar las combinaciones de celdas
      worksheet['!merges'] = merges;

      // ========== ESTILOS MEJORADOS ==========

      // Estilo para título principal (verde turquesa como en imagen)
      const titleStyle = {
        font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 14 },
        fill: { fgColor: { rgb: '00B8A9' } }, // Verde turquesa
        alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
        border: {
          top: { style: 'medium', color: { rgb: '00A896' } },
          bottom: { style: 'medium', color: { rgb: '00A896' } },
          left: { style: 'medium', color: { rgb: '00A896' } },
          right: { style: 'medium', color: { rgb: '00A896' } }
        }
      };

      // Estilo para labels del header (HU, Set, Fecha, Estado)
      const headerLabelStyle = {
        font: { bold: true, color: { rgb: '1F2937' }, sz: 10 },
        fill: { fgColor: { rgb: 'F3F4F6' } }, // Gris claro
        alignment: { vertical: 'center', horizontal: 'left', wrapText: true },
        border: {
          top: { style: 'thin', color: { rgb: 'D1D5DB' } },
          bottom: { style: 'thin', color: { rgb: 'D1D5DB' } },
          left: { style: 'thin', color: { rgb: 'D1D5DB' } },
          right: { style: 'thin', color: { rgb: 'D1D5DB' } }
        }
      };

      const headerValueStyle = {
        font: { color: { rgb: '1F2937' }, sz: 10 },
        fill: { fgColor: { rgb: 'FFFFFF' } },
        alignment: { vertical: 'center', horizontal: 'left', wrapText: true },
        border: {
          top: { style: 'thin', color: { rgb: 'D1D5DB' } },
          bottom: { style: 'thin', color: { rgb: 'D1D5DB' } },
          left: { style: 'thin', color: { rgb: 'D1D5DB' } },
          right: { style: 'thin', color: { rgb: 'D1D5DB' } }
        }
      };

      // Estilo para encabezados de tabla
      const tableHeaderStyle = {
        font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
        fill: { fgColor: { rgb: '374151' } },
        alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
        border: {
          top: { style: 'medium', color: { rgb: '1F2937' } },
          bottom: { style: 'medium', color: { rgb: '1F2937' } },
          left: { style: 'thin', color: { rgb: '6B7280' } },
          right: { style: 'thin', color: { rgb: '6B7280' } }
        }
      };

      // Estilos para ID Caso (negrilla, destacado)
      const idCellStyle = {
        font: { bold: true, color: { rgb: '1E40AF' }, sz: 11 }, // Negrilla + azul
        fill: { fgColor: { rgb: 'EFF6FF' } }, // Azul muy claro
        alignment: { vertical: 'top', horizontal: 'center', wrapText: true },
        border: {
          top: { style: 'medium', color: { rgb: '000000' } },
          bottom: { style: 'medium', color: { rgb: '000000' } },
          left: { style: 'medium', color: { rgb: '000000' } },
          right: { style: 'medium', color: { rgb: '000000' } }
        }
      };

      // Estilos para Escenario (negrilla)
      const scenarioCellStyle = {
        font: { bold: true, color: { rgb: '1F2937' }, sz: 11 }, // Negrilla
        fill: { fgColor: { rgb: 'F9FAFB' } },
        alignment: { vertical: 'top', horizontal: 'left', wrapText: true },
        border: {
          top: { style: 'medium', color: { rgb: '000000' } },
          bottom: { style: 'medium', color: { rgb: '000000' } },
          left: { style: 'medium', color: { rgb: '000000' } },
          right: { style: 'medium', color: { rgb: '000000' } }
        }
      };

      // Estilos para celdas de contenido normal
      const contentCellStyle = {
        font: { color: { rgb: '1F2937' }, sz: 10 },
        fill: { fgColor: { rgb: 'FFFFFF' } },
        alignment: { vertical: 'top', horizontal: 'left', wrapText: true },
        border: {
          top: { style: 'medium', color: { rgb: '000000' } },
          bottom: { style: 'medium', color: { rgb: '000000' } },
          left: { style: 'medium', color: { rgb: '000000' } },
          right: { style: 'medium', color: { rgb: '000000' } }
        }
      };

      // Estilos para filas alternas (pasos impares = gris claro)
      const contentCellAlternoStyle = {
        font: { color: { rgb: '1F2937' }, sz: 10 },
        fill: { fgColor: { rgb: 'F9FAFB' } }, // Gris claro para alternar
        alignment: { vertical: 'top', horizontal: 'left', wrapText: true },
        border: {
          top: { style: 'medium', color: { rgb: '000000' } },
          bottom: { style: 'medium', color: { rgb: '000000' } },
          left: { style: 'medium', color: { rgb: '000000' } },
          right: { style: 'medium', color: { rgb: '000000' } }
        }
      };

      // Estilos para celdas de evidencia (expandibles)
      const evidenceCellStyle = {
        font: { italic: true, color: { rgb: '9CA3AF' }, sz: 9 },
        fill: { fgColor: { rgb: 'F3F4F6' } },
        alignment: { vertical: 'top', horizontal: 'center', wrapText: true },
        border: {
          top: { style: 'medium', color: { rgb: '000000' } },
          bottom: { style: 'medium', color: { rgb: '000000' } },
          left: { style: 'medium', color: { rgb: '000000' } },
          right: { style: 'medium', color: { rgb: '000000' } }
        }
      };

      const evidenceCellAlternoStyle = {
        font: { italic: true, color: { rgb: '9CA3AF' }, sz: 9 },
        fill: { fgColor: { rgb: 'FFFFFF' } }, // Alternar color
        alignment: { vertical: 'top', horizontal: 'center', wrapText: true },
        border: {
          top: { style: 'medium', color: { rgb: '000000' } },
          bottom: { style: 'medium', color: { rgb: '000000' } },
          left: { style: 'medium', color: { rgb: '000000' } },
          right: { style: 'medium', color: { rgb: '000000' } }
        }
      };

      // ========== APLICAR ESTILOS A TODAS LAS CELDAS ==========
      Object.keys(worksheet).forEach(cellAddress => {
        if (cellAddress[0] === '!') return;

        const cell = worksheet[cellAddress];
        const match = cellAddress.match(/([A-Z]+)([0-9]+)/);
        if (!match) return;

        const col = match[1];
        const row = parseInt(match[2]);

        if (row === 1) {
          // Encabezados de tabla
          cell.s = tableHeaderStyle;
        } else {
          // Contenido (filas 2+)
          const dataRow = row - 1; // Fila relativa de datos
          const isAlternoRow = dataRow % 2 === 0; // Filas pares = gris

          if (col === 'A') {
            // Columna ID (negrilla, destacado)
            cell.s = idCellStyle;
          } else if (col === 'B') {
            // Columna Escenario (negrilla)
            cell.s = scenarioCellStyle;
          } else if (col === 'E') {
            // Columna Evidencias (expandible, alternado)
            cell.s = isAlternoRow ? evidenceCellAlternoStyle : evidenceCellStyle;
          } else {
            // Resto de columnas (con colores alternos)
            cell.s = isAlternoRow ? contentCellAlternoStyle : contentCellStyle;
          }
        }
      });

      // Agregar la hoja al libro
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

      // Generar archivo y descargarlo
      // Limpiar caracteres no permitidos en el nombre de archivo
      const rawFileName = `Matriz - ${hu.title}.xlsx`;
      const fileName = rawFileName.replace(/[\\/:*?"<>|]/g, '-').trim();
      XLSX.writeFile(workbook, fileName);

      console.log(`✅ Archivo Excel generado: ${fileName}`);
      console.log(`   🎨 Diseño: Header compacto (3 filas), colores profesionales`);
      console.log(`   📝 Numeración: Pasos numerados automáticamente (1, 2, 3...)`);
      console.log(`   📸 Evidencias: Celdas expandibles con altura automática`);
      console.log(`   📋 Estructura: 6 columnas (ID, Escenario, Precondiciones, Pasos, Evidencias, Resultado)`);

      this.toastService.success('Archivo Excel generado exitosamente');
    } catch (error) {
      console.error('❌ Error generando archivo Excel:', error);
      this.toastService.error('Error al generar el archivo Excel: ' + (error as Error).message);
    }
  }

  /**
   * Método legacy mantenido para compatibilidad
   * @deprecated Usar generateMatrixExcel en su lugar
   */
  public generateMatrixHtml(hu: HUData): string {
    console.warn('generateMatrixHtml está deprecado. Usa generateMatrixExcel en su lugar.');
    // Llamar al nuevo método
    this.generateMatrixExcel(hu);
    return '';
  }
}
