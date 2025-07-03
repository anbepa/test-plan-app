// src/app/html-matrix-exporter/html-matrix-exporter.component.ts

import { Component, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { HUData } from '../models/hu-data.model'; // Asegúrate que la ruta al modelo es correcta

@Component({
  selector: 'app-html-matrix-exporter',
  standalone: true,
  imports: [CommonModule],
  template: '', // No se necesita template ni css propio
})
export class HtmlMatrixExporterComponent {
  private isBrowser: boolean;

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  private escapeHtml(text: string | undefined | null): string {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  public generateMatrixHtml(hu: HUData): string {
    if (!this.isBrowser || !hu || !hu.detailedTestCases) {
      console.warn('No hay datos válidos para generar la matriz HTML.');
      return '';
    }

    const scenariosForJson = hu.detailedTestCases.map((tc, idx) => ({
      'ID Caso': `${hu.id}_CP${idx + 1}`,
      'Escenario de Prueba': tc.title,
      'Precondiciones': tc.preconditions,
      'Paso a Paso': tc.steps ? tc.steps.map(s => s.accion).join('\n') : '',
      'Resultado Esperado': tc.expectedResults,
      'evidencias': []
    }));

    const scenariosJsonString = JSON.stringify(scenariosForJson, null, 2)
                                     .replace(/</g, '\\u003c');

    return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Matriz de Casos de Prueba - ${this.escapeHtml(hu.id)}</title>
  <script src="https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js"></script>
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f4f6fa; margin: 0; padding: 0; color: #222; }
    header { background: #f8fafc; color: #222; padding: 1rem; text-align: center; font-size: 1.3rem; font-weight: 500; border-radius: 0 0 10px 10px; }
    .container { max-width: 1200px; margin: 30px auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 16px rgba(0,0,0,0.09); padding: 32px 24px; }
    .export-bar { display: flex; gap: 1.2rem; justify-content: center; margin: 2rem 0 1rem 0; }
    .btn, button { background: #e5e7eb; color: #222; border: none; padding: 0.7em 1.5em; border-radius: 6px; font-size: 1em; cursor: pointer; transition: background 0.2s; font-weight: 500; margin: 4px 2px; }
    .btn:hover, button:hover { background: #d1d5db; }
    .btn-danger { background: #fef2f2; color: #b91c1c; }
    .btn-danger:hover { background: #fee2e2; }
    .btn-primary { background: #eff6ff; color: #1e40af; }
    .btn-primary:hover { background: #dbeafe; }
    section.escenario { background: #f8fafc; border-radius: 10px; box-shadow: 0 1px 8px rgba(44,62,80,0.06); margin-bottom: 2.5rem; padding: 2rem 1.5rem; }
    .escenario-table { width: 100%; border-collapse: collapse; margin-bottom: 1.2rem; background: #fff; border-radius: 8px; overflow: hidden; }
    .escenario-table th, .escenario-table td { padding: 0.7em 1em; border: 1px solid #e0e0e0; text-align: left; vertical-align: top; }
    .escenario-table th { background: #e3eafc; color: #1e293b; font-weight: 600; }
    .escenario-table td[contenteditable="true"] { background: #f1f5f9; outline: 1.5px solid transparent; }
    .escenario-table td[contenteditable="true"]:focus { outline: 1.5px solid #2563eb; }
    .actions-cell { display: flex; flex-direction: column; align-items: stretch; gap: 8px; }
    .evidencias { background: #fff; border-radius: 8px; padding: 1.2em 1em; }
    .evidencias-titulo { color: #2563eb; font-size: 1.1em; margin: 0 0 10px 0; border-bottom: 1px dashed #b0b0b0; padding-bottom: 4px; font-weight: 600; }
    .evidencias-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 24px; margin-bottom: 18px; }
    .evidencia-block { background: #f8fafc; border-radius: 8px; box-shadow: 0 1px 4px rgba(44,62,80,0.07); padding: 18px 12px; display: flex; flex-direction: column; align-items: center; }
    .evidencia-block img { width: 100%; max-height: 200px; border-radius: 8px; border: 1px solid #bbb; margin-bottom: 10px; object-fit: contain; background: #fff; }
    .evidencia-label { font-size: 1em; color: #444; margin-bottom: 8px; font-weight: 500; display: flex; align-items: center; justify-content: space-between; width: 100%; }
    .evidencia-nombre { border: none; background: transparent; font-size: 1em; color: #444; font-weight: 500; outline: none; width: calc(100% - 30px); border-bottom: 1px dashed transparent; }
    .evidencia-nombre:focus { border-bottom: 1.5px dashed #2563eb; }
    .btn-evidencia-eliminar { background: #f3f4f6; color: #b91c1c; border: none; padding: 0.2em 0.5em; border-radius: 50%; font-size: 1.2em; cursor: pointer; }
    .escenarios-tabs-bar { display: flex; gap: 0.2em; margin-bottom: 1.2em; border-bottom: 1px solid #e0e0e0; overflow-x: auto; white-space: nowrap; }
    .escenario-tab-btn { background: #f4f4f4; color: #222; border: 1px solid #e0e0e0; border-radius: 6px 6px 0 0; padding: 0.5em 1em; cursor: pointer; margin-bottom: -1px; }
    .escenario-tab-btn.active { background: #fff; border-bottom: 1px solid #fff; font-weight: bold; }
    @media print { .btn, header, .export-bar { display: none !important; } }
  </style>
</head>
<body>
  <div class="container">
    <header><h1>Matriz de Casos de Prueba</h1></header>
    <div class="export-bar">
      <button class="btn" id="btn-cargar-csv">Cargar archivo CSV</button>
      <button class="btn" id="btn-agregar-escenario">Agregar Escenario en Blanco</button>
      <button class="btn" id="btn-descargar-pdf">Descargar PDF</button>
    </div>
    <div id="escenarios-container"></div>
  </div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"></script>

  <script>
    let escenarios = ${scenariosJsonString};
    let escenarioActivo = 0;

    function renderEvidencias(idx) {
      const grid = document.getElementById(\`evid-grid-\${idx}\`);
      if (!grid) return;
      grid.innerHTML = '';
      (escenarios[idx].evidencias || []).forEach((ev, i) => {
        const div = document.createElement('div');
        div.className = 'evidencia-block';
        const nombreArchivo = ev.nombre || \`evidencia_\${i + 1}.png\`;
        div.innerHTML = \`<div class="evidencia-label"><input type='text' value='\${nombreArchivo}' class="evidencia-nombre" onchange="escenarios[\${idx}].evidencias[\${i}].nombre = this.value" title='Nombre archivo' /><button class='btn-evidencia-eliminar' onclick="eliminarEvidencia(\${idx}, \${i})" title='Eliminar'>&times;</button></div><img src="\${ev.data}" alt="Evidencia" />\`;
        grid.appendChild(div);
      });
    }

    function subirEvidencias(idx, input) {
      for (const file of input.files) {
        const reader = new FileReader();
        reader.onload = (e) => {
          escenarios[idx].evidencias.push({ tipo: 'img', nombre: file.name, data: e.target.result });
          renderEvidencias(idx);
        };
        reader.readAsDataURL(file);
      }
      input.value = '';
    }

    async function pegarEvidencia(idx) {
        try {
            const items = await navigator.clipboard.read();
            for (const item of items) {
                if (item.types.includes('image/png')) {
                    const blob = await item.getType('image/png');
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        escenarios[idx].evidencias.push({ tipo: 'img', nombre: 'pegado.png', data: e.target.result });
                        renderEvidencias(idx);
                    };
                    reader.readAsDataURL(blob);
                    return;
                }
            }
        } catch (err) { console.error('Error al pegar:', err); alert('No se pudo pegar la imagen.'); }
    }
    
    function eliminarEvidencia(escenarioIdx, evidenciaIdx) {
        if (escenarios[escenarioIdx] && escenarios[escenarioIdx].evidencias) {
            escenarios[escenarioIdx].evidencias.splice(evidenciaIdx, 1);
            renderEvidencias(escenarioIdx);
        }
    }

    function limpiarEvidencias(idx) { escenarios[idx].evidencias = []; renderEvidencias(idx); }
    
    function crearEscenarioHTML(esc, idx) {
      const section = document.createElement('section');
      section.className = 'escenario';
      section.id = \`escenario-\${idx}\`;
      section.innerHTML = \`
        <table class="escenario-table">
          <thead><tr><th>ID Caso</th><th>Escenario de Prueba</th><th>Precondiciones</th><th>Paso a Paso</th><th>Resultado Esperado</th><th>Acciones</th></tr></thead>
          <tbody>
            <tr id="caso-row-\${idx}">
              <td contenteditable="true" onblur="escenarios[\${idx}]['ID Caso'] = this.innerText">\${esc['ID Caso'] || ''}</td>
              <td contenteditable="true" onblur="escenarios[\${idx}]['Escenario de Prueba'] = this.innerText">\${esc['Escenario de Prueba'] || ''}</td>
              <td contenteditable="true" onblur="escenarios[\${idx}]['Precondiciones'] = this.innerText">\${esc['Precondiciones'] || ''}</td>
              <td contenteditable="true" onblur="escenarios[\${idx}]['Paso a Paso'] = this.innerText" style="white-space: pre-wrap;">\${esc['Paso a Paso'] || ''}</td>
              <td contenteditable="true" onblur="escenarios[\${idx}]['Resultado Esperado'] = this.innerText">\${esc['Resultado Esperado'] || ''}</td>
              <td class="actions-cell">
                <button class="btn btn-primary" onclick="ejecutarConTerminal(\${idx})">Ejecutar con Terminal</button>
                <button class="btn btn-danger" onclick="eliminarEscenario(\${idx})">Eliminar</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="evidencias"><div class="evidencias-titulo">Evidencias</div><div style="margin-bottom:10px; display:flex; flex-wrap:wrap; gap:0.7em;"><label class="btn">Subir Evidencias <input type="file" accept="image/*" multiple onchange="subirEvidencias(\${idx}, this)" style="display:none;"></label><button class="btn" onclick="pegarEvidencia(\${idx})">Pegar Evidencia</button><button class="btn" onclick="limpiarEvidencias(\${idx})">Limpiar Evidencias</button></div><div class="evidencias-grid" id="evid-grid-\${idx}"></div></div>\`;
      return section;
    }
    
    function eliminarEscenario(idx) {
        if (escenarios.length > 1) {
            escenarios.splice(idx, 1);
            if (escenarioActivo >= escenarios.length) { escenarioActivo = escenarios.length - 1; }
            render();
        } else { alert('No se puede eliminar el último escenario.'); }
    }

    function render() {
      const container = document.getElementById('escenarios-container');
      container.innerHTML = '';
      const tabsBar = document.createElement('div');
      tabsBar.className = 'escenarios-tabs-bar';
      escenarios.forEach((esc, idx) => {
        const tabBtn = document.createElement('button');
        tabBtn.className = 'escenario-tab-btn' + (idx === escenarioActivo ? ' active' : '');
        tabBtn.textContent = esc['ID Caso'] || \`Escenario \${idx + 1}\`;
        tabBtn.onclick = () => { escenarioActivo = idx; render(); };
        tabsBar.appendChild(tabBtn);
      });
      container.appendChild(tabsBar);
      if (escenarios[escenarioActivo]) {
        const escenarioEl = crearEscenarioHTML(escenarios[escenarioActivo], escenarioActivo);
        container.appendChild(escenarioEl);
        renderEvidencias(escenarioActivo);
      }
    }

    document.addEventListener('DOMContentLoaded', () => {
      document.getElementById('btn-agregar-escenario').addEventListener('click', agregarEscenario);
      
      // === CAMBIO CLAVE PARA SOLUCIONAR EL ERROR ===
      document.getElementById('btn-descargar-pdf').addEventListener('click', () => generarReportePDF(escenarios));
      
      document.getElementById('btn-cargar-csv').addEventListener('click', () => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.csv';
          input.onchange = (e) => {
              const file = e.target.files[0];
              if (!file) return;
              Papa.parse(file, { header: true, skipEmptyLines: true, complete: (results) => {
                  escenarios = results.data.map(row => ({ ...row, evidencias: [] }));
                  escenarioActivo = 0;
                  render();
              }});
          };
          input.click();
      });
      if(escenarios.length === 0) agregarEscenario(); else render();
    });

    function agregarEscenario() {
      escenarios.push({ 'ID Caso': \`CP\${escenarios.length + 1}\`, 'Escenario de Prueba': '', 'Precondiciones': '', 'Paso a Paso': '', 'Resultado Esperado': '', evidencias: [] });
      escenarioActivo = escenarios.length - 1;
      render();
    }
    
    function ejecutarConTerminal(idx) {
      const casoRow = document.getElementById(\`caso-row-\${idx}\`);
      if (!casoRow) {
        alert(\`Error: No se encontró la fila del caso con índice \${idx}\`);
        return;
      }
      const idCaso = casoRow.cells[0].innerText.trim();
      const pasoAPaso = casoRow.cells[3].innerText.trim();
      if (!pasoAPaso) { alert('La columna "Paso a Paso" está vacía.'); return; }
      const comando = \`Ejecutando Caso: \${idCaso}\\n\\nPasos:\\n\${pasoAPaso}\`;
      const encodedCommand = encodeURIComponent(comando);
      window.location.href = \`miappterminal://\${encodedCommand}\`;
    }

    // === CAMBIO CLAVE PARA SOLUCIONAR EL ERROR ===
    async function generarReportePDF(escenariosAGenerar) {
        if (!escenariosAGenerar || escenariosAGenerar.length === 0) {
            alert("No hay escenarios para generar el PDF.");
            return;
        }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
        const pageHeight = doc.internal.pageSize.getHeight();
        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 40;

        doc.setFontSize(28).text('Reporte de Matriz de Casos de Prueba', pageWidth / 2, 180, { align: 'center' });
        doc.setFontSize(16).text('Fecha de generación: ' + new Date().toLocaleString('es-CO'), pageWidth / 2, 220, { align: 'center' });
        doc.setFontSize(12).text('Área: QA / Testing', pageWidth / 2, 260, { align: 'center' });
        doc.setFontSize(12).text('Versión: 1.0', pageWidth / 2, 280, { align: 'center' });

        const scenariosWithPageNumbers = [];
        
        for (const esc of escenariosAGenerar) {
            doc.addPage();
            const pageNum = doc.internal.getNumberOfPages();
            scenariosWithPageNumbers.push({ name: esc['ID Caso'] || 'Escenario sin ID', page: pageNum });

            doc.autoTable({
                startY: margin,
                head: [['ID Caso', 'Escenario de Prueba', 'Precondiciones', 'Paso a Paso', 'Resultado Esperado']],
                body: [[ esc['ID Caso'], esc['Escenario de Prueba'], esc['Precondiciones'], esc['Paso a Paso'], esc['Resultado Esperado'] ]],
                theme: 'grid',
                styles: { halign: 'left', font: 'helvetica', cellPadding: 8, fontSize: 9, lineWidth: 0.5, lineColor: [200, 200, 200] },
                headStyles: { fillColor: [63, 81, 181], textColor: 255, fontStyle: 'bold' },
                columnStyles: { 0: { cellWidth: 80 }, 1: { cellWidth: 120 }, 2: { cellWidth: 120 }, 3: { cellWidth: 'auto' }, 4: { cellWidth: 120 } },
                margin: { left: margin, right: margin }
            });

            if (esc.evidencias && esc.evidencias.length > 0) {
                let y = doc.lastAutoTable.finalY + 30;
                if (y > pageHeight - 120) { doc.addPage(); y = margin; }
                doc.setFontSize(14).setTextColor(40).text('Evidencias:', margin, y);
                y += 25;

                const containerWidth = (pageWidth - margin * 2.5) / 2;
                const containerHeight = 200;
                const gap = 20;

                for (let i = 0; i < esc.evidencias.length; i += 2) {
                    const ev1 = esc.evidencias[i];
                    const ev2 = i + 1 < esc.evidencias.length ? esc.evidencias[i+1] : null;
                    const img1 = ev1 ? await loadImage(ev1.data) : null;
                    const img2 = ev2 ? await loadImage(ev2.data) : null;
                    
                    if (y + containerHeight > pageHeight - margin) { doc.addPage(); y = margin; }
                    
                    if(img1) {
                      const x1 = margin;
                      doc.setFillColor(240, 240, 240);
                      doc.roundedRect(x1, y, containerWidth, containerHeight, 5, 5, 'F');
                      const dim1 = calculateAspectRatioFit(img1.width, img1.height, containerWidth - 20, containerHeight - 40);
                      doc.setFontSize(8).setTextColor(80).text(ev1.nombre, x1 + 10, y + 20);
                      doc.addImage(img1, 'PNG', x1 + (containerWidth - dim1.width) / 2, y + 35, dim1.width, dim1.height);
                    }
                    
                    if(img2) {
                      const x2 = margin + containerWidth + gap;
                      doc.setFillColor(240, 240, 240);
                      doc.roundedRect(x2, y, containerWidth, containerHeight, 5, 5, 'F');
                      const dim2 = calculateAspectRatioFit(img2.width, img2.height, containerWidth - 20, containerHeight - 40);
                      doc.setFontSize(8).setTextColor(80).text(ev2.nombre, x2 + 10, y + 20);
                      doc.addImage(img2, 'PNG', x2 + (containerWidth - dim2.width) / 2, y + 35, dim2.width, dim2.height);
                    }
                    y += containerHeight + gap;
                }
            }
        }
        
        doc.insertPage(2);
        doc.setPage(2);
        doc.setFontSize(22).text('Índice', margin, 80);
        let yIndex = 120;
        doc.setFontSize(12);
        scenariosWithPageNumbers.forEach((item, i) => {
            if (yIndex > pageHeight - margin) { doc.addPage(); yIndex = margin; }
            const dots = '.'.repeat(Math.max(0, 110 - item.name.length));
            doc.text(\`\${i + 1}. \${item.name} \${dots} \${item.page}\`, margin, yIndex);
            yIndex += 20;
        });

        doc.addPage();
        doc.setFontSize(18).text('Firmas y Validaciones', margin, 80);
        doc.setFontSize(12);
        doc.text('Responsable QA:', margin, 180);
        doc.setDrawColor(150).line(margin + 100, 180, pageWidth - margin, 180);
        doc.text('Revisor:', margin, 260);
        doc.line(margin + 100, 260, pageWidth - margin, 260);
        doc.text('Aprobador:', margin, 340);
        doc.line(margin + 100, 340, pageWidth - margin, 340);

        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(9).setTextColor(150).text(\`Página \${i} de \${pageCount}\`, pageWidth - margin, pageHeight - 20, { align: 'right' });
        }

        doc.save(\`reporte_casos_prueba.pdf\`);
    }

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = (err) => reject(err);
            img.src = src;
        });
    }

    function calculateAspectRatioFit(srcWidth, srcHeight, maxWidth, maxHeight) {
        const ratio = Math.min(maxWidth / srcWidth, maxHeight / srcHeight);
        return { width: srcWidth * ratio, height: srcHeight * ratio };
    }
  </script>
</body>
</html>`;
  }
}