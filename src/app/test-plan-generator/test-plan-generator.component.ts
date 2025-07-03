// src/app/test-plan-generator/test-plan-generator.component.ts
import { Component, Inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { HUData, GenerationMode, DetailedTestCase } from '../models/hu-data.model';
import { GeminiService } from '../services/gemini.service';
import { catchError, finalize, tap, of } from 'rxjs';
import { saveAs } from 'file-saver';
import { TestCaseGeneratorComponent } from '../test-case-generator/test-case-generator.component';

type StaticSectionBaseName = 'repositoryLink' | 'outOfScope' | 'strategy' | 'limitations' | 'assumptions' | 'team';

@Component({
  selector: 'app-test-plan-generator',
  templateUrl: './test-plan-generator.component.html',
  styleUrls: ['./test-plan-generator.component.css'],
  standalone: true,
  imports: [
    FormsModule,
    CommonModule,
    TestCaseGeneratorComponent
  ]
})
export class TestPlanGeneratorComponent {

  // --- Tus propiedades existentes se mantienen igual ---
  currentGenerationMode: GenerationMode | null = null;
  showTestCaseGenerator: boolean = false;
  showFlowAnalysisComponent: boolean = false;
  showFlowComparisonComponent: boolean = false;
  isModeSelected: boolean = false;
  formError: string | null = null;
  currentFlowSprint: string = 'Sprint Actual';
  huList: HUData[] = [];
  downloadPreviewHtmlContent: string = '';
  bugComparisonErrorGlobal: string | null = null;
  testPlanTitle: string = '';
  repositoryLink: string = 'https://dev.azure.com/YOUR_ORG/YOUR_PROJECT/_git/NU0139001_SAF_MR_Test - Repos (visualstudio.com)';
  outOfScopeContent: string = 'No se probarán funcionalidades o secciones diferentes a los definidos en el alcance.';
  strategyContent: string = 'Trabajar en coordinación con el equipo de desarrollo para identificar y/o corregir errores en etapas tempranas del proyecto.\nReportar bugs de manera inmediata, con el fin de que sean corregidos lo más pronto posible y no se vean afectadas las fechas planteadas para las entregas que generan valor al cliente.\nEl ambiente de certificación se encuentra estable.';
  limitationsContent: string = 'No tener los permisos requeridos para la aplicación.';
  assumptionsContent: string = 'El equipo de desarrollo ha realizado pruebas unitarias y de aceptación.\nSe cuenta con los insumos necesarios para realizar las pruebas.\nSe cuenta con las herramientas necesarias para la ejecución de las pruebas.\nSe cuenta con los permisos y accesos requeridos para las pruebas.\nEl equipo de desarrollo tendrá disponibilidad para la corrección de errores.';
  teamContent: string = 'Dueño del Producto – Bancolombia: Diego Fernando Giraldo Hincapie\nAnalista de Desarrollo – Pragma: Eddy Johana Cristancho\nAnalista de Desarrollo – Luis Alfredo Chuscano Remolina\nAnalista de Desarrollo - Kevin David Cuadros Estupinan\nAnalista de Pruebas – TCS: Gabriel Ernesto Montoya Henao\nAnalista de Pruebas – TCS: Andrés Antonio Bernal Padilla';
  editingRepositoryLink: boolean = false;
  editingOutOfScope: boolean = false;
  editingStrategy: boolean = false;
  editingLimitations: boolean = false;
  editingAssumptions: boolean = false;
  editingTeam: boolean = false;
  loadingOutOfScopeAI: boolean = false;
  errorOutOfScopeAI: string | null = null;
  loadingStrategyAI: boolean = false;
  errorStrategyAI: string | null = null;
  loadingLimitationsAI: boolean = false;
  errorLimitationsAI: string | null = null;
  loadingAssumptionsAI: boolean = false;
  errorAssumptionsAI: string | null = null;
  isRepositoryLinkDetailsOpen: boolean = false;
  isOutOfScopeDetailsOpen: boolean = false;
  isStrategyDetailsOpen: boolean = false;
  isLimitationsDetailsOpen: boolean = false;
  isAssumptionsDetailsOpen: boolean = false;
  isTeamDetailsOpen: boolean = false;
  public macTemplateUrl = 'https://drive.google.com/uc?export=download&id=1FVRJav4D93FeWVq8GqcmYqaVSFBegamT';
  public windowsTemplateUrl = 'https://drive.google.com/uc?export=download&id=1sJ_zIcabBfKmxEgaOWX6_5oq5xol6CkU';

  constructor(
    private geminiService: GeminiService,
    @Inject(PLATFORM_ID) private platformId: Object,
    private cdr: ChangeDetectorRef
  ) {}

  // --- El resto de tus métodos hasta generarReportePDF() se mantienen igual ---
  selectInitialMode(mode: GenerationMode): void {
    if (mode !== 'text' && mode !== 'image') {
      return;
    }
    this.currentGenerationMode = mode;
    this.isModeSelected = true;
    this.showTestCaseGenerator = true;
    this.cdr.detectChanges();
  }
  private resetActiveGeneratorsAndGoToSelection(): void {
    this.currentGenerationMode = null;
    this.showTestCaseGenerator = false;
    this.showFlowAnalysisComponent = false;
    this.showFlowComparisonComponent = false;
    this.isModeSelected = false;
    this.formError = null;
    this.bugComparisonErrorGlobal = null;
    this.cdr.detectChanges();
  }
  onHuGeneratedFromChild(huData: HUData) {
    this.huList.push(huData);
    this.updateTestPlanTitle();
    this.updatePreview();
    this.resetActiveGeneratorsAndGoToSelection();
  }
  onGenerationCancelledFromChild() {
    this.resetActiveGeneratorsAndGoToSelection();
  }
  onAnalysisDataGenerated(huData: HUData) {
    this.huList.push(huData);
    this.updateTestPlanTitle();
    this.updatePreview();
    this.resetActiveGeneratorsAndGoToSelection();
  }
  onAnalysisCancelledFromChild() {
    this.resetActiveGeneratorsAndGoToSelection();
  }
  onComparisonDataGenerated(huData: HUData) {
    this.huList.push(huData);
    this.updateTestPlanTitle();
    this.updatePreview();
    this.resetActiveGeneratorsAndGoToSelection();
  }
  onComparisonCancelledFromChild() {
    this.resetActiveGeneratorsAndGoToSelection();
  }
  resetToInitialSelection(): void {
    this.resetActiveGeneratorsAndGoToSelection();
  }
  public toggleEdit(hu: HUData, section: 'scope' | 'scenarios'): void {
    if (section === 'scope') {
      if (hu.originalInput.generationMode === 'text') {
        hu.editingScope = !hu.editingScope;
        if (hu.editingScope) hu.isScopeDetailsOpen = true;
      } else {
        alert("El alcance no es aplicable/editable para este modo.");
      }
    } else if (section === 'scenarios') {
       alert("La edición de casos de prueba se realiza en el componente de generación antes de añadir al plan.");
    }
    if (!hu.editingScope) {
        this.updatePreview();
    }
    this.cdr.detectChanges();
  }
  public toggleStaticEdit(baseName: StaticSectionBaseName): void {
    let editingProp: keyof TestPlanGeneratorComponent;
    let detailsOpenProp: keyof TestPlanGeneratorComponent;
    switch (baseName) {
      case 'repositoryLink': editingProp = 'editingRepositoryLink'; detailsOpenProp = 'isRepositoryLinkDetailsOpen'; break;
      case 'outOfScope': editingProp = 'editingOutOfScope'; detailsOpenProp = 'isOutOfScopeDetailsOpen'; break;
      case 'strategy': editingProp = 'editingStrategy'; detailsOpenProp = 'isStrategyDetailsOpen'; break;
      case 'limitations': editingProp = 'editingLimitations'; detailsOpenProp = 'isLimitationsDetailsOpen'; break;
      case 'assumptions': editingProp = 'editingAssumptions'; detailsOpenProp = 'isAssumptionsDetailsOpen'; break;
      case 'team': editingProp = 'editingTeam'; detailsOpenProp = 'isTeamDetailsOpen'; break;
      default: return;
    }
    const wasEditing = this[editingProp] as boolean;
    (this[editingProp] as any) = !wasEditing;
    if (this[editingProp]) { (this[detailsOpenProp] as any) = true; }
    if (wasEditing && !(this[editingProp] as boolean)) { this.updatePreview(); }
    this.cdr.detectChanges();
  }
  public regenerateScope(hu: HUData): void {
    if (hu.originalInput.generationMode !== 'text' || !hu.originalInput.description || !hu.originalInput.acceptanceCriteria) {
      alert('Alcance solo se regenera para HUs con descripción/criterios.'); return;
    }
    hu.editingScope = false; hu.isScopeDetailsOpen = true; hu.loadingScope = true; hu.errorScope = null;
    this.geminiService.generateTestPlanSections(hu.originalInput.description!, hu.originalInput.acceptanceCriteria!)
      .pipe(
        tap(scopeText => { hu.generatedScope = scopeText; hu.errorScope = null; }),
        catchError(error => { hu.errorScope = (typeof error === 'string' ? error : error.message) || 'Error regenerando alcance.'; return of(''); }),
        finalize(() => { hu.loadingScope = false; this.updatePreview(); this.cdr.detectChanges(); })
      ).subscribe();
  }
  public exportExecutionMatrix(hu: HUData): void {
    if (!hu.detailedTestCases || hu.detailedTestCases.length === 0 || hu.detailedTestCases.some(tc => tc.title.startsWith("Error") || tc.title === "Información Insuficiente" || tc.title === "Imágenes no interpretables o técnica no aplicable"  || tc.title === "Refinamiento no posible con el contexto actual")) {
      alert('No hay casos de prueba válidos para exportar o los casos generados indican un error.');
      return;
    }
    const csvHeader = ["ID Caso", "Escenario de Prueba", "Precondiciones", "Paso a Paso", "Resultado Esperado"];
    const csvRows = hu.detailedTestCases.map((tc, index) => {
      const stepsString = Array.isArray(tc.steps) ? tc.steps.map(step => `${step.numero_paso}. ${step.accion}`).join('\n') : 'Pasos no disponibles.';
      return [
        this.escapeCsvField(hu.id + '_CP' + (index + 1)),
        this.escapeCsvField(tc.title),
        this.escapeCsvField(tc.preconditions),
        this.escapeCsvField(stepsString),
        this.escapeCsvField(tc.expectedResults)
      ];
    });
    const csvFullContent = [csvHeader.join(','), ...csvRows.map(row => row.join(','))].join('\r\n');
    saveAs(new Blob(["\uFEFF" + csvFullContent], { type: 'text/csv;charset=utf-8;' }), `MatrizEjecucion_${this.escapeFilename(hu.id)}_${new Date().toISOString().split('T')[0]}.csv`);
  }
  public isAnyHuTextBased = (): boolean => this.huList.some(hu => hu.originalInput.generationMode === 'text');
  public trackHuById = (i: number, hu: HUData): string => hu.id;
  private escapeCsvField = (f: string | number | undefined | null): string => {
      if (f === null || f === undefined) return '';
      const stringValue = String(f);
      if (stringValue.includes('"') || stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('\r')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
  };
  public exportExecutionMatrixToHtml(hu: HUData): void {
    if (!hu.detailedTestCases || hu.detailedTestCases.length === 0 || hu.detailedTestCases.some(tc => tc.title.startsWith("Error") || tc.title === "Información Insuficiente" || tc.title === "Imágenes no interpretables o técnica no aplicable"  || tc.title === "Refinamiento no posible con el contexto actual")) {
      alert('No hay casos de prueba válidos para exportar o los casos generados indican un error.');
      return;
    }
    const date = new Date();
    const formattedDate = date.getFullYear() + '-' + ('0' + (date.getMonth() + 1)).slice(-2) + '-' + ('0' + date.getDate()).slice(-2);
    const rowsHtml = hu.detailedTestCases.map((tc, idx) => `
      <tr id="caso-row-${idx}">
        <td contenteditable="true">${this.escapeHtmlForExport(hu.id + '_CP' + (idx + 1))}</td>
        <td contenteditable="true">${this.escapeHtmlForExport(tc.title)}</td>
        <td contenteditable="true">${this.escapeHtmlForExport(tc.preconditions)}</td>
        <td contenteditable="true">${Array.isArray(tc.steps) ? tc.steps.map(step => this.escapeHtmlForExport(step.numero_paso + '. ' + step.accion)).join('<br>') : 'Pasos no disponibles.'}</td>
        <td contenteditable="true">${this.escapeHtmlForExport(tc.expectedResults)}</td>
        <td><div class="acciones-btn">
          <button class="btn btn-danger" onclick="removeCase(${idx})">Eliminar</button>
        </div></td>
      </tr>
      <tr id="evid-row-${idx}"><td colspan="6">
        <div class="evidencias-titulo">Evidencias para ${this.escapeHtmlForExport(hu.id + '_CP' + (idx + 1))}</div>
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
    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Matriz de Casos de Prueba - Con Terminal</title>
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
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"><\/script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"><\/script>
</head>
<body>
  <div class="container">
    <h1>Matriz de Casos de Prueba</h1>
    <table id="casos-table">
      <thead>
        <tr>
          <th>ID Caso</th>
          <th>Escenario de Prueba</th>
          <th>Precondiciones</th>
          <th>Paso a Paso</th>
          <th>Resultado Esperado</th>
          <th>Acción</th>
        </tr>
      </thead>
      <tbody id="casos-tbody">
        ${rowsHtml}
      </tbody>
    </table>
    <div class="add-scenario-bar">
      <button class="btn" onclick="addScenario()">Agregar Escenario en Blanco</button>
    </div>
    <div class="export-bar">
      <button class="btn" onclick="generarReportePDF()">Exportar PDF</button>
    </div>
    <div class="footer">Exportado el ${formattedDate} &mdash; Generado automáticamente</div>
  </div>
  <script>
    function createScenarioRowHTML(idx) {
      return \`<tr id="caso-row-\${idx}">
        <td contenteditable="true"></td>
        <td contenteditable="true"></td>
        <td contenteditable="true"></td>
        <td contenteditable="true"></td>
        <td contenteditable="true"></td>
        <td><div class="acciones-btn">
          <button class="btn btn-danger" onclick="removeCase(\${idx})">Eliminar</button>
        </div></td>
      </tr>
      <tr id="evid-row-\${idx}"><td colspan="6">
        <div class="evidencias-titulo">Evidencias para Nuevo Caso</div>
        <div class="evidencias-grid" id="evid-grid-\${idx}"></div>
        <div style="margin-top:10px; display:flex; flex-wrap:wrap; gap:8px;">
          <label class="btn btn-secondary">Subir Evidencias<input type="file" accept="image/*" multiple onchange="uploadEvidence(\${idx}, this)"></label>
          <button class="btn btn-secondary" onclick="pasteEvidence(\${idx})">Pegar Evidencia</button>
          <button class="btn btn-secondary" onclick="clearEvidence(\${idx})">Limpiar Evidencias</button>
          <label class="btn btn-secondary">Subir Excel<input type="file" accept=".xls,.xlsx" onchange="uploadExcel(\${idx}, this)"></label>
          <button class="btn" onclick="ejecutarConTerminal(\${idx})">Ejecutar con Terminal</button>
        </div>
      </td></tr>\`;
    }
    function removeCase(idx) {
      const row = document.getElementById(\`caso-row-\${idx}\`);
      const evid = document.getElementById(\`evid-row-\${idx}\`);
      if(row) row.remove();
      if(evid) evid.remove();
    }
    function addScenario() {
      const tbody = document.getElementById('casos-tbody');
      const idx = tbody.querySelectorAll('tr[id^="caso-row-"]').length;
      tbody.insertAdjacentHTML('beforeend', createScenarioRowHTML(idx));
    }
    function uploadEvidence(idx, input) {
      const files = input.files;
      const grid = document.getElementById(\`evid-grid-\${idx}\`);
      for(let i=0; i<files.length; i++) {
        const reader = new FileReader();
        reader.onload = function(e) {
          const div = document.createElement('div');
          div.className = 'evidencia-block';
          div.innerHTML = \`<div class="evidencia-label"><span contenteditable="true" class="evidencia-nombre-span">Evidencia \${grid.children.length+1}</span><button class="btn-evidencia-eliminar" onclick="this.parentElement.parentElement.remove()">&times;</button></div><img src="\${e.target.result}" alt="Evidencia" />\`;
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
                const grid = document.getElementById(\`evid-grid-\${idx}\`);
                const div = document.createElement('div');
                div.className = 'evidencia-block';
                div.innerHTML = \`<div class="evidencia-label"><span contenteditable="true" class="evidencia-nombre-span">Evidencia Pegada</span><button class="btn-evidencia-eliminar" onclick="this.parentElement.parentElement.remove()">&times;</button></div><img src="\${e.target.result}" alt="Evidencia" />\`;
                grid.appendChild(div);
              };
              reader.readAsDataURL(blob);
            });
          }
        }
      });
    }
    function clearEvidence(idx) {
      const grid = document.getElementById(\`evid-grid-\${idx}\`);
      if(grid) grid.innerHTML = '';
    }
    function uploadExcel(idx, input) {
      const files = input.files;
      const grid = document.getElementById(\`evid-grid-\${idx}\`);
      for(let i=0; i<files.length; i++) {
        const div = document.createElement('div');
        div.className = 'evidencia-block';
        div.innerHTML = \`<div class="evidencia-label">Excel \${grid.children.length+1}</div><span class="excel-file">\${files[i].name}</span>\`;
        grid.appendChild(div);
      }
      input.value = '';
    }
    function ejecutarConTerminal(idx) {
      const casoRow = document.getElementById(\`caso-row-\${idx}\`);
      if (!casoRow) {
        console.error(\`Error: No se encontró la fila del caso con índice \${idx}\`);
        alert(\`Error: No se encontró la fila del caso con índice \${idx}\`);
        return;
      }
      const idCaso = casoRow.cells[0].innerText.trim();
      const pasoAPaso = casoRow.cells[3].innerText.trim();
      
      if (!pasoAPaso) {
        alert('La columna "Paso a Paso" está vacía. No hay nada que ejecutar.');
        return;
      }
      const comando = \`Ejecutando Caso: \${idCaso}\\n\\nPasos:\\n\${pasoAPaso}\`;
      const encodedCommand = encodeURIComponent(comando);
      const customUrl = \`miappterminal://\${encodedCommand}\`;
      console.log('Intentando abrir URL:', customUrl);
      window.location.href = customUrl;
    }
    function generarReportePDF() {
      if (typeof window !== 'undefined') {
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
            head: [['ID Caso', 'Escenario de Prueba', 'Precondiciones', 'Paso a Paso', 'Resultado Esperado']],
            body: tableData,
            startY: 60,
            theme: 'grid',
            styles: { fontSize: 8 }
        });
        doc.save('reporte_casos_prueba.pdf');
      }
    }
  <\/script>
</body>
</html>`;
    saveAs(new Blob([html], { type: 'text/html;charset=utf-8;' }), `Matriz_Casos_Prueba_${this.escapeFilename(hu.id)}_${formattedDate}.html`);
  }
  public getHuSummaryForStaticAI(): string {
    if (this.huList.length === 0) return "No hay Historias de Usuario definidas aún.";
    let summary = this.huList.map(hu => {
      let huDesc = `ID ${hu.id} (${hu.title}): Modo "${hu.originalInput.generationMode}".`;
      if (hu.originalInput.generationMode === 'text' && hu.originalInput.description) {
        huDesc += ` Descripción: ${hu.originalInput.description.substring(0, 70)}...`;
      } else if (hu.originalInput.generationMode === 'image') {
        huDesc += ` (Desde ${hu.originalInput.imagesBase64?.length || 0} imagen(es), título: ${hu.title}, técnica: ${hu.originalInput.selectedTechnique})`;
      }
      return `- ${huDesc}`;
    }).join('\n');
    return summary.length > 1500 ? summary.substring(0, 1500) + "\n... (resumen truncado para no exceder límites de prompt)" : summary;
  }
  public regenerateStaticSectionWithAI(section: 'outOfScope' | 'strategy' | 'limitations' | 'assumptions'): void {
    let sectionNameDisplay = '', currentContent = '', loadingFlag: keyof TestPlanGeneratorComponent | null = null, errorFlag: keyof TestPlanGeneratorComponent | null = null;
    let detailsOpenFlag: keyof TestPlanGeneratorComponent | null = null;
    switch (section) {
      case 'outOfScope': sectionNameDisplay = 'Fuera del Alcance'; currentContent = this.outOfScopeContent; loadingFlag = 'loadingOutOfScopeAI'; errorFlag = 'errorOutOfScopeAI'; detailsOpenFlag = 'isOutOfScopeDetailsOpen'; break;
      case 'strategy': sectionNameDisplay = 'Estrategia'; currentContent = this.strategyContent; loadingFlag = 'loadingStrategyAI'; errorFlag = 'errorStrategyAI'; detailsOpenFlag = 'isStrategyDetailsOpen'; break;
      case 'limitations': sectionNameDisplay = 'Limitaciones'; currentContent = this.limitationsContent; loadingFlag = 'loadingLimitationsAI'; errorFlag = 'errorLimitationsAI'; detailsOpenFlag = 'isLimitationsDetailsOpen'; break;
      case 'assumptions': sectionNameDisplay = 'Supuestos'; currentContent = this.assumptionsContent; loadingFlag = 'loadingAssumptionsAI'; errorFlag = 'errorAssumptionsAI'; detailsOpenFlag = 'isAssumptionsDetailsOpen'; break;
      default: return;
    }
    if (loadingFlag) (this[loadingFlag] as any) = true; if (errorFlag) (this[errorFlag] as any) = null; if (detailsOpenFlag) (this[detailsOpenFlag] as any) = true;
    this.geminiService.generateEnhancedStaticSectionContent(sectionNameDisplay, currentContent, this.getHuSummaryForStaticAI())
      .pipe(
          finalize(() => {
              if (loadingFlag) (this[loadingFlag] as any) = false;
              this.updatePreview();
              this.cdr.detectChanges();
            })
      )
      .subscribe({
        next: (aiResponse) => {
          if (aiResponse?.trim()) {
            const isPlaceholder =
                (section === 'outOfScope' && currentContent.trim().toLowerCase().startsWith('no se probarán')) ||
                (section === 'limitations' && currentContent.trim().toLowerCase().startsWith('no tener los permisos')) ||
                currentContent.trim() === '';
            const newContent = isPlaceholder ? aiResponse.trim() : currentContent + '\n\n' + aiResponse.trim();
            switch (section) {
              case 'outOfScope': this.outOfScopeContent = newContent; break;
              case 'strategy': this.strategyContent = newContent; break;
              case 'limitations': this.limitationsContent = newContent; break;
              case 'assumptions': this.assumptionsContent = newContent; break;
            }
          } else if (errorFlag) {
              (this[errorFlag] as any) = 'La IA no generó contenido adicional o la respuesta fue vacía.';
          }
        },
        error: (err) => {
            if (errorFlag) (this[errorFlag] as any) = err.message || `Error regenerando sección "${sectionNameDisplay}".`;
        }
      });
  }
  public formatSimpleScenarioTitles(titles: string[]): string {
    if (!titles || titles.length === 0) return 'No se generaron escenarios.';
    return titles.map((title, index) => `${index + 1}. ${title}`).join('\n');
  }
  public updateTestPlanTitle(): void {
    if (this.huList.length > 0) {
      const relevantHuForTitle = [...this.huList].reverse().find(hu => hu.originalInput.generationMode !== undefined) || this.huList[this.huList.length - 1];
      this.testPlanTitle = `TEST PLAN EVC00057_ ${relevantHuForTitle.id} SPRINT ${relevantHuForTitle.sprint}`;
    } else {
        this.testPlanTitle = 'Plan de Pruebas (Aún sin entradas)';
    }
    this.cdr.detectChanges();
  }
  public updatePreview(): void {
    this.downloadPreviewHtmlContent = this.generatePlanContentHtmlString();
    this.cdr.detectChanges();
  }
  public generatePlanContentString(): string {
    if (this.huList.length === 0 && !this.testPlanTitle) return 'Plan de pruebas aún no generado. Añade entradas.';
    let fullPlanContent = '';
    if (this.testPlanTitle) fullPlanContent += `Título del Plan de Pruebas: ${this.testPlanTitle}\n\n`;
    fullPlanContent += `Repositorio pruebas VSTS: ${this.repositoryLink}\n\n`;
    if (this.isAnyHuTextBased()) {
        fullPlanContent += `ALCANCE:\n\n`;
        this.huList.forEach(hu => {
            if (hu.originalInput.generationMode === 'text') {
                fullPlanContent += `HU ${hu.id}: ${hu.title}\n${hu.generatedScope || 'Alcance no generado o no aplica.'}\n\n`;
            }
        });
    }
    fullPlanContent += `FUERA DEL ALCANCE:\n\n${this.outOfScopeContent}\n\nESTRATEGIA:\n\n${this.strategyContent}\n\n`;
    const scenarioHUs = this.huList.filter(hu => hu.originalInput.generationMode === 'text' || hu.originalInput.generationMode === 'image');
    if(scenarioHUs.length > 0){
        fullPlanContent += `CASOS DE PRUEBA (Solo Títulos):\n\n`;
        scenarioHUs.forEach(hu => {
            fullPlanContent += `ID ${hu.id}: ${hu.title} ${hu.originalInput.generationMode === 'image' ? `(Desde ${hu.originalInput.imagesBase64?.length || 0} imgs - Técnica: ${hu.originalInput.selectedTechnique})` : `(Técnica: ${hu.originalInput.selectedTechnique})`}\n${hu.generatedTestCaseTitles || 'Casos no generados o error.'}\n\n`;
        });
    }
    fullPlanContent += `LIMITACIONES:\n\n${this.limitationsContent}\n\nSUPUESTOS:\n\n${this.assumptionsContent}\n\nEquipo de Trabajo:\n\n${this.teamContent}\n\n`;
    return fullPlanContent;
  }
  public generatePlanContentHtmlString(): string {
    if (this.huList.length === 0 && !this.testPlanTitle) { return '<p style="text-align:center; color:#6c757d;">Plan de pruebas aún no generado. Añade entradas.</p>'; }
    let fullPlanHtmlContent = '';
    const currentDateForHtml = new Date().toISOString().split('T')[0];
    if (this.testPlanTitle) { fullPlanHtmlContent += `<p><span class="preview-section-title">Título del Plan de Pruebas:</span> ${this.escapeHtmlForExport(this.testPlanTitle)}</p>\n\n`; }
    const repoLinkUrl = this.repositoryLink.split(' ')[0];
    fullPlanHtmlContent += `<p><span class="preview-section-title">Repositorio pruebas VSTS:</span> <a href="${this.escapeHtmlForExport(repoLinkUrl)}" target="_blank" rel="noopener noreferrer">${this.escapeHtmlForExport(this.repositoryLink)}</a></p>\n\n`;
    if (this.isAnyHuTextBased()) {
        fullPlanHtmlContent += `<p><span class="preview-section-title">ALCANCE:</span></p>\n`;
        this.huList.forEach((hu) => {
          if (hu.originalInput.generationMode === 'text') {
            fullPlanHtmlContent += `<p><span class="preview-hu-title">HU ${this.escapeHtmlForExport(hu.id)}: ${this.escapeHtmlForExport(hu.title)}</span><br>\n`;
            fullPlanHtmlContent += `${this.escapeHtmlForExport(hu.generatedScope) || '<em>Alcance no generado o no aplica.</em>'}</p>\n\n`;
          }
        });
    }
    fullPlanHtmlContent += `<p><span class="preview-section-title">FUERA DEL ALCANCE:</span><br>\n${this.escapeHtmlForExport(this.outOfScopeContent)}</p>\n\n`;
    fullPlanHtmlContent += `<p><span class="preview-section-title">ESTRATEGIA:</span><br>\n${this.escapeHtmlForExport(this.strategyContent)}</p>\n\n`;
    const scenarioHUs = this.huList.filter(hu => hu.originalInput.generationMode === 'text' || hu.originalInput.generationMode === 'image');
    if(scenarioHUs.length > 0){
        fullPlanHtmlContent += `<p><span class="preview-section-title">CASOS DE PRUEBA (Solo Títulos):</span></p>\n`;
        scenarioHUs.forEach((hu) => {
          fullPlanHtmlContent += `<p><span class="preview-hu-title">ID ${this.escapeHtmlForExport(hu.id)}: ${this.escapeHtmlForExport(hu.title)} ${hu.originalInput.generationMode === 'image' ? `(Generada desde ${hu.originalInput.imagesBase64?.length || 0} imagen(es) - Técnica: ${this.escapeHtmlForExport(hu.originalInput.selectedTechnique)})` : `(Técnica: ${this.escapeHtmlForExport(hu.originalInput.selectedTechnique)})`}</span><br>\n`;
          fullPlanHtmlContent += `${this.escapeHtmlForExport(hu.generatedTestCaseTitles) || '<em>Casos no generados o error.</em>'}</p>\n\n`;
        });
    }
    fullPlanHtmlContent += `<p><span class="preview-section-title">LIMITACIONES:</span><br>\n${this.escapeHtmlForExport(this.limitationsContent)}</p>\n\n`;
    fullPlanHtmlContent += `<p><span class="preview-section-title">SUPUESTOS:</span><br>\n${this.escapeHtmlForExport(this.assumptionsContent)}</p>\n\n`;
    fullPlanHtmlContent += `<p><span class="preview-section-title">Equipo de Trabajo:</span><br>\n${this.escapeHtmlForExport(this.teamContent)}</p>\n\n`;
    return fullPlanHtmlContent;
  }
  public copyPreviewToClipboard(): void {
    const planText = this.generatePlanContentString();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(planText)
        .then(() => alert('Plan de pruebas copiado al portapapeles!'))
        .catch(err => {
            console.error('Error al copiar al portapapeles:', err);
            alert('Error al copiar: ' + err);
        });
    } else {
      alert('La API del portapapeles no es compatible con este navegador.');
    }
  }
  public downloadWord(): void {
    const htmlContent = this.generatePlanContentHtmlString();
    if (htmlContent.includes('Plan de pruebas aún no generado')) {
      alert('No hay contenido del plan para descargar.');
      return;
    }
    try {
      import('html-to-docx').then(module => {
        const htmlToDocx = module.default;
        if (typeof htmlToDocx === 'function') {
          const headerHtml = `<p style="font-size:10pt;color:#888888;text-align:right;">Plan de Pruebas - ${this.testPlanTitle || 'General'}</p>`;
          
          const fullHtmlForDocx = `
            <!DOCTYPE html>
            <html>
              <head>
                <meta charset="UTF-8">
                <style>
                  body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; }
                  p { margin-bottom: 10px; line-height: 1.5; }
                  h1, .preview-section-title { font-size: 16pt; color: #2F5496; margin-bottom: 5px; font-weight: bold; }
                  h2, .preview-hu-title { font-size: 14pt; color: #365F91; margin-bottom: 5px; font-weight: bold; }
                  h3 { font-size: 12pt; color: #4F81BD; margin-bottom: 5px; font-weight: bold; }
                  ul, ol { margin-top: 0; margin-bottom: 10px; padding-left: 30px; }
                  li { margin-bottom: 5px; }
                  table { border-collapse: collapse; width: 100%; margin-bottom: 15px; }
                  th, td { border: 1px solid #BFBFBF; padding: 5px; text-align: left; font-size:10pt; }
                  th { background-color: #F2F2F2; font-weight: bold; }
                  .bug-report-image { max-width: 90%; height: auto; display: block; margin: 5px 0; border: 1px solid #ccc; }
                  pre { white-space: pre-wrap; word-wrap: break-word; font-family: inherit; font-size: inherit; }
                </style>
              </head>
              <body>
                ${htmlContent}
              </body>
            </html>`;

          htmlToDocx(fullHtmlForDocx, headerHtml, {
            table: { row: { cantSplit: true } },
            footer: true,
            pageNumber: true,
          }).then((fileBuffer: BlobPart) => {
            saveAs(new Blob([fileBuffer]), `${this.escapeFilename(this.testPlanTitle || 'PlanDePruebas')}.docx`);
          }).catch((error: any) => {
            console.error('Error al generar DOCX con html-to-docx:', error);
            alert('Error al generar el archivo DOCX. Ver consola para detalles. Se descargará como HTML.');
            this.downloadHtmlFallback(htmlContent);
          });
        } else {
          console.error('htmlToDocx no es una función. La importación pudo haber fallado o el módulo no es compatible.');
          alert('No se pudo generar el archivo DOCX. La librería no cargó correctamente. Se descargará como HTML.');
           this.downloadHtmlFallback(htmlContent);
        }
      }).catch(error => {
        console.error('Error al importar html-to-docx:', error);
        alert('No se pudo cargar la librería para generar DOCX. Se descargará como HTML.');
        this.downloadHtmlFallback(htmlContent);
      });
    } catch (e) {
      console.error('Excepción general al intentar generar DOCX:', e);
      alert('Error al intentar generar DOCX. Se descargará como HTML.');
      this.downloadHtmlFallback(htmlContent);
    }
  }
  private downloadHtmlFallback(htmlContent: string): void {
    const blob = new Blob(['\uFEFF', htmlContent], { type: 'text/html;charset=utf-8' });
    saveAs(blob, `${this.escapeFilename(this.testPlanTitle || 'PlanDePruebas')}_Fallback.html`);
  }
  private escapeFilename = (filename: string): string => filename.replace(/[^a-z0-9_.\-]/gi, '_').substring(0, 50);
  private escapeHtmlForExport = (u: string | undefined | null): string => { if (!u) return ''; return u.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); };
}