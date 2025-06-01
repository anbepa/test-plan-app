// src/app/test-case-generator/test-case-generator.component.ts
import { Component, OnInit, ViewChild, ElementRef, Inject, PLATFORM_ID, Output, EventEmitter, Input, ChangeDetectorRef } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { CommonModule, isPlatformBrowser } from '@angular/common';
// Importar directamente desde el archivo de modelos
import { DetailedTestCase, TestCaseStep, HUData, GenerationMode } from '../models/hu-data.model';
import { GeminiService } from '../services/gemini.service';
import { catchError, finalize, tap, switchMap } from 'rxjs/operators';
import { Observable, of, forkJoin } from 'rxjs';

interface DraggableImage {
  file: File;
  preview: string | ArrayBuffer;
  base64: string;
  mimeType: string;
  id: string;
}

@Component({
  selector: 'app-test-case-generator',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './test-case-generator.component.html',
  styleUrls: ['./test-case-generator.component.css']
})
export class TestCaseGeneratorComponent implements OnInit {
  @Input() initialGenerationMode: GenerationMode = 'text';
  @Input() initialSprint: string = '';
  @Output() huGenerated = new EventEmitter<HUData>();
  @Output() generationCancelled = new EventEmitter<void>();

  currentGenerationMode: GenerationMode = 'text';

  draggableImages: DraggableImage[] = [];
  imagesBase64: string[] = [];
  imageMimeTypes: string[] = [];
  imageUploadError: string | null = null;

  currentHuId: string = '';
  currentHuTitle: string = '';
  currentSprint: string = '';
  currentDescription: string = '';
  currentAcceptanceCriteria: string = '';
  currentSelectedTechnique: string = '';

  generatedHUData: HUData | null = null;
  userTestCaseReanalysisContext: string = ''; 
  currentEditingTestCase: DetailedTestCase | null = null; 

  formError: string | null = null;
  loadingScope: boolean = false;
  loadingScenarios: boolean = false;
  errorScope: string | null = null;
  errorScenarios: string | null = null;

  draggedImage: DraggableImage | null = null;
  dragOverImageId: string | null = null;

  draggedTestCaseStep: TestCaseStep | null = null;
  dragOverTestCaseStepId: string | null = null; 

  @ViewChild('huForm') huFormDirective!: NgForm;
  @ViewChild('imageFilesInput') imageFilesInputRef: ElementRef<HTMLInputElement> | undefined;

  constructor(
    private geminiService: GeminiService,
    @Inject(PLATFORM_ID) private platformId: Object,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.currentGenerationMode = this.initialGenerationMode;
    this.currentSprint = this.initialSprint;
    this.onGenerationModeChange(); 
  }

  public autoGrowTextarea(element: any): void { // Cambiado a 'any' para evitar problemas con $event.target
    if (element && element instanceof HTMLTextAreaElement) { // Verificación de tipo
      element.style.height = 'auto'; // Reset height
      // Forzar un reflujo para asegurar que scrollHeight se calcula correctamente antes de establecer la nueva altura
      // eslint-disable-next-line no-self-assign
      element.scrollTop = element.scrollTop; 
      element.style.height = (element.scrollHeight) + 'px';
    }
  }

  onGenerationModeChange(): void {
    this.formError = null;
    this.imageUploadError = null;
    this.draggableImages = [];
    this.imagesBase64 = [];
    this.imageMimeTypes = [];
    
    const keptSprint = this.currentSprint; 
    const keptTechnique = this.currentSelectedTechnique; 

    this.currentHuId = '';
    this.currentHuTitle = '';
    this.currentDescription = '';
    this.currentAcceptanceCriteria = '';
    
    this.generatedHUData = null;
    this.userTestCaseReanalysisContext = '';
    this.currentEditingTestCase = null;

    if (isPlatformBrowser(this.platformId) && this.imageFilesInputRef?.nativeElement) {
      this.imageFilesInputRef.nativeElement.value = '';
    }
    
    this.huFormDirective?.resetForm({
        currentSprint: keptSprint,
        currentSelectedTechnique: keptTechnique,
        currentHuId: '', 
        currentHuTitle: '',
        currentDescription: '',
        currentAcceptanceCriteria: ''
    });
    this.currentSprint = keptSprint;
    this.currentSelectedTechnique = keptTechnique;

     setTimeout(() => this.huFormDirective?.form.updateValueAndValidity(), 0);
  }

  isFormInvalidForCurrentMode(): boolean {
    if (!this.huFormDirective?.form || !this.currentGenerationMode) return true;
    const commonRequired = !this.currentSprint || !this.currentHuTitle || !this.currentSelectedTechnique;
    if (this.currentGenerationMode === 'text') {
      return !this.currentHuId || !this.currentDescription || !this.currentAcceptanceCriteria || commonRequired;
    } else if (this.currentGenerationMode === 'image') {
      return commonRequired || this.draggableImages.length === 0;
    }
    return true; 
  }

  private parseFileNameForSorting(fileName: string): { main: number, sub: number } {
      const nameWithoutExtension = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
      const parts = nameWithoutExtension.split(/[^0-9]+/g).filter(Boolean).map(p => parseInt(p, 10));
      return {
          main: parts.length > 0 && !isNaN(parts[0]) ? parts[0] : Infinity,
          sub: parts.length > 1 && !isNaN(parts[1]) ? parts[1] : (parts.length > 0 && !isNaN(parts[0]) ? 0 : Infinity)
      };
  }

  onFileSelected(event: Event): void {
    this.imageUploadError = null; this.formError = null; this.draggableImages = [];
    const element = event.currentTarget as HTMLInputElement;
    const fileList: FileList | null = element.files;
    const maxImages = 5; 

    if (fileList?.length) {
        if (fileList.length > maxImages) { this.imageUploadError = `Puedes seleccionar un máximo de ${maxImages} imágenes.`; element.value = ""; return; }
        
        let filesArray = Array.from(fileList).sort((a,b) => { 
            const pA = this.parseFileNameForSorting(a.name);
            const pB = this.parseFileNameForSorting(b.name);
            return pA.main !== pB.main ? pA.main - pB.main : pA.sub - pB.sub;
        });

        const fileProcessingObservables: Observable<DraggableImage>[] = [];
        let validationErrorFound = false;

        for (const file of filesArray) {
            if (validationErrorFound) continue; 
            if (file.size > 4 * 1024 * 1024) { 
                this.imageUploadError = `El archivo "${file.name}" excede el tamaño máximo de 4MB.`;
                validationErrorFound = true;
            }
            if (!['image/jpeg', 'image/png'].includes(file.type) && !validationErrorFound) {
                this.imageUploadError = `Formato de archivo inválido: "${file.name}". Solo se permiten JPG y PNG.`;
                validationErrorFound = true;
            }
            if (validationErrorFound) {
                element.value = ""; 
                this.draggableImages = []; 
                this.updateArraysFromDraggable(); 
                return; 
            }

            const readerObservable = new Observable<DraggableImage>(subscriber => {
                const reader = new FileReader();
                reader.onload = () => {
                    subscriber.next({
                        file: file,
                        preview: reader.result!,
                        base64: (reader.result as string).split(',')[1],
                        mimeType: file.type,
                        id: 'IMG_' + file.name + '_' + Date.now() + Math.random().toString(16).slice(2) 
                    });
                    subscriber.complete();
                };
                reader.onerror = error => {
                    this.imageUploadError = `Error al leer el archivo "${file.name}".`;
                    subscriber.error(error);
                };
                reader.readAsDataURL(file);
            });
            fileProcessingObservables.push(readerObservable);
        }

        if (validationErrorFound) { 
             this.draggableImages = []; this.updateArraysFromDraggable(); return; 
        }

        if (fileProcessingObservables.length > 0) {
            forkJoin(fileProcessingObservables).subscribe({
                next: (processedImages) => {
                    this.draggableImages.push(...processedImages);
                    this.updateArraysFromDraggable();
                },
                error: () => { 
                    element.value = ""; this.draggableImages = []; this.updateArraysFromDraggable();
                },
                complete: () => {
                    this.huFormDirective?.form.updateValueAndValidity(); 
                }
            });
        }
    } else { 
        this.draggableImages = [];
        this.updateArraysFromDraggable();
        this.huFormDirective?.form.updateValueAndValidity();
    }
  }

  private updateArraysFromDraggable(): void {
    this.imagesBase64 = this.draggableImages.map(di => di.base64);
    this.imageMimeTypes = this.draggableImages.map(di => di.mimeType);
    this.cdr.detectChanges(); 
  }

  public onImageDragStart(event: DragEvent, image: DraggableImage): void { this.draggedImage = image; if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', image.id); (event.target as HTMLElement).style.opacity = '0.4'; } }
  public onImageDragOver(event: DragEvent, targetImage?: DraggableImage): void { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'; this.dragOverImageId = targetImage ? targetImage.id : null; }
  public onImageDragLeave(event: DragEvent): void { this.dragOverImageId = null; }
  public onImageDrop(event: DragEvent, targetImage: DraggableImage): void { event.preventDefault(); this.dragOverImageId = null; const dEl = document.querySelector<HTMLElement>('.image-preview-item[style*="opacity: 0.4"]'); if (dEl) dEl.style.opacity = '1'; if (!this.draggedImage || this.draggedImage.id === targetImage.id) { this.draggedImage = null; return; } const fromI = this.draggableImages.findIndex(i => i.id === this.draggedImage!.id), toI = this.draggableImages.findIndex(i => i.id === targetImage.id); if (fromI!==-1 && toI!==-1) { const item = this.draggableImages.splice(fromI,1)[0]; this.draggableImages.splice(toI,0,item); this.updateArraysFromDraggable(); } this.draggedImage = null; }
  public onImageDragEnd(event?: DragEvent): void { if (event?.target instanceof HTMLElement) (event.target as HTMLElement).style.opacity = '1'; else { const dEl = document.querySelector<HTMLElement>('.image-preview-item[style*="opacity: 0.4"]'); if (dEl) dEl.style.opacity = '1'; } this.draggedImage = null; this.dragOverImageId = null; }

  generateIdFromTitle(title: string, mode: GenerationMode): string { if (!title || !mode) return ''; let p = mode === 'text' ? "HU_" : "IMG_"; const sT = title.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^\w-]+/g, ''); return `${p}${sT.substring(0,20)}_${Date.now().toString().slice(-4)}`; }

  addHuAndGenerateData(): void {
    this.formError = null; this.errorScope = null; this.errorScenarios = null;
    if (this.isFormInvalidForCurrentMode()) { this.formError = "Por favor, completa todos los campos requeridos."; if (this.currentGenerationMode === 'image' && !this.draggableImages.length) this.formError = "Por favor, selecciona al menos una imagen."; this.huFormDirective?.form.markAllAsTouched(); return; }
    let finalId = this.currentHuId; if (this.currentGenerationMode === 'image') { finalId = this.generateIdFromTitle(this.currentHuTitle,this.currentGenerationMode); if(!finalId){this.formError="El título es necesario para generar el ID.";return;}}

    const huData: HUData = {
      originalInput: { 
        id: finalId, 
        title: this.currentHuTitle, 
        sprint: this.currentSprint, 
        description: this.currentGenerationMode === 'text' ? this.currentDescription : undefined, 
        acceptanceCriteria: this.currentGenerationMode === 'text' ? this.currentAcceptanceCriteria : undefined, 
        selectedTechnique: this.currentSelectedTechnique, 
        generationMode: this.currentGenerationMode, 
        imagesBase64: this.currentGenerationMode === 'image' ? [...this.imagesBase64] : undefined, 
        imageMimeTypes: this.currentGenerationMode === 'image' ? [...this.imageMimeTypes] : undefined, 
      },
      id: finalId.trim(), 
      title: this.currentHuTitle.trim(), 
      sprint: this.currentSprint.trim(),
      generatedScope: '', 
      detailedTestCases: [], 
      generatedTestCaseTitles: '',
      editingScope: false, 
      editingScenarios: false,
      loadingScope: this.currentGenerationMode === 'text', 
      errorScope: null,
      loadingScenarios: true, 
      errorScenarios: null, 
      showRegenTechniquePicker: false, 
      regenSelectedTechnique: '',
      userTestCaseReanalysisContext: '', 
      isScopeDetailsOpen: this.currentGenerationMode === 'text', 
      isScenariosDetailsOpen: true,
    };
    this.generatedHUData = huData; 

    if (huData.originalInput.generationMode === 'text') {
      this.loadingScope = true; 
      this.geminiService.generateTestPlanSections(huData.originalInput.description!, huData.originalInput.acceptanceCriteria!)
        .pipe(
          tap(s => { huData.generatedScope = s; }),
          catchError(e => { huData.errorScope = (typeof e === 'string' ? e : e.message) || 'Error al generar alcance.'; this.errorScope = huData.errorScope; return of(''); }),
          finalize(() => { huData.loadingScope = false; this.loadingScope = false; this.cdr.detectChanges(); }),
          switchMap(() => this._generateDetailedTestCasesForHu(huData, huData.originalInput.selectedTechnique))
        )
        .subscribe({
          next: () => this.finalizeGeneration(),
          error: e => this.handleGenerationError(e, huData)
        });
    } else if (huData.originalInput.generationMode === 'image') {
      huData.loadingScope = false; 
      this.loadingScope = false; 
      this._generateDetailedTestCasesForHu(huData, huData.originalInput.selectedTechnique)
        .subscribe({
          next: () => this.finalizeGeneration(),
          error: e => this.handleGenerationError(e, huData)
        });
    }
  }

  private _generateDetailedTestCasesForHu(hu: HUData, technique: string, additionalContext?: string): Observable<DetailedTestCase[]> {
    hu.loadingScenarios = true; this.loadingScenarios = true; 
    hu.errorScenarios = null; this.errorScenarios = null;
    
    let genObs$: Observable<DetailedTestCase[]>;

    if (hu.originalInput.generationMode === 'image' && hu.originalInput.imagesBase64?.length) {
      genObs$ = this.geminiService.generateDetailedTestCasesImageBased(hu.originalInput.imagesBase64, hu.originalInput.imageMimeTypes!, technique, additionalContext);
    } else if (hu.originalInput.generationMode === 'text' && hu.originalInput.description && hu.originalInput.acceptanceCriteria) {
      genObs$ = this.geminiService.generateDetailedTestCasesTextBased(hu.originalInput.description, hu.originalInput.acceptanceCriteria!, technique, additionalContext);
    } else {
      hu.errorScenarios = "Datos de entrada insuficientes para generar casos de prueba.";
      this.errorScenarios = hu.errorScenarios;
      hu.detailedTestCases = [{ title: "Error de Configuración", preconditions: hu.errorScenarios ?? "Error desconocido", steps: [], expectedResults: "N/A" }];
      hu.generatedTestCaseTitles = hu.errorScenarios ?? "Error desconocido";
      return of(hu.detailedTestCases).pipe(finalize(() => { hu.loadingScenarios = false; this.loadingScenarios = false; this.cdr.detectChanges(); }));
    }

    return genObs$.pipe(
      tap(tcs => {
        hu.detailedTestCases = tcs.map(tc => ({
          ...tc,
          steps: Array.isArray(tc.steps) ? tc.steps.map((s: any, i: number) => ({ 
            numero_paso: s.numero_paso || (i + 1),
            accion: s.accion || "Paso no descrito"
          })) : []
        }));
        hu.generatedTestCaseTitles = this.formatSimpleScenarioTitles(tcs.map(tc => tc.title));
        
        if (tcs?.length === 1 && (tcs[0].title === "Información Insuficiente" || tcs[0].title === "Imágenes no interpretables o técnica no aplicable" || tcs[0].title?.startsWith("Error"))) {
            hu.errorScenarios = `${tcs[0].title}: ${tcs[0].preconditions || (tcs[0].steps && tcs[0].steps[0] ? tcs[0].steps[0].accion : 'Detalles no disponibles.')}`;
            this.errorScenarios = hu.errorScenarios;
        }
      }),
      catchError(e => {
        hu.errorScenarios = (typeof e === 'string' ? e : e.message) || 'Error al generar casos de prueba.';
        this.errorScenarios = hu.errorScenarios;
        hu.detailedTestCases = [{ title: "Error Crítico en Generación", preconditions: hu.errorScenarios ?? "Error no especificado", steps: [], expectedResults: "N/A" }];
        hu.generatedTestCaseTitles = "Error en la generación.";
        return of(hu.detailedTestCases);
      }),
      finalize(() => { 
        hu.loadingScenarios = false; 
        this.loadingScenarios = false; 
        this.cdr.detectChanges(); 
      })
    );
  }

  private finalizeGeneration() {
    if (this.generatedHUData) {
      this.cdr.detectChanges();
      // Intentar ajustar la altura de los textareas después de que se hayan renderizado con datos
      setTimeout(() => {
        if (this.generatedHUData && this.generatedHUData.detailedTestCases) {
          const textareas = document.querySelectorAll('.test-case-steps-table textarea.table-input');
          textareas.forEach(ta => this.autoGrowTextarea(ta as HTMLTextAreaElement));
        }
      }, 0);
    }
  }

  private handleGenerationError(err: any, huData: HUData) {
    console.error(`Error en el flujo de generación de HU (${huData.originalInput.generationMode}):`, err);
    if (!huData.errorScope && !huData.errorScenarios) {
        const defaultErrorMsg = `Error general durante el proceso de generación (${huData.originalInput.generationMode}).`;
        if (huData.loadingScope) huData.errorScope = err.message || defaultErrorMsg;
        if (huData.loadingScenarios) huData.errorScenarios = err.message || defaultErrorMsg;
        this.errorScope = huData.errorScope;
        this.errorScenarios = huData.errorScenarios;
    }
    huData.loadingScope = false; huData.loadingScenarios = false;
    this.loadingScope = false; this.loadingScenarios = false;
    this.generatedHUData = huData; 
    this.cdr.detectChanges();
  }

  formatSimpleScenarioTitles(titles: string[]): string { if (!titles?.length) return 'No se generaron escenarios.'; return titles.map((t, i) => `${i+1}. ${t}`).join('\n'); }
  
  resetCurrentInputs(): void {
    const keptMode = this.currentGenerationMode;
    const keptSprint = this.currentSprint;
    const keptTech = this.currentSelectedTechnique;

    this.huFormDirective?.resetForm(); 
    
    this.currentGenerationMode = keptMode; 
    this.currentSprint = keptSprint;
    this.currentSelectedTechnique = keptTech;

    this.currentHuId = ''; 
    this.currentHuTitle = ''; 
    this.currentDescription = ''; 
    this.currentAcceptanceCriteria = '';
    
    this.draggableImages = []; 
    this.imagesBase64 = []; 
    this.imageMimeTypes = [];
    this.imageUploadError = null; 
    this.formError = null;
    this.errorScope = null;
    this.errorScenarios = null;
    
    this.generatedHUData = null;
    this.userTestCaseReanalysisContext = ''; 
    this.currentEditingTestCase = null;

    if (isPlatformBrowser(this.platformId) && this.imageFilesInputRef?.nativeElement) {
        this.imageFilesInputRef.nativeElement.value = '';
    }

    setTimeout(() => {
        if (this.huFormDirective?.form) {
            this.huFormDirective.form.patchValue({
                currentSprint: this.currentSprint,
                currentSelectedTechnique: this.currentSelectedTechnique,
                currentHuId: this.currentHuId,
                currentHuTitle: this.currentHuTitle,
                currentDescription: this.currentDescription,
                currentAcceptanceCriteria: this.currentAcceptanceCriteria
            });
            this.huFormDirective.form.updateValueAndValidity();
        }
        this.cdr.detectChanges();
    }, 0);
  }

  cancelGeneration() { 
    this.resetCurrentInputs(); 
    this.generationCancelled.emit(); 
  }

  addTestCaseStep(testCase: DetailedTestCase): void {
    if (!testCase.steps) testCase.steps = [];
    testCase.steps.push({ numero_paso: testCase.steps.length + 1, accion: '' });
    this.cdr.detectChanges();
    // Ajustar altura del nuevo textarea si es visible
    setTimeout(() => {
      const textareas = document.querySelectorAll('.test-case-steps-table textarea.table-input');
      if (textareas.length > 0) {
        this.autoGrowTextarea(textareas[textareas.length -1] as HTMLTextAreaElement);
      }
    },0);
  }

  deleteTestCaseStep(testCase: DetailedTestCase, stepIndex: number): void {
    if (testCase.steps) {
      testCase.steps.splice(stepIndex, 1);
      testCase.steps.forEach((step: TestCaseStep, idx: number) => step.numero_paso = idx + 1);
      this.cdr.detectChanges();
    }
  }

  getTestCaseStepDragId(testCase: DetailedTestCase, step: TestCaseStep): string {
    const stepIndex = testCase.steps.indexOf(step);
    return `tc-${this.generatedHUData?.id || 'temp'}-step-${stepIndex}`;
  }

  onTestCaseStepDragStart(event: DragEvent, step: TestCaseStep, testCase: DetailedTestCase): void {
    this.draggedTestCaseStep = step;
    if (event.dataTransfer) {
      const stepIndex = testCase.steps.indexOf(step);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', stepIndex.toString()); 
      const targetEl = event.target as HTMLElement;
      const rowEl = targetEl.closest('tr');
      if(rowEl) rowEl.style.opacity = '0.4';
    }
  }

  onTestCaseStepDragOver(event: DragEvent, targetStep: TestCaseStep | undefined, testCase: DetailedTestCase): void { 
    event.preventDefault();
    if(this.draggedTestCaseStep && event.dataTransfer && targetStep) { 
        event.dataTransfer.dropEffect = 'move';
        this.dragOverTestCaseStepId = this.getTestCaseStepDragId(testCase, targetStep);
    } else if (!targetStep) {
        this.dragOverTestCaseStepId = null; 
    }
  }

  onTestCaseStepDragLeave(event: DragEvent): void {
    this.dragOverTestCaseStepId = null;
  }

  onTestCaseStepDrop(event: DragEvent, targetStep: TestCaseStep, testCase: DetailedTestCase): void {
    event.preventDefault(); this.dragOverTestCaseStepId = null;
    document.querySelectorAll('.test-case-steps-table tbody tr[style*="opacity: 0.4"]')
        .forEach(el => (el as HTMLElement).style.opacity = '1');

    if (!this.draggedTestCaseStep || !testCase.steps || testCase.steps.length === 0) {
        this.draggedTestCaseStep = null; return;
    }
    if (this.draggedTestCaseStep === targetStep) { this.draggedTestCaseStep = null; return; }

    const fromIndex = testCase.steps.indexOf(this.draggedTestCaseStep);
    const toIndex = testCase.steps.indexOf(targetStep);

    if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
        const itemToMove = testCase.steps.splice(fromIndex, 1)[0];
        testCase.steps.splice(toIndex, 0, itemToMove);
        testCase.steps.forEach((s: TestCaseStep, i: number) => s.numero_paso = i + 1);
        this.cdr.detectChanges();
    }
    this.draggedTestCaseStep = null;
  }

  onTestCaseStepDragEnd(event: DragEvent): void {
     document.querySelectorAll('.test-case-steps-table tbody tr[style*="opacity: 0.4"]')
        .forEach(el => (el as HTMLElement).style.opacity = '1');
    this.draggedTestCaseStep = null; this.dragOverTestCaseStepId = null;
  }

  confirmAndEmitHUData() {
    if (this.generatedHUData) {
        if (this.generatedHUData.detailedTestCases) {
             this.generatedHUData.generatedTestCaseTitles = this.formatSimpleScenarioTitles(
                 this.generatedHUData.detailedTestCases.map(tc => tc.title)
             );
             this.generatedHUData.detailedTestCases.forEach(tc => {
                 if (tc.steps) {
                     tc.steps.forEach(step => {
                         if (!step.accion || step.accion.trim() === '') {
                             step.accion = "Acción no definida.";
                         }
                     });
                 }
             });
        }
        this.huGenerated.emit(this.generatedHUData);
        this.resetCurrentInputs(); 
    }
  }
}