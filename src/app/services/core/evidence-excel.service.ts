import { Injectable } from '@angular/core';
import * as ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

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
          const match = step.imagen_referencia.match(/\d+/);
          if (match) {
            const order = parseInt(match[0], 10);
            const fallbackImg = report.report_images?.find((img: any) => img.image_order === order);
            if (fallbackImg) stepImages = [fallbackImg];
          }
        }
        
        if (stepImages.length > 0) {
          // Ajustar altura de fila según cantidad de imágenes
          row.height = 280 * stepImages.length;
          
          for (let imgIdx = 0; imgIdx < stepImages.length; imgIdx++) {
            const imgData = stepImages[imgIdx];
            if (imgData && imgData.image_url) {
              try {
                const response = await fetch(imgData.image_url);
                const buffer = await response.arrayBuffer();
                const imageId = workbook.addImage({
                  buffer: buffer,
                  extension: 'png',
                });

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

          // Imagen
          const imgData = report.report_images?.find((img: any) => img.step_id === step.id);
          if (imgData && imgData.image_url) {
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
}
