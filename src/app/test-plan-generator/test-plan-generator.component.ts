// src/app/test-plan-generator/test-plan-generator.component.ts
import { Component, ViewChild, AfterViewInit, OnDestroy, ElementRef, Inject, PLATFORM_ID } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { GeminiService, DetailedTestCase } from '../services/gemini.service';
import { catchError, finalize, tap, switchMap } from 'rxjs/operators';
import { Observable, of, Subscription } from 'rxjs';
import { saveAs } from 'file-saver';
import { HUData, GenerationMode } from '../models/hu-data.model';

type StaticSectionBaseName = 'repositoryLink' | 'outOfScope' | 'strategy' | 'limitations' | 'assumptions' | 'team';

@Component({
  selector: 'app-test-plan-generator',
  templateUrl: './test-plan-generator.component.html',
  styleUrls: ['./test-plan-generator.component.css'],
  standalone: true,
  imports: [ FormsModule, CommonModule ]
})
export class TestPlanGeneratorComponent implements AfterViewInit, OnDestroy {

  currentGenerationMode: GenerationMode | null = null;
  selectedFile: File | null = null;
  currentImagePreview: string | ArrayBuffer | null = null;
  imageBase64: string | null = null;
  imageMimeType: string | null = null;
  imageUploadError: string | null = null;
  formError: string | null = null;

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

  // Default static sections to closed
  isRepositoryLinkDetailsOpen: boolean = false;
  isOutOfScopeDetailsOpen: boolean = false;
  isStrategyDetailsOpen: boolean = false;
  isLimitationsDetailsOpen: boolean = false;
  isAssumptionsDetailsOpen: boolean = false;
  isTeamDetailsOpen: boolean = false;

  @ViewChild('huForm') huFormDirective!: NgForm;
  private formStatusSubscription!: Subscription;
  @ViewChild('scenariosTextarea') scenariosTextarea: ElementRef | undefined;

  constructor(
    private geminiService: GeminiService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
  }

  ngAfterViewInit(): void {
    if (this.huFormDirective && this.huFormDirective.statusChanges) {
      this.formStatusSubscription = this.huFormDirective.statusChanges.subscribe(() => {
      });
    }
  }

  ngOnDestroy(): void {
    if (this.formStatusSubscription) {
      this.formStatusSubscription.unsubscribe();
    }
  }

  selectInitialMode(mode: GenerationMode): void {
    this.currentGenerationMode = mode;
    this.onGenerationModeChange();
  }

  resetToInitialSelection(): void {
    const keptSprint = this.currentSprint;
    const keptTechnique = this.currentSelectedTechnique;

    this.currentGenerationMode = null;
    this.formError = null;
    this.imageUploadError = null;
    this.selectedFile = null;
    this.currentImagePreview = null;
    this.imageBase64 = null;
    this.imageMimeType = null;

    this.currentDescription = '';
    this.currentAcceptanceCriteria = '';
    this.currentHuId = '';
    this.currentHuTitle = '';


    if (isPlatformBrowser(this.platformId)) {
      const imageInput = document.getElementById('imageFile') as HTMLInputElement;
      if (imageInput) imageInput.value = '';
    }

    if (this.huFormDirective && this.huFormDirective.form) {
        this.huFormDirective.resetForm({
            currentSprint: keptSprint,
            currentSelectedTechnique: keptTechnique
        });
        this.currentSprint = keptSprint;
        this.currentSelectedTechnique = keptTechnique;

        setTimeout(() => {
            if (this.huFormDirective && this.huFormDirective.form) {
                this.huFormDirective.form.markAsPristine();
                this.huFormDirective.form.markAsUntouched();
                this.huFormDirective.form.updateValueAndValidity();
            }
        },0);
    }
  }


  onGenerationModeChange(): void {
    if (!this.currentGenerationMode) {
        return;
    }
    this.formError = null;
    this.imageUploadError = null;
    this.selectedFile = null;
    this.currentImagePreview = null;
    this.imageBase64 = null;
    this.imageMimeType = null;

    this.currentDescription = '';
    this.currentAcceptanceCriteria = '';


    if (isPlatformBrowser(this.platformId)) {
      const imageInput = document.getElementById('imageFile') as HTMLInputElement;
      if (imageInput) imageInput.value = '';
    }

    if (this.currentGenerationMode === 'text') {
      this.currentHuId = '';
      this.currentHuTitle = '';
    } else { 
      this.currentHuId = `IMG_${new Date().getTime().toString().slice(-5)}`;
      this.currentHuTitle = `Análisis de Flujo Visual ${this.huList.length + 1}`;
    }
    if (this.huFormDirective && this.huFormDirective.form) {
        setTimeout(() => {
            this.huFormDirective.form.markAsPristine();
            this.huFormDirective.form.markAsUntouched(); 
            this.huFormDirective.form.updateValueAndValidity();
        },0);
    }
  }

  isFormInvalidForCurrentMode(): boolean {
    if (!this.huFormDirective || !this.huFormDirective.form || !this.currentGenerationMode) {
      return true;
    }
    const commonRequired = !this.currentSprint || !this.currentSelectedTechnique;
    if (this.currentGenerationMode === 'text') {
      return commonRequired || !this.currentHuId || !this.currentHuTitle || !this.currentDescription || !this.currentAcceptanceCriteria;
    } else { // 'image'
      return commonRequired || !this.selectedFile || !this.imageBase64 || !this.currentHuId || !this.currentHuTitle;
    }
  }

  onFileSelected(event: Event): void {
    this.imageUploadError = null;
    this.formError = null;
    this.selectedFile = null;
    this.currentImagePreview = null;
    this.imageBase64 = null;
    this.imageMimeType = null;

    const element = event.currentTarget as HTMLInputElement;
    const fileList: FileList | null = element.files;

    if (fileList && fileList[0]) {
      const file = fileList[0];
      if (file.size > 4 * 1024 * 1024) {
        this.imageUploadError = "El archivo es demasiado grande. Máximo 4MB.";
        element.value = ""; return;
      }
      if (!['image/jpeg', 'image/png'].includes(file.type)) {
        this.imageUploadError = "Formato de archivo no válido. Solo se permiten JPG y PNG.";
        element.value = ""; return;
      }
      this.selectedFile = file;
      this.imageMimeType = file.type;
      const reader = new FileReader();
      reader.onload = e => {
        this.currentImagePreview = reader.result;
        if (typeof reader.result === 'string') {
          this.imageBase64 = reader.result.split(',')[1];
        }
        if (this.huFormDirective && this.huFormDirective.form) {
            this.huFormDirective.form.updateValueAndValidity();
        }
      };
      reader.onerror = error => {
        this.imageUploadError = "Error al leer el archivo.";
        console.error("FileReader error: ", error);
        element.value = "";
      };
      reader.readAsDataURL(file);
    }
  }

  addHuAndGenerateData(): void {
    this.formError = null;
    if (!this.currentGenerationMode) { 
        this.formError = "Por favor, selecciona un método de generación primero.";
        return;
    }
    if (this.isFormInvalidForCurrentMode()) {
      this.formError = "Por favor, completa todos los campos requeridos.";
       if (this.huFormDirective && this.huFormDirective.form) {
        Object.values(this.huFormDirective.form.controls).forEach(control => {
          if (control.invalid) control.markAsTouched();
        });
      }
      return;
    }
    const newHu: HUData = {
      originalInput: {
        id: this.currentHuId, title: this.currentHuTitle, sprint: this.currentSprint,
        description: this.currentGenerationMode === 'text' ? this.currentDescription : undefined,
        acceptanceCriteria: this.currentGenerationMode === 'text' ? this.currentAcceptanceCriteria : undefined,
        selectedTechnique: this.currentSelectedTechnique, generationMode: this.currentGenerationMode,
        imageBase64: this.currentGenerationMode === 'image' ? this.imageBase64 || undefined : undefined,
        imageMimeType: this.currentGenerationMode === 'image' ? this.imageMimeType || undefined : undefined
      },
      id: this.currentHuId.trim(), title: this.currentHuTitle.trim(), sprint: this.currentSprint.trim(),
      generatedScope: '', detailedTestCases: [], generatedTestCaseTitles: '',
      editingScope: false, editingScenarios: false,
      loadingScope: this.currentGenerationMode === 'text', errorScope: null,
      loadingScenarios: true, errorScenarios: null,
      showRegenTechniquePicker: false, regenSelectedTechnique: '',
      isScopeDetailsOpen: true, isScenariosDetailsOpen: true // HU specific sections open by default
    };
    this.huList.push(newHu);
    if (newHu.loadingScope) { this.loadingSections = true; this.sectionsError = null; }
    this.loadingScenarios = true;
    let scopeGeneration$: Observable<string> = of('');
    if (newHu.originalInput.generationMode === 'text' && newHu.originalInput.description && newHu.originalInput.acceptanceCriteria) {
      scopeGeneration$ = this.geminiService.generateTestPlanSections(
        newHu.originalInput.description, newHu.originalInput.acceptanceCriteria
      ).pipe(
        tap(scopeText => { newHu.generatedScope = scopeText; }),
        catchError(error => {
          newHu.errorScope = (typeof error === 'string' ? error : error.message) || 'Error al generar alcance.';
          if (this.currentGenerationMode === 'text') this.sectionsError = 'Error al generar el alcance.';
          return of('');
        }),
        finalize(() => { newHu.loadingScope = false; this.checkOverallLoadingStatus(); })
      );
    } else { newHu.loadingScope = false; this.checkOverallLoadingStatus(); }

    scopeGeneration$.pipe(
      switchMap(() => this._generateDetailedTestCasesForHu(newHu, newHu.originalInput.selectedTechnique, true)),
      finalize(() => { this.updateTestPlanTitle(); this.updatePreview(); })
    ).subscribe({
        error: (err) => {
            console.error("Error en el flujo de generación:", err);
            this.scenariosError = "Error general en el proceso de generación.";
            newHu.loadingScenarios = false; newHu.loadingScope = false; this.checkOverallLoadingStatus();
        }
    });
  }

  private _generateDetailedTestCasesForHu(hu: HUData, technique: string, isInitialGeneration: boolean = false): Observable<DetailedTestCase[]> {
    hu.loadingScenarios = true; hu.errorScenarios = null;
    if (isInitialGeneration || !this.huList.some(h => h.id !== hu.id && h.loadingScenarios)) {
        this.loadingScenarios = true;
    }
    let generationObservable$: Observable<DetailedTestCase[]>;
    if (hu.originalInput.generationMode === 'image' && hu.originalInput.imageBase64 && hu.originalInput.imageMimeType) {
      generationObservable$ = this.geminiService.generateDetailedTestCasesImageBased(
        hu.originalInput.imageBase64, hu.originalInput.imageMimeType, technique
      );
    } else if (hu.originalInput.generationMode === 'text' && hu.originalInput.description && hu.originalInput.acceptanceCriteria) {
      generationObservable$ = this.geminiService.generateDetailedTestCasesTextBased(
        hu.originalInput.description, hu.originalInput.acceptanceCriteria, technique
      );
    } else {
      hu.errorScenarios = "Datos de entrada insuficientes para generar casos.";
      hu.detailedTestCases = [{ title: "Error Configuración", preconditions: hu.errorScenarios, steps: "Verifique datos.", expectedResults: "N/A" }];
      hu.generatedTestCaseTitles = hu.errorScenarios;
      return of(hu.detailedTestCases).pipe(
          finalize(() => { hu.loadingScenarios = false; this.checkOverallLoadingStatus(); if (isInitialGeneration) this.resetCurrentInputs(); })
      );
    }
    return generationObservable$.pipe(
      tap(detailedTestCases => {
        hu.detailedTestCases = detailedTestCases;
        hu.generatedTestCaseTitles = this.formatSimpleScenarioTitles(detailedTestCases.map(tc => tc.title));
        hu.errorScenarios = null;
        if (hu.showRegenTechniquePicker) { hu.showRegenTechniquePicker = false; hu.regenSelectedTechnique = ''; }
      }),
      catchError(error => {
        hu.errorScenarios = (typeof error === 'string' ? error : error.message) || 'Error al generar casos detallados.';
        hu.detailedTestCases = [{ title: "Error", preconditions: hu.errorScenarios ?? "Error no especificado.", steps: "N/A", expectedResults: "N/A" }];
        hu.generatedTestCaseTitles = "Error al generar casos de prueba.";
        this.scenariosError = `Error al generar casos para HU ${hu.id}.`;
        return of(hu.detailedTestCases);
      }),
      finalize(() => {
        hu.loadingScenarios = false; this.checkOverallLoadingStatus();
        if (isInitialGeneration) { this.resetCurrentInputs(); }
        this.updatePreview();
      })
    );
  }

  private checkOverallLoadingStatus(): void {
    this.loadingSections = this.huList.some(huItem => huItem.loadingScope);
    this.loadingScenarios = this.huList.some(huItem => huItem.loadingScenarios);
  }

  toggleEdit(hu: HUData, section: 'scope' | 'scenarios'): void {
    if (section === 'scenarios' && hu.showRegenTechniquePicker) { this.cancelScenarioRegeneration(hu); }
    if (section === 'scope') {
      if (hu.originalInput.generationMode === 'text') {
        hu.editingScope = !hu.editingScope; if (hu.editingScope) hu.isScopeDetailsOpen = true;
      } else { alert("El alcance no es aplicable ni editable para la generación basada en imágenes."); }
    } else if (section === 'scenarios') {
      hu.editingScenarios = !hu.editingScenarios;
      if (hu.editingScenarios) { hu.isScenariosDetailsOpen = true; setTimeout(() => this.scenariosTextarea?.nativeElement.focus(), 0); }
    }
    if (section === 'scope' && !hu.editingScope && hu.originalInput.generationMode === 'text') { this.updatePreview(); }
  }

  toggleStaticEdit(baseName: StaticSectionBaseName): void {
    let editingProp: keyof TestPlanGeneratorComponent; let detailsOpenProp: keyof TestPlanGeneratorComponent;
    switch (baseName) {
      case 'repositoryLink': editingProp = 'editingRepositoryLink'; detailsOpenProp = 'isRepositoryLinkDetailsOpen'; break;
      case 'outOfScope': editingProp = 'editingOutOfScope'; detailsOpenProp = 'isOutOfScopeDetailsOpen'; break;
      case 'strategy': editingProp = 'editingStrategy'; detailsOpenProp = 'isStrategyDetailsOpen'; break;
      case 'limitations': editingProp = 'editingLimitations'; detailsOpenProp = 'isLimitationsDetailsOpen'; break;
      case 'assumptions': editingProp = 'editingAssumptions'; detailsOpenProp = 'isAssumptionsDetailsOpen'; break;
      case 'team': editingProp = 'editingTeam'; detailsOpenProp = 'isTeamDetailsOpen'; break;
      default: const exhaustiveCheck: never = baseName; console.error('Invalid static name:', exhaustiveCheck); return;
    }
    const wasEditing = this[editingProp] as boolean; (this[editingProp] as any) = !wasEditing;
    if (this[editingProp]) { (this[detailsOpenProp] as any) = true; } // Open if starting to edit
    if (wasEditing && !(this[editingProp] as boolean)) { this.updatePreview(); }
  }

  startScenarioRegeneration(hu: HUData): void {
    hu.editingScenarios = false; hu.showRegenTechniquePicker = true; hu.isScenariosDetailsOpen = true;
    hu.regenSelectedTechnique = hu.originalInput.selectedTechnique; hu.errorScenarios = null; this.scenariosError = null;
  }

  cancelScenarioRegeneration(hu: HUData): void {
    hu.showRegenTechniquePicker = false; hu.regenSelectedTechnique = ''; hu.errorScenarios = null;
  }

  confirmRegenerateScenarios(hu: HUData): void {
    if (!hu.regenSelectedTechnique) { hu.errorScenarios = 'Debes seleccionar una técnica.'; return; }
    this._generateDetailedTestCasesForHu(hu, hu.regenSelectedTechnique, false).subscribe();
  }

  regenerateScope(hu: HUData): void {
    if (hu.originalInput.generationMode !== 'text' || !hu.originalInput.description || !hu.originalInput.acceptanceCriteria) {
      hu.errorScope = 'El alcance solo se regenera para HUs con descripción/criterios.'; alert(hu.errorScope); return;
    }
    hu.editingScope = false; hu.isScopeDetailsOpen = true; hu.loadingScope = true; hu.errorScope = null;
    this.loadingSections = this.huList.some(h => h.loadingScope || h.id === hu.id); this.sectionsError = null;
    this.geminiService.generateTestPlanSections(hu.originalInput.description!, hu.originalInput.acceptanceCriteria!)
      .pipe(
        tap(scopeText => { hu.generatedScope = scopeText; hu.errorScope = null; }),
        catchError(error => {
          hu.errorScope = (typeof error === 'string' ? error : error.message) || 'Error regenerando alcance.';
          this.sectionsError = `Error alcance HU ${hu.id}.`; return of('');
        }),
        finalize(() => { hu.loadingScope = false; this.checkOverallLoadingStatus(); this.updatePreview(); })
      ).subscribe();
  }

  private getHuSummaryForStaticAI(): string {
    if (this.huList.length === 0) {
      return "No hay Historias de Usuario definidas aún.";
    }
    let summary = this.huList.map(hu => {
      let huDesc = `HU ${hu.id} (${hu.title}): Modo ${hu.originalInput.generationMode}.`;
      if (hu.originalInput.generationMode === 'text' && hu.originalInput.description) {
        huDesc += ` Descripción (inicio): ${hu.originalInput.description.substring(0, 70)}...`;
      } else if (hu.originalInput.generationMode === 'image') {
        huDesc += ` (Generada desde imagen, título: ${hu.title})`;
      }
      return `- ${huDesc}`;
    }).join('\n');

    if (summary.length > 1500) { 
        summary = summary.substring(0, 1500) + "\n... (resumen truncado por longitud)";
    }
    return summary;
  }

  regenerateStaticSectionWithAI(section: 'outOfScope' | 'strategy' | 'limitations' | 'assumptions'): void {
    let sectionNameDisplay: string = '';
    let currentContent: string = '';
    let loadingFlag: keyof TestPlanGeneratorComponent | null = null;
    let errorFlag: keyof TestPlanGeneratorComponent | null = null;
    let detailsOpenFlag: keyof TestPlanGeneratorComponent | null = null;


    switch (section) {
      case 'outOfScope':
        sectionNameDisplay = 'Fuera del Alcance'; currentContent = this.outOfScopeContent;
        loadingFlag = 'loadingOutOfScopeAI'; errorFlag = 'errorOutOfScopeAI'; detailsOpenFlag = 'isOutOfScopeDetailsOpen';
        break;
      case 'strategy':
        sectionNameDisplay = 'Estrategia'; currentContent = this.strategyContent;
        loadingFlag = 'loadingStrategyAI'; errorFlag = 'errorStrategyAI'; detailsOpenFlag = 'isStrategyDetailsOpen';
        break;
      case 'limitations':
        sectionNameDisplay = 'Limitaciones'; currentContent = this.limitationsContent;
        loadingFlag = 'loadingLimitationsAI'; errorFlag = 'errorLimitationsAI'; detailsOpenFlag = 'isLimitationsDetailsOpen';
        break;
      case 'assumptions':
        sectionNameDisplay = 'Supuestos'; currentContent = this.assumptionsContent;
        loadingFlag = 'loadingAssumptionsAI'; errorFlag = 'errorAssumptionsAI'; detailsOpenFlag = 'isAssumptionsDetailsOpen';
        break;
    }

    if (loadingFlag) (this[loadingFlag] as any) = true;
    if (errorFlag) (this[errorFlag] as any) = null;
    if (detailsOpenFlag) (this[detailsOpenFlag] as any) = true; // Open on AI generation start

    const huSummary = this.getHuSummaryForStaticAI();

    this.geminiService.generateEnhancedStaticSectionContent(sectionNameDisplay, currentContent, huSummary)
      .pipe(
        finalize(() => {
          if (loadingFlag) (this[loadingFlag] as any) = false;
          this.updatePreview();
        })
      )
      .subscribe({
        next: (aiResponse: string) => {
          if (aiResponse && aiResponse.trim() !== '') {
            const newContent = (currentContent.trim() === '' || currentContent.trim().toLowerCase().startsWith('no se probarán') && section === 'outOfScope' || currentContent.trim().toLowerCase().startsWith('no tener los permisos') && section === 'limitations'
                ? aiResponse.trim() // Replace default placeholder if it's the only content
                : currentContent + '\n\n' + aiResponse.trim()); // Append otherwise
            switch (section) {
              case 'outOfScope': this.outOfScopeContent = newContent; break;
              case 'strategy': this.strategyContent = newContent; break;
              case 'limitations': this.limitationsContent = newContent; break;
              case 'assumptions': this.assumptionsContent = newContent; break;
            }
          } else {
            if (errorFlag) (this[errorFlag] as any) = 'La IA no generó contenido adicional.';
          }
        },
        error: (err: Error) => {
          if (errorFlag) (this[errorFlag] as any) = err.message || `Error al regenerar "${sectionNameDisplay}" con IA.`;
        }
      });
  }

  formatSimpleScenarioTitles(titles: string[]): string {
    if (!titles || titles.length === 0) { return 'No se generaron escenarios.'; }
    return titles.map((title, index) => `${index + 1}. ${title}`).join('\n');
  }

  private resetCurrentInputs(): void {
    const keptMode = this.currentGenerationMode;
    const keptTechnique = this.currentSelectedTechnique;
    const keptSprint = this.currentSprint;

    if (this.huFormDirective) {
        this.huFormDirective.resetForm({
            currentSelectedTechnique: keptTechnique,
            currentSprint: keptSprint
        });
    }

    this.currentGenerationMode = keptMode;
    this.currentSelectedTechnique = keptTechnique;
    this.currentSprint = keptSprint;


    this.currentDescription = '';
    this.currentAcceptanceCriteria = '';
    this.selectedFile = null;
    this.currentImagePreview = null;
    this.imageBase64 = null;
    this.imageMimeType = null;
    this.imageUploadError = null;
    this.formError = null;

    if (this.currentGenerationMode === 'image') {
      this.currentHuId = `IMG_${new Date().getTime().toString().slice(-5)}`;
      this.currentHuTitle = `Análisis de Flujo Visual ${this.huList.length + 1}`;
    } else { 
      this.currentHuId = '';
      this.currentHuTitle = '';
    }


    if (isPlatformBrowser(this.platformId)) {
      const imageInput = document.getElementById('imageFile') as HTMLInputElement;
      if (imageInput) imageInput.value = '';
    }
     setTimeout(() => { 
        if (this.huFormDirective && this.huFormDirective.form) {
            this.huFormDirective.form.updateValueAndValidity();
        }
    }, 0);
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
    if (this.isAnyHuTextBased()) {
        fullPlanContent += `ALCANCE:\n\n`;
        this.huList.forEach((hu) => {
          if (hu.originalInput.generationMode === 'text') {
            fullPlanContent += `HU ${hu.id}: ${hu.title}\n`;
            fullPlanContent += `${hu.generatedScope || 'Alcance no generado.'}\n\n`;
          }
        });
    }
    // Always include these sections as they can be manually edited or AI generated
    fullPlanContent += `FUERA DEL ALCANCE:\n\n${this.outOfScopeContent}\n\n`;
    fullPlanContent += `ESTRATEGIA:\n\n${this.strategyContent}\n\n`;

    fullPlanContent += `CASOS DE PRUEBA (Solo Títulos):\n\n`;
    this.huList.forEach((hu) => {
      fullPlanContent += `HU ${hu.id}: ${hu.title} ${hu.originalInput.generationMode === 'image' ? '(Generada desde imagen)' : ''}\n`;
      fullPlanContent += `${hu.generatedTestCaseTitles}\n\n`;
    });
    fullPlanContent += `LIMITACIONES:\n\n${this.limitationsContent}\n\n`;
    fullPlanContent += `SUPUESTOS:\n\n${this.assumptionsContent}\n\n`;
    fullPlanContent += `Equipo de Trabajo:\n\n${this.teamContent}\n\n`;
    return fullPlanContent;
  }

  generatePlanContentHtmlString(): string {
    if (this.huList.length === 0) { return ''; }
    let fullPlanHtmlContent = '';
    const escapeHtml = (unsafe: string): string => {
        if (typeof unsafe !== 'string') {
            return '';
        }
        let safe = unsafe;
        safe = safe.replace(/&/g, `&`);
        safe = safe.replace(/</g, `<`);
        safe = safe.replace(/>/g, `>`);
        safe = safe.replace(/"/g, `"`); // Usando comilla invertida para la cadena de reemplazo
        safe = safe.replace(/'/g, `'`); // Usando comilla invertida para la cadena de reemplazo
        return safe;
    };

    if (this.testPlanTitle) { fullPlanHtmlContent += `<span class="preview-section-title">Título del Plan de Pruebas:</span> ${escapeHtml(this.testPlanTitle)}\n\n`; }
    
    const repoLinkUrl = this.repositoryLink.split(' ')[0];
    fullPlanHtmlContent += `<span class="preview-section-title">Repositorio pruebas VSTS:</span> <a href="${escapeHtml(repoLinkUrl)}" target="_blank">${escapeHtml(this.repositoryLink)}</a>\n\n`;
    
    if (this.isAnyHuTextBased()) {
        fullPlanHtmlContent += `<span class="preview-section-title">ALCANCE:</span>\n\n`;
        this.huList.forEach((hu) => {
          if (hu.originalInput.generationMode === 'text') {
            fullPlanHtmlContent += `<span class="preview-hu-title">HU ${escapeHtml(hu.id)}: ${escapeHtml(hu.title)}</span>\n`;
            fullPlanHtmlContent += `${escapeHtml(hu.generatedScope) || 'Alcance no generado.'}\n\n`;
          }
        });
    }
    fullPlanHtmlContent += `<span class="preview-section-title">FUERA DEL ALCANCE:</span>\n\n${escapeHtml(this.outOfScopeContent)}\n\n`;
    fullPlanHtmlContent += `<span class="preview-section-title">ESTRATEGIA:</span>\n\n${escapeHtml(this.strategyContent)}\n\n`;
    fullPlanHtmlContent += `<span class="preview-section-title">CASOS DE PRUEBA (Solo Títulos):</span>\n\n`;
    this.huList.forEach((hu) => {
      fullPlanHtmlContent += `<span class="preview-hu-title">HU ${escapeHtml(hu.id)} ${escapeHtml(hu.title)} ${hu.originalInput.generationMode === 'image' ? '(Generada desde imagen)' : ''}</span>\n`;
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

  copyPreviewToClipboard(): void {
    const plainTextContent = this.generatePlanContentString();
    if (!plainTextContent) {
      alert('No hay contenido para copiar.');
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(plainTextContent)
        .then(() => {
          alert('¡Plan de pruebas copiado al portapapeles!');
        })
        .catch(err => {
          console.error('Error al copiar al portapapeles: ', err);
          alert('Error al copiar. Puede que necesites hacerlo manualmente.');
        });
    } else {
      alert('La copia al portapapeles no es compatible o no está permitida en este navegador/contexto. Intenta copiar manualmente desde la previsualización.');
    }
  }

  downloadWord(): void {
    const plainTextContent = this.generatePlanContentString();
    if (!plainTextContent) { console.warn('No hay contenido para descargar.'); return; }
    const blob = new Blob([plainTextContent], { type: 'text/plain;charset=utf-8' });
    const date = new Date().toISOString().split('T')[0];
    saveAs(blob, `PlanDePruebas_Completo_${date}.doc`);
  }

  exportExecutionMatrix(hu: HUData): void {
    if (!hu.detailedTestCases || hu.detailedTestCases.length === 0 || hu.detailedTestCases.some(tc => tc.title.startsWith("Error") || tc.title === "Información Insuficiente" || tc.title === "Imagen no interpretable o técnica no aplicable")) {
      alert('No hay casos de prueba válidos para exportar.'); return;
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

  isAnyHuTextBased(): boolean {
    return this.huList.some(hu => hu.originalInput.generationMode === 'text');
  }

  trackHuById(index: number, hu: HUData): string {
    return hu.id;
  }
}