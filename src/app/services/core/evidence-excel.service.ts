import { Injectable } from '@angular/core';
import * as ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import * as XLSX from 'xlsx';

@Injectable({
  providedIn: 'root'
})
export class EvidenceExcelService {

  constructor() { }

  /**
   * Genera y descarga un archivo Excel con imágenes de evidencias alineadas por paso
   */
  async downloadExcelReport(report: any): Promise<boolean> {
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Caso de Prueba');

      // Configurar columnas
      worksheet.columns = [
        { width: 15 }, // ID Caso
        { width: 30 }, // Escenario
        { width: 35 }, // Precondiciones
        { width: 50 }, // Paso a Paso
        { width: 100 }, // Evidencias
        { width: 35 }  // Resultado
      ];

      // Título principal
      worksheet.mergeCells('A1:F1');
      const titleCell = worksheet.getCell('A1');
      titleCell.value = 'MATRIZ DE EJECUCIÓN DE CASOS DE PRUEBA';
      titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF007AFF' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      worksheet.getRow(1).height = 40;

      // Metadatos
      const today = new Date().toLocaleDateString();
      worksheet.addRow(['HU:', report.historia_usuario || 'N/A', '', 'Fecha:', today, '']);
      worksheet.addRow([]);

      // Encabezados de tabla
      const headerRow = worksheet.addRow([
        'ID Caso',
        'Escenario de Prueba',
        'Precondiciones',
        'Paso a Paso',
        'Evidencias',
        'Resultado'
      ]);

      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
      headerRow.height = 25;

      const steps = report.test_scenario_steps || [];
      let currentRowIndex = 5;

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const row = worksheet.addRow([
          i === 0 ? (report.id_caso || '1') : '',
          i === 0 ? report.nombre_del_escenario : '',
          i === 0 ? (report.precondiciones || 'Ninguna') : '',
          `${step.numero_paso}. ${step.descripcion_accion_observada}`,
          '', // Espacio para la imagen
          i === 0 ? (report.resultado_obtenido || 'Exitoso') : ''
        ]);

        row.alignment = { vertical: 'middle', wrapText: true };
        row.height = 280; // Altura para que quepa la imagen

        // Obtener imágenes asociadas a este paso
        let stepImages = report.report_images?.filter((img: any) => img.step_id === step.id) || [];
        
        // FALLBACK: Si no hay imágenes vinculadas por ID, intentar por referencia de texto/orden (como hace la UI)
        if (stepImages.length === 0 && step.imagen_referencia) {
          const imgByName = report.report_images?.find((img: any) => img.file_name && (img.file_name === step.imagen_referencia || step.imagen_referencia.includes(img.file_name)));
          if (imgByName) {
            stepImages.push(imgByName);
          } else {
            const cleanRef = step.imagen_referencia.replace(/\d{2}[\/\-]\d{2}[\/\-]\d{4}/g, '').replace(/\(\d+\)\.(?:xlsx|csv|jpg|png|jpeg)/gi, '');
            const matches = cleanRef.match(/\d+/g);
            if (matches) {
              matches.forEach((m: string) => {
                const order = parseInt(m, 10);
                const fallbackImg = report.report_images?.find((img: any) => img.image_order === order);
                if (fallbackImg) stepImages.push(fallbackImg);
              });
            }
          }
        }
        
        if (stepImages.length > 0) {
          for (let imgIdx = 0; imgIdx < stepImages.length; imgIdx++) {
            const imgData = stepImages[imgIdx];
            if (imgData && imgData.image_url) {
              const isCSV = imgData.file_type?.includes('csv') || imgData.file_name?.toLowerCase().endsWith('.csv');
              const isXLSX = imgData.file_type?.includes('sheet') || imgData.file_type?.includes('excel') || imgData.file_name?.toLowerCase().endsWith('.xlsx');

              if (isCSV || isXLSX) {
                // Parsear y escribir datos tabulares en el Excel
                try {
                  const tabularData = await this.fetchSpreadsheetTabularData(imgData.image_url);
                  if (tabularData && tabularData.length > 0) {
                    // Escribir en filas adicionales debajo del paso actual
                    const evidCell = row.getCell(5);
                    evidCell.value = `[${imgData.file_name || 'CSV/XLSX'}]`;
                    evidCell.font = { bold: true, color: { argb: 'FF007AFF' } };
                    row.height = 20 + tabularData.length * 16;
                    for (let rIdx = 0; rIdx < tabularData.length; rIdx++) {
                      const dataRow = worksheet.getRow(currentRowIndex + rIdx);
                      for (let cIdx = 0; cIdx < tabularData[rIdx].length; cIdx++) {
                        const targetCell = dataRow.getCell(5 + cIdx);
                        targetCell.value = String(tabularData[rIdx][cIdx] ?? '');
                        if (rIdx === 0) {
                          targetCell.font = { bold: true };
                          targetCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
                        }
                        targetCell.border = {
                          top: { style: 'thin' }, left: { style: 'thin' },
                          bottom: { style: 'thin' }, right: { style: 'thin' }
                        };
                      }
                    }
                    currentRowIndex += tabularData.length;
                  }
                } catch (e) {
                  console.error('Error al insertar datos CSV/XLSX en Excel', e);
                }
              } else {
                // Imagen normal
                row.height = 280;
                try {
                  const response = await fetch(imgData.image_url);
                  const buffer = await response.arrayBuffer();
                  const imageId = workbook.addImage({ buffer, extension: 'png' });
                  worksheet.addImage(imageId, {
                    tl: { col: 4, row: (currentRowIndex - 1) + (imgIdx * 0.8) },
                    ext: { width: 400, height: 250 }
                  });
                } catch (e) {
                  console.error('Error al insertar imagen en Excel', e);
                }
              }
            }
          }
        }

        currentRowIndex++;
      }

      // Estilos de bordes
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber >= 4) {
          row.eachCell((cell) => {
            cell.border = {
              top: { style: 'thin' },
              left: { style: 'thin' },
              bottom: { style: 'thin' },
              right: { style: 'thin' }
            };
          });
        }
      });

      // Guardar archivo
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      saveAs(blob, `Reporte_Evidencias_${report.id_caso || 'QA'}.xlsx`);

      return true;
    } catch (error) {
      console.error('Error generando Excel:', error);
      return false;
    }
  }

  /**
   * Genera un Excel con múltiples reportes
   */
  async downloadBulkExcelReport(reports: any[], onProgress?: (current: number, total: number) => void): Promise<boolean> {
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Matriz Masiva');

      worksheet.columns = [
        { width: 15 }, { width: 30 }, { width: 35 },
        { width: 50 }, { width: 100 }, { width: 35 }
      ];

      // Título
      worksheet.mergeCells('A1:F1');
      const titleCell = worksheet.getCell('A1');
      titleCell.value = 'MATRIZ MASIVA DE EJECUCIÓN DE PRUEBAS';
      titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      worksheet.getRow(1).height = 40;

      let currentRow = 3;
      let processed = 0;

      for (const report of reports) {
        processed++;
        onProgress?.(processed, reports.length);
        // Encabezado de cada reporte
        const subHeader = worksheet.addRow([`ESCENARIO: ${report.nombre_del_escenario}`, '', '', '', '', `ESTADO: ${report.estado_general}`]);
        subHeader.font = { bold: true };
        subHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        currentRow++;

        const steps = report.test_scenario_steps || [];
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          const row = worksheet.addRow([
            i === 0 ? report.id_caso : '',
            i === 0 ? report.nombre_del_escenario : '',
            i === 0 ? report.precondiciones : '',
            `${step.numero_paso}. ${step.descripcion_accion_observada}`,
            '',
            i === 0 ? report.resultado_obtenido : ''
          ]);
          row.height = 150;

          // Imagen o CSV/XLSX
          const imgData = report.report_images?.find((img: any) => img.step_id === step.id);
          if (imgData && imgData.image_url) {
            const isCSV = imgData.file_type?.includes('csv') || imgData.file_name?.toLowerCase().endsWith('.csv');
            const isXLSX = imgData.file_type?.includes('sheet') || imgData.file_type?.includes('excel') || imgData.file_name?.toLowerCase().endsWith('.xlsx');

            if (isCSV || isXLSX) {
              try {
                const tabularData = await this.fetchSpreadsheetTabularData(imgData.image_url);
                if (tabularData && tabularData.length > 0) {
                  row.height = 20 + tabularData.length * 16;
                  for (let rIdx = 0; rIdx < tabularData.length; rIdx++) {
                    const dataRow = worksheet.getRow(currentRow + rIdx);
                    for (let cIdx = 0; cIdx < tabularData[rIdx].length; cIdx++) {
                      const targetCell = dataRow.getCell(5 + cIdx);
                      targetCell.value = String(tabularData[rIdx][cIdx] ?? '');
                      if (rIdx === 0) {
                        targetCell.font = { bold: true };
                        targetCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
                      }
                      targetCell.border = {
                        top: { style: 'thin' }, left: { style: 'thin' },
                        bottom: { style: 'thin' }, right: { style: 'thin' }
                      };
                    }
                  }
                  currentRow += tabularData.length;
                }
              } catch (e) { console.error('Error al insertar CSV/XLSX en Excel masivo', e); }
            } else {
              try {
                const response = await fetch(imgData.image_url);
                const buffer = await response.arrayBuffer();
                const imageId = workbook.addImage({ buffer, extension: 'png' });
                worksheet.addImage(imageId, {
                  tl: { col: 4, row: currentRow - 1 },
                  ext: { width: 400, height: 250 }
                });
              } catch (e) {}
            }
          }
          currentRow++;
        }
        worksheet.addRow([]); // Espacio entre reportes
        currentRow++;
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      saveAs(blob, `Matriz_Masiva_QA_${Date.now()}.xlsx`);

      return true;
    } catch (e) {
      console.error('Error en exportación masiva:', e);
      return false;
    }
  }

  /**
   * Descarga un CSV o XLSX desde una URL y devuelve sus datos tabulares como string[][].
   */
  private async fetchSpreadsheetTabularData(url: string): Promise<string[][] | null> {
    try {
      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      const data = new Uint8Array(buffer);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) return null;
      const sheet = workbook.Sheets[sheetName];
      const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as string[][];
      return rows.length > 0 ? rows : null;
    } catch (e) {
      console.error('Error al parsear spreadsheet para Excel:', e);
      return null;
    }
  }
}
