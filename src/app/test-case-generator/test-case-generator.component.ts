// src/app/test-case-generator/test-case-generator.component.ts
import { Component, OnInit, ViewChild, ElementRef, Inject, PLATFORM_ID, Output, EventEmitter, Input, ChangeDetectorRef } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { DetailedTestCase as OriginalDetailedTestCase, TestCaseStep, HUData as OriginalHUData, GenerationMode } from '../models/hu-data.model'; // Renamed imports
import { GeminiService } from '../services/gemini.service';
import { catchError, finalize, tap, switchMap } from 'rxjs/operators';
import { Observable, of, forkJoin } from 'rxjs';
import { saveAs } from 'file-saver'; // Para exportar CSV

interface DraggableImage {
  file: File;
  preview: string | ArrayBuffer;
  base64: string;
  mimeType: string;
  id: string;
}

// UI-specific interface extending the original model
interface UIDetailedTestCase extends OriginalDetailedTestCase {
  isExpanded?: boolean;
}

// UI-specific HUData interface
interface UIHUData extends OriginalHUData {
  detailedTestCases: UIDetailedTestCase[];
}

type ComponentState = 'initialForm' | 'previewingGenerated' | 'editingForRefinement' | 'submitting';

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
  @Output() huGenerated = new EventEmitter<OriginalHUData>(); // Emits the original HUData type
  @Output() generationCancelled = new EventEmitter<void>();

  componentState: ComponentState = 'initialForm';
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
  
  refinementTechnique: string = ''; 
  userRefinementContext: string = '';

  generatedHUData: UIHUData | null = null; // Use the UI-specific HUData type

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

  // IDs de los archivos de Google Drive para las plantillas
  private readonly macTemplateId = '1FVRJav4D93FeWVq8GqcmYqaVSFBegamT';
  private readonly windowsTemplateId = '1sJ_zIcabBfKmxEgaOWX6_5oq5xol6CkU';

  constructor(
    private geminiService: GeminiService,
    @Inject(PLATFORM_ID) private platformId: Object,
    private cdr: ChangeDetectorRef,
    private elRef: ElementRef 
  ) {}

  ngOnInit(): void {
    this.currentGenerationMode = this.initialGenerationMode;
    this.currentSprint = this.initialSprint;
    this.resetToInitialForm();
  }

  resetToInitialForm(): void {
    this.componentState = 'initialForm';
    this.formError = null;
    this.imageUploadError = null;
    this.draggableImages = [];
    this.imagesBase64 = [];
    this.imageMimeTypes = [];
    
    const keptSprint = this.currentSprint || this.initialSprint; 
    const keptTechnique = this.currentSelectedTechnique;
    const keptMode = this.currentGenerationMode || this.initialGenerationMode;

    this.currentHuId = '';
    this.currentHuTitle = '';
    this.currentDescription = '';
    this.currentAcceptanceCriteria = '';
    
    this.generatedHUData = null;
    this.userRefinementContext = '';
    this.refinementTechnique = '';

    this.loadingScope = false;
    this.loadingScenarios = false;
    this.errorScope = null;
    this.errorScenarios = null;

    if (isPlatformBrowser(this.platformId) && this.imageFilesInputRef?.nativeElement) {
      this.imageFilesInputRef.nativeElement.value = '';
    }
    
    this.huFormDirective?.resetForm();
    this.currentGenerationMode = keptMode;
    this.currentSprint = keptSprint;
    this.currentSelectedTechnique = keptTechnique; 
    
     setTimeout(() => {
        if (this.huFormDirective?.form) {
            this.huFormDirective.form.patchValue({
                currentSprint: this.currentSprint,
                currentSelectedTechnique: this.currentSelectedTechnique,
                currentHuId: '', 
                currentHuTitle: '',
                currentDescription: '',
                currentAcceptanceCriteria: ''
            });
            this.huFormDirective.form.updateValueAndValidity();
        }
        this.cdr.detectChanges();
     },0);
  }

  public autoGrowTextarea(element: any): void {
    if (element && element instanceof HTMLTextAreaElement) {
      element.style.height = 'auto';
      element.scrollTop = element.scrollTop; 
      element.style.height = (element.scrollHeight) + 'px';
    }
  }

  private autoGrowTextareasInCardByIndex(tcIndex: number): void {
    if (!this.generatedHUData || !this.generatedHUData.detailedTestCases || 
        !this.generatedHUData.detailedTestCases[tcIndex] || 
        !this.generatedHUData.detailedTestCases[tcIndex].isExpanded) {
      return;
    }
  
    const cardId = `test-case-card-${this.generatedHUData.id || 'temp'}-${tcIndex}`;
    const cardElement = this.elRef.nativeElement.querySelector(`#${cardId}`);
  
    if (cardElement) {
      const textareas = cardElement.querySelectorAll(
        '.form-group textarea.form-control, .test-case-steps-table textarea.table-input'
      );
      textareas.forEach((ta: HTMLTextAreaElement) => {
        if (ta.offsetParent !== null) { 
          this.autoGrowTextarea(ta);
        }
      });
    }
  }

  isFormInvalidForGeneration(): boolean {
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

  generateIdFromTitle(title: string, mode: GenerationMode): string {
    if (!title || !mode) return '';

    if (mode === 'text') {
      const prefix = "HU_";
      const sanitizedTitle = title.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^\w-]+/g, '');
      return `${prefix}${sanitizedTitle.substring(0, 20)}_${Date.now().toString().slice(-4)}`;
    } else if (mode === 'image') {
      const sanitizedTitle = title.trim().replace(/\s+/g, '').replace(/[^\wÀ-ÿ]+/g, ''); 
      if (sanitizedTitle.length < 2) {

        return `#_XX_${Date.now().toString().slice(-4)}`; 
      }
      const prefixLetters = sanitizedTitle.substring(0, 2).toUpperCase();

      return `#_${prefixLetters}_${Date.now().toString().slice(-4)}`;
    }
    return ''; 
  }


  generateInitialHuAndCases(): void {
    this.formError = null; this.errorScope = null; this.errorScenarios = null;
    if (this.isFormInvalidForGeneration()) { 
        this.formError = "Por favor, completa todos los campos requeridos."; 
        if (this.currentGenerationMode === 'image' && !this.draggableImages.length) this.formError = "Por favor, selecciona al menos una imagen."; 
        this.huFormDirective?.form.markAllAsTouched(); return; 
    }
    let finalId = this.currentHuId; 
    if (this.currentGenerationMode === 'image') { 
        finalId = this.generateIdFromTitle(this.currentHuTitle,this.currentGenerationMode); 
        if(!finalId){this.formError="El título es necesario para generar el ID.";return;}
    }

    // Use UIHUData for the object creation
    const huData: UIHUData = {
      originalInput: { 
        id: finalId, title: this.currentHuTitle, sprint: this.currentSprint, 
        description: this.currentGenerationMode === 'text' ? this.currentDescription : undefined, 
        acceptanceCriteria: this.currentGenerationMode === 'text' ? this.currentAcceptanceCriteria : undefined, 
        selectedTechnique: this.currentSelectedTechnique, 
        generationMode: this.currentGenerationMode, 
        imagesBase64: this.currentGenerationMode === 'image' ? [...this.imagesBase64] : undefined, 
        imageMimeTypes: this.currentGenerationMode === 'image' ? [...this.imageMimeTypes] : undefined, 
      },
      id: finalId.trim(), title: this.currentHuTitle.trim(), sprint: this.currentSprint.trim(),
      generatedScope: '', 
      detailedTestCases: [], // Initialized as UIDetailedTestCase[]
      generatedTestCaseTitles: '',
      // Ensure all properties from OriginalHUData are covered here or by UIHUData extending it
      editingScope: false, 
      editingScenarios: false, 
      loadingScope: false, errorScope: null,
      loadingScenarios: false, errorScenarios: null, 
      showRegenTechniquePicker: false, 
      regenSelectedTechnique: this.currentSelectedTechnique, 
      userTestCaseReanalysisContext: '', 
      isScopeDetailsOpen: this.currentGenerationMode === 'text', 
      isScenariosDetailsOpen: true,
      isEditingDetailedTestCases: false 
    };
    this.generatedHUData = huData; 
    this.refinementTechnique = this.currentSelectedTechnique;

    this.cdr.detectChanges();

    const operations: Observable<any>[] = [];

    if (huData.originalInput.generationMode === 'text') {
      this.loadingScope = true;
      operations.push(
        this.geminiService.generateTestPlanSections(huData.originalInput.description!, huData.originalInput.acceptanceCriteria!)
          .pipe(
            tap(s => { if(this.generatedHUData) this.generatedHUData.generatedScope = s; }),
            catchError(e => { 
              if(this.generatedHUData) this.generatedHUData.errorScope = (typeof e === 'string' ? e : e.message) || 'Error al generar alcance.'; 
              this.errorScope = this.generatedHUData!.errorScope; return of(''); 
            }),
            finalize(() => { this.loadingScope = false; this.cdr.detectChanges(); })
          )
      );
    }
    
    this.loadingScenarios = true; 
    operations.push(
      this._generateOrRefineDetailedTestCases$(huData, this.currentSelectedTechnique, undefined, 'initial')
    );
    
    forkJoin(operations).pipe(
        finalize(() => {
            this.loadingScope = false; 
            this.loadingScenarios = false;
            this.componentState = 'previewingGenerated'; 
            this.cdr.detectChanges();
             setTimeout(() => { 
                const textareas = document.querySelectorAll('.test-case-steps-table textarea.table-input');
                textareas.forEach(ta => this.autoGrowTextarea(ta as HTMLTextAreaElement));
            }, 0);
        })
    ).subscribe({
        error: e => { 
            console.error("Error en la generación inicial combinada:", e);
            if (!this.errorScope && !this.errorScenarios) {
                this.errorScenarios = "Error general durante la generación inicial.";
            }
            this.componentState = 'initialForm'; 
        }
    });
  }
  
  private _generateOrRefineDetailedTestCases$(
    huData: UIHUData, // Parameter is UIHUData
    technique: string, 
    userContext?: string,
    mode: 'initial' | 'refinement' = 'initial' 
  ): Observable<UIDetailedTestCase[]> { // Returns Observable of UIDetailedTestCase[]
    if (!this.generatedHUData) return of([]); 
    
    this.loadingScenarios = true;
    this.errorScenarios = null;
    if (this.generatedHUData) this.generatedHUData.errorScenarios = null;

    let genObs$: Observable<OriginalDetailedTestCase[]>; // Service returns OriginalDetailedTestCase[]

    if (mode === 'refinement') {
      // Map UIDetailedTestCase[] to OriginalDetailedTestCase[] before sending to service if needed
      const originalTestCasesForRefinement = huData.detailedTestCases.map(uiTc => {
          const { isExpanded, ...originalTc } = uiTc;
          return originalTc as OriginalDetailedTestCase;
      });

      genObs$ = this.geminiService.refineDetailedTestCases(
        huData.originalInput, 
        originalTestCasesForRefinement, 
        technique, 
        userContext || '' 
      );
    } else { 
      if (huData.originalInput.generationMode === 'image' && huData.originalInput.imagesBase64?.length) {
        genObs$ = this.geminiService.generateDetailedTestCasesImageBased(huData.originalInput.imagesBase64, huData.originalInput.imageMimeTypes!, technique, userContext);
      } else if (huData.originalInput.generationMode === 'text' && huData.originalInput.description && huData.originalInput.acceptanceCriteria) {
        genObs$ = this.geminiService.generateDetailedTestCasesTextBased(huData.originalInput.description, huData.originalInput.acceptanceCriteria, technique, userContext);
      } else {
        const errorMsg = "Datos de entrada insuficientes para generar casos de prueba.";
        if(this.generatedHUData) { this.generatedHUData.errorScenarios = errorMsg; this.generatedHUData.detailedTestCases = [];}
        this.errorScenarios = errorMsg;
        this.loadingScenarios = false;
        this.cdr.detectChanges();
        return of([]);
      }
    }

    return genObs$.pipe(
      tap((tcs: OriginalDetailedTestCase[]) => { 
        if (this.generatedHUData) {
          const existingExpansionStates = new Map<string, boolean>();
          if (mode === 'refinement') {
            this.generatedHUData.detailedTestCases.forEach(existingTc => {
              existingExpansionStates.set(existingTc.title, existingTc.isExpanded || false);
            });
          }

          this.generatedHUData.detailedTestCases = tcs.map((tc, index) => {
            const detailedTc: UIDetailedTestCase = {
              ...tc,
              steps: Array.isArray(tc.steps) ? tc.steps.map((s: any, i: number) => ({ 
                numero_paso: s.numero_paso || (i + 1),
                accion: s.accion || "Paso no descrito"
              })) : [{ numero_paso: 1, accion: "Pasos en formato incorrecto"}],
              isExpanded: mode === 'refinement' ? (existingExpansionStates.get(tc.title) || false) : (index === 0)
            };
            return detailedTc;
          });

          this.generatedHUData.generatedTestCaseTitles = this.formatSimpleScenarioTitles(tcs.map(tc => tc.title));
          
          if (tcs?.length === 1 && (
              tcs[0].title === "Información Insuficiente" || 
              tcs[0].title === "Imágenes no interpretables o técnica no aplicable" ||
              tcs[0].title === "Refinamiento no posible con el contexto actual" ||
              tcs[0].title?.startsWith("Error"))
            ) {
              this.generatedHUData.errorScenarios = `${tcs[0].title}: ${tcs[0].preconditions || (tcs[0].steps && tcs[0].steps[0] ? tcs[0].steps[0].accion : 'Detalles no disponibles.')}`;
              this.errorScenarios = this.generatedHUData.errorScenarios;
          }
        }
      }),
      catchError(e => {
        const errorMsg = (typeof e === 'string' ? e : e.message) || `Error al ${mode === 'initial' ? 'generar' : 'refinar'} casos de prueba.`;
        if (this.generatedHUData) {
            this.generatedHUData.errorScenarios = errorMsg;
            if (mode === 'initial' || !this.generatedHUData.detailedTestCases?.length) {
                // Create a UIDetailedTestCase for error display
                const errorTc: UIDetailedTestCase = { 
                    title: `Error Crítico en ${mode === 'initial' ? 'Generación' : 'Refinamiento'}`, 
                    preconditions: errorMsg, 
                    steps: [], 
                    expectedResults: "N/A",
                    isExpanded: true 
                };
                this.generatedHUData.detailedTestCases = [errorTc];
                this.generatedHUData.generatedTestCaseTitles = "Error en el proceso.";
            }
        }
        this.errorScenarios = errorMsg;
        return of(this.generatedHUData?.detailedTestCases || []);
      }),
      finalize(() => { 
        this.loadingScenarios = false; 
        this.cdr.detectChanges(); 
         setTimeout(() => {
            if (this.componentState === 'editingForRefinement' && this.generatedHUData && this.generatedHUData.detailedTestCases) {
                this.generatedHUData.detailedTestCases.forEach((tc, index) => {
                    if (tc.isExpanded) {
                        this.autoGrowTextareasInCardByIndex(index);
                    }
                });
            }
        }, 0);
      })
    );
  }

  startRefinementMode(): void {
    if (this.generatedHUData && this.generatedHUData.detailedTestCases) {
      this.componentState = 'editingForRefinement';
      this.refinementTechnique = this.generatedHUData.originalInput.selectedTechnique; 
      this.userRefinementContext = this.generatedHUData.userTestCaseReanalysisContext || ''; 

      this.generatedHUData.detailedTestCases.forEach((tc, index) => {
        tc.isExpanded = index === 0; 
      });
      
      this.cdr.detectChanges();
      setTimeout(() => {
        if (this.generatedHUData && this.generatedHUData.detailedTestCases.length > 0 && this.generatedHUData.detailedTestCases[0].isExpanded) {
          this.autoGrowTextareasInCardByIndex(0);
        }
      }, 0);
    }
  }

  toggleTestCaseExpansion(tc: UIDetailedTestCase, tcIndex: number): void { // Parameter is UIDetailedTestCase
    if (!this.generatedHUData || !this.generatedHUData.detailedTestCases) return;
      
    tc.isExpanded = !tc.isExpanded;
    this.cdr.detectChanges();
  
    if (tc.isExpanded) {
      setTimeout(() => this.autoGrowTextareasInCardByIndex(tcIndex), 0);
    }
  }
  
  refineHuCasesWithAI(): void {
    if (!this.generatedHUData) {
      this.errorScenarios = "No hay datos generados para refinar.";
      return;
    }
    if (!this.refinementTechnique) {
      this.errorScenarios = "Por favor, selecciona una técnica para el refinamiento.";
      return;
    }

    this.generatedHUData.detailedTestCases.forEach(tc => {
        if (tc.steps) {
            tc.steps.forEach(step => {
                if (!step.accion || step.accion.trim() === '') {
                    step.accion = "Acción no definida por el usuario.";
                }
            });
        }
    });
    this.generatedHUData.userTestCaseReanalysisContext = this.userRefinementContext;

    this._generateOrRefineDetailedTestCases$(
      this.generatedHUData, 
      this.refinementTechnique, 
      this.userRefinementContext,
      'refinement'
    ).subscribe(() => {
        this.componentState = 'editingForRefinement'; 
        this.cdr.detectChanges();
        setTimeout(() => {
          if (this.generatedHUData && this.generatedHUData.detailedTestCases) {
            this.generatedHUData.detailedTestCases.forEach((tc, index) => {
              if (tc.isExpanded) {
                this.autoGrowTextareasInCardByIndex(index);
              }
            });
          }
        }, 0);
    });
  }

  cancelRefinementEditing(): void {
    this.componentState = 'previewingGenerated';
    this.errorScenarios = null; 
    this.cdr.detectChanges();
  }

  formatSimpleScenarioTitles(titles: string[]): string { 
    if (!titles?.length) return 'No se generaron escenarios.'; 
    return titles.map((t, i) => `${i+1}. ${t}`).join('\n'); 
  }
  
  handleCancelGeneration() { 
    this.resetToInitialForm(); 
    this.generationCancelled.emit(); 
  }

  addTestCaseStep(testCase: UIDetailedTestCase): void { // Parameter is UIDetailedTestCase
    if (!testCase.steps) testCase.steps = [];
    testCase.steps.push({ numero_paso: testCase.steps.length + 1, accion: '' });
    this.cdr.detectChanges();
    setTimeout(() => {
      const tcIndex = this.generatedHUData?.detailedTestCases.indexOf(testCase);
      if (tcIndex !== undefined && tcIndex !== -1) {
        const cardId = `test-case-card-${this.generatedHUData!.id || 'temp'}-${tcIndex}`;
        const cardElement = this.elRef.nativeElement.querySelector(`#${cardId}`);
        if (cardElement) {
          const textareas = cardElement.querySelectorAll('.test-case-steps-table textarea.table-input');
          if (textareas.length > 0) {
            this.autoGrowTextarea(textareas[textareas.length - 1] as HTMLTextAreaElement);
          }
        }
      }
    },0);
  }

  deleteTestCaseStep(testCase: UIDetailedTestCase, stepIndex: number): void { // Parameter is UIDetailedTestCase
    if (testCase.steps) {
      testCase.steps.splice(stepIndex, 1);
      testCase.steps.forEach((step: TestCaseStep, idx: number) => step.numero_paso = idx + 1);
      this.cdr.detectChanges();
    }
  }

  getTestCaseStepDragId(testCase: UIDetailedTestCase, step: TestCaseStep): string { // Parameter is UIDetailedTestCase
    const stepIndex = testCase.steps.indexOf(step);
    return `tc-${this.generatedHUData?.id || 'temp'}-step-${stepIndex}`;
  }

  onTestCaseStepDragStart(event: DragEvent, step: TestCaseStep, testCase: UIDetailedTestCase): void { // Parameter is UIDetailedTestCase
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

  onTestCaseStepDragOver(event: DragEvent, targetStep: TestCaseStep | undefined, testCase: UIDetailedTestCase): void { // Parameter is UIDetailedTestCase
    event.preventDefault();
    if(this.draggedTestCaseStep && event.dataTransfer && targetStep) { 
        event.dataTransfer.dropEffect = 'move';
        this.dragOverTestCaseStepId = this.getTestCaseStepDragId(testCase, targetStep);
    } else if (!targetStep && event.dataTransfer) { 
        event.dataTransfer.dropEffect = 'move';
        this.dragOverTestCaseStepId = `tc-${this.generatedHUData?.id || 'temp'}-dropzone-end-tc-${testCase.title.replace(/\s/g, '')}`;
    }
  }

  onTestCaseStepDragLeave(event: DragEvent): void {
    this.dragOverTestCaseStepId = null;
  }

  onTestCaseStepDrop(event: DragEvent, targetStep: TestCaseStep | undefined, testCase: UIDetailedTestCase): void { // Parameter is UIDetailedTestCase
    event.preventDefault(); this.dragOverTestCaseStepId = null;
    document.querySelectorAll('.test-case-steps-table tbody tr[style*="opacity: 0.4"]')
        .forEach(el => (el as HTMLElement).style.opacity = '1');

    if (!this.draggedTestCaseStep || !testCase.steps) {
        this.draggedTestCaseStep = null; return;
    }
    
    const fromIndex = testCase.steps.indexOf(this.draggedTestCaseStep);
    let toIndex = -1;

    if (targetStep) {
        if (this.draggedTestCaseStep === targetStep) { this.draggedTestCaseStep = null; return; }
        toIndex = testCase.steps.indexOf(targetStep);
    } else { 
        toIndex = testCase.steps.length; 
    }

    if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
        const itemToMove = testCase.steps.splice(fromIndex, 1)[0];
        if (targetStep || toIndex < testCase.steps.length) { 
            testCase.steps.splice(toIndex, 0, itemToMove);
        } else { 
            testCase.steps.push(itemToMove);
        }
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

  confirmAndEmitHUDataToPlan() {
    if (this.generatedHUData) {
        this.componentState = 'submitting'; 
        
        // Create a new object conforming to OriginalHUData to emit
        const dataToEmit: OriginalHUData = {
            ...this.generatedHUData, // Spread all properties from UIHUData
            detailedTestCases: this.generatedHUData.detailedTestCases.map(uiTc => {
                uiTc.title = (uiTc.title || "").trim() || "Caso de prueba sin título";
                uiTc.preconditions = (uiTc.preconditions || "").trim() || "N/A";
                uiTc.expectedResults = (uiTc.expectedResults || "").trim() || "N/A";
                if (uiTc.steps) {
                    uiTc.steps.forEach(step => {
                        step.accion = (step.accion || "").trim() || "Acción no definida.";
                    });
                } else {
                   uiTc.steps = [{numero_paso: 1, accion: "Pasos no definidos."}];
                }
                if (uiTc.steps.length === 0) {
                   uiTc.steps.push({numero_paso: 1, accion: "Pasos no definidos."});
                }

                const { isExpanded, ...originalTc } = uiTc; // Destructure to remove isExpanded
                return originalTc as OriginalDetailedTestCase; // Cast to the original model type
            })
        };
        
        dataToEmit.generatedTestCaseTitles = this.formatSimpleScenarioTitles(
            dataToEmit.detailedTestCases.map(tc => tc.title)
        );

        if (this.refinementTechnique && dataToEmit.originalInput.selectedTechnique !== this.refinementTechnique) {
            dataToEmit.originalInput.selectedTechnique = this.refinementTechnique;
        }

        this.huGenerated.emit(dataToEmit);
        this.resetToInitialForm(); 
    }
  }

  exportExecutionMatrixLocal(): void {
    if (!this.generatedHUData || !this.generatedHUData.detailedTestCases || this.generatedHUData.detailedTestCases.length === 0 || this.generatedHUData.detailedTestCases.some(tc => tc.title.startsWith("Error") || tc.title === "Información Insuficiente" || tc.title === "Imágenes no interpretables o técnica no aplicable" || tc.title === "Refinamiento no posible con el contexto actual")) {
        alert('No hay casos de prueba válidos para exportar o los casos generados indican un error.');
        return;
    }
    const hu = this.generatedHUData;
    const csvHeader = ["ID Caso", "Escenario de Prueba", "Precondiciones", "Paso a Paso", "Resultado Esperado"];
    const csvRows = hu.detailedTestCases.map((tc, index) => {
      const stepsString = Array.isArray(tc.steps) ? tc.steps.map(step => `${step.numero_paso}. ${step.accion}`).join('\n') : 'Pasos no disponibles.';
      return [
        `"${(hu.id + '_CP' + (index + 1)).replace(/"/g, '""')}"`,
        `"${(tc.title || "").replace(/"/g, '""')}"`,
        `"${(tc.preconditions || "").replace(/"/g, '""')}"`,
        `"${stepsString.replace(/"/g, '""')}"`,
        `"${(tc.expectedResults || "").replace(/"/g, '""')}"`
      ];
    });
    const csvFullContent = [csvHeader.join(','), ...csvRows.map(row => row.join(','))].join('\r\n');
    saveAs(new Blob(["\uFEFF" + csvFullContent], { type: 'text/csv;charset=utf-8;' }), `MatrizEjecucion_${hu.id}_${new Date().toISOString().split('T')[0]}.csv`);
  }

  downloadTemplate(os: 'mac' | 'windows'): void {
    let fileId = '';
    if (os === 'mac') {
      fileId = this.macTemplateId;
    } else if (os === 'windows') {
      fileId = this.windowsTemplateId;
    }
    if (!fileId) return;
    const url = `https://drive.google.com/uc?export=download&id=${fileId}`;
    // Forzar descarga automática
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}