// src/app/html-matrix-exporter/html-matrix-exporter.component.ts

import { Component, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { HUData, DetailedTestCase } from '../models/hu-data.model'; // Asegúrate que la ruta al modelo es correcta

@Component({
  selector: 'app-html-matrix-exporter',
  standalone: true,
  imports: [CommonModule],
  // Este componente ya no necesita su propio HTML o CSS. Es solo un generador lógico.
  template: '',
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

  /**
   * Genera el contenido HTML para una matriz de ejecución a partir de una HU.
   * @param hu La Historia de Usuario con los casos de prueba detallados.
   * @returns Un string con el documento HTML completo o un string vacío si no hay datos.
   */
  public generateMatrixHtml(hu: HUData): string {
    if (!this.isBrowser || !hu || !hu.detailedTestCases || hu.detailedTestCases.length === 0) {
      console.warn('No hay datos válidos para generar la matriz HTML.');
      return '';
    }

    // Generar los escenarios solo con los campos requeridos
    const escenarios = hu.detailedTestCases.map((tc, idx) => ({
      id: `${this.escapeHtml(hu.id)}_CP${idx + 1}`,
      title: this.escapeHtml(tc.title),
      preconditions: this.escapeHtml(tc.preconditions),
      steps: tc.steps && tc.steps.length > 0 ? tc.steps.map(s => this.escapeHtml(s.accion)).join('\n') : '',
      expectedResults: this.escapeHtml(tc.expectedResults),
      evidences: [] // Siempre vacío al exportar
    }));

    const styles = `
      body { font-family: Calibri, Arial, sans-serif; margin: 0; background: #f4f6fa; }
      .container { max-width: 1100px; margin: 30px auto; background: #fff; border-radius: 10px; box-shadow: 0 2px 8px #0001; padding: 32px 32px 24px 32px; }
      .export-bar { display: flex; gap: 12px; margin-bottom: 18px; }
      .btn-primary { background: #2563eb; color: #fff; border: none; border-radius: 4px; padding: 7px 18px; font-weight: 600; cursor: pointer; }
      .btn-primary:hover { background: #1d4ed8; }
      .btn-secondary { background: #f1f5f9; color: #222; border: 1px solid #cbd5e1; border-radius: 4px; padding: 7px 14px; font-weight: 500; cursor: pointer; }
      .btn-secondary:hover { background: #e2e8f0; }
      .btn-danger { background: #ef4444; color: #fff; border: none; border-radius: 4px; padding: 7px 14px; font-weight: 600; cursor: pointer; }
      .btn-danger:hover { background: #dc2626; }
      .escenario-table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
      .escenario-table th { background: #e3eafc; color: #222; font-weight: bold; border: 1px solid #cbd5e1; padding: 8px; }
      .escenario-table td { border: 1px solid #cbd5e1; padding: 8px; background: #fff; }
      .escenario-table tr:nth-child(even) td { background: #f8fafc; }
      .escenario-table td[contenteditable="true"] { outline: 2px solid #2563eb33; background: #e0e7ff; }
      .evidencias-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-top: 10px; }
      .evidencia-block { background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; display: flex; flex-direction: column; align-items: center; position: relative; }
      .evidencia-block img { max-width: 100px; max-height: 80px; border-radius: 4px; margin-bottom: 4px; }
      .evidencia-block input[type='text'] { width: 90px; font-size: 10px; margin-bottom: 2px; border: 1px solid #cbd5e1; border-radius: 3px; padding: 2px 4px; text-align: center; }
      .evidencia-block .btn-danger { position: absolute; top: 2px; right: 2px; padding: 2px 7px; font-size: 12px; border-radius: 50%; }
      .evidencias-actions { display: flex; gap: 8px; margin-bottom: 8px; }
      @media (max-width: 700px) { .container { padding: 8px; } }
    `;

    // Script JS embebido para poblar la tabla y gestionar evidencias
    const escenariosJson = JSON.stringify(escenarios).replace(/</g, '\u003c');
    const script = [
      'let escenarios = ', escenariosJson, ';',
      'function renderEscenarios() {',
      '  const tbody = document.getElementById("escenarios-tbody");',
      '  tbody.innerHTML = "";',
      '  escenarios.forEach(function(esc, idx) {',
      '    var tr = document.createElement("tr");',
      '    [esc.id, esc.title, esc.preconditions, esc.steps, esc.expectedResults].forEach(function(val, i) {',
      '      var td = document.createElement("td");',
      '      td.textContent = val;',
      '      tr.appendChild(td);',
      '    });',
      '    tbody.appendChild(tr);',
      '  });',
      '}',
      'window.onload = function() { renderEscenarios(); };',
      'let activeIdx = 0;',
      'function addEscenario() {',
      '  var newId = "CP" + (escenarios.length + 1);',
      '  escenarios.push({ id: newId, title: "", preconditions: "", steps: "", expectedResults: "", evidences: [] });',
      '  renderEscenarios();',
      '}',
      'function saveField(field, value) { escenarios[activeIdx][field] = value; }',
      'function renderEvidencias() {',
      '  var grid = document.getElementById("evidencias-grid");',
      '  grid.innerHTML = "";',
      '  escenarios[activeIdx].evidences.forEach(function(ev, idx) {',
      '    var block = document.createElement("div");',
      '    block.className = "evidencia-block";',
      '    var img = document.createElement("img");',
      '    img.src = ev.data;',
      '    block.appendChild(img);',
      '    var input = document.createElement("input");',
      '    input.type = "text";',
      '    input.value = ev.name;',
      '    input.onchange = function() { ev.name = input.value; };',
      '    block.appendChild(input);',
      '    var btn = document.createElement("button");',
      '    btn.className = "btn-danger";',
      '    btn.textContent = "X";',
      '    btn.onclick = function() { escenarios[activeIdx].evidences.splice(idx,1); renderEvidencias(); };',
      '    block.appendChild(btn);',
      '    grid.appendChild(block);',
      '  });',
      '}',
      'function subirEvidencias() {',
      '  var input = document.createElement("input");',
      '  input.type = "file";',
      '  input.accept = "image/*";',
      '  input.multiple = true;',
      '  input.onchange = function(e) {',
      '    var files = Array.from(input.files);',
      '    files.forEach(function(file) {',
      '      var reader = new FileReader();',
      '      reader.onload = function(ev) {',
      '        escenarios[activeIdx].evidences.push({ name: file.name, data: ev.target.result });',
      '        renderEvidencias();',
      '      };',
      '      reader.readAsDataURL(file);',
      '    });',
      '  };',
      '  input.click();',
      '}',
      'async function pegarEvidencia() {',
      '  if (!navigator.clipboard || !navigator.clipboard.read) {',
      '    alert("Tu navegador no soporta pegar imágenes desde el portapapeles.");',
      '    return;',
      '  }',
      '  try {',
      '    var items = await navigator.clipboard.read();',
      '    for (var i = 0; i < items.length; i++) {',
      '      var item = items[i];',
      '      for (var j = 0; j < item.types.length; j++) {',
      '        var type = item.types[j];',
      '        if (type.startsWith("image/")) {',
      '          var blob = await item.getType(type);',
      '          var reader = new FileReader();',
      '          reader.onload = function(ev) {',
      '            escenarios[activeIdx].evidences.push({ name: "pegada.png", data: ev.target.result });',
      '            renderEvidencias();',
      '          };',
      '          reader.readAsDataURL(blob);',
      '          return;',
      '        }',
      '      }',
      '    }',
      '    alert("No se encontró imagen en el portapapeles.");',
      '  } catch (e) { alert("Error al pegar evidencia: " + e); }',
      '}',
      'function limpiarEvidencias() {',
      '  escenarios[activeIdx].evidences = [];',
      '  renderEvidencias();',
      '}',
      'function ejecutarTerminal() {',
      '  var esc = escenarios[activeIdx];',
      '  if (!esc.steps || !esc.steps.trim()) {',
      "    alert('El campo \"Paso a Paso\" no puede estar vacío.');",
      '    return;',
      '  }',
      '  var texto = "ID: " + esc.id + "\nPasos: " + esc.steps;',
      '  var url = "miappterminal://" + encodeURIComponent(texto);',
      '  window.location.href = url;',
      '}',
    ].join('\n');

    return `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <title>Matriz de Ejecución - ${this.escapeHtml(hu.id)}</title>
        <style>${styles}</style>
      </head>
      <body>
        <div class="container">
          <h1>Matriz de Ejecución para HU: <span id="hu-id">${this.escapeHtml(hu.id)}</span> - <span id="hu-title">${this.escapeHtml(hu.title)}</span></h1>
          <div class="export-bar">
            <button class="btn-primary" onclick="addEscenario()">Agregar Escenario en Blanco</button>
            <button class="btn-secondary" onclick="subirEvidencias()">Subir Evidencias</button>
            <button class="btn-secondary" onclick="pegarEvidencia()">Pegar Evidencia</button>
            <button class="btn-danger" onclick="limpiarEvidencias()">Limpiar Evidencias</button>
            <button class="btn-primary" onclick="ejecutarTerminal()">Ejecutar con Terminal</button>
          </div>
          <table class="escenario-table">
            <thead>
              <tr>
                <th>ID Caso</th>
                <th>Escenario de Prueba</th>
                <th>Precondiciones</th>
                <th>Paso a Paso</th>
                <th>Resultado Esperado</th>
              </tr>
            </thead>
            <tbody id="escenarios-tbody">
              <!-- Se pobla por JS -->
            </tbody>
          </table>
          <div class="evidencias-actions">
            <strong>Evidencias:</strong>
          </div>
          <div id="evidencias-grid" class="evidencias-grid"></div>
        </div>
        <script>${script}</script>
      </body>
      </html>
    `;
  }
}