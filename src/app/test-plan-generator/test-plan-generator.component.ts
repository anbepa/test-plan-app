// src/app/test-plan-generator/test-plan-generator.component.ts
import { Component, ViewChild, AfterViewInit, OnDestroy, ElementRef, Inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { HUData, GenerationMode, FlowAnalysisReportItem, FlowAnalysisStep, BugReportItem, DetailedTestCase, TestCaseStep, ImageAnnotation } from '../models/hu-data.model';
import { GeminiService } from '../services/gemini.service';
import { catchError, finalize, tap } from 'rxjs/operators';
import { Observable, of, Subscription, forkJoin } from 'rxjs';
import { saveAs } from 'file-saver';
import { TestCaseGeneratorComponent } from '../test-case-generator/test-case-generator.component';
import { FlowComparisonComponent } from '../flow-comparison/flow-comparison.component';

type StaticSectionBaseName = 'repositoryLink' | 'outOfScope' | 'strategy' | 'limitations' | 'assumptions' | 'team';

interface DraggableFlowImage {
  file: File;
  preview: string | ArrayBuffer;
  base64: string;
  mimeType: string;
  id: string;
  annotations?: ImageAnnotation[]; // para que este componente también pueda manejar anotaciones si se usa
}

@Component({
  selector: 'app-test-plan-generator',
  templateUrl: './test-plan-generator.component.html',
  styleUrls: ['./test-plan-generator.component.css'],
  standalone: true,
  imports: [
    FormsModule,
    CommonModule,
    TestCaseGeneratorComponent,
    FlowComparisonComponent
  ]
})
export class TestPlanGeneratorComponent implements AfterViewInit, OnDestroy {

  currentGenerationMode: GenerationMode | null = null;
  showTestCaseGenerator: boolean = false;
  showParentFormComponent: boolean = false;
  showFlowComparisonComponent: boolean = false;
  isModeSelected: boolean = false;

  draggableFlowImages: DraggableFlowImage[] = [];
  flowImagesBase64: string[] = [];
  flowImageMimeTypes: string[] = [];
  flowImageUploadError: string | null = null;

  formError: string | null = null;

  currentFlowTitle: string = '';
  currentFlowSprint: string = '';

  huList: HUData[] = [];
  downloadPreviewHtmlContent: string = '';

  loadingFlowAnalysisGlobal: boolean = false;
  flowAnalysisErrorGlobal: string | null = null;
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

  draggedFlowImage: DraggableFlowImage | null = null;
  dragOverFlowImageId: string | null = null;

  draggedFlowStep: FlowAnalysisStep | null = null;
  dragOverFlowStepId: string | null = null;

  @ViewChild('flowForm') flowFormDirective!: NgForm;
  private formStatusSubscription!: Subscription;
  @ViewChild('flowAnalysisImageInput') flowAnalysisImageInputRef: ElementRef<HTMLInputElement> | undefined;

  constructor(
    private geminiService: GeminiService,
    @Inject(PLATFORM_ID) private platformId: Object,
    private cdr: ChangeDetectorRef
  ) {}

  ngAfterViewInit(): void {
    if (this.flowFormDirective && this.flowFormDirective.statusChanges) {
      this.formStatusSubscription = this.flowFormDirective.statusChanges.subscribe(() => {
        this.cdr.detectChanges();
      });
    }
  }

  ngOnDestroy(): void {
    if (this.formStatusSubscription) {
      this.formStatusSubscription.unsubscribe();
    }
  }

  selectInitialMode(mode: GenerationMode): void {
    console.log('[TestPlanGenerator] SelectInitialMode - Mode received:', mode);
    this.currentGenerationMode = mode;
    this.isModeSelected = true;

    this.showTestCaseGenerator = false;
    this.showParentFormComponent = false;
    this.showFlowComparisonComponent = false;

    if (mode === 'text' || mode === 'image') {
      this.showTestCaseGenerator = true;
    } else if (mode === 'flowAnalysis') {
      this.showParentFormComponent = true;
      this.onParentGenerationModeChange();
    } else if (mode === 'flowComparison') {
      this.showFlowComparisonComponent = true;
    } else {
      console.error('[TestPlanGenerator] SelectInitialMode - Unknown mode received:', mode, ". Resetting to selection.");
      this.resetActiveGeneratorsAndGoToSelection();
      return;
    }

    console.log('[TestPlanGenerator] SelectInitialMode - Flags state after setting:', {
        isModeSelected: this.isModeSelected,
        currentMode: this.currentGenerationMode,
        showTC: this.showTestCaseGenerator,
        showParent: this.showParentFormComponent,
        showComparison: this.showFlowComparisonComponent
    });
    this.cdr.detectChanges();
  }

  private resetActiveGeneratorsAndGoToSelection(): void {
    console.log('[TestPlanGenerator] resetActiveGeneratorsAndGoToSelection called.');
    this.currentGenerationMode = null;
    this.showTestCaseGenerator = false;
    this.showParentFormComponent = false;
    this.showFlowComparisonComponent = false;
    this.isModeSelected = false;

    this.formError = null;
    this.flowAnalysisErrorGlobal = null;
    this.bugComparisonErrorGlobal = null;
    
    const keptSprint = this.currentFlowSprint;
    this.currentFlowTitle = '';
    this.draggableFlowImages = [];
    this.flowImagesBase64 = [];
    this.flowImageMimeTypes = [];
    this.flowImageUploadError = null;

    if (isPlatformBrowser(this.platformId) && this.flowAnalysisImageInputRef?.nativeElement) {
      this.flowAnalysisImageInputRef.nativeElement.value = '';
    }
    if (this.flowFormDirective?.form) {
      this.flowFormDirective.resetForm({ currentFlowSprint: keptSprint, currentFlowTitle: '' });
      this.currentFlowSprint = keptSprint;
    }
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

  onParentGenerationModeChange(): void {
    if (this.currentGenerationMode !== 'flowAnalysis') {
        return;
    }
    this.formError = null;
    this.draggableFlowImages = []; this.flowImagesBase64 = []; this.flowImageMimeTypes = []; this.flowImageUploadError = null;
    const keptSprint = this.currentFlowSprint;
    this.currentFlowTitle = '';

    if (isPlatformBrowser(this.platformId)) {
      if (this.flowAnalysisImageInputRef?.nativeElement) this.flowAnalysisImageInputRef.nativeElement.value = '';
    }

    if (this.flowFormDirective && this.flowFormDirective.form) {
        this.flowFormDirective.resetForm({ currentFlowSprint: keptSprint, currentFlowTitle: '' });
        this.currentFlowSprint = keptSprint;
         setTimeout(() => {
            if (this.flowFormDirective?.form) {
              this.flowFormDirective.form.markAsPristine();
              this.flowFormDirective.form.markAsUntouched();
              this.flowFormDirective.form.updateValueAndValidity();
            }
            this.cdr.detectChanges();
        },0);
    } else {
        this.cdr.detectChanges();
    }
  }

  isParentFormInvalidForCurrentMode(): boolean {
    if (!this.flowFormDirective || !this.flowFormDirective.form || this.currentGenerationMode !== 'flowAnalysis') {
      return true;
    }
    const commonRequiredFields = !this.currentFlowSprint || !this.currentFlowTitle;
    return commonRequiredFields || this.draggableFlowImages.length === 0;
  }

  private parseFileNameForSorting(fileName: string): { main: number, sub: number } {
      const nameWithoutExtension = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
      const parts = nameWithoutExtension.split(/[^0-9]+/g).filter(Boolean).map(p => parseInt(p, 10));
      return {
          main: parts.length > 0 && !isNaN(parts[0]) ? parts[0] : Infinity,
          sub: parts.length > 1 && !isNaN(parts[1]) ? parts[1] : (parts.length > 0 && !isNaN(parts[0]) ? 0 : Infinity)
      };
  }

  onFlowFileSelected(event: Event): void {
    if (this.currentGenerationMode !== 'flowAnalysis') return;
    this.flowImageUploadError = null;
    this.formError = null;
    this.draggableFlowImages.length = 0;
    const maxImages = 20;

    const element = event.currentTarget as HTMLInputElement;
    const fileList: FileList | null = element.files;

    if (fileList && fileList.length > 0) {
        if (fileList.length > maxImages) {
            this.flowImageUploadError = `Puedes seleccionar un máximo de ${maxImages} imágenes.`;
            element.value = ""; return;
        }
        let filesArray = Array.from(fileList);
        filesArray.sort((a, b) => {
            const parsedA = this.parseFileNameForSorting(a.name);
            const parsedB = this.parseFileNameForSorting(b.name);
            if (parsedA.main !== parsedB.main) return parsedA.main - parsedB.main;
            return parsedA.sub - parsedB.sub;
        });
        
        const fileProcessingObservables: Observable<DraggableFlowImage>[] = [];
        let validationErrorFound = false;

        for (const file of filesArray) {
            if (validationErrorFound) continue;
            if (file.size > 4 * 1024 * 1024) {
                 this.flowImageUploadError = `"${file.name}" excede 4MB.`; validationErrorFound = true;
            }
            if (!['image/jpeg', 'image/png'].includes(file.type) && !validationErrorFound) {
                this.flowImageUploadError = `Formato inválido: "${file.name}". Solo JPG/PNG.`; validationErrorFound = true;
            }
            if (validationErrorFound) {
                element.value = ""; this.draggableFlowImages.length = 0; this.updateParentArraysFromDraggable(); this.cdr.detectChanges(); return;
            }
            const readerObservable = new Observable<DraggableFlowImage>(observer => {
                const reader = new FileReader();
                reader.onload = () => {
                    observer.next({ file, preview: reader.result!, base64: (reader.result as string).split(',')[1], mimeType: file.type, id: 'S_' + file.name + '_' + Date.now() + Math.random().toString(16).slice(2) });
                    observer.complete();
                };
                reader.onerror = error => { this.flowImageUploadError = `Error al leer "${file.name}".`; observer.error(error); };
                reader.readAsDataURL(file);
            });
            fileProcessingObservables.push(readerObservable);
        }
        if (validationErrorFound) { this.draggableFlowImages.length = 0; this.updateParentArraysFromDraggable(); this.cdr.detectChanges(); return; }

        if (fileProcessingObservables.length > 0) {
            forkJoin(fileProcessingObservables).subscribe({
                next: (processedImages) => {
                    processedImages.forEach(img => this.draggableFlowImages.push(img));
                    this.updateParentArraysFromDraggable();
                },
                complete: () => { this.flowFormDirective?.form.updateValueAndValidity(); this.cdr.detectChanges(); },
                error: () => { element.value = ""; this.draggableFlowImages.length = 0; this.updateParentArraysFromDraggable(); this.flowFormDirective?.form.updateValueAndValidity(); this.cdr.detectChanges(); }
            });
        }
    } else {
        this.draggableFlowImages.length = 0;
        this.updateParentArraysFromDraggable();
        this.flowFormDirective?.form.updateValueAndValidity();
        this.cdr.detectChanges();
    }
  }

  private updateParentArraysFromDraggable(): void {
    if (this.currentGenerationMode === 'flowAnalysis') {
        this.flowImagesBase64 = this.draggableFlowImages.map(di => di.base64);
        this.flowImageMimeTypes = this.draggableFlowImages.map(di => di.mimeType);
    }
    this.cdr.detectChanges();
  }

  public onParentImageDragStart(event: DragEvent, image: DraggableFlowImage): void {
    if (this.currentGenerationMode !== 'flowAnalysis') return;
    this.draggedFlowImage = image;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', image.id);
      (event.target as HTMLElement).style.opacity = '0.4';
    }
  }

  public onParentImageDragOver(event: DragEvent, targetImage?: DraggableFlowImage): void {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    if (this.currentGenerationMode === 'flowAnalysis') {
        this.dragOverFlowImageId = targetImage ? targetImage.id : null;
    }
  }
  public onParentImageDragLeave(event: DragEvent): void {
    if (this.currentGenerationMode === 'flowAnalysis') {
        this.dragOverFlowImageId = null;
    }
  }
  public onParentImageDrop(event: DragEvent, targetImage: DraggableFlowImage): void {
    event.preventDefault();
    if (this.currentGenerationMode !== 'flowAnalysis') return;
    
    this.dragOverFlowImageId = null;
    const draggedHtmlElement = document.querySelector('.image-preview-item[style*="opacity: 0.4"]');
    if (draggedHtmlElement) (draggedHtmlElement as HTMLElement).style.opacity = '1';

    if (!this.draggedFlowImage || this.draggedFlowImage.id === targetImage.id) {
      this.draggedFlowImage = null;
      return;
    }
    const fromIndex = this.draggableFlowImages.findIndex(img => img.id === this.draggedFlowImage!.id);
    const toIndex = this.draggableFlowImages.findIndex(img => img.id === targetImage.id);

    if (fromIndex !== -1 && toIndex !== -1) {
      const itemToMove = this.draggableFlowImages.splice(fromIndex, 1)[0];
      this.draggableFlowImages.splice(toIndex, 0, itemToMove);
      this.updateParentArraysFromDraggable();
    }
    this.draggedFlowImage = null;
  }
  public onParentImageDragEnd(event?: DragEvent): void {
    if (event?.target instanceof HTMLElement) (event.target as HTMLElement).style.opacity = '1';
    else {
       const draggedHtmlElement = document.querySelector('.image-preview-item[style*="opacity: 0.4"]');
       if (draggedHtmlElement) (draggedHtmlElement as HTMLElement).style.opacity = '1';
    }
    if (this.currentGenerationMode === 'flowAnalysis') {
      this.draggedFlowImage = null; this.dragOverFlowImageId = null;
    }
  }

  public getFlowStepDragId(paso: FlowAnalysisStep, hu: HUData): string {
    const report = hu.flowAnalysisReport?.[0];
    if (report && report.Pasos_Analizados) {
        const stepIndex = report.Pasos_Analizados.indexOf(paso);
        if (stepIndex !== -1) {
            return `flow-${hu.id}-step-${stepIndex}`;
        }
    }
    return `flow-step-${paso.numero_paso}-${Math.random().toString(16).slice(2,8)}`;
  }

  public onFlowStepDragStart(event: DragEvent, paso: FlowAnalysisStep, hu: HUData): void {
    if (hu.isEditingFlowReportDetails) { event.preventDefault(); return; }
    this.draggedFlowStep = paso;
    if (event.dataTransfer && hu.flowAnalysisReport?.[0]?.Pasos_Analizados) {
      const stepIndex = hu.flowAnalysisReport[0].Pasos_Analizados.indexOf(paso);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', stepIndex.toString());
      const targetElement = event.target as HTMLElement;
      const rowElement = targetElement.closest('tr');
      if (rowElement) rowElement.style.opacity = '0.4';
    }
  }

  public onFlowStepDragOver(event: DragEvent, targetPaso: FlowAnalysisStep | undefined, hu: HUData): void {
    event.preventDefault();
     if (this.draggedFlowStep && event.dataTransfer && targetPaso) {
        event.dataTransfer.dropEffect = 'move';
        this.dragOverFlowStepId = this.getFlowStepDragId(targetPaso, hu);
     } else if (!targetPaso) {
        this.dragOverFlowStepId = null;
     }
  }

  public onFlowStepDragLeave(event: DragEvent): void {
    this.dragOverFlowStepId = null;
  }

  public onFlowStepDrop(event: DragEvent, targetPaso: FlowAnalysisStep, hu: HUData): void {
    event.preventDefault(); this.dragOverFlowStepId = null;
    document.querySelectorAll('.flow-analysis-steps-table tbody tr[style*="opacity: 0.4"]').forEach(el => (el as HTMLElement).style.opacity = '1');

    if (!this.draggedFlowStep || !hu.flowAnalysisReport?.[0]?.Pasos_Analizados || hu.flowAnalysisReport[0].Pasos_Analizados.length === 0) {
        this.draggedFlowStep = null; return;
    }
    if(this.draggedFlowStep === targetPaso) { this.draggedFlowStep = null; return; }

    const pasosAnalizados = hu.flowAnalysisReport[0].Pasos_Analizados;
    const fromIndex = pasosAnalizados.indexOf(this.draggedFlowStep);
    const toIndex = pasosAnalizados.indexOf(targetPaso);

    if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
      const itemToMove = pasosAnalizados.splice(fromIndex, 1)[0];
      pasosAnalizados.splice(toIndex, 0, itemToMove);
      pasosAnalizados.forEach((paso, index) => { paso.numero_paso = index + 1; });
      this.cdr.detectChanges(); this.updatePreview();
    }
    this.draggedFlowStep = null;
  }

  public onFlowStepDragEnd(event: DragEvent): void {
    document.querySelectorAll('.flow-analysis-steps-table tbody tr[style*="opacity: 0.4"]').forEach(el => (el as HTMLElement).style.opacity = '1');
    this.draggedFlowStep = null; this.dragOverFlowStepId = null;
  }

  generateIdFromFlowTitle(title: string, mode: GenerationMode | null): string {
    if (!title || !mode) return '';
    let prefix = "UNKNOWN_";
    if (mode === 'flowAnalysis') prefix = "FLOW_";
    const sanitizedTitle = title.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^\w-]+/g, '');
    return `${prefix}${sanitizedTitle.substring(0, 20)}_${Date.now().toString().slice(-4)}`;
  }

  addAndGenerateFlowData(): void {
    this.formError = null;
    this.flowAnalysisErrorGlobal = null;

    if (this.currentGenerationMode !== 'flowAnalysis') {
        this.formError = "Modo de generación no válido para esta acción.";
        return;
    }
    if (this.isParentFormInvalidForCurrentMode()) {
      this.formError = "Por favor, completa todos los campos requeridos para el flujo de análisis.";
      if (this.draggableFlowImages.length === 0) {
        this.formError = "Por favor, selecciona al menos una imagen para el análisis de flujo.";
      }
       if (this.flowFormDirective?.form) {
        Object.values(this.flowFormDirective.form.controls).forEach(control => {
          if (control.invalid && control.enabled) control.markAsTouched();
        });
      }
      return;
    }

    const finalFlowId = this.generateIdFromFlowTitle(this.currentFlowTitle, this.currentGenerationMode);
    if (!finalFlowId) { this.formError = "El título es necesario para generar el ID del flujo."; return; }

    const newHu: HUData = {
      originalInput: {
        id: finalFlowId, title: this.currentFlowTitle, sprint: this.currentFlowSprint,
        selectedTechnique: '',
        generationMode: this.currentGenerationMode,
        imagesBase64: [...this.flowImagesBase64],
        imageMimeTypes: [...this.flowImageMimeTypes],
      },
      id: finalFlowId.trim(), title: this.currentFlowTitle.trim(), sprint: this.currentFlowSprint.trim(),
      generatedScope: '', detailedTestCases: [], generatedTestCaseTitles: '',
      editingScope: false, editingScenarios: false, loadingScope: false, errorScope: null,
      loadingScenarios: false, errorScenarios: null, showRegenTechniquePicker: false,
      regenSelectedTechnique: '', userTestCaseReanalysisContext: '', isScopeDetailsOpen: false,
      isScenariosDetailsOpen: false, isEditingDetailedTestCases: false,
      flowAnalysisReport: undefined, loadingFlowAnalysis: true, errorFlowAnalysis: null,
      isFlowAnalysisDetailsOpen: true, isEditingFlowReportDetails: false, userReanalysisContext: '',
      bugComparisonReport: undefined, loadingBugComparison: false, errorBugComparison: null,
      isBugComparisonDetailsOpen: false, userBugComparisonReanalysisContext: '',
    };
    this.huList.push(newHu);
    this.updateTestPlanTitle();

    this.loadingFlowAnalysisGlobal = true; this.flowAnalysisErrorGlobal = null;
    this.geminiService.generateFlowAnalysisFromImages(newHu.originalInput.imagesBase64!, newHu.originalInput.imageMimeTypes!).pipe(
        tap(report => {
            newHu.flowAnalysisReport = report; newHu.errorFlowAnalysis = null;
            if (this.isFlowAnalysisReportInErrorState(report?.[0])) {
                newHu.errorFlowAnalysis = `${report[0].Nombre_del_Escenario}: ${report[0].Pasos_Analizados?.[0]?.descripcion_accion_observada || 'Detalles no disponibles en el error.'}`;
                this.flowAnalysisErrorGlobal = newHu.errorFlowAnalysis ?? null;
            }
        }),
        catchError(error => {
            newHu.errorFlowAnalysis = (typeof error === 'string' ? error : error.message) || 'Error al generar análisis de flujo.';
            this.flowAnalysisErrorGlobal = newHu.errorFlowAnalysis ?? null;
            newHu.flowAnalysisReport = [{ Nombre_del_Escenario: "Error Crítico en Generación", Pasos_Analizados: [{ numero_paso: 1, descripcion_accion_observada: newHu.errorFlowAnalysis ?? "Error desconocido", imagen_referencia_entrada: "N/A", elemento_clave_y_ubicacion_aproximada: "N/A", dato_de_entrada_paso:"N/A", resultado_esperado_paso: "N/A", resultado_obtenido_paso_y_estado: "Análisis fallido."}], Resultado_Esperado_General_Flujo: "N/A", Conclusion_General_Flujo: "El análisis de flujo no pudo completarse." }];
            return of(newHu.flowAnalysisReport);
        }),
        finalize(() => {
            newHu.loadingFlowAnalysis = false;
            this.checkOverallLoadingStatus();
            this.updatePreview();
            this.resetParentCurrentInputs();
            this.resetActiveGeneratorsAndGoToSelection();
        })
    ).subscribe({
        error: (err) => {
            console.error("Error en suscripción de generación (análisis de flujo):", err);
            this.flowAnalysisErrorGlobal = (this.flowAnalysisErrorGlobal || "Error general en análisis de flujo.");
            newHu.loadingFlowAnalysis = false;
            this.checkOverallLoadingStatus();
            this.cdr.detectChanges();
        }
    });
  }

  public checkOverallLoadingStatus(): void {
    this.loadingFlowAnalysisGlobal = this.huList.some(huItem => huItem.loadingFlowAnalysis);
    this.cdr.detectChanges();
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
      case 'repositoryLink':
        editingProp = 'editingRepositoryLink';
        detailsOpenProp = 'isRepositoryLinkDetailsOpen';
        break;
      case 'outOfScope':
        editingProp = 'editingOutOfScope';
        detailsOpenProp = 'isOutOfScopeDetailsOpen';
        break;
      case 'strategy':
        editingProp = 'editingStrategy';
        detailsOpenProp = 'isStrategyDetailsOpen';
        break;
      case 'limitations':
        editingProp = 'editingLimitations';
        detailsOpenProp = 'isLimitationsDetailsOpen';
        break;
      case 'assumptions':
        editingProp = 'editingAssumptions';
        detailsOpenProp = 'isAssumptionsDetailsOpen';
        break;
      case 'team':
        editingProp = 'editingTeam';
        detailsOpenProp = 'isTeamDetailsOpen';
        break;
      default:
        return;
    }
    const wasEditing = this[editingProp] as boolean;
    (this[editingProp] as any) = !wasEditing;
    if (this[editingProp]) {
        (this[detailsOpenProp] as any) = true;
    }
    if (wasEditing && !(this[editingProp] as boolean)) {
        this.updatePreview();
    }
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

  public regenerateFlowAnalysis(hu: HUData): void {
    if (hu.originalInput.generationMode !== 'flowAnalysis' || !hu.originalInput.imagesBase64?.length || !hu.flowAnalysisReport?.length) {
        alert("Solo se puede re-analizar un flujo con imágenes y un informe previo."); return;
    }
    hu.loadingFlowAnalysis = true; hu.errorFlowAnalysis = null; this.loadingFlowAnalysisGlobal = true; this.flowAnalysisErrorGlobal = null;
    this.geminiService.refineFlowAnalysisFromImagesAndContext(
        hu.originalInput.imagesBase64!, hu.originalInput.imageMimeTypes!, hu.flowAnalysisReport[0], hu.userReanalysisContext
    ).pipe(
        tap(report => {
            hu.flowAnalysisReport = report; hu.errorFlowAnalysis = null;
            if (this.isFlowAnalysisReportInErrorState(report?.[0])) {
                hu.errorFlowAnalysis = `${report[0].Nombre_del_Escenario}: ${report[0].Pasos_Analizados?.[0]?.descripcion_accion_observada || 'Detalles no disponibles en el error.'}`;
                this.flowAnalysisErrorGlobal = hu.errorFlowAnalysis ?? null;
            }
            hu.isEditingFlowReportDetails = false;
        }),
        catchError(error => {
            hu.errorFlowAnalysis = (typeof error === 'string' ? error : error.message) || 'Error al re-generar análisis.';
            this.flowAnalysisErrorGlobal = hu.errorFlowAnalysis ?? null;
            hu.flowAnalysisReport = hu.flowAnalysisReport || [{ Nombre_del_Escenario: "Error Crítico en Re-Generación", Pasos_Analizados: [{ numero_paso: 1, descripcion_accion_observada: hu.errorFlowAnalysis ?? "Error desconocido", imagen_referencia_entrada: "N/A", elemento_clave_y_ubicacion_aproximada: "N/A", dato_de_entrada_paso:"N/A", resultado_esperado_paso: "N/A", resultado_obtenido_paso_y_estado: "Análisis fallido."}], Resultado_Esperado_General_Flujo: "N/A", Conclusion_General_Flujo: "Re-análisis fallido." }];
            return of(hu.flowAnalysisReport);
        }),
        finalize(() => { hu.loadingFlowAnalysis = false; this.checkOverallLoadingStatus(); this.updatePreview(); this.cdr.detectChanges(); })
    ).subscribe();
  }

  public toggleEditFlowReportDetails(hu: HUData): void {
    hu.isEditingFlowReportDetails = !hu.isEditingFlowReportDetails;
    if (!hu.isEditingFlowReportDetails && hu.flowAnalysisReport?.[0]?.Pasos_Analizados) {
        hu.flowAnalysisReport[0].Pasos_Analizados.forEach((paso, index) => { paso.numero_paso = index + 1; });
        this.updatePreview();
    }
    this.cdr.detectChanges();
  }

  public deleteFlowAnalysisStep(hu: HUData, reportIndex: number, stepIndex: number): void {
    if (hu.flowAnalysisReport?.[reportIndex]?.Pasos_Analizados) {
        hu.flowAnalysisReport[reportIndex].Pasos_Analizados.splice(stepIndex, 1);
        hu.flowAnalysisReport[reportIndex].Pasos_Analizados.forEach((paso, idx) => { paso.numero_paso = idx + 1; });
        this.updatePreview(); this.cdr.detectChanges();
    }
  }

  public addFlowAnalysisStep(hu: HUData, reportIndex: number): void {
    if (hu.flowAnalysisReport?.[reportIndex] && hu.flowAnalysisReport[reportIndex].Pasos_Analizados) {
        const newStep: FlowAnalysisStep = {
            numero_paso: hu.flowAnalysisReport[reportIndex].Pasos_Analizados.length + 1,
            descripcion_accion_observada: '',
            imagen_referencia_entrada: 'Nueva',
            elemento_clave_y_ubicacion_aproximada: '',
            dato_de_entrada_paso: '',
            resultado_esperado_paso: '',
            resultado_obtenido_paso_y_estado: ''
        };
        hu.flowAnalysisReport[reportIndex].Pasos_Analizados.push(newStep);
        this.updatePreview(); this.cdr.detectChanges();
    }
  }

  public deleteBugReportItem(hu: HUData, bugIndex: number): void {
    if (hu.originalInput.generationMode === 'flowComparison' && hu.bugComparisonReport) {
        hu.bugComparisonReport.splice(bugIndex, 1);
        this.updatePreview();
        this.cdr.detectChanges();
    }
  }
  
  public getBugReportImage(hu: HUData, imageNameRef?: string, flowType?: 'A' | 'B'): string | null {
    if (!imageNameRef) return null;

    let imagesArray: string[] | undefined;
    let mimeTypesArray: string[] | undefined;

    if (flowType === 'A') {
        imagesArray = hu.originalInput.imagesBase64FlowA;
        mimeTypesArray = hu.originalInput.imageMimeTypesFlowA;
    } else if (flowType === 'B') {
        imagesArray = hu.originalInput.imagesBase64FlowB;
        mimeTypesArray = hu.originalInput.imageMimeTypesFlowB;
    } else {
        imagesArray = hu.originalInput.imagesBase64;
        mimeTypesArray = hu.originalInput.imageMimeTypes;
    }

    if (!imagesArray?.length || !mimeTypesArray?.length) return null;

    const match = imageNameRef.match(/Imagen (?:[AB]\.)?(\d+)/i);
    if (match?.[1]) {
      const imageIndex = parseInt(match[1], 10) - 1;
      if (imageIndex >= 0 && imageIndex < imagesArray.length) {
        return `data:${mimeTypesArray[imageIndex]};base64,${imagesArray[imageIndex]}`;
      }
    }
    return null;
  }

  public exportBugComparisonReportToHtmlLocalized(hu: HUData, language: 'es' | 'en'): void {
    if (hu.originalInput.generationMode !== 'flowComparison' || !hu.bugComparisonReport?.length || this.isBugReportInErrorState(hu.bugComparisonReport)) {
        alert(language === 'en' ? 'No valid bug comparison report available for export.' : 'No hay reporte de comparación de bugs válido para exportar.'); return;
    }
    const date = new Date().toISOString().split('T')[0];
    const title = language === 'en' ? `Bug Comparison Report: ${this.escapeHtmlForExport(hu.title)} (ID: ${this.escapeHtmlForExport(hu.id)})` : `Reporte de Comparación de Bugs: ${this.escapeHtmlForExport(hu.title)} (ID: ${this.escapeHtmlForExport(hu.id)})`;
    let html = `<html><head><meta charset="UTF-8"><title>${title}</title><style>body{font-family:Segoe UI,Calibri,Arial,sans-serif;margin:20px;line-height:1.5;color:#333}.report-container{max-width:900px;margin:auto}h1{color:#3b5a6b;border-bottom:2px solid #e9ecef;padding-bottom:10px}h2.bug-title{font-size:1.3em;color:#c0392b;margin-top:25px;margin-bottom:10px;padding-bottom:5px;border-bottom:1px dashed #e0e0e0;}.bug-item{border:1px solid #ddd;border-radius:5px;padding:15px;margin-bottom:20px;background:#f9f9f9;box-shadow:0 2px 4px rgba(0,0,0,0.05);}.bug-meta p,.bug-details p{margin-bottom:8px;font-size:.95em}.bug-meta strong,.bug-details strong{color:#555;font-weight:600;}.bug-details pre{white-space:pre-wrap;word-wrap:break-word;background:#fff;border:1px solid #eee;padding:10px;border-radius:4px;font-family:Consolas,monospace,sans-serif;margin:3px 0 10px;font-size:0.9em;}.bug-steps{margin-left:20px;list-style-type:decimal;padding-left:15px;}.bug-steps li{margin-bottom:4px;}.image-ref{font-style:italic;color:#777;font-size:.9em}.bug-report-image{max-width:100%;height:auto;max-height:250px;border:1px solid #ccc;border-radius:4px;display:block;margin:10px 0;background-color:#fff;object-fit:contain;}</style></head><body><div class="report-container"><h1>${title}</h1>`;
    hu.bugComparisonReport.forEach((bug, i) => {
        html += `<div class="bug-item"><h2 class="bug-title">${language === 'en' ? 'Bug' : 'Bug'} #${i + 1}: ${this.escapeHtmlForExport(bug.titulo_bug)} (ID: ${this.escapeHtmlForExport(bug.id_bug)})</h2><div class="bug-meta"><p><strong>${language === 'en' ? 'Priority' : 'Prioridad'}:</strong> ${this.escapeHtmlForExport(bug.prioridad)} | <strong>${language === 'en' ? 'Severity' : 'Severidad'}:</strong> ${this.escapeHtmlForExport(bug.severidad)}</p><p><strong>${language === 'en' ? 'Report Date' : 'Fecha de Reporte'}:</strong> ${this.escapeHtmlForExport(bug.fecha_reporte || date)}</p></div><div class="bug-details">`;
        if (bug.descripcion_diferencia_general) html += `<p><strong>${language === 'en' ? 'General Description of Difference' : 'Descripción General de la Diferencia'}:</strong></p><pre>${this.escapeHtmlForExport(bug.descripcion_diferencia_general)}</pre>`;
        html += `<p><strong>${language === 'en' ? 'Steps to Reproduce' : 'Pasos para Reproducir'}:</strong></p>`;
        if (bug.pasos_para_reproducir?.length) { html += `<ol class="bug-steps">${bug.pasos_para_reproducir.map(p => `<li>${this.escapeHtmlForExport(p.descripcion)}</li>`).join('')}</ol>`; } else html += `<p><em>${language === 'en' ? 'Steps not detailed.' : 'Pasos no detallados.'}</em></p>`;
        const imgSrcA = this.getBugReportImage(hu, bug.imagen_referencia_flujo_a, 'A'), imgSrcB = this.getBugReportImage(hu, bug.imagen_referencia_flujo_b, 'B');
        html += `<p><strong>${language === 'en' ? 'Expected Result' : 'Resultado Esperado'}:</strong> <span class="image-ref">(${language === 'en' ? 'Ref. Flow A' : 'Ref. Flujo A'}: ${this.escapeHtmlForExport(bug.imagen_referencia_flujo_a || 'N/A')})</span></p>${imgSrcA ? `<img src="${imgSrcA}" alt="Imagen Flujo A para bug ${bug.id_bug}" class="bug-report-image">` : ''}<pre>${this.escapeHtmlForExport(bug.resultado_esperado)}</pre>`;
        html += `<p><strong>${language === 'en' ? 'Actual Result' : 'Resultado Actual'}:</strong> <span class="image-ref">(${language === 'en' ? 'Ref. Flow B' : 'Ref. Flujo B'}: ${this.escapeHtmlForExport(bug.imagen_referencia_flujo_b || 'N/A')})</span></p>${imgSrcB ? `<img src="${imgSrcB}" alt="Imagen Flujo B para bug ${bug.id_bug}" class="bug-report-image">` : ''}<pre>${this.escapeHtmlForExport(bug.resultado_actual)}</pre></div></div>`;
    });
    html += `</div></body></html>`;
    saveAs(new Blob([html], { type: 'text/html;charset=utf-8;' }), `Reporte_Comparacion_Bugs_${this.escapeFilename(hu.title)}_${language === 'en' ? 'ENG' : 'ESP'}_${date}.html`);
  }

  private escapeFilename = (filename: string): string => filename.replace(/[^a-z0-9_.\-]/gi, '_').substring(0, 50);

  private escapeHtmlForExport = (u: string | undefined | null): string => {
    if (!u) return '';
    return u.replace(/&/g, "&amp;")
           .replace(/</g, "&lt;")
           .replace(/>/g, "&gt;")
           .replace(/"/g, "&quot;")
           .replace(/'/g, "&#039;");
  };

  public getHuSummaryForStaticAI(): string {
    if (this.huList.length === 0) return "No hay Historias de Usuario, Análisis de Flujo ni Comparaciones definidas aún.";
    let summary = this.huList.map(hu => {
      let huDesc = `ID ${hu.id} (${hu.title}): Modo "${hu.originalInput.generationMode}".`;
      if (hu.originalInput.generationMode === 'text' && hu.originalInput.description) huDesc += ` Descripción: ${hu.originalInput.description.substring(0, 70)}...`;
      else if (hu.originalInput.generationMode === 'image') huDesc += ` (Desde ${hu.originalInput.imagesBase64?.length || 0} imagen(es), título: ${hu.title}, técnica: ${hu.originalInput.selectedTechnique})`;
      else if (hu.originalInput.generationMode === 'flowAnalysis') huDesc += ` (Análisis desde ${hu.originalInput.imagesBase64?.length || 0} imagen(es), título: ${hu.title})`;
      else if (hu.originalInput.generationMode === 'flowComparison') huDesc += ` (Comparación Flujo A:${hu.originalInput.imagesBase64FlowA?.length || 0} vs Flujo B:${hu.originalInput.imagesBase64FlowB?.length || 0} imagen(es), título: ${hu.title})`;
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
      default: return; // Asegura que no se caiga si se llama con un valor inesperado
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

  public resetParentCurrentInputs(): void {
    const keptSprint = this.currentFlowSprint;

    if (this.flowFormDirective) {
        this.flowFormDirective.resetForm({ currentFlowSprint: keptSprint, currentFlowTitle: '' });
    }
    this.currentFlowSprint = keptSprint;
    this.currentFlowTitle = '';

    this.draggableFlowImages = []; this.flowImagesBase64 = []; this.flowImageMimeTypes = []; this.flowImageUploadError = null;
    this.formError = null;
    this.flowAnalysisErrorGlobal = null;
    this.bugComparisonErrorGlobal = null;


    if (isPlatformBrowser(this.platformId)) {
      if (this.flowAnalysisImageInputRef?.nativeElement) this.flowAnalysisImageInputRef.nativeElement.value = '';
    }
    setTimeout(() => {
        if(this.flowFormDirective?.form) {
            this.flowFormDirective.form.patchValue({
                currentFlowSprint: this.currentFlowSprint,
                currentFlowTitle: this.currentFlowTitle
            });
            this.flowFormDirective.form.updateValueAndValidity();
        }
        this.cdr.detectChanges();
    }, 0);
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

    const flowAnalysisHUs = this.huList.filter(hu => hu.originalInput.generationMode === 'flowAnalysis');
    if(flowAnalysisHUs.length > 0){
        fullPlanContent += `ANÁLISIS DE FLUJO INVERSO (Desde Imágenes):\n\n`;
        flowAnalysisHUs.forEach(hu => {
            fullPlanContent += `Análisis ID ${hu.id}: ${hu.title} (Desde ${hu.originalInput.imagesBase64?.length || 0} imgs)\n`;
            if(hu.flowAnalysisReport?.[0] && !this.isFlowAnalysisReportInErrorState(hu.flowAnalysisReport[0])){
                const report = hu.flowAnalysisReport[0];
                fullPlanContent += `  Nombre Escenario: ${report.Nombre_del_Escenario}\n`;
                if (report.Pasos_Analizados?.length) {
                    report.Pasos_Analizados.forEach((paso) => {
                        fullPlanContent += `    Paso ${paso.numero_paso}: ${paso.descripcion_accion_observada} (Ref IA: ${paso.imagen_referencia_entrada})\n      Elemento: ${paso.elemento_clave_y_ubicacion_aproximada}\n      Dato Entrada: ${paso.dato_de_entrada_paso || 'N/A'}\n      Res.Esp: ${paso.resultado_esperado_paso}\n      Res.Obt: ${paso.resultado_obtenido_paso_y_estado}\n`;
                    });
                } else {
                     fullPlanContent += `  Pasos: No detallados o no generados.\n`;
                }
                fullPlanContent += `  Res.Esp.General: ${report.Resultado_Esperado_General_Flujo}\n  Conclusión: ${report.Conclusion_General_Flujo}\n\n`;
            } else if (hu.errorFlowAnalysis) {
                fullPlanContent += `  Error en análisis: ${hu.errorFlowAnalysis}\n\n`;
            } else {
                 fullPlanContent += `  Informe no disponible o con errores.\n\n`;
            }
        });
    }

    const bugComparisonHUs = this.huList.filter(hu => hu.originalInput.generationMode === 'flowComparison');
    if (bugComparisonHUs.length > 0) {
        fullPlanContent += `REPORTE DE COMPARACIÓN DE FLUJOS (BUGS):\n\n`;
        const currentDate = new Date().toISOString().split('T')[0];
        bugComparisonHUs.forEach(hu => {
            fullPlanContent += `Comparación ID ${hu.id}: ${hu.title}\n`;
            if (hu.bugComparisonReport?.length && !this.isBugReportInErrorState(hu.bugComparisonReport)) {
                hu.bugComparisonReport.forEach(bug => {
                    fullPlanContent += `  Bug: ${bug.titulo_bug}\n    Prioridad: ${bug.prioridad}, Severidad: ${bug.severidad}\n    Fecha: ${bug.fecha_reporte || currentDate}\n`;
                    if (bug.descripcion_diferencia_general) fullPlanContent += `    Desc. General: ${bug.descripcion_diferencia_general}\n`;
                    fullPlanContent += `    Pasos Repr.:\n`;
                    if (bug.pasos_para_reproducir?.length) {
                        bug.pasos_para_reproducir.forEach(p => { fullPlanContent += `      ${p.numero_paso}. ${p.descripcion}\n`; });
                    } else {
                        fullPlanContent += `      Pasos no detallados.\n`;
                    }
                    fullPlanContent += `    Res.Esp. (Ref A: ${bug.imagen_referencia_flujo_a || 'N/A'}): ${bug.resultado_esperado}\n    Res.Act. (Ref B: ${bug.imagen_referencia_flujo_b || 'N/A'}): ${bug.resultado_actual}\n\n`;
                });
            } else if (hu.errorBugComparison) {
                fullPlanContent += `  Error en comparación: ${hu.errorBugComparison}\n\n`;
            } else {
                fullPlanContent += `  No se reportaron diferencias o hubo un error en la generación.\n\n`;
            }
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

    const flowAnalysisHUs = this.huList.filter(hu => hu.originalInput.generationMode === 'flowAnalysis');
    if(flowAnalysisHUs.length > 0){
        fullPlanHtmlContent += `<p><span class="preview-section-title">ANÁLISIS DE FLUJO INVERSO (Desde Imágenes):</span></p>\n`;
        flowAnalysisHUs.forEach(hu => {
            fullPlanHtmlContent += `<p><span class="preview-hu-title">Análisis ID ${this.escapeHtmlForExport(hu.id)}: ${this.escapeHtmlForExport(hu.title)} (Generado desde ${hu.originalInput.imagesBase64?.length || 0} imagen(es))</span></p>\n`;
            if(hu.flowAnalysisReport && hu.flowAnalysisReport.length > 0 && !this.isFlowAnalysisReportInErrorState(hu.flowAnalysisReport[0])){
                const report = hu.flowAnalysisReport[0];
                fullPlanHtmlContent += `  <p style="margin-left:15px;"><strong>Nombre del Escenario:</strong> ${this.escapeHtmlForExport(report.Nombre_del_Escenario)}</p>\n`;
                 if (report.Pasos_Analizados && report.Pasos_Analizados.length > 0) {
                    fullPlanHtmlContent += `  <p style="margin-left:15px;"><strong>Pasos:</strong></p>\n<ul style="margin-left:30px;">`;
                    report.Pasos_Analizados.forEach((paso) => {
                        fullPlanHtmlContent += `<li>Paso ${paso.numero_paso}: ${this.escapeHtmlForExport(paso.descripcion_accion_observada)} (Ref IA: ${this.escapeHtmlForExport(paso.imagen_referencia_entrada)}, Elem.IA: ${this.escapeHtmlForExport(paso.elemento_clave_y_ubicacion_aproximada)})<br>\n`;
                        fullPlanHtmlContent += `      <em>Dato de Entrada (Paso):</em> ${this.escapeHtmlForExport(paso.dato_de_entrada_paso || 'N/A')}<br>\n`;
                        fullPlanHtmlContent += `      <em>Resultado Esperado (Paso):</em> ${this.escapeHtmlForExport(paso.resultado_esperado_paso)}<br>\n`;
                        fullPlanHtmlContent += `      <em>Resultado Obtenido (Paso):</em> ${this.escapeHtmlForExport(paso.resultado_obtenido_paso_y_estado)}</li>\n`;
                    });
                    fullPlanHtmlContent += `</ul>\n`;
                } else {
                    fullPlanHtmlContent += `  <p style="margin-left:15px;"><strong>Pasos:</strong> <em>No se pudieron determinar pasos detallados o no se encontraron.</em></p>\n`;
                }
                fullPlanHtmlContent += `  <p style="margin-left:15px;"><strong>Resultado Esperado General del Flujo:</strong> ${this.escapeHtmlForExport(report.Resultado_Esperado_General_Flujo)}</p>\n`;
                fullPlanHtmlContent += `  <p style="margin-left:15px;"><strong>Conclusión General del Flujo:</strong> ${this.escapeHtmlForExport(report.Conclusion_General_Flujo)}</p>\n\n`;
            } else if (hu.errorFlowAnalysis) {
                fullPlanHtmlContent += `  <p style="margin-left:15px; color:red;"><em>Error en análisis: ${this.escapeHtmlForExport(hu.errorFlowAnalysis)}</em></p>\n\n`;
            } else {
                fullPlanHtmlContent += `  <p style="margin-left:15px;"><em>Informe de análisis de flujo no disponible o con errores.</em></p>\n\n`;
            }
        });
    }

    const bugComparisonHUs_html = this.huList.filter(hu => hu.originalInput.generationMode === 'flowComparison');
    if (bugComparisonHUs_html.length > 0) {
        fullPlanHtmlContent += `<p><span class="preview-section-title">REPORTE DE COMPARACIÓN DE FLUJOS (BUGS):</span></p>\n`;
        bugComparisonHUs_html.forEach(hu => {
            fullPlanHtmlContent += `<p><span class="preview-hu-title">Comparación ID ${this.escapeHtmlForExport(hu.id)}: ${this.escapeHtmlForExport(hu.title)}</span></p>\n`;
            if (hu.bugComparisonReport && hu.bugComparisonReport.length > 0 && !this.isBugReportInErrorState(hu.bugComparisonReport)) {
                hu.bugComparisonReport.forEach(bug => {
                    fullPlanHtmlContent += `  <div style="margin-left:15px; border-left: 2px solid #c0392b; padding-left:10px; margin-bottom:10px;"><strong>Bug: ${this.escapeHtmlForExport(bug.titulo_bug)}</strong><br>\n`;
                    fullPlanHtmlContent += `    Prioridad: ${this.escapeHtmlForExport(bug.prioridad)}, Severidad: ${this.escapeHtmlForExport(bug.severidad)}<br>\n`;
                    fullPlanHtmlContent += `    Fecha: ${this.escapeHtmlForExport(bug.fecha_reporte || currentDateForHtml)}<br>\n`;
                    if (bug.descripcion_diferencia_general) fullPlanHtmlContent += `    Descripción General: ${this.escapeHtmlForExport(bug.descripcion_diferencia_general)}<br>\n`;
                    fullPlanHtmlContent += `    Pasos para Reproducir:<br>\n`;
                    if (bug.pasos_para_reproducir && bug.pasos_para_reproducir.length > 0) {
                        fullPlanHtmlContent += `<ol style="margin-left:20px;">`;
                        bug.pasos_para_reproducir.forEach(paso => {
                            fullPlanHtmlContent += `<li>${this.escapeHtmlForExport(paso.descripcion)}</li>\n`;
                        });
                        fullPlanHtmlContent += `</ol>\n`;
                    } else {
                         fullPlanHtmlContent += `    <em>Pasos no detallados.</em><br>\n`;
                    }
                    const imgSrcA = this.getBugReportImage(hu, bug.imagen_referencia_flujo_a, 'A');
                    const imgSrcB = this.getBugReportImage(hu, bug.imagen_referencia_flujo_b, 'B');
                    fullPlanHtmlContent += `    Resultado Esperado (Ref. A: ${this.escapeHtmlForExport(bug.imagen_referencia_flujo_a || 'N/A')}): ${this.escapeHtmlForExport(bug.resultado_esperado)}<br>\n`;
                    if(imgSrcA) fullPlanHtmlContent += `<img src="${imgSrcA}" alt="Imagen Esperada para bug ${bug.id_bug}" class="bug-report-image"><br>`;
                    fullPlanHtmlContent += `    Resultado Actual (Ref. B: ${this.escapeHtmlForExport(bug.imagen_referencia_flujo_b || 'N/A')}): ${this.escapeHtmlForExport(bug.resultado_actual)}<br>\n`;
                    if(imgSrcB) fullPlanHtmlContent += `<img src="${imgSrcB}" alt="Imagen Actual para bug ${bug.id_bug}" class="bug-report-image"><br>`;
                    fullPlanHtmlContent += `</div>\n\n`;
                });
            } else if (hu.errorBugComparison) {
                 fullPlanHtmlContent += `  <p style="margin-left:15px; color:red;"><em>Error en la comparación: ${this.escapeHtmlForExport(hu.errorBugComparison)}</em></p>\n\n`;
            } else {
                fullPlanHtmlContent += `  <p style="margin-left:15px;"><em>No se reportaron diferencias significativas o hubo un error en la generación del reporte.</em></p>\n\n`;
            }
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
    const blob = new Blob(['\uFEFF', htmlContent], { type: 'text/html;charset=utf-8;' });
    saveAs(blob, `${this.escapeFilename(this.testPlanTitle || 'PlanDePruebas')}_Fallback.html`);
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

  public exportFlowAnalysisReportToCsv(hu: HUData): void {
    if (hu.originalInput.generationMode !== 'flowAnalysis' || !hu.flowAnalysisReport?.[0]?.Pasos_Analizados?.length || this.isFlowAnalysisReportInErrorState(hu.flowAnalysisReport[0])) {
      alert('No hay datos de análisis de flujo válidos para exportar.');
      return;
    }
    const report = hu.flowAnalysisReport[0];
    const csvHeader = [
      "Nombre del Escenario",
      "Número de Paso",
      "Descripción de la Acción Observada",
      // "Imagen Ref. Entrada (IA)", // Removed as per user request
      // "Elemento Clave (IA)",       // Removed as per user request
      "Dato de Entrada (Paso)",
      "Resultado Esperado (Paso)",
      "Resultado Obtenido (Paso) y Estado",
      "Resultado Esperado General del Flujo",
      "Conclusión General del Flujo"
    ];
    const csvRows = report.Pasos_Analizados.map(paso => [
      this.escapeCsvField(report.Nombre_del_Escenario),
      this.escapeCsvField(paso.numero_paso),
      this.escapeCsvField(paso.descripcion_accion_observada),
      // this.escapeCsvField(paso.imagen_referencia_entrada), // Removed
      // this.escapeCsvField(paso.elemento_clave_y_ubicacion_aproximada), // Removed
      this.escapeCsvField(paso.dato_de_entrada_paso || 'N/A'),
      this.escapeCsvField(paso.resultado_esperado_paso),
      this.escapeCsvField(paso.resultado_obtenido_paso_y_estado),
      this.escapeCsvField(report.Resultado_Esperado_General_Flujo),
      this.escapeCsvField(report.Conclusion_General_Flujo)
    ]);
    const csvFullContent = [csvHeader.join(','), ...csvRows.map(row => row.join(','))].join('\r\n');
    saveAs(new Blob(["\uFEFF" + csvFullContent], { type: 'text/csv;charset=utf-8;' }), `AnalisisFlujo_${this.escapeFilename(hu.title || 'Reporte')}_${new Date().toISOString().split('T')[0]}.csv`);
  }

  public exportFlowAnalysisReportToHtmlLocalized(hu: HUData, language: 'es' | 'en'): void {
    if (hu.originalInput.generationMode !== 'flowAnalysis' || !hu.flowAnalysisReport?.[0] || this.isFlowAnalysisReportInErrorState(hu.flowAnalysisReport[0])) {
        alert(language === 'en' ? 'No valid flow analysis report to export.' : 'No hay informe de análisis de flujo válido para exportar.');
        return;
    }
    const report = hu.flowAnalysisReport[0];
    const date = new Date().toISOString().split('T')[0];
    const title = language === 'en'
        ? `Flow Analysis Report: ${this.escapeHtmlForExport(report.Nombre_del_Escenario)}`
        : `Informe de Análisis de Flujo: ${this.escapeHtmlForExport(report.Nombre_del_Escenario)}`;

    let html = `<html><head><meta charset="UTF-8"><title>${title}</title><style>body{font-family:Segoe UI,Calibri,Arial,sans-serif;margin:20px;line-height:1.6;color:#333}.report-container{max-width:900px;margin:auto}h1{color:#3b5a6b;border-bottom:2px solid #e9ecef;padding-bottom:10px}h2{font-size:1.4em;color:#4a6d7c;margin-top:20px;margin-bottom:10px;padding-bottom:5px;border-bottom:1px dashed #e0e0e0}table{width:100%;border-collapse:collapse;margin-bottom:20px;font-size:.9em}th,td{border:1px solid #ddd;padding:8px;text-align:left;vertical-align:top}th{background-color:#f2f2f2;font-weight:600}img.flow-step-image{max-width:150px;max-height:100px;border:1px solid #ccc;border-radius:4px;display:block;margin:5px 0;background-color:#fff;object-fit:contain}tr.status-success td:first-child{border-left:5px solid #28a745!important}tr.status-failure td:first-child{border-left:5px solid #dc3545!important}tr.status-deviation td:first-child{border-left:5px solid #ffc107!important}.conclusion-section p{margin-bottom:8px} .conclusion-section strong{color:#555}</style></head><body><div class="report-container"><h1>${title}</h1><p><strong>${language === 'en' ? 'Date' : 'Fecha'}:</strong> ${date}</p>`;
    
    html += `<h2>${language === 'en' ? 'Analyzed Steps' : 'Pasos Analizados'}:</h2>`;
    if (report.Pasos_Analizados && report.Pasos_Analizados.length > 0) {
        html += `<table><thead><tr>
        <th>${language === 'en' ? 'Step' : 'Paso'}</th>
        <th>${language === 'en' ? 'Action/Observation' : 'Acción/Observación'}</th>
        <th>${language === 'en' ? 'Input Data' : 'Dato Entrada'}</th>
        <th>${language === 'en' ? 'Expected Result' : 'Res. Esperado'}</th>
        <th>${language === 'en' ? 'Actual Result & Status' : 'Res. Obtenido y Estado'}</th>
        <th>${language === 'en' ? 'Step Image' : 'Imagen Paso'}</th>
        </tr></thead><tbody>`;
        report.Pasos_Analizados.forEach(paso => {
            const imgSrc = this.getFlowStepImage(hu, paso);
            html += `<tr class="${this.getFlowStepStatusClass(paso)}">
            <td>${paso.numero_paso}</td>
            <td>${this.escapeHtmlForExport(paso.descripcion_accion_observada)}</td>
            <td>${this.escapeHtmlForExport(paso.dato_de_entrada_paso || 'N/A')}</td>
            <td>${this.escapeHtmlForExport(paso.resultado_esperado_paso)}</td>
            <td>${this.escapeHtmlForExport(paso.resultado_obtenido_paso_y_estado)}</td>
            <td>${imgSrc ? `<img src="${imgSrc}" alt="Imagen para paso original ${paso.numero_paso}" class="flow-step-image">` : 'N/A'}</td>
            </tr>`;
        });
        html += `</tbody></table>`;
    } else {
        html += `<p><em>${language === 'en' ? 'No detailed steps were analyzed or found.' : 'No se pudieron determinar pasos detallados o no se encontraron.'}</em></p>`;
    }

    html += `<div class="conclusion-section"><h2>${language === 'en' ? 'General Conclusions' : 'Conclusiones Generales'}:</h2><p><strong>${language === 'en' ? 'Overall Expected Result of the Flow' : 'Resultado Esperado General del Flujo'}:</strong> ${this.escapeHtmlForExport(report.Resultado_Esperado_General_Flujo)}</p><p><strong>${language === 'en' ? 'Overall Conclusion of the Flow' : 'Conclusión General del Flujo'}:</strong> ${this.escapeHtmlForExport(report.Conclusion_General_Flujo)}</p></div>`;
    html += `</div></body></html>`;
    saveAs(new Blob([html], { type: 'text/html;charset=utf-8;' }), `AnalisisFlujo_${this.escapeFilename(hu.title || 'Reporte')}_${language === 'en' ? 'ENG' : 'ESP'}_${date}.html`);
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

  public getFlowStepImage(hu: HUData, paso: FlowAnalysisStep): string | null {
    if (!hu.originalInput.imagesBase64?.length || !hu.originalInput.imageMimeTypes) return null;
    
    const match = paso.imagen_referencia_entrada?.match(/Imagen (?:[AB]\.?)?(\d+)/i);
    if (match?.[1]) {
      const imageIndex = parseInt(match[1], 10) - 1;
      
      let imagesToUse: string[] | undefined;
      let mimeTypesToUse: string[] | undefined;

      if (paso.imagen_referencia_entrada?.toUpperCase().startsWith("IMAGEN A")) {
          imagesToUse = hu.originalInput.imagesBase64FlowA;
          mimeTypesToUse = hu.originalInput.imageMimeTypesFlowA;
      } else if (paso.imagen_referencia_entrada?.toUpperCase().startsWith("IMAGEN B")) {
          imagesToUse = hu.originalInput.imagesBase64FlowB;
          mimeTypesToUse = hu.originalInput.imageMimeTypesFlowB;
      } else {
          imagesToUse = hu.originalInput.imagesBase64;
          mimeTypesToUse = hu.originalInput.imageMimeTypes;
      }

      if (imagesToUse && mimeTypesToUse && imageIndex >= 0 && imageIndex < imagesToUse.length) {
        return `data:${mimeTypesToUse[imageIndex]};base64,${imagesToUse[imageIndex]}`;
      }
    }
    return null;
  }

  public getFlowStepStatusClass(paso: FlowAnalysisStep): string {
    const status = (paso.resultado_obtenido_paso_y_estado || '').toLowerCase();
    if (status.includes('exitosa con desviaciones') || status.includes('parcialmente exitosa')) return 'status-deviation';
    if (status.includes('exitosa')) return 'status-success';
    if (status.includes('fallido') || status.includes('fallida') || status.includes('error')) return 'status-failure';
    return '';
  }
  
  public isFlowAnalysisReportInErrorState = (r?: FlowAnalysisReportItem): boolean =>
    !r ||
    ["Error de API", "Error de Formato de Respuesta", "Error de Formato (No JSON Array)", "Error de Formato (No Array)", "Error de Formato (Faltan Campos)", "Error de Parsing JSON", "Secuencia de imágenes no interpretable", "Error Crítico en Generación", "Error Crítico en Re-Generación", "Error Crítico en Re-Generación (Contextualizada)", "Respuesta Vacía de IA"].includes(r.Nombre_del_Escenario);

  public isBugReportInErrorState = (r?: BugReportItem[]): boolean =>
    !r || r.length === 0 ? false : r.some(b =>
        b.titulo_bug.startsWith("Error de API") ||
        b.titulo_bug.startsWith("Error de Formato") ||
        b.titulo_bug.startsWith("Error de Parsing JSON") ||
        b.titulo_bug.startsWith("Error Crítico") ||
        b.titulo_bug.startsWith("Error en el Análisis de Imágenes")
    );
}