// src/app/test-plan-generator/test-plan-generator.component.ts
import { Component, ViewChild, AfterViewInit, OnDestroy, ElementRef } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { GeminiService, DetailedTestCase } from '../services/gemini.service'; // Importar DetailedTestCase
import { catchError, finalize, tap } from 'rxjs/operators';
import { of, Subscription } from 'rxjs';
import { saveAs } from 'file-saver';
import { HUData } from '../models/hu-data.model';

type StaticSectionBaseName = 'repositoryLink' | 'outOfScope' | 'strategy' | 'limitations' | 'assumptions' | 'team';

@Component({
  selector: 'app-test-plan-generator',
  templateUrl: './test-plan-generator.component.html',
  styleUrls: ['./test-plan-generator.component.css'],
  standalone: true,
  imports: [
    FormsModule,
    CommonModule
  ]
})
export class TestPlanGeneratorComponent implements AfterViewInit, OnDestroy {

  currentHuId: string = '';
  currentHuTitle: string = '';
  currentSprint: string = '';
  currentDescription: string = '';
  currentAcceptanceCriteria: string = '';
  currentSelectedTechnique: string = '';

  huList: HUData[] = [];
  downloadPreviewHtmlContent: string = '';

  loadingSections: boolean = false;
  sectionsError: string | null = null;
  loadingScenarios: boolean = false;
  scenariosError: string | null = null;

  isFormInvalid: boolean = true;
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

  isRepositoryLinkDetailsOpen: boolean = true;
  isOutOfScopeDetailsOpen: boolean = true;
  isStrategyDetailsOpen: boolean = true;
  isLimitationsDetailsOpen: boolean = true;
  isAssumptionsDetailsOpen: boolean = true;
  isTeamDetailsOpen: boolean = true;

  @ViewChild('huForm') huFormDirective!: NgForm;
  private formStatusSubscription!: Subscription;
  @ViewChild('scenariosTextarea') scenariosTextarea: ElementRef | undefined;

  constructor(private geminiService: GeminiService) { }

  ngAfterViewInit(): void {
    if (this.huFormDirective && this.huFormDirective.statusChanges) {
      this.formStatusSubscription = this.huFormDirective.statusChanges.subscribe(status => {
        setTimeout(() => {
          this.isFormInvalid = status !== 'VALID';
        });
      });
    }
  }

  ngOnDestroy(): void {
    if (this.formStatusSubscription) {
      this.formStatusSubscription.unsubscribe();
    }
  }

  addHuAndGenerateData(): void {
    if (this.huFormDirective.invalid) {
      Object.keys(this.huFormDirective.controls).forEach(key => {
        this.huFormDirective.controls[key].markAsTouched();
      });
      return;
    }

    const newHu: HUData = {
      originalInput: {
        id: this.currentHuId,
        title: this.currentHuTitle,
        sprint: this.currentSprint,
        description: this.currentDescription,
        acceptanceCriteria: this.currentAcceptanceCriteria,
        selectedTechnique: this.currentSelectedTechnique
      },
      id: this.currentHuId.trim(),
      title: this.currentHuTitle.trim(),
      sprint: this.currentSprint.trim(),
      generatedScope: '',
      detailedTestCases: [],
      generatedTestCaseTitles: '',
      editingScope: false,
      editingScenarios: false,
      loadingScope: true,
      errorScope: null,
      loadingScenarios: true,
      errorScenarios: null,
      showRegenTechniquePicker: false,
      regenSelectedTechnique: '',
      isScopeDetailsOpen: true,
      isScenariosDetailsOpen: true
    };

    this.huList.push(newHu);
    this.loadingSections = true; this.sectionsError = null;
    this.loadingScenarios = true; this.scenariosError = null;

    this.geminiService.generateTestPlanSections(newHu.originalInput.description, newHu.originalInput.acceptanceCriteria)
      .pipe(
        tap(scopeText => {
          newHu.generatedScope = scopeText;
          newHu.loadingScope = false;
        }),
        catchError(error => {
          newHu.errorScope = (typeof error === 'string' ? error : error.message) || 'Error al generar alcance.';
          newHu.loadingScope = false;
          this.sectionsError = 'Error al generar el alcance para una HU.';
          return of('');
        }),
        finalize(() => {
          this.checkOverallLoadingStatus();
          this.updateTestPlanTitle();
          this.updatePreview();
          this.generateInitialDetailedTestCases(newHu);
        })
      )
      .subscribe();
  }

  private generateInitialDetailedTestCases(hu: HUData): void {
    this._generateDetailedTestCasesForHu(hu, hu.originalInput.selectedTechnique, true);
  }

  private _generateDetailedTestCasesForHu(hu: HUData, technique: string, isInitialGeneration: boolean = false): void {
    hu.loadingScenarios = true;
    hu.errorScenarios = null;
    if (!isInitialGeneration) {
        this.loadingScenarios = this.huList.some(h => h.loadingScenarios || (h.id === hu.id && hu.loadingScenarios));
    }

    this.geminiService.generateDetailedTestCases(
      hu.originalInput.description,
      hu.originalInput.acceptanceCriteria,
      technique
    )
    .pipe(
      tap(detailedTestCases => {
        hu.detailedTestCases = detailedTestCases;
        hu.generatedTestCaseTitles = this.formatSimpleScenarioTitles(detailedTestCases.map(tc => tc.title));
        hu.loadingScenarios = false;
        hu.errorScenarios = null;
        if (hu.showRegenTechniquePicker) {
            hu.showRegenTechniquePicker = false;
            hu.regenSelectedTechnique = '';
        }
      }),
      catchError(error => {
        hu.errorScenarios = (typeof error === 'string' ? error : error.message) || 'Error al generar casos de prueba detallados.';
        // VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV CORRECCIÓN AQUÍ VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV
        hu.detailedTestCases = [{ title: "Error", preconditions: hu.errorScenarios ?? "Error no especificado.", steps: "N/A", expectedResults: "N/A" }];
        // ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ CORRECCIÓN AQUÍ ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
        hu.generatedTestCaseTitles = "Error al generar casos de prueba.";
        hu.loadingScenarios = false;
        if (!isInitialGeneration) this.scenariosError = `Error al generar casos para HU ${hu.id}.`; else this.scenariosError = 'Error al generar casos para una HU.';
        return of([]);
      }),
      finalize(() => {
        hu.loadingScenarios = false;
        this.checkOverallLoadingStatus();
        if (isInitialGeneration) {
          this.resetCurrentInputs();
        }
        this.updatePreview();
      })
    )
    .subscribe();
  }

  private checkOverallLoadingStatus(): void {
    this.loadingSections = this.huList.some(huItem => huItem.loadingScope);
    this.loadingScenarios = this.huList.some(huItem => huItem.loadingScenarios);
  }

  toggleEdit(hu: HUData, section: 'scope' | 'scenarios'): void {
    if (section === 'scenarios' && hu.showRegenTechniquePicker) {
      this.cancelScenarioRegeneration(hu);
    }
    if (section === 'scope') {
      hu.editingScope = !hu.editingScope;
      if (hu.editingScope) hu.isScopeDetailsOpen = true;
    } else if (section === 'scenarios') {
      hu.editingScenarios = !hu.editingScenarios;
      if (hu.editingScenarios) {
        hu.isScenariosDetailsOpen = true;
        setTimeout(() => this.scenariosTextarea?.nativeElement.focus(), 0);
      }
    }
    if (section === 'scope' && !hu.editingScope) {
      this.updatePreview();
    }
  }

  toggleStaticEdit(baseName: StaticSectionBaseName): void {
    let editingProp: keyof TestPlanGeneratorComponent;
    let detailsOpenProp: keyof TestPlanGeneratorComponent;
    switch (baseName) {
      case 'repositoryLink': editingProp = 'editingRepositoryLink'; detailsOpenProp = 'isRepositoryLinkDetailsOpen'; break;
      case 'outOfScope': editingProp = 'editingOutOfScope'; detailsOpenProp = 'isOutOfScopeDetailsOpen'; break;
      case 'strategy': editingProp = 'editingStrategy'; detailsOpenProp = 'isStrategyDetailsOpen'; break;
      case 'limitations': editingProp = 'editingLimitations'; detailsOpenProp = 'isLimitationsDetailsOpen'; break;
      case 'assumptions': editingProp = 'editingAssumptions'; detailsOpenProp = 'isAssumptionsDetailsOpen'; break;
      case 'team': editingProp = 'editingTeam'; detailsOpenProp = 'isTeamDetailsOpen'; break;
      default: const exhaustiveCheck: never = baseName; console.error('Invalid static section base name:', exhaustiveCheck); return;
    }
    const wasEditing = this[editingProp] as boolean;
    (this[editingProp] as any) = !wasEditing;
    if (this[editingProp]) { (this[detailsOpenProp] as any) = true; }
    if (wasEditing && !(this[editingProp] as boolean)) { this.updatePreview(); }
  }

  startScenarioRegeneration(hu: HUData): void {
    hu.editingScenarios = false;
    hu.showRegenTechniquePicker = true;
    hu.isScenariosDetailsOpen = true;
    hu.regenSelectedTechnique = hu.originalInput.selectedTechnique;
    hu.errorScenarios = null;
    this.scenariosError = null;
  }

  cancelScenarioRegeneration(hu: HUData): void {
    hu.showRegenTechniquePicker = false;
    hu.regenSelectedTechnique = '';
    hu.errorScenarios = null;
  }

  confirmRegenerateScenarios(hu: HUData): void {
    if (!hu.regenSelectedTechnique) {
      hu.errorScenarios = 'Debes seleccionar una técnica para regenerar.';
      // Es buena idea NO poner hu.loadingScenarios = false aquí,
      // porque si el usuario selecciona una técnica después, el botón debe estar habilitado.
      return;
    }
    if (!hu.originalInput.description || !hu.originalInput.acceptanceCriteria) {
      hu.errorScenarios = 'Datos originales incompletos para regenerar.';
      return;
    }
    // La llamada a _generateDetailedTestCasesForHu se encargará de hu.loadingScenarios
    this._generateDetailedTestCasesForHu(hu, hu.regenSelectedTechnique, false);
  }

  regenerateScope(hu: HUData): void {
    if (!hu.originalInput.description || !hu.originalInput.acceptanceCriteria) {
      hu.errorScope = 'Datos incompletos para regenerar.'; return;
    }
    hu.editingScope = false; hu.isScopeDetailsOpen = true;
    hu.loadingScope = true; hu.errorScope = null;
    this.loadingSections = this.huList.some(h => h.loadingScope || h.id === hu.id);
    this.sectionsError = null;
    this.geminiService.generateTestPlanSections(hu.originalInput.description, hu.originalInput.acceptanceCriteria)
      .pipe(
        tap(scopeText => { hu.generatedScope = scopeText; hu.errorScope = null; }),
        catchError(error => {
          hu.errorScope = (typeof error === 'string' ? error : error.message) || 'Error al regenerar alcance.';
          this.sectionsError = `Error al regenerar el alcance para HU ${hu.id}.`; return of('');
        }),
        finalize(() => { hu.loadingScope = false; this.checkOverallLoadingStatus(); this.updatePreview(); })
      ).subscribe();
  }

  formatSimpleScenarioTitles(titles: string[]): string {
    if (!titles || titles.length === 0) { return 'No se generaron escenarios.'; }
    return titles.map((title, index) => `${index + 1}. ${title}`).join('\n');
  }

  private resetCurrentInputs(): void {
    this.currentHuId = ''; this.currentHuTitle = ''; this.currentSprint = '';
    this.currentDescription = ''; this.currentAcceptanceCriteria = ''; this.currentSelectedTechnique = '';
    if (this.huFormDirective) {
      this.huFormDirective.resetForm();
      setTimeout(() => { this.isFormInvalid = this.huFormDirective.invalid ?? true; });
    } else { this.isFormInvalid = true; }
  }

  updateTestPlanTitle(): void {
    if (this.huList.length > 0) {
      const latestHu = this.huList[this.huList.length - 1];
      this.testPlanTitle = `TEST PLAN EVC00057_ ${latestHu.id} SPRINT ${latestHu.sprint}`;
    } else { this.testPlanTitle = ''; }
  }

  generatePlanContentString(): string {
    if (this.huList.length === 0) { return ''; }
    let fullPlanContent = '';
    if (this.testPlanTitle) { fullPlanContent += `Título del Plan de Pruebas: ${this.testPlanTitle}\n\n`; }
    fullPlanContent += `Repositorio pruebas VSTS: ${this.repositoryLink}\n\n`;
    fullPlanContent += `ALCANCE:\n\n`;
    this.huList.forEach((hu) => {
      fullPlanContent += `HU ${hu.id}: ${hu.title}\n`;
      fullPlanContent += `${hu.generatedScope}\n\n`;
    });
    fullPlanContent += `FUERA DEL ALCANCE:\n\n${this.outOfScopeContent}\n\n`;
    fullPlanContent += `ESTRATEGIA:\n\n${this.strategyContent}\n\n`;
    fullPlanContent += `CASOS DE PRUEBA:\n\n`;
    this.huList.forEach((hu) => {
      fullPlanContent += `HU ${hu.id} ${hu.title}\n`;
      fullPlanContent += `${hu.generatedTestCaseTitles}\n\n`;
    });
    fullPlanContent += `LIMITACIONES:\n\n${this.limitationsContent}\n\n`;
    fullPlanContent += `SUPUESTOS:\n\n${this.assumptionsContent}\n\n`;
    fullPlanContent += `Equipo de Trabajo:\n\n${this.teamContent}\n\n`;
    return fullPlanContent;
  }

  generatePlanContentHtmlString(): string {
    if (this.huList.length === 0) {
      return '';
    }
    let fullPlanHtmlContent = '';

    const escapeHtml = (unsafe: string): string => {
        if (typeof unsafe !== 'string') {
            return '';
        }
        let safe = unsafe;
        safe = safe.replace(/&/g, `&`);
        safe = safe.replace(/</g, `<`);
        safe = safe.replace(/>/g, `>`);
        safe = safe.replace(/"/g, `"`); 
        safe = safe.replace(/'/g, `'`); 
        return safe;
    };

    if (this.testPlanTitle) {
      fullPlanHtmlContent += `<span class="preview-section-title">Título del Plan de Pruebas:</span> ${escapeHtml(this.testPlanTitle)}\n\n`;
    }

    fullPlanHtmlContent += `<span class="preview-section-title">Repositorio pruebas VSTS:</span> <a href="${this.repositoryLink.split(' ')[0]}" target="_blank">${escapeHtml(this.repositoryLink)}</a>\n\n`;

    fullPlanHtmlContent += `<span class="preview-section-title">ALCANCE:</span>\n\n`;
    this.huList.forEach((hu) => {
        fullPlanHtmlContent += `<span class="preview-hu-title">HU ${escapeHtml(hu.id)}: ${escapeHtml(hu.title)}</span>\n`;
        fullPlanHtmlContent += `${escapeHtml(hu.generatedScope)}\n\n`;
    });

    fullPlanHtmlContent += `<span class="preview-section-title">FUERA DEL ALCANCE:</span>\n\n${escapeHtml(this.outOfScopeContent)}\n\n`;
    fullPlanHtmlContent += `<span class="preview-section-title">ESTRATEGIA:</span>\n\n${escapeHtml(this.strategyContent)}\n\n`;
    fullPlanHtmlContent += `<span class="preview-section-title">CASOS DE PRUEBA (Solo Títulos):</span>\n\n`;
    this.huList.forEach((hu) => {
      fullPlanHtmlContent += `<span class="preview-hu-title">HU ${escapeHtml(hu.id)} ${escapeHtml(hu.title)}</span>\n`;
      fullPlanHtmlContent += `${escapeHtml(hu.generatedTestCaseTitles)}\n\n`;
    });
    fullPlanHtmlContent += `<span class="preview-section-title">LIMITACIONES:</span>\n\n${escapeHtml(this.limitationsContent)}\n\n`;
    fullPlanHtmlContent += `<span class="preview-section-title">SUPUESTOS:</span>\n\n${escapeHtml(this.assumptionsContent)}\n\n`;
    fullPlanHtmlContent += `<span class="preview-section-title">Equipo de Trabajo:</span>\n\n${escapeHtml(this.teamContent)}\n\n`;

    return fullPlanHtmlContent;
  }

  updatePreview(): void {
    this.downloadPreviewHtmlContent = this.generatePlanContentHtmlString();
  }

  downloadWord(): void {
    const plainTextContent = this.generatePlanContentString();
    if (!plainTextContent) { console.warn('No hay contenido para descargar.'); return; }
    const blob = new Blob([plainTextContent], { type: 'text/plain;charset=utf-8' });
    const date = new Date().toISOString().split('T')[0];
    saveAs(blob, `PlanDePruebas_Completo_${date}.doc`);
  }

  exportExecutionMatrix(hu: HUData): void {
    if (!hu.detailedTestCases || hu.detailedTestCases.length === 0) {
      alert('No hay casos de prueba detallados para exportar para esta HU.'); return;
    }
    const csvHeader = ["Escenario de Prueba", "Precondiciones", "Paso a Paso", "Resultado Esperado"];
    const csvRows = hu.detailedTestCases.map(tc => ([
      `"${this.escapeCsvField(tc.title)}"`,
      `"${this.escapeCsvField(tc.preconditions)}"`,
      `"${this.escapeCsvField(tc.steps)}"`,
      `"${this.escapeCsvField(tc.expectedResults)}"`
    ]));
    const csvContent = [csvHeader.join(','), ...csvRows.map(row => row.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const date = new Date().toISOString().split('T')[0];
    saveAs(blob, `MatrizEjecucion_${hu.id}_${date}.csv`);
  }

  private escapeCsvField(field: string): string {
    if (field === null || field === undefined) { return ''; }
    let result = field.toString();
    result = result.replace(/"/g, '""');
    return result;
  }

  trackHuById(index: number, hu: HUData): string {
    return hu.id;
  }
}