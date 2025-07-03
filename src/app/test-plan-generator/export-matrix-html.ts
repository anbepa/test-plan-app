// @ts-nocheck
import { DetailedTestCase } from '../models/hu-data.model';

export function generateExecutionMatrixHtml(
  huId: string,
  detailedTestCases: DetailedTestCase[],
  escapeHtml: (u: string | undefined | null) => string
): string {
  const date = new Date().toISOString().split('T')[0];
  const rowsHtml = detailedTestCases.map((tc, idx) => `
    <tr id="caso-row-${idx}">
      <td contenteditable="true">${escapeHtml(huId + '_CP' + (idx + 1))}</td>
      <td contenteditable="true">${escapeHtml(tc.title)}</td>
      <td contenteditable="true">${escapeHtml(tc.preconditions)}</td>
      <td contenteditable="true">${escapeHtml(tc.steps)}</td>
      <td contenteditable="true">${escapeHtml(tc.expectedResult)}</td>
      <td>
        <div class="acciones-btn">
          <button class="btn btn-danger" onclick="removeCase(${idx})">Eliminar</button>
        </div>
      </td>
    </tr>
    <tr id="evid-row-${idx}"><td colspan="6">
      <div class="evidencias-titulo">Evidencias para Nuevo Caso</div>
      <div class="evidencias-grid" id="evid-grid-${idx}"></div>
      <div style="margin-top:10px; display:flex; flex-wrap:wrap; gap:8px;">
        <label class="btn btn-secondary">Subir Evidencias<input type="file" accept="image/*" multiple onchange="uploadEvidence(${idx}, this)"></label>
        <button class="btn btn-secondary" onclick="pasteEvidence(${idx})">Pegar Evidencia</button>
        <button class="btn btn-secondary" onclick="clearEvidence(${idx})">Limpiar Evidencias</button>
        <label class="btn btn-secondary">Subir Excel<input type="file" accept=".xls,.xlsx" onchange="uploadExcel(${idx}, this)"></label>
        <button class="btn" onclick="ejecutarConTerminal(${idx})">Ejecutar con Terminal</button>
      </div>
    </td></tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Matriz de Casos de Prueba - ${date}</title>
  <style>
    body { font-family: Calibri, Arial, sans-serif; background: #f7f9fa; margin: 0; padding: 0; }
    .container { max-width: 1200px; margin: 30px auto; background: #fff; border-radius: 10px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); padding: 32px; }
    h1 { color: #2f5496; margin-bottom: 18px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    th, td { border: 1px solid #e0e0e0; padding: 10px 12px; text-align: left; vertical-align: top; }
    th { background: #f2f6fa; color: #2f5496; font-weight: 600; }
    .acciones-btn { display: flex; gap: 6px; }
    .evidencias-titulo { color: #1d3557; font-size: 1.1em; margin: 18px 0 8px 0; border-bottom: 1px dashed #b0b0b0; padding-bottom: 4px; }
    .evidencias-grid { display: flex; flex-wrap: wrap; gap: 18px; margin-bottom: 18px; }
    .evidencia-block { width: 600px; background: #f8fafc; border-radius: 8px; box-shadow: 0 1px 4px rgba(44,62,80,0.07); padding: 10px; margin-bottom: 8px; position:relative; }
    .evidencia-block img { width: 100%; max-width: 600px; border-radius: 6px; border: 1px solid #bbb; margin-bottom: 6px; }
    .evidencia-label { font-size: 0.98em; color: #444; margin-bottom: 4px; font-weight: 500; display: flex; align-items: center; }
    .evidencia-nombre-span { display: inline-block; min-width: 60px; font-size: 1em; font-weight: 500; outline: none; border: none; background: transparent; margin-right: 8px; }
    .btn-evidencia-eliminar { background: #c0392b; color: #fff; border: none; border-radius: 4px; padding: 2px 8px; font-size: 0.95em; cursor: pointer; margin-left: 4px; }
    .btn-evidencia-eliminar:hover { background: #922b1a; }
    .footer { margin-top: 40px; color: #888; font-size: 0.95em; text-align: center; }
    .btn { background: #2f5496; color: #fff; border: none; border-radius: 4px; padding: 7px 16px; cursor: pointer; font-weight: 500; transition: background 0.2s; margin: 2px; }
    .btn:hover { background: #1d3557; }
    .btn-danger { background: #c0392b; }
    .btn-danger:hover { background: #922b1a; }
    .btn-secondary { background: #888; }
    .btn-secondary:hover { background: #444; }
    .excel-label { color: #1d3557; font-size: 0.95em; margin-top: 6px; display: block; }
    .evidencia-block input[type=file] { display: none; }
    .evidencia-block .excel-file { margin-top: 4px; font-size: 0.95em; color: #2f5496; }
    .add-scenario-bar { margin: 30px 0 10px 0; text-align: center; }
    .export-bar { margin: 30px 0 10px 0; text-align: center; }
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"></script>
</head>
<body>
  <div class="container">
    <h1>Matriz de Casos de Prueba</h1>
    <table id="casos-table">
      <thead>
        <tr>
          <th>ID Caso</th>
          <th>Título</th>
          <th>Precondiciones</th>
          <th>Paso a Paso</th>
          <th>Resultado Esperado</th>
          <th>Acciones</th>
        </tr>
      </thead>
      <tbody id="casos-tbody">
        ${rowsHtml}
      </tbody>
    </table>
    <div class="add-scenario-bar">
      <button class="btn" onclick="addBlankScenario()">Agregar Escenario en Blanco</button>
    </div>
    <div class="export-bar">
      <button class="btn" onclick="exportToPDF()">Exportar a PDF</button>
    </div>
    <div class="footer">Generado el ${date}</div>
  </div>
  <script>
    function createScenarioRowHTML(idx) {
      return '<tr id="caso-row-' + idx + '">' +
        '<td contenteditable="true"></td>' +
        '<td contenteditable="true"></td>' +
        '<td contenteditable="true"></td>' +
        '<td contenteditable="true"></td>' +
        '<td contenteditable="true"></td>' +
        '<td><div class="acciones-btn">' +
          '<button class="btn btn-danger" onclick="removeCase(' + idx + ')">Eliminar</button>' +
        '</div></td>' +
      '</tr>' +
      '<tr id="evid-row-' + idx + '"><td colspan="6">' +
        '<div class="evidencias-titulo">Evidencias para Nuevo Caso</div>' +
        '<div class="evidencias-grid" id="evid-grid-' + idx + '"></div>' +
        '<div style="margin-top:10px; display:flex; flex-wrap:wrap; gap:8px;">' +
          '<label class="btn btn-secondary">Subir Evidencias<input type="file" accept="image/*" multiple onchange="uploadEvidence(' + idx + ', this)"></label>' +
          '<button class="btn btn-secondary" onclick="pasteEvidence(' + idx + ')">Pegar Evidencia</button>' +
          '<button class="btn btn-secondary" onclick="clearEvidence(' + idx + ')">Limpiar Evidencias</button>' +
          '<label class="btn btn-secondary">Subir Excel<input type="file" accept=".xls,.xlsx" onchange="uploadExcel(' + idx + ', this)"></label>' +
          '<button class="btn" onclick="ejecutarConTerminal(' + idx + ')">Ejecutar con Terminal</button>' +
        '</div>' +
      '</td></tr>';
    }
    function removeCase(idx) {
      const row = document.getElementById('caso-row-' + idx);
      const evid = document.getElementById('evid-row-' + idx);
      if(row) row.remove();
      if(evid) evid.remove();
    }
    function addBlankScenario() {
      const tbody = document.getElementById('casos-tbody');
      const idx = tbody.querySelectorAll('tr[id^="caso-row-"]').length;
      tbody.insertAdjacentHTML('beforeend', createScenarioRowHTML(idx));
    }
    function uploadEvidence(idx, input) {
      const files = input.files;
      const grid = document.getElementById('evid-grid-' + idx);
      for(let i=0; i<files.length; i++) {
        const reader = new FileReader();
        reader.onload = function(e) {
          const div = document.createElement('div');
          div.className = 'evidencia-block';
          div.innerHTML = '<div class="evidencia-label"><span contenteditable="true" class="evidencia-nombre-span">Evidencia ' + (grid.children.length+1) + '</span><button class="btn-evidencia-eliminar" onclick="this.parentElement.parentElement.remove()">&times;</button></div><img src="' + e.target.result + '" alt="Evidencia" />';
          grid.appendChild(div);
        };
        reader.readAsDataURL(files[i]);
      }
      input.value = '';
    }
    function pasteEvidence(idx) {
      navigator.clipboard.read().then(function(data) {
        for (let item of data) {
          if (item.types.includes('image/png')) {
            item.getType('image/png').then(function(blob) {
              const reader = new FileReader();
              reader.onload = function(e) {
                const grid = document.getElementById('evid-grid-' + idx);
                const div = document.createElement('div');
                div.className = 'evidencia-block';
                div.innerHTML = '<div class="evidencia-label"><span contenteditable="true" class="evidencia-nombre-span">Evidencia Pegada</span><button class="btn-evidencia-eliminar" onclick="this.parentElement.parentElement.remove()">&times;</button></div><img src="' + e.target.result + '" alt="Evidencia" />';
                grid.appendChild(div);
              };
              reader.readAsDataURL(blob);
            });
          }
        }
      });
    }
    function clearEvidence(idx) {
      const grid = document.getElementById('evid-grid-' + idx);
      if(grid) grid.innerHTML = '';
    }
    function uploadExcel(idx, input) {
      const files = input.files;
      const grid = document.getElementById('evid-grid-' + idx);
      for(let i=0; i<files.length; i++) {
        const div = document.createElement('div');
        div.className = 'evidencia-block';
        div.innerHTML = '<div class="evidencia-label">Excel ' + (grid.children.length+1) + '</div><span class="excel-file">' + files[i].name + '</span>';
        grid.appendChild(div);
      }
      input.value = '';
    }
    function ejecutarConTerminal(idx) {
      const casoRow = document.getElementById(`caso-row-${idx}`);
      if (!casoRow) {
        console.error(`Error: No se encontró la fila del caso con índice ${idx}`);
        alert(`Error: No se encontró la fila del caso con índice ${idx}`);
        return;
      }
      const idCaso = casoRow.cells[0].innerText.trim();
      const pasoAPaso = casoRow.cells[3].innerText.trim();
      if (!pasoAPaso) {
        alert('La columna "Paso a Paso" está vacía. No hay nada que ejecutar.');
        return;
      }
      const comando = `Ejecutando Caso: ${idCaso}\n\nPasos:\n${pasoAPaso}`;
      const encodedCommand = encodeURIComponent(comando);
      const customUrl = `miappterminal://${encodedCommand}`;
      console.log('Intentando abrir URL:', customUrl);
      window.location.href = customUrl;
    }
    function exportToPDF() {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      doc.text('Reporte de Matriz de Casos de Prueba', 40, 40);
      const tableData = [];
      const rows = document.querySelectorAll('#casos-tbody > tr[id^="caso-row-"]');
      rows.forEach(row => {
          const rowData = Array.from(row.cells).slice(0, 5).map(cell => cell.innerText);
          tableData.push(rowData);
      });
      doc.autoTable({
          head: [['ID Caso', 'Título', 'Precondiciones', 'Paso a Paso', 'Resultado Esperado']],
          body: tableData,
          startY: 60,
          theme: 'grid',
          styles: { fontSize: 8 }
      });
      doc.save('reporte_casos_prueba.pdf');
    }
  </script>
</body>
</html>`;
} 