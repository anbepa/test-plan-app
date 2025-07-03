import { Component, Input } from '@angular/core';
import { HUData } from '../models/hu-data.model';
import { saveAs } from 'file-saver';

@Component({
  selector: 'app-html-matrix-exporter',
  standalone: true,
  template: ``,
})
export class HtmlMatrixExporterComponent {
  @Input() data: HUData[] = [];

  private escapeFilename(filename: string): string {
    return filename.replace(/[\\/:":*?<>|]/g, '_');
  }

  private escapeHtmlForExport(u: string | undefined | null): string {
    return u
      ? u
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;')
      : '';
  }

  public exportToHtml(hu?: HUData): void {
    const dataToExport = hu ? [hu] : this.data;
    if (!dataToExport || dataToExport.length === 0) {
      return;
    }

    const formattedDate = new Date().toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });

    const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Matriz de Casos de Prueba</title>
  <style>
    body { font-family: Arial, sans-serif; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #f2f2f2; }
  </style>
</head>
<body>
  <h1>Matriz de Casos de Prueba</h1>
  ${dataToExport.map(hu => this.generateHuTable(hu)).join('')}
</body>
</html>`;

    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8;' });
    const firstHu = dataToExport[0];
    saveAs(
      blob,
      `Matriz_Casos_Prueba_${this.escapeFilename(firstHu.id)}_${formattedDate}.html`
    );
  }

  private generateHuTable(hu: HUData): string {
    return `
      <h2>HU: ${this.escapeHtmlForExport(hu.id)} - ${this.escapeHtmlForExport(hu.title)}</h2>
      <table>
        <thead>
          <tr>
            <th>ID Caso de Prueba</th>
            <th>Título</th>
            <th>Precondiciones</th>
            <th>Paso a Paso</th>
            <th>Resultados Esperados</th>
          </tr>
        </thead>
        <tbody id="tbody-${hu.id}">
          ${(hu.detailedTestCases || []).map((tc, idx) => `
            <tr id="caso-row-${hu.id}-${idx}">
              <td contenteditable="true">${this.escapeHtmlForExport(hu.id + '_CP' + (idx + 1))}</td>
              <td contenteditable="true">${this.escapeHtmlForExport(tc.title)}</td>
              <td contenteditable="true">${this.escapeHtmlForExport(tc.preconditions)}</td>
              <td contenteditable="true">${tc.steps.map(step => this.escapeHtmlForExport(step.numero_paso + '. ' + step.accion)).join('<br>')}</td>
              <td contenteditable="true">${this.escapeHtmlForExport(tc.expectedResults)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }
}