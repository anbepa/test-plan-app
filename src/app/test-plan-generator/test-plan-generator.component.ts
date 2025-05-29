// src/app/test-plan-generator/test-plan-generator.component.ts
import { Component, ViewChild, AfterViewInit, OnDestroy, ElementRef, Inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { GeminiService, DetailedTestCase } from '../services/gemini.service';
import { catchError, finalize, tap, switchMap } from 'rxjs/operators';
import { Observable, of, Subscription, forkJoin, throwError } from 'rxjs';
import { saveAs } from 'file-saver';
import { HUData, GenerationMode, FlowAnalysisReportItem, FlowAnalysisStep, BugReportItem } from '../models/hu-data.model';

type StaticSectionBaseName = 'repositoryLink' | 'outOfScope' | 'strategy' | 'limitations' | 'assumptions' | 'team';

interface DraggableImage {
  file: File;
  preview: string | ArrayBuffer;
  base64: string;
  mimeType: string;
  id: string;
}

@Component({
  selector: 'app-test-plan-generator',
  templateUrl: './test-plan-generator.component.html',
  styleUrls: ['./test-plan-generator.component.css'],
  standalone: true,
  imports: [ FormsModule, CommonModule ]
})
export class TestPlanGeneratorComponent implements AfterViewInit, OnDestroy {

  currentGenerationMode: GenerationMode | null = null;

  // For 'image' and 'flowAnalysis' modes
  selectedFiles: File[] = [];
  currentImagePreviews: (string | ArrayBuffer)[] = [];
  imagesBase64: string[] = [];
  imageMimeTypes: string[] = [];
  draggableImages: DraggableImage[] = []; // Used by 'image' and 'flowAnalysis'

  // NEW: For 'flowComparison' mode - Flow A
  draggableImagesFlowA: DraggableImage[] = [];
  imagesBase64FlowA: string[] = [];
  imageMimeTypesFlowA: string[] = [];
  imageUploadErrorFlowA: string | null = null;

  // NEW: For 'flowComparison' mode - Flow B
  draggableImagesFlowB: DraggableImage[] = [];
  imagesBase64FlowB: string[] = [];
  imageMimeTypesFlowB: string[] = [];
  imageUploadErrorFlowB: string | null = null;

  imageUploadError: string | null = null; // General error for 'image' and 'flowAnalysis'
  formError: string | null = null;

  currentHuId: string = '';
  currentHuTitle: string = ''; // Used for all modes (HU title, Image Set title, Flow Analysis title, Comparison title)
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
  loadingFlowAnalysisGlobal: boolean = false;
  flowAnalysisErrorGlobal: string | null = null;
  // NEW: Loading for bug comparison
  loadingBugComparisonGlobal: boolean = false;
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

  // For 'image' and 'flowAnalysis' drag/drop
  draggedImage: DraggableImage | null = null;
  dragOverImageId: string | null = null;
  // NEW: For 'flowComparison' drag/drop
  draggedImageFlowA: DraggableImage | null = null;
  dragOverImageIdFlowA: string | null = null;
  draggedImageFlowB: DraggableImage | null = null;
  dragOverImageIdFlowB: string | null = null;


  draggedFlowStep: FlowAnalysisStep | null = null;
  dragOverFlowStepId: string | null = null; // For styling drop target

  @ViewChild('huForm') huFormDirective!: NgForm;
  private formStatusSubscription!: Subscription;
  @ViewChild('scenariosTextarea') scenariosTextarea: ElementRef | undefined;
  @ViewChild('imageFilesInput') imageFilesInputRef: ElementRef<HTMLInputElement> | undefined;
  // NEW: Refs for flow comparison image inputs
  @ViewChild('imageFilesInputFlowA') imageFilesInputFlowARef: ElementRef<HTMLInputElement> | undefined;
  @ViewChild('imageFilesInputFlowB') imageFilesInputFlowBRef: ElementRef<HTMLInputElement> | undefined;


  constructor(
    private geminiService: GeminiService,
    @Inject(PLATFORM_ID) private platformId: Object,
    private cdr: ChangeDetectorRef
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
    const keptTechnique = (this.currentGenerationMode === 'text' || this.currentGenerationMode === 'image') ? this.currentSelectedTechnique : '';

    this.currentGenerationMode = null;
    this.formError = null;
    this.imageUploadError = null;
    this.selectedFiles = [];
    this.currentImagePreviews = [];
    this.imagesBase64 = [];
    this.imageMimeTypes = [];
    this.draggableImages = [];

    this.draggableImagesFlowA = [];
    this.imagesBase64FlowA = [];
    this.imageMimeTypesFlowA = [];
    this.imageUploadErrorFlowA = null;
    this.draggableImagesFlowB = [];
    this.imagesBase64FlowB = [];
    this.imageMimeTypesFlowB = [];
    this.imageUploadErrorFlowB = null;

    this.currentDescription = '';
    this.currentAcceptanceCriteria = '';
    this.currentHuId = '';
    this.currentHuTitle = '';


    if (isPlatformBrowser(this.platformId)) {
      if (this.imageFilesInputRef && this.imageFilesInputRef.nativeElement) {
        this.imageFilesInputRef.nativeElement.value = '';
      }
      if (this.imageFilesInputFlowARef && this.imageFilesInputFlowARef.nativeElement) {
        this.imageFilesInputFlowARef.nativeElement.value = '';
      }
      if (this.imageFilesInputFlowBRef && this.imageFilesInputFlowBRef.nativeElement) {
        this.imageFilesInputFlowBRef.nativeElement.value = '';
      }
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
    this.selectedFiles = [];
    this.currentImagePreviews = [];
    this.imagesBase64 = [];
    this.imageMimeTypes = [];
    this.draggableImages = [];

    this.draggableImagesFlowA = [];
    this.imagesBase64FlowA = [];
    this.imageMimeTypesFlowA = [];
    this.imageUploadErrorFlowA = null;
    this.draggableImagesFlowB = [];
    this.imagesBase64FlowB = [];
    this.imageMimeTypesFlowB = [];
    this.imageUploadErrorFlowB = null;

    this.currentHuId = '';
    this.currentHuTitle = '';
    this.currentDescription = '';
    this.currentAcceptanceCriteria = '';

    if (isPlatformBrowser(this.platformId)) {
      if (this.imageFilesInputRef && this.imageFilesInputRef.nativeElement) {
        this.imageFilesInputRef.nativeElement.value = '';
      }
      if (this.imageFilesInputFlowARef && this.imageFilesInputFlowARef.nativeElement) {
        this.imageFilesInputFlowARef.nativeElement.value = '';
      }
      if (this.imageFilesInputFlowBRef && this.imageFilesInputFlowBRef.nativeElement) {
        this.imageFilesInputFlowBRef.nativeElement.value = '';
      }
    }

    if (this.currentGenerationMode === 'flowAnalysis' || this.currentGenerationMode === 'flowComparison') {
      this.currentSelectedTechnique = '';
    }

    if (this.huFormDirective && this.huFormDirective.form) {
        setTimeout(() => {
            if (this.huFormDirective?.form) {
              this.huFormDirective.form.markAsPristine();
              this.huFormDirective.form.markAsUntouched();

              if (this.currentGenerationMode === 'flowAnalysis' || this.currentGenerationMode === 'flowComparison') {
                this.huFormDirective.form.controls['currentSelectedTechnique']?.setValue('', {emitEvent: false});
                this.huFormDirective.form.controls['currentSelectedTechnique']?.disable({emitEvent: false});
              } else {
                this.huFormDirective.form.controls['currentSelectedTechnique']?.enable({emitEvent: false});
              }
              this.huFormDirective.form.updateValueAndValidity();
            }
        },0);
    }
  }

  isFormInvalidForCurrentMode(): boolean {
    if (!this.huFormDirective || !this.huFormDirective.form || !this.currentGenerationMode) {
      return true;
    }
    const commonRequiredFields = !this.currentSprint || !this.currentHuTitle;

    switch (this.currentGenerationMode) {
      case 'text':
        return !this.currentSprint || !this.currentHuId || !this.currentHuTitle || !this.currentDescription || !this.currentAcceptanceCriteria || !this.currentSelectedTechnique;
      case 'image':
        return commonRequiredFields || !this.currentSelectedTechnique || this.draggableImages.length === 0;
      case 'flowAnalysis':
        return commonRequiredFields || this.draggableImages.length === 0;
      case 'flowComparison':
        return commonRequiredFields || this.draggableImagesFlowA.length === 0 || this.draggableImagesFlowB.length === 0;
      default:
        return true;
    }
  }

  private parseFileNameForSorting(fileName: string): { main: number, sub: number } {
      const nameWithoutExtension = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
      const parts = nameWithoutExtension.split(/[^0-9]+/g).filter(Boolean).map(p => parseInt(p, 10));

      return {
          main: parts.length > 0 && !isNaN(parts[0]) ? parts[0] : Infinity,
          sub: parts.length > 1 && !isNaN(parts[1]) ? parts[1] : (parts.length > 0 && !isNaN(parts[0]) ? 0 : Infinity)
      };
  }

  onFileSelected(event: Event, flowType?: 'A' | 'B'): void {
    let currentDraggableImagesRef: DraggableImage[]; // This will be a reference
    let currentUploadErrorProp: 'imageUploadErrorFlowA' | 'imageUploadErrorFlowB' | 'imageUploadError';
    let maxImages: number;

    if (flowType === 'A') {
        currentDraggableImagesRef = this.draggableImagesFlowA;
        this.imageUploadErrorFlowA = null; // Reset specific error
        currentUploadErrorProp = 'imageUploadErrorFlowA';
        maxImages = 10;
    } else if (flowType === 'B') {
        currentDraggableImagesRef = this.draggableImagesFlowB;
        this.imageUploadErrorFlowB = null; // Reset specific error
        currentUploadErrorProp = 'imageUploadErrorFlowB';
        maxImages = 10;
    } else {
        currentDraggableImagesRef = this.draggableImages;
        this.imageUploadError = null; // Reset general error
        currentUploadErrorProp = 'imageUploadError';
        maxImages = this.currentGenerationMode === 'flowAnalysis' ? 20 : 5; // Max 20 for flow analysis
    }
    this.formError = null;

    // Clear the specific array being populated
    currentDraggableImagesRef.length = 0;


    const element = event.currentTarget as HTMLInputElement;
    const fileList: FileList | null = element.files;

    if (fileList && fileList.length > 0) {
        if (fileList.length > maxImages) {
            this[currentUploadErrorProp] = `Puedes seleccionar un máximo de ${maxImages} imágenes para este flujo.`;
            element.value = ""; return;
        }

        let filesArray = Array.from(fileList);

        filesArray.sort((a, b) => {
            const parsedA = this.parseFileNameForSorting(a.name);
            const parsedB = this.parseFileNameForSorting(b.name);

            if (parsedA.main !== parsedB.main) {
                return parsedA.main - parsedB.main;
            }
            return parsedA.sub - parsedB.sub;
        });

        const fileProcessingObservables: Observable<DraggableImage>[] = [];
        let validationErrorFound = false;

        for (const file of filesArray) {
            if (validationErrorFound) continue;

            if (file.size > 4 * 1024 * 1024) {
                this[currentUploadErrorProp] = `El archivo "${file.name}" es demasiado grande (Máx. 4MB). Se omitirán todos los archivos.`;
                validationErrorFound = true;
            }
            if (!['image/jpeg', 'image/png'].includes(file.type) && !validationErrorFound) {
                this[currentUploadErrorProp] = `Formato inválido para "${file.name}" (Solo JPG, PNG). Se omitirán todos los archivos.`;
                validationErrorFound = true;
            }

            if (validationErrorFound) {
                element.value = "";
                currentDraggableImagesRef.length = 0; // Clear again on error
                this.updateArraysFromDraggable(flowType);
                return;
            }

            const readerObservable = new Observable<DraggableImage>(observer => {
                const reader = new FileReader();
                reader.onload = e => {
                    const preview = reader.result as string | ArrayBuffer;
                    const base64 = typeof reader.result === 'string' ? reader.result.split(',')[1] : '';

                    observer.next({
                        file: file,
                        preview: preview,
                        base64: base64,
                        mimeType: file.type,
                        id: (flowType || 'G') + '_' + file.name + '_' + new Date().getTime() + Math.random()
                    });
                    observer.complete();
                };
                reader.onerror = error => {
                    this[currentUploadErrorProp] = `Error al leer el archivo "${file.name}".`;
                    console.error(`FileReader error for ${file.name}: `, error);
                    observer.error(error);
                };
                reader.readAsDataURL(file);
            });
            fileProcessingObservables.push(readerObservable);
        }

        if (validationErrorFound) {
             currentDraggableImagesRef.length = 0; // Clear again on error
             this.updateArraysFromDraggable(flowType);
             return;
        }

        if (fileProcessingObservables.length > 0) {
            forkJoin(fileProcessingObservables).subscribe({
                next: (processedImages: DraggableImage[]) => {
                    // Assign to the correct array by reference
                    processedImages.forEach(img => currentDraggableImagesRef.push(img));
                    this.updateArraysFromDraggable(flowType);
                },
                complete: () => {
                    if (this.huFormDirective && this.huFormDirective.form) {
                        this.huFormDirective.form.updateValueAndValidity();
                    }
                },
                error: (err) => {
                    element.value = "";
                    currentDraggableImagesRef.length = 0;
                    this.updateArraysFromDraggable(flowType);
                    if (this.huFormDirective && this.huFormDirective.form) {
                        this.huFormDirective.form.updateValueAndValidity();
                    }
                     console.error("Error processing files with forkJoin:", err.message || err);
                }
            });
        }
    } else {
        currentDraggableImagesRef.length = 0;
        this.updateArraysFromDraggable(flowType);
        if (this.huFormDirective && this.huFormDirective.form) {
            this.huFormDirective.form.updateValueAndValidity();
        }
    }
  }

  private updateArraysFromDraggable(flowType?: 'A' | 'B'): void {
    if (flowType === 'A') {
        this.imagesBase64FlowA = this.draggableImagesFlowA.map(di => di.base64);
        this.imageMimeTypesFlowA = this.draggableImagesFlowA.map(di => di.mimeType);
    } else if (flowType === 'B') {
        this.imagesBase64FlowB = this.draggableImagesFlowB.map(di => di.base64);
        this.imageMimeTypesFlowB = this.draggableImagesFlowB.map(di => di.mimeType);
    } else {
        this.selectedFiles = this.draggableImages.map(di => di.file);
        this.currentImagePreviews = this.draggableImages.map(di => di.preview);
        this.imagesBase64 = this.draggableImages.map(di => di.base64);
        this.imageMimeTypes = this.draggableImages.map(di => di.mimeType);
    }
  }

  public onImageDragStart(event: DragEvent, image: DraggableImage, flowType?: 'A' | 'B'): void {
    if (flowType === 'A') this.draggedImageFlowA = image;
    else if (flowType === 'B') this.draggedImageFlowB = image;
    else this.draggedImage = image;

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', image.id);
      (event.target as HTMLElement).style.opacity = '0.4';
    }
  }

  public onImageDragOver(event: DragEvent, targetImage?: DraggableImage, flowType?: 'A' | 'B'): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    if (flowType === 'A') this.dragOverImageIdFlowA = targetImage ? targetImage.id : null;
    else if (flowType === 'B') this.dragOverImageIdFlowB = targetImage ? targetImage.id : null;
    else this.dragOverImageId = targetImage ? targetImage.id : null;
  }

  public onImageDragLeave(event: DragEvent, flowType?: 'A' | 'B'): void {
    if (flowType === 'A') this.dragOverImageIdFlowA = null;
    else if (flowType === 'B') this.dragOverImageIdFlowB = null;
    else this.dragOverImageId = null;
  }

  public onImageDrop(event: DragEvent, targetImage: DraggableImage, flowType?: 'A' | 'B'): void {
    event.preventDefault();
    if (flowType === 'A') this.dragOverImageIdFlowA = null;
    else if (flowType === 'B') this.dragOverImageIdFlowB = null;
    else this.dragOverImageId = null;

    const draggedHtmlElement = document.querySelector('.image-preview-item[style*="opacity: 0.4"]');
    if (draggedHtmlElement) {
        (draggedHtmlElement as HTMLElement).style.opacity = '1';
    }

    let currentDraggedImage = flowType === 'A' ? this.draggedImageFlowA : (flowType === 'B' ? this.draggedImageFlowB : this.draggedImage);
    let currentDraggableImages = flowType === 'A' ? this.draggableImagesFlowA : (flowType === 'B' ? this.draggableImagesFlowB : this.draggableImages);

    if (!currentDraggedImage || currentDraggedImage.id === targetImage.id) {
      if (flowType === 'A') this.draggedImageFlowA = null;
      else if (flowType === 'B') this.draggedImageFlowB = null;
      else this.draggedImage = null;
      return;
    }

    const fromIndex = currentDraggableImages.findIndex(img => img.id === currentDraggedImage!.id);
    let toIndex = currentDraggableImages.findIndex(img => img.id === targetImage.id);

    if (fromIndex !== -1 && toIndex !== -1) {
      const itemToMove = currentDraggableImages.splice(fromIndex, 1)[0];
      currentDraggableImages.splice(toIndex, 0, itemToMove);

      this.updateArraysFromDraggable(flowType);
    }
    if (flowType === 'A') this.draggedImageFlowA = null;
    else if (flowType === 'B') this.draggedImageFlowB = null;
    else this.draggedImage = null;
  }

  public onImageDragEnd(event?: DragEvent, flowType?: 'A' | 'B'): void {
     if (event && event.target instanceof HTMLElement) {
        (event.target as HTMLElement).style.opacity = '1';
    } else {
        const draggedHtmlElement = document.querySelector('.image-preview-item[style*="opacity: 0.4"]');
        if (draggedHtmlElement) {
            (draggedHtmlElement as HTMLElement).style.opacity = '1';
        }
    }
    if (flowType === 'A') { this.draggedImageFlowA = null; this.dragOverImageIdFlowA = null; }
    else if (flowType === 'B') { this.draggedImageFlowB = null; this.dragOverImageIdFlowB = null; }
    else { this.draggedImage = null; this.dragOverImageId = null; }
  }

  public getFlowStepDragId(paso: FlowAnalysisStep): string {
    // Ensure a unique ID even if steps are identical initially or become identical after edits
    // This ID is primarily for dragover styling.
    return `${paso.numero_paso}-${(paso.descripcion_accion_observada || '').substring(0, 10).replace(/\s/g, '_')}-${Math.random().toString(16).slice(2, 8)}`;
  }


  public onFlowStepDragStart(event: DragEvent, paso: FlowAnalysisStep, hu: HUData): void {
    if (hu.isEditingFlowReportDetails) {
      event.preventDefault(); // Prevent dragging when editing to avoid conflicts
      return;
    }
    this.draggedFlowStep = paso;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      // Use the current visual index (paso.numero_paso which is 1-based)
      event.dataTransfer.setData('text/plain', (paso.numero_paso - 1).toString()); // Store 0-based index
      const targetElement = event.target as HTMLElement;
      const rowElement = targetElement.closest('tr');
      if (rowElement) {
        rowElement.style.opacity = '0.4';
      }
    }
  }

  public onFlowStepDragOver(event: DragEvent, targetPaso?: FlowAnalysisStep): void {
    event.preventDefault();
     if (this.draggedFlowStep && event.dataTransfer) { // Check if a drag operation is in progress
      event.dataTransfer.dropEffect = 'move';
    }
    this.dragOverFlowStepId = targetPaso ? this.getFlowStepDragId(targetPaso) : null;
  }

  public onFlowStepDragLeave(event: DragEvent): void {
    this.dragOverFlowStepId = null;
  }

  public onFlowStepDrop(event: DragEvent, targetPaso: FlowAnalysisStep, hu: HUData): void {
    event.preventDefault();
    this.dragOverFlowStepId = null;

    document.querySelectorAll('.flow-analysis-steps-table tbody tr[style*="opacity: 0.4"]')
      .forEach(el => (el as HTMLElement).style.opacity = '1');

    if (!this.draggedFlowStep || !hu.flowAnalysisReport || hu.flowAnalysisReport.length === 0 || hu.flowAnalysisReport[0].Pasos_Analizados.length === 0) {
      this.draggedFlowStep = null;
      return;
    }

    // If dragged and target are the same, do nothing
    if(this.draggedFlowStep === targetPaso) {
        this.draggedFlowStep = null;
        return;
    }

    const pasosAnalizados = hu.flowAnalysisReport[0].Pasos_Analizados;
    const fromIndex = pasosAnalizados.indexOf(this.draggedFlowStep);
    let toIndex = pasosAnalizados.indexOf(targetPaso);

    if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
      const itemToMove = pasosAnalizados.splice(fromIndex, 1)[0];
      pasosAnalizados.splice(toIndex, 0, itemToMove);

      // Re-index numero_paso based on the new visual order
      pasosAnalizados.forEach((paso, index) => {
        paso.numero_paso = index + 1;
      });

      hu.flowAnalysisReport = [{ ...hu.flowAnalysisReport[0], Pasos_Analizados: [...pasosAnalizados] }];
      this.cdr.detectChanges();
      this.updatePreview();
    }
    this.draggedFlowStep = null;
  }

  public onFlowStepDragEnd(event: DragEvent): void {
    document.querySelectorAll('.flow-analysis-steps-table tbody tr[style*="opacity: 0.4"]')
      .forEach(el => (el as HTMLElement).style.opacity = '1');
    this.draggedFlowStep = null;
    this.dragOverFlowStepId = null;
  }

  public generateIdFromTitle(title: string, mode: GenerationMode | null): string {
    if (!title || !mode) {
        return '';
    }
    let prefix = "HU_";
    if (mode === 'image') prefix = "IMG_";
    else if (mode === 'flowAnalysis') prefix = "FLOW_";
    else if (mode === 'flowComparison') prefix = "COMP_";

    const sanitizedTitle = title.trim().toLowerCase()
                              .replace(/\s+/g, '_')
                              .replace(/[^\w-]+/g, '');
    return `${prefix}${sanitizedTitle.substring(0, 20)}_${new Date().getTime().toString().slice(-4)}`;
  }

  addHuAndGenerateData(): void {
    this.formError = null;
    this.sectionsError = null;
    this.scenariosError = null;
    this.flowAnalysisErrorGlobal = null;
    this.bugComparisonErrorGlobal = null;

    if (!this.currentGenerationMode) {
        this.formError = "Por favor, selecciona un método de generación primero.";
        return;
    }
    if (this.isFormInvalidForCurrentMode()) {
      this.formError = "Por favor, completa todos los campos requeridos.";
      if ((this.currentGenerationMode === 'image' || this.currentGenerationMode === 'flowAnalysis') && this.draggableImages.length === 0) {
        this.formError = "Por favor, selecciona al menos una imagen.";
      }
      if (this.currentGenerationMode === 'flowComparison' && (this.draggableImagesFlowA.length === 0 || this.draggableImagesFlowB.length === 0 )) {
        this.formError = "Por favor, selecciona imágenes para ambos flujos (A y B).";
      }
       if (this.huFormDirective && this.huFormDirective.form) {
        Object.values(this.huFormDirective.form.controls).forEach(control => {
          if (control.invalid && control.enabled) control.markAsTouched();
        });
      }
      return;
    }

    let finalHuId = this.currentHuId;
    if (this.currentGenerationMode === 'image' || this.currentGenerationMode === 'flowAnalysis' || this.currentGenerationMode === 'flowComparison') {
        finalHuId = this.generateIdFromTitle(this.currentHuTitle, this.currentGenerationMode);
        if (!finalHuId) {
            this.formError = "El título es necesario para generar el ID.";
            return;
        }
    }

    const newHu: HUData = {
      originalInput: {
        id: finalHuId,
        title: this.currentHuTitle,
        sprint: this.currentSprint,
        description: this.currentGenerationMode === 'text' ? this.currentDescription : undefined,
        acceptanceCriteria: this.currentGenerationMode === 'text' ? this.currentAcceptanceCriteria : undefined,
        selectedTechnique: (this.currentGenerationMode === 'text' || this.currentGenerationMode === 'image') ? this.currentSelectedTechnique : '',
        generationMode: this.currentGenerationMode,
        imagesBase64: (this.currentGenerationMode === 'image' || this.currentGenerationMode === 'flowAnalysis') ? [...this.imagesBase64] : undefined,
        imageMimeTypes: (this.currentGenerationMode === 'image' || this.currentGenerationMode === 'flowAnalysis') ? [...this.imageMimeTypes] : undefined,
        imagesBase64FlowA: this.currentGenerationMode === 'flowComparison' ? [...this.imagesBase64FlowA] : undefined,
        imageMimeTypesFlowA: this.currentGenerationMode === 'flowComparison' ? [...this.imageMimeTypesFlowA] : undefined,
        imagesBase64FlowB: this.currentGenerationMode === 'flowComparison' ? [...this.imagesBase64FlowB] : undefined,
        imageMimeTypesFlowB: this.currentGenerationMode === 'flowComparison' ? [...this.imageMimeTypesFlowB] : undefined,
      },
      id: finalHuId.trim(),
      title: this.currentHuTitle.trim(),
      sprint: this.currentSprint.trim(),
      generatedScope: '', detailedTestCases: [], generatedTestCaseTitles: '',
      editingScope: false, editingScenarios: false,
      loadingScope: this.currentGenerationMode === 'text', errorScope: null,
      loadingScenarios: (this.currentGenerationMode === 'text' || this.currentGenerationMode === 'image'), errorScenarios: null,
      showRegenTechniquePicker: false, regenSelectedTechnique: '',
      isScopeDetailsOpen: this.currentGenerationMode === 'text',
      isScenariosDetailsOpen: (this.currentGenerationMode === 'text' || this.currentGenerationMode === 'image'),
      flowAnalysisReport: undefined,
      loadingFlowAnalysis: this.currentGenerationMode === 'flowAnalysis',
      errorFlowAnalysis: null,
      isFlowAnalysisDetailsOpen: this.currentGenerationMode === 'flowAnalysis',
      isEditingFlowReportDetails: false,
      userReanalysisContext: '', // NEW: Initialize context field
      bugComparisonReport: undefined,
      loadingBugComparison: this.currentGenerationMode === 'flowComparison',
      errorBugComparison: null,
      isBugComparisonDetailsOpen: this.currentGenerationMode === 'flowComparison',
    };
    this.huList.push(newHu);

    if (newHu.originalInput.generationMode === 'text') {
      this.loadingSections = true;
      let scopeGeneration$: Observable<string> = this.geminiService.generateTestPlanSections(
          newHu.originalInput.description!, newHu.originalInput.acceptanceCriteria!
        ).pipe(
          tap(scopeText => { newHu.generatedScope = scopeText; }),
          catchError(error => {
            newHu.errorScope = (typeof error === 'string' ? error : error.message) || 'Error al generar alcance.';
            this.sectionsError = newHu.errorScope;
            return of('');
          }),
          finalize(() => { newHu.loadingScope = false; this.checkOverallLoadingStatus(); })
        );

      scopeGeneration$.pipe(
        switchMap(() => this._generateDetailedTestCasesForHu(newHu, newHu.originalInput.selectedTechnique, true)),
        finalize(() => { this.updateTestPlanTitle(); this.updatePreview(); this.resetCurrentInputs(); })
      ).subscribe({
          error: (err) => {
              console.error("Error en el flujo de generación (texto):", err);
              this.scenariosError = "Error general en el proceso de generación de HU basada en texto.";
              newHu.loadingScenarios = false; newHu.loadingScope = false; this.checkOverallLoadingStatus();
          }
      });

    } else if (newHu.originalInput.generationMode === 'image') {
        newHu.loadingScope = false;
        this._generateDetailedTestCasesForHu(newHu, newHu.originalInput.selectedTechnique, true).pipe(
            finalize(() => { this.updateTestPlanTitle(); this.updatePreview(); this.resetCurrentInputs(); })
        ).subscribe({
            error: (err) => {
                console.error("Error en el flujo de generación (imagen):", err);
                this.scenariosError = "Error general en el proceso de generación de HU basada en imagen.";
                newHu.loadingScenarios = false; this.checkOverallLoadingStatus();
            }
        });
    } else if (newHu.originalInput.generationMode === 'flowAnalysis') {
        newHu.loadingScope = false; newHu.loadingScenarios = false;
        this.loadingFlowAnalysisGlobal = true; this.flowAnalysisErrorGlobal = null;
        this.geminiService.generateFlowAnalysisFromImages(newHu.originalInput.imagesBase64!, newHu.originalInput.imageMimeTypes!).pipe(
            tap(report => {
                newHu.flowAnalysisReport = report;
                newHu.errorFlowAnalysis = null;
                if (this.isFlowAnalysisReportInErrorState(report?.[0])) {
                    newHu.errorFlowAnalysis = `${report[0].Nombre_del_Escenario}: ${report[0].Pasos_Analizados[0]?.descripcion_accion_observada || 'Detalles no disponibles.'}`;
                    this.flowAnalysisErrorGlobal = newHu.errorFlowAnalysis ?? null;
                }
            }),
            catchError(error => {
                newHu.errorFlowAnalysis = (typeof error === 'string' ? error : error.message) || 'Error al generar análisis de flujo.';
                this.flowAnalysisErrorGlobal = newHu.errorFlowAnalysis ?? null;
                newHu.flowAnalysisReport = [{
                    Nombre_del_Escenario: "Error Crítico en Generación",
                    Pasos_Analizados: [{ numero_paso: 1, descripcion_accion_observada: newHu.errorFlowAnalysis ?? "Error desconocido", imagen_referencia_entrada: "N/A", elemento_clave_y_ubicacion_aproximada: "N/A", dato_de_entrada_paso:"N/A", resultado_esperado_paso: "N/A", resultado_obtenido_paso_y_estado: "Análisis fallido."}],
                    Resultado_Esperado_General_Flujo: "N/A",
                    Conclusion_General_Flujo: "El análisis de flujo no pudo completarse."
                }];
                return of(newHu.flowAnalysisReport);
            }),
            finalize(() => {
                newHu.loadingFlowAnalysis = false;
                this.checkOverallLoadingStatus();
                this.updateTestPlanTitle();
                this.updatePreview();
                this.resetCurrentInputs();
            })
        ).subscribe({
            error: (err) => {
                console.error("Error en el flujo de generación (análisis de flujo):", err);
                this.flowAnalysisErrorGlobal = (this.flowAnalysisErrorGlobal || "Error general en el proceso de análisis de flujo.");
                newHu.loadingFlowAnalysis = false; this.checkOverallLoadingStatus();
            }
        });
    } else if (newHu.originalInput.generationMode === 'flowComparison') {
        newHu.loadingScope = false; newHu.loadingScenarios = false; newHu.loadingFlowAnalysis = false;
        this.loadingBugComparisonGlobal = true; this.bugComparisonErrorGlobal = null;

        this.geminiService.compareImageFlows(
            newHu.originalInput.imagesBase64FlowA!, newHu.originalInput.imageMimeTypesFlowA!,
            newHu.originalInput.imagesBase64FlowB!, newHu.originalInput.imageMimeTypesFlowB!
        ).pipe(
            tap(report => {
                newHu.bugComparisonReport = report;
                newHu.errorBugComparison = null;
                if (report && report.length > 0 && report.some(item => item.titulo_bug.startsWith("Error de API") || item.titulo_bug.startsWith("Error de Formato") || item.titulo_bug.startsWith("Error de Parsing JSON"))){
                    const firstError = report.find(item => item.titulo_bug.startsWith("Error"));
                    newHu.errorBugComparison = `${firstError?.titulo_bug}: ${firstError?.resultado_actual || 'Detalles no disponibles.'}`;
                    this.bugComparisonErrorGlobal = newHu.errorBugComparison ?? null;
                }
            }),
            catchError(error => {
                newHu.errorBugComparison = (typeof error === 'string' ? error : error.message) || 'Error al generar comparación de flujos.';
                this.bugComparisonErrorGlobal = newHu.errorBugComparison ?? null;
                newHu.bugComparisonReport = [{
                    titulo_bug: "Error Crítico en Comparación", id_bug:"ERR-CRIT", prioridad:"Alta", severidad:"Crítica",
                    pasos_para_reproducir: [], resultado_actual: newHu.errorBugComparison ?? "Error desconocido", resultado_esperado: "Reporte de bugs."
                } as BugReportItem];
                return of(newHu.bugComparisonReport);
            }),
            finalize(() => {
                newHu.loadingBugComparison = false;
                this.checkOverallLoadingStatus();
                this.updateTestPlanTitle();
                this.updatePreview();
                this.resetCurrentInputs();
            })
        ).subscribe({
            error: (err) => {
                console.error("Error en el flujo de generación (comparación de flujos):", err);
                this.bugComparisonErrorGlobal = (this.bugComparisonErrorGlobal || "Error general en el proceso de comparación de flujos.");
                newHu.loadingBugComparison = false; this.checkOverallLoadingStatus();
            }
        });
    }
  }

  private _generateDetailedTestCasesForHu(hu: HUData, technique: string, isInitialGeneration: boolean = false): Observable<DetailedTestCase[]> {
    hu.loadingScenarios = true; hu.errorScenarios = null;
    if (isInitialGeneration || !this.huList.some(h => h.id !== hu.id && h.loadingScenarios)) {
        this.loadingScenarios = true; this.scenariosError = null;
    }
    let generationObservable$: Observable<DetailedTestCase[]>;
    if (hu.originalInput.generationMode === 'image' && hu.originalInput.imagesBase64 && hu.originalInput.imagesBase64.length > 0 && hu.originalInput.imageMimeTypes && hu.originalInput.imageMimeTypes.length > 0) {
      generationObservable$ = this.geminiService.generateDetailedTestCasesImageBased(
        hu.originalInput.imagesBase64, hu.originalInput.imageMimeTypes, technique
      );
    } else if (hu.originalInput.generationMode === 'text' && hu.originalInput.description && hu.originalInput.acceptanceCriteria) {
      generationObservable$ = this.geminiService.generateDetailedTestCasesTextBased(
        hu.originalInput.description, hu.originalInput.acceptanceCriteria, technique
      );
    } else {
      hu.errorScenarios = "Datos de entrada insuficientes para generar casos.";
      hu.detailedTestCases = [{ title: "Error Configuración", preconditions: hu.errorScenarios, steps: "Verifique datos.", expectedResults: "N/A" }];
      hu.generatedTestCaseTitles = hu.errorScenarios;
      this.scenariosError = hu.errorScenarios;
      return of(hu.detailedTestCases).pipe(
          finalize(() => { hu.loadingScenarios = false; this.checkOverallLoadingStatus(); })
      );
    }
    return generationObservable$.pipe(
      tap(detailedTestCases => {
        hu.detailedTestCases = detailedTestCases;
        hu.generatedTestCaseTitles = this.formatSimpleScenarioTitles(detailedTestCases.map(tc => tc.title));
        hu.errorScenarios = null;
        if (detailedTestCases && detailedTestCases.length > 0 && (detailedTestCases[0].title === "Error de API" || detailedTestCases[0].title === "Error de Formato" || detailedTestCases[0].title === "Error de Parsing JSON" || detailedTestCases[0].title === "Información Insuficiente" || detailedTestCases[0].title === "Imágenes no interpretables o técnica no aplicable")) {
            hu.errorScenarios = `${detailedTestCases[0].title}: ${detailedTestCases[0].preconditions}`;
            this.scenariosError = hu.errorScenarios;
        }
        if (hu.showRegenTechniquePicker) { hu.showRegenTechniquePicker = false; hu.regenSelectedTechnique = ''; }
      }),
      catchError(error => {
        hu.errorScenarios = (typeof error === 'string' ? error : error.message) || 'Error al generar casos detallados.';
        hu.detailedTestCases = [{ title: "Error Crítico", preconditions: hu.errorScenarios ?? "Error no especificado.", steps: "N/A", expectedResults: "N/A" }];
        hu.generatedTestCaseTitles = "Error al generar casos de prueba.";
        this.scenariosError = `Error al generar casos para HU ${hu.id}. ${hu.errorScenarios}`;
        return of(hu.detailedTestCases);
      }),
      finalize(() => {
        hu.loadingScenarios = false; this.checkOverallLoadingStatus();
        this.updatePreview();
      })
    );
  }

  public checkOverallLoadingStatus(): void {
    this.loadingSections = this.huList.some(huItem => huItem.loadingScope);
    this.loadingScenarios = this.huList.some(huItem => huItem.loadingScenarios);
    this.loadingFlowAnalysisGlobal = this.huList.some(huItem => huItem.loadingFlowAnalysis);
    this.loadingBugComparisonGlobal = this.huList.some(huItem => huItem.loadingBugComparison);
  }

  public toggleEdit(hu: HUData, section: 'scope' | 'scenarios'): void {
    if (section === 'scenarios' && hu.showRegenTechniquePicker) { this.cancelScenarioRegeneration(hu); }
    if (section === 'scope') {
      if (hu.originalInput.generationMode === 'text') {
        hu.editingScope = !hu.editingScope; if (hu.editingScope) hu.isScopeDetailsOpen = true;
      } else { alert("El alcance no es aplicable ni editable para este modo de generación."); }
    } else if (section === 'scenarios') {
      if (hu.originalInput.generationMode === 'text' || hu.originalInput.generationMode === 'image') {
        hu.editingScenarios = !hu.editingScenarios;
        if (hu.editingScenarios) { hu.isScenariosDetailsOpen = true; setTimeout(() => this.scenariosTextarea?.nativeElement.focus(), 0); }
      } else { alert("La edición de títulos de escenarios no es aplicable para este modo de generación.");}
    }
    if ((section === 'scope' && !hu.editingScope && hu.originalInput.generationMode === 'text') ||
        (section === 'scenarios' && !hu.editingScenarios && (hu.originalInput.generationMode === 'text' || hu.originalInput.generationMode === 'image'))
    ) { this.updatePreview(); }
  }

  public toggleStaticEdit(baseName: StaticSectionBaseName): void {
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
    if (this[editingProp]) { (this[detailsOpenProp] as any) = true; }
    if (wasEditing && !(this[editingProp] as boolean)) { this.updatePreview(); }
  }

  public startScenarioRegeneration(hu: HUData): void {
    if (hu.originalInput.generationMode !== 'text' && hu.originalInput.generationMode !== 'image') {
      alert("La regeneración de escenarios solo aplica para HUs basadas en texto o imágenes."); return;
    }
    hu.editingScenarios = false; hu.showRegenTechniquePicker = true; hu.isScenariosDetailsOpen = true;
    hu.regenSelectedTechnique = hu.originalInput.selectedTechnique; hu.errorScenarios = null; this.scenariosError = null;
  }

  public cancelScenarioRegeneration(hu: HUData): void {
    hu.showRegenTechniquePicker = false; hu.regenSelectedTechnique = ''; hu.errorScenarios = null;
  }

  public confirmRegenerateScenarios(hu: HUData): void {
    if (!hu.regenSelectedTechnique) { hu.errorScenarios = 'Debes seleccionar una técnica.'; return; }
    this._generateDetailedTestCasesForHu(hu, hu.regenSelectedTechnique, false).subscribe();
  }

  public regenerateScope(hu: HUData): void {
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

public regenerateFlowAnalysis(hu: HUData): void {
    if (hu.originalInput.generationMode !== 'flowAnalysis' ||
        !hu.originalInput.imagesBase64 || hu.originalInput.imagesBase64.length === 0 ||
        !hu.flowAnalysisReport || hu.flowAnalysisReport.length === 0) {
        alert("Solo se puede re-analizar un flujo si es de tipo 'Análisis de Flujo', tiene imágenes y un informe previo para contextualizar.");
        return;
    }
    hu.loadingFlowAnalysis = true;
    hu.errorFlowAnalysis = null;
    this.loadingFlowAnalysisGlobal = true;
    this.flowAnalysisErrorGlobal = null;

    this.geminiService.refineFlowAnalysisFromImagesAndContext(
        hu.originalInput.imagesBase64!,
        hu.originalInput.imageMimeTypes!,
        hu.flowAnalysisReport[0],
        hu.userReanalysisContext // NUEVO: Pasar el contexto del usuario
    ).pipe(
        tap(report => {
            hu.flowAnalysisReport = report;
            hu.errorFlowAnalysis = null;
            if (this.isFlowAnalysisReportInErrorState(report?.[0])) {
                hu.errorFlowAnalysis = `${report[0].Nombre_del_Escenario}: ${report[0].Pasos_Analizados[0]?.descripcion_accion_observada || 'Detalles no disponibles.'}`;
                this.flowAnalysisErrorGlobal = hu.errorFlowAnalysis ?? null;
            }
            hu.isEditingFlowReportDetails = false; // Terminar edición después de re-análisis
        }),
        catchError(error => {
            hu.errorFlowAnalysis = (typeof error === 'string' ? error : error.message) || 'Error al re-generar análisis de flujo con contexto.';
            this.flowAnalysisErrorGlobal = hu.errorFlowAnalysis ?? null;
            // Conservar el reporte anterior o una indicación del error en el reporte
            hu.flowAnalysisReport = hu.flowAnalysisReport || [{
                Nombre_del_Escenario: "Error Crítico en Re-Generación (Contextualizada)",
                Pasos_Analizados: [{ numero_paso: 1, descripcion_accion_observada: hu.errorFlowAnalysis ?? "Error desconocido", imagen_referencia_entrada: "N/A", elemento_clave_y_ubicacion_aproximada: "N/A", dato_de_entrada_paso:"N/A", resultado_esperado_paso: "N/A", resultado_obtenido_paso_y_estado: "Análisis fallido."}],
                Resultado_Esperado_General_Flujo: "N/A",
                Conclusion_General_Flujo: "El re-análisis de flujo no pudo completarse."
            }];
            return of(hu.flowAnalysisReport); // Devuelve el reporte (posiblemente con error) para no romper el flujo
        }),
        finalize(() => {
            hu.loadingFlowAnalysis = false;
            this.checkOverallLoadingStatus();
            this.updatePreview();
        })
    ).subscribe();
}

public toggleEditFlowReportDetails(hu: HUData): void {
    hu.isEditingFlowReportDetails = !hu.isEditingFlowReportDetails;
    if (!hu.isEditingFlowReportDetails) { // When finishing edit
        if (hu.flowAnalysisReport && hu.flowAnalysisReport[0] && hu.flowAnalysisReport[0].Pasos_Analizados) {
            // Ensure steps are re-numbered for visual consistency
            hu.flowAnalysisReport[0].Pasos_Analizados.forEach((paso, index) => {
                paso.numero_paso = index + 1;
            });
        }
        this.updatePreview();
    }
}

public deleteFlowAnalysisStep(hu: HUData, reportIndex: number, stepIndex: number): void {
    if (hu.flowAnalysisReport && hu.flowAnalysisReport[reportIndex] && hu.flowAnalysisReport[reportIndex].Pasos_Analizados) {
        hu.flowAnalysisReport[reportIndex].Pasos_Analizados.splice(stepIndex, 1);
        hu.flowAnalysisReport[reportIndex].Pasos_Analizados.forEach((paso, idx) => {
            paso.numero_paso = idx + 1; // Re-number after deletion
        });
        this.updatePreview();
        this.cdr.detectChanges();
    }
}

public addFlowAnalysisStep(hu: HUData, reportIndex: number): void {
    if (hu.flowAnalysisReport && hu.flowAnalysisReport[reportIndex]) {
        const newStep: FlowAnalysisStep = {
            numero_paso: hu.flowAnalysisReport[reportIndex].Pasos_Analizados.length + 1,
            descripcion_accion_observada: '',
            imagen_referencia_entrada: 'Nueva (describir o sin imagen)', // User should edit this
            elemento_clave_y_ubicacion_aproximada: '',
            dato_de_entrada_paso: '',
            resultado_esperado_paso: '',
            resultado_obtenido_paso_y_estado: ''
        };
        hu.flowAnalysisReport[reportIndex].Pasos_Analizados.push(newStep);
        this.updatePreview();
        this.cdr.detectChanges();
    }
}


  public regenerateBugComparison(hu: HUData): void {
    if (hu.originalInput.generationMode !== 'flowComparison' ||
        !hu.originalInput.imagesBase64FlowA || hu.originalInput.imagesBase64FlowA.length === 0 ||
        !hu.originalInput.imagesBase64FlowB || hu.originalInput.imagesBase64FlowB.length === 0) {
        alert("Solo se puede re-analizar una comparación si es de tipo 'Comparación de Flujos' y tiene imágenes cargadas para ambos flujos.");
        return;
    }
    hu.loadingBugComparison = true;
    hu.errorBugComparison = null;
    this.loadingBugComparisonGlobal = true;
    this.bugComparisonErrorGlobal = null;

    this.geminiService.compareImageFlows(
        hu.originalInput.imagesBase64FlowA!, hu.originalInput.imageMimeTypesFlowA!,
        hu.originalInput.imagesBase64FlowB!, hu.originalInput.imageMimeTypesFlowB!
    ).pipe(
        tap(report => {
            hu.bugComparisonReport = report;
            hu.errorBugComparison = null;
             if (report && report.length > 0 && report.some(item => item.titulo_bug.startsWith("Error de API") || item.titulo_bug.startsWith("Error de Formato") || item.titulo_bug.startsWith("Error de Parsing JSON"))){
                const firstError = report.find(item => item.titulo_bug.startsWith("Error"));
                hu.errorBugComparison = `${firstError?.titulo_bug}: ${firstError?.resultado_actual || 'Detalles no disponibles.'}`;
                this.bugComparisonErrorGlobal = hu.errorBugComparison ?? null;
            }
        }),
        catchError(error => {
            hu.errorBugComparison = (typeof error === 'string' ? error : error.message) || 'Error al re-generar comparación de flujos.';
            this.bugComparisonErrorGlobal = hu.errorBugComparison ?? null;
            hu.bugComparisonReport = [{
                titulo_bug: "Error Crítico en Re-Comparación", id_bug:"ERR-CRIT-RE", prioridad:"Alta", severidad:"Crítica",
                pasos_para_reproducir: [], resultado_actual: hu.errorBugComparison ?? "Error desconocido", resultado_esperado: "Reporte de bugs."
            } as BugReportItem];
            return of(hu.bugComparisonReport);
        }),
        finalize(() => {
            hu.loadingBugComparison = false;
            this.checkOverallLoadingStatus();
            this.updatePreview();
        })
    ).subscribe();
  }


  public getHuSummaryForStaticAI(): string {
    if (this.huList.length === 0) {
      return "No hay Historias de Usuario definidas aún.";
    }
    let summary = this.huList.map(hu => {
      let huDesc = `ID ${hu.id} (${hu.title}): Modo ${hu.originalInput.generationMode}.`;
      if (hu.originalInput.generationMode === 'text' && hu.originalInput.description) {
        huDesc += ` Descripción (inicio): ${hu.originalInput.description.substring(0, 70)}...`;
      } else if (hu.originalInput.generationMode === 'image' || hu.originalInput.generationMode === 'flowAnalysis') {
        huDesc += ` (Generada desde ${hu.originalInput.imagesBase64?.length || 0} imagen(es), título: ${hu.title})`;
      } else if (hu.originalInput.generationMode === 'flowComparison') {
        huDesc += ` (Comparación desde ${hu.originalInput.imagesBase64FlowA?.length || 0} imgs Flujo A vs ${hu.originalInput.imagesBase64FlowB?.length || 0} imgs Flujo B, título: ${hu.title})`;
      }
      return `- ${huDesc}`;
    }).join('\n');

    if (summary.length > 1500) {
        summary = summary.substring(0, 1500) + "\n... (resumen truncado por longitud)";
    }
    return summary;
  }

  public regenerateStaticSectionWithAI(section: 'outOfScope' | 'strategy' | 'limitations' | 'assumptions'): void {
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
    if (detailsOpenFlag) (this[detailsOpenFlag] as any) = true;

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
                ? aiResponse.trim()
                : currentContent + '\n\n' + aiResponse.trim());
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

  public formatSimpleScenarioTitles(titles: string[]): string {
    if (!titles || titles.length === 0) { return 'No se generaron escenarios.'; }
    return titles.map((title, index) => `${index + 1}. ${title}`).join('\n');
  }

  public resetCurrentInputs(): void {
    const keptMode = this.currentGenerationMode;
    const keptSprint = this.currentSprint;
    const keptTechnique = (keptMode === 'text' || keptMode === 'image') ? this.currentSelectedTechnique : '';

    if (this.huFormDirective) {
        this.huFormDirective.resetForm({
            currentSelectedTechnique: keptTechnique,
            currentSprint: keptSprint,
            currentHuTitle: ''
        });
    }

    this.currentGenerationMode = keptMode;
    this.currentSelectedTechnique = keptTechnique;
    this.currentSprint = keptSprint;

    this.currentHuId = '';
    this.currentHuTitle = '';

    this.currentDescription = '';
    this.currentAcceptanceCriteria = '';

    this.selectedFiles = [];
    this.currentImagePreviews = [];
    this.imagesBase64 = [];
    this.imageMimeTypes = [];
    this.draggableImages = [];
    this.imageUploadError = null;

    this.draggableImagesFlowA = [];
    this.imagesBase64FlowA = [];
    this.imageMimeTypesFlowA = [];
    this.imageUploadErrorFlowA = null;
    this.draggableImagesFlowB = [];
    this.imagesBase64FlowB = [];
    this.imageMimeTypesFlowB = [];
    this.imageUploadErrorFlowB = null;

    this.formError = null;


    if (isPlatformBrowser(this.platformId)) {
      if (this.imageFilesInputRef && this.imageFilesInputRef.nativeElement) {
        this.imageFilesInputRef.nativeElement.value = '';
      }
      if (this.imageFilesInputFlowARef && this.imageFilesInputFlowARef.nativeElement) {
        this.imageFilesInputFlowARef.nativeElement.value = '';
      }
      if (this.imageFilesInputFlowBRef && this.imageFilesInputFlowBRef.nativeElement) {
        this.imageFilesInputFlowBRef.nativeElement.value = '';
      }
    }
     setTimeout(() => {
        if (this.huFormDirective && this.huFormDirective.form) {
            if(this.currentGenerationMode === 'flowAnalysis' || this.currentGenerationMode === 'flowComparison'){
                this.huFormDirective.form.controls['currentSelectedTechnique']?.disable({emitEvent: false});
            } else {
                this.huFormDirective.form.controls['currentSelectedTechnique']?.enable({emitEvent: false});
            }
            this.huFormDirective.form.updateValueAndValidity();
        }
    }, 0);
  }

  public updateTestPlanTitle(): void {
    if (this.huList.length > 0) {
      const relevantHuForTitle = [...this.huList].reverse().find(hu => hu.originalInput.generationMode === 'text' || hu.originalInput.generationMode === 'image' || hu.originalInput.generationMode === 'flowComparison' || hu.originalInput.generationMode === 'flowAnalysis') || this.huList[this.huList.length - 1];
      this.testPlanTitle = `TEST PLAN EVC00057_ ${relevantHuForTitle.id} SPRINT ${relevantHuForTitle.sprint}`;
    } else { this.testPlanTitle = ''; }
  }

  public updatePreview(): void {
    this.downloadPreviewHtmlContent = this.generatePlanContentHtmlString();
  }

  public generatePlanContentString(): string {
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
    fullPlanContent += `FUERA DEL ALCANCE:\n\n${this.outOfScopeContent}\n\n`;
    fullPlanContent += `ESTRATEGIA:\n\n${this.strategyContent}\n\n`;

    const scenarioHUs = this.huList.filter(hu => hu.originalInput.generationMode === 'text' || hu.originalInput.generationMode === 'image');
    if(scenarioHUs.length > 0){
        fullPlanContent += `CASOS DE PRUEBA (Solo Títulos):\n\n`;
        scenarioHUs.forEach((hu) => {
          fullPlanContent += `HU ${hu.id}: ${hu.title} ${hu.originalInput.generationMode === 'image' ? `(Generada desde ${hu.originalInput.imagesBase64?.length || 0} imagen(es) - Técnica: ${hu.originalInput.selectedTechnique})` : `(Técnica: ${hu.originalInput.selectedTechnique})`}\n`;
          fullPlanContent += `${hu.generatedTestCaseTitles}\n\n`;
        });
    }

    const flowAnalysisHUs = this.huList.filter(hu => hu.originalInput.generationMode === 'flowAnalysis');
    if(flowAnalysisHUs.length > 0){
        fullPlanContent += `ANÁLISIS DE FLUJO INVERSO (Desde Imágenes):\n\n`;
        flowAnalysisHUs.forEach(hu => {
            fullPlanContent += `Análisis ID ${hu.id}: ${hu.title} (Generado desde ${hu.originalInput.imagesBase64?.length || 0} imagen(es))\n`;
            if(hu.flowAnalysisReport && hu.flowAnalysisReport.length > 0 && !this.isFlowAnalysisReportInErrorState(hu.flowAnalysisReport[0])){
                const report = hu.flowAnalysisReport[0];
                fullPlanContent += `  Nombre del Escenario Inferido: ${report.Nombre_del_Escenario}\n`;
                if (report.Pasos_Analizados && report.Pasos_Analizados.length > 0) {
                    fullPlanContent += `  Pasos Analizados:\n`;
                    report.Pasos_Analizados.forEach((paso, index) => {
                        // Use index + 1 for visual numbering as paso.numero_paso might be AI's original or re-ordered.
                        fullPlanContent += `    Paso ${index + 1}: ${paso.descripcion_accion_observada} (Ref IA: ${paso.imagen_referencia_entrada})\n`;
                        fullPlanContent += `      Elemento Clave: ${paso.elemento_clave_y_ubicacion_aproximada}\n`;
                        fullPlanContent += `      Dato de Entrada (Paso): ${paso.dato_de_entrada_paso || 'N/A'}\n`;
                        fullPlanContent += `      Resultado Esperado (Paso): ${paso.resultado_esperado_paso}\n`;
                        fullPlanContent += `      Resultado Obtenido (Paso): ${paso.resultado_obtenido_paso_y_estado}\n`;
                    });
                } else {
                     fullPlanContent += `  Pasos Analizados: No se pudieron determinar pasos detallados.\n`;
                }
                fullPlanContent += `  Resultado Esperado General del Flujo: ${report.Resultado_Esperado_General_Flujo}\n`;
                fullPlanContent += `  Conclusión General del Flujo: ${report.Conclusion_General_Flujo}\n\n`;
            } else {
                fullPlanContent += `  Informe de análisis de flujo no disponible o con errores.\n\n`;
            }
        });
    }
    const bugComparisonHUs = this.huList.filter(hu => hu.originalInput.generationMode === 'flowComparison');
    if (bugComparisonHUs.length > 0) {
        fullPlanContent += `REPORTE DE COMPARACIÓN DE FLUJOS (BUGS):\n\n`;
        const currentDate = new Date().toISOString().split('T')[0];
        bugComparisonHUs.forEach(hu => {
            fullPlanContent += `Comparación ID ${hu.id}: ${hu.title}\n`;
            if (hu.bugComparisonReport && hu.bugComparisonReport.length > 0 && !hu.bugComparisonReport.some(b => b.titulo_bug.startsWith("Error"))) {
                hu.bugComparisonReport.forEach(bug => {
                    fullPlanContent += `  Bug: ${bug.titulo_bug}\n`; // ID del Bug omitido
                    fullPlanContent += `    Prioridad: ${bug.prioridad}, Severidad: ${bug.severidad}\n`;
                    fullPlanContent += `    Fecha: ${currentDate}\n`; // Usar fecha actual
                    // Reportado por y Version/Entorno omitidos
                    if (bug.descripcion_diferencia_general) fullPlanContent += `    Descripción General: ${bug.descripcion_diferencia_general}\n`;
                    fullPlanContent += `    Pasos para Reproducir:\n`;
                    bug.pasos_para_reproducir.forEach(paso => {
                        fullPlanContent += `      ${paso.numero_paso}. ${paso.descripcion}\n`;
                    });
                    fullPlanContent += `    Resultado Esperado (Ref. Flujo A: ${bug.imagen_referencia_flujo_a || 'N/A'}): ${bug.resultado_esperado}\n`;
                    fullPlanContent += `    Resultado Actual (Ref. Flujo B: ${bug.imagen_referencia_flujo_b || 'N/A'}): ${bug.resultado_actual}\n\n`;
                });
            } else if (hu.errorBugComparison) {
                fullPlanContent += `  Error en la comparación: ${hu.errorBugComparison}\n\n`;
            } else {
                fullPlanContent += `  No se reportaron diferencias significativas o hubo un error.\n\n`;
            }
        });
    }


    fullPlanContent += `LIMITACIONES:\n\n${this.limitationsContent}\n\n`;
    fullPlanContent += `SUPUESTOS:\n\n${this.assumptionsContent}\n\n`;
    fullPlanContent += `Equipo de Trabajo:\n\n${this.teamContent}\n\n`;
    return fullPlanContent;
  }

  public generatePlanContentHtmlString(): string {
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
        safe = safe.replace(/"/g, `"`);
        safe = safe.replace(/'/g, `'`);
        return safe.replace(/\n/g, '<br>');
    };
    const currentDateForHtml = new Date().toISOString().split('T')[0];

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

    const scenarioHUs = this.huList.filter(hu => hu.originalInput.generationMode === 'text' || hu.originalInput.generationMode === 'image');
    if(scenarioHUs.length > 0){
        fullPlanHtmlContent += `<span class="preview-section-title">CASOS DE PRUEBA (Solo Títulos):</span>\n\n`;
        scenarioHUs.forEach((hu) => {
          fullPlanHtmlContent += `<span class="preview-hu-title">HU ${escapeHtml(hu.id)} ${escapeHtml(hu.title)} ${hu.originalInput.generationMode === 'image' ? `(Generada desde ${hu.originalInput.imagesBase64?.length || 0} imagen(es) - Técnica: ${escapeHtml(hu.originalInput.selectedTechnique)})` : `(Técnica: ${escapeHtml(hu.originalInput.selectedTechnique)})`}</span>\n`;
          fullPlanHtmlContent += `${escapeHtml(hu.generatedTestCaseTitles)}\n\n`;
        });
    }

    const flowAnalysisHUs = this.huList.filter(hu => hu.originalInput.generationMode === 'flowAnalysis');
    if(flowAnalysisHUs.length > 0){
        fullPlanHtmlContent += `<span class="preview-section-title">ANÁLISIS DE FLUJO INVERSO (Desde Imágenes):</span>\n\n`;
        flowAnalysisHUs.forEach(hu => {
            fullPlanHtmlContent += `<span class="preview-hu-title">Análisis ID ${escapeHtml(hu.id)}: ${escapeHtml(hu.title)} (Generado desde ${hu.originalInput.imagesBase64?.length || 0} imagen(es))</span>\n`;
            if(hu.flowAnalysisReport && hu.flowAnalysisReport.length > 0 && !this.isFlowAnalysisReportInErrorState(hu.flowAnalysisReport[0])){
                const report = hu.flowAnalysisReport[0];
                fullPlanHtmlContent += `  <strong>Nombre del Escenario:</strong> ${escapeHtml(report.Nombre_del_Escenario)}\n`;
                 if (report.Pasos_Analizados && report.Pasos_Analizados.length > 0) {
                    fullPlanHtmlContent += `  <strong>Pasos:</strong>\n`;
                    report.Pasos_Analizados.forEach((paso, index) => {
                        fullPlanHtmlContent += `    Paso ${index + 1}: ${escapeHtml(paso.descripcion_accion_observada)} (Ref. IA: ${escapeHtml(paso.imagen_referencia_entrada)}, Elemento IA: ${escapeHtml(paso.elemento_clave_y_ubicacion_aproximada)})\n`;
                        fullPlanHtmlContent += `      <em>Dato de Entrada (Paso):</em> ${escapeHtml(paso.dato_de_entrada_paso || 'N/A')}\n`;
                        fullPlanHtmlContent += `      <em>Resultado Esperado (Paso):</em> ${escapeHtml(paso.resultado_esperado_paso)}\n`;
                        fullPlanHtmlContent += `      <em>Resultado Obtenido (Paso):</em> ${escapeHtml(paso.resultado_obtenido_paso_y_estado)}\n`;
                    });
                } else {
                    fullPlanHtmlContent += `  <strong>Pasos:</strong> No se pudieron determinar pasos detallados.\n`;
                }
                fullPlanHtmlContent += `  <strong>Resultado Esperado General del Flujo:</strong> ${escapeHtml(report.Resultado_Esperado_General_Flujo)}\n`;
                fullPlanHtmlContent += `  <strong>Conclusión General del Flujo:</strong> ${escapeHtml(report.Conclusion_General_Flujo)}\n\n`;
            } else {
                fullPlanHtmlContent += `  Informe de análisis de flujo no disponible o con errores.\n\n`;
            }
        });
    }

    const bugComparisonHUs_html = this.huList.filter(hu => hu.originalInput.generationMode === 'flowComparison');
    if (bugComparisonHUs_html.length > 0) {
        fullPlanHtmlContent += `<span class="preview-section-title">REPORTE DE COMPARACIÓN DE FLUJOS (BUGS):</span>\n\n`;
        bugComparisonHUs_html.forEach(hu => {
            fullPlanHtmlContent += `<span class="preview-hu-title">Comparación ID ${escapeHtml(hu.id)}: ${escapeHtml(hu.title)}</span>\n`;
            if (hu.bugComparisonReport && hu.bugComparisonReport.length > 0 && !hu.bugComparisonReport.some(b => b.titulo_bug.startsWith("Error"))) {
                hu.bugComparisonReport.forEach(bug => {
                    fullPlanHtmlContent += `  <strong>Bug: ${escapeHtml(bug.titulo_bug)}</strong>\n`; // ID Bug omitido
                    fullPlanHtmlContent += `    Prioridad: ${escapeHtml(bug.prioridad)}, Severidad: ${escapeHtml(bug.severidad)}\n`;
                    fullPlanHtmlContent += `    Fecha: ${currentDateForHtml}\n`; // Usar fecha actual
                    // Reportado por y Version/Entorno omitidos
                    if (bug.descripcion_diferencia_general) fullPlanHtmlContent += `    Descripción General: ${escapeHtml(bug.descripcion_diferencia_general)}\n`;
                    fullPlanHtmlContent += `    Pasos para Reproducir:\n`;
                    bug.pasos_para_reproducir.forEach(paso => {
                        fullPlanHtmlContent += `      ${paso.numero_paso}. ${escapeHtml(paso.descripcion)}\n`;
                    });
                    fullPlanHtmlContent += `    Resultado Esperado (Ref. A: ${escapeHtml(bug.imagen_referencia_flujo_a || 'N/A')}): ${escapeHtml(bug.resultado_esperado)}\n`;
                    // No se incluyen imágenes en esta previsualización de texto plano
                    fullPlanHtmlContent += `    Resultado Actual (Ref. B: ${escapeHtml(bug.imagen_referencia_flujo_b || 'N/A')}): ${escapeHtml(bug.resultado_actual)}\n\n`;
                });
            } else if (hu.errorBugComparison) {
                 fullPlanHtmlContent += `  <em>Error en la comparación: ${escapeHtml(hu.errorBugComparison)}</em>\n\n`;
            } else {
                fullPlanHtmlContent += `  <em>No se reportaron diferencias significativas o hubo un error en la generación del reporte.</em>\n\n`;
            }
        });
    }


    fullPlanHtmlContent += `<span class="preview-section-title">LIMITACIONES:</span>\n\n${escapeHtml(this.limitationsContent)}\n\n`;
    fullPlanHtmlContent += `<span class="preview-section-title">SUPUESTOS:</span>\n\n${escapeHtml(this.assumptionsContent)}\n\n`;
    fullPlanHtmlContent += `<span class="preview-section-title">Equipo de Trabajo:</span>\n\n${escapeHtml(this.teamContent)}\n\n`;
    return fullPlanHtmlContent;
  }

  public copyPreviewToClipboard(): void {
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

  public downloadWord(): void {
    const plainTextContent = this.generatePlanContentString();
    if (!plainTextContent) { console.warn('No hay contenido para descargar.'); return; }
    const blob = new Blob([plainTextContent], { type: 'text/plain;charset=utf-8' });
    const date = new Date().toISOString().split('T')[0];
    saveAs(blob, `PlanDePruebas_Completo_${date}.doc`);
  }

  public exportExecutionMatrix(hu: HUData): void {
    if (hu.originalInput.generationMode === 'flowAnalysis' || hu.originalInput.generationMode === 'flowComparison' || !hu.detailedTestCases || hu.detailedTestCases.length === 0 || hu.detailedTestCases.some(tc => tc.title.startsWith("Error") || tc.title === "Información Insuficiente" || tc.title === "Imágenes no interpretables o técnica no aplicable")) {
      alert('No hay casos de prueba válidos para exportar para esta HU o el tipo de HU no genera matriz de ejecución.'); return;
    }
    const csvHeader = ["Escenario de Prueba", "Precondiciones", "Paso a Paso", "Resultado Esperado"];
    const csvRows = hu.detailedTestCases.map(tc => ([
      `${this.escapeCsvField(tc.title)}`,
      `${this.escapeCsvField(tc.preconditions)}`,
      `${this.escapeCsvField(tc.steps)}`,
      `${this.escapeCsvField(tc.expectedResults)}`
    ]));
    const csvContent = [csvHeader.join(','), ...csvRows.map(row => row.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const date = new Date().toISOString().split('T')[0];
    saveAs(blob, `MatrizEjecucion_${hu.id}_${date}.csv`);
  }

  public exportFlowAnalysisReportToCsv(hu: HUData): void {
    if (hu.originalInput.generationMode !== 'flowAnalysis' ||
        !hu.flowAnalysisReport || hu.flowAnalysisReport.length === 0 ||
        this.isFlowAnalysisReportInErrorState(hu.flowAnalysisReport[0])) {
      alert('No hay un informe de análisis de flujo válido para exportar a CSV.');
      return;
    }

    const report = hu.flowAnalysisReport[0];
    const csvHeader = [
      "ID Análisis", "Título Análisis", "Sprint", "Nombre Escenario Inferido",
      "Paso N° (Orden Visual)", "Descripción Acción/Observación", "Imagen(es) Referencia (IA)", "Elemento Clave y Ubicación", "Dato de Entrada (Paso)",
      "Resultado Esperado (Paso)", "Resultado Obtenido y Estado (Paso)",
      "Resultado Esperado General Flujo", "Conclusión General Flujo"
    ];
    const csvRows: string[][] = [];

    if (report.Pasos_Analizados && report.Pasos_Analizados.length > 0) {
        report.Pasos_Analizados.forEach((paso, index) => {
            csvRows.push([
                this.escapeCsvField(hu.id),
                this.escapeCsvField(hu.title),
                this.escapeCsvField(hu.sprint),
                this.escapeCsvField(report.Nombre_del_Escenario),
                this.escapeCsvField(index + 1), // Use visual order
                this.escapeCsvField(paso.descripcion_accion_observada),
                this.escapeCsvField(paso.imagen_referencia_entrada),
                this.escapeCsvField(paso.elemento_clave_y_ubicacion_aproximada),
                this.escapeCsvField(paso.dato_de_entrada_paso || 'N/A'),
                this.escapeCsvField(paso.resultado_esperado_paso),
                this.escapeCsvField(paso.resultado_obtenido_paso_y_estado),
                this.escapeCsvField(report.Resultado_Esperado_General_Flujo),
                this.escapeCsvField(report.Conclusion_General_Flujo)
            ]);
        });
    } else {
        csvRows.push([
            this.escapeCsvField(hu.id),
            this.escapeCsvField(hu.title),
            this.escapeCsvField(hu.sprint),
            this.escapeCsvField(report.Nombre_del_Escenario),
            "N/A", "No se analizaron pasos.", "N/A", "N/A", "N/A", "N/A", "N/A",
            this.escapeCsvField(report.Resultado_Esperado_General_Flujo),
            this.escapeCsvField(report.Conclusion_General_Flujo)
        ]);
    }

    const csvContent = [csvHeader.join(','), ...csvRows.map(row => row.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const date = new Date().toISOString().split('T')[0];
    saveAs(blob, `InformeAnalisisFlujo_CSV_${hu.id}_${date}.csv`);
  }

  public exportFlowAnalysisReportToHtmlLocalized(hu: HUData, language: 'es' | 'en'): void {
    if (hu.originalInput.generationMode !== 'flowAnalysis' ||
        !hu.flowAnalysisReport || hu.flowAnalysisReport.length === 0 ||
        this.isFlowAnalysisReportInErrorState(hu.flowAnalysisReport[0])
      ) {
      alert(language === 'en' ? 'No valid flow analysis report to export to HTML.' : 'No hay un informe de análisis de flujo válido para exportar a HTML.');
      return;
    }
    const report = hu.flowAnalysisReport[0];
    const title = language === 'en' ? `Flow Report: ${this.escapeHtmlForExport(hu.title)}` : `Informe de Flujo: ${this.escapeHtmlForExport(hu.title)}`;
    let htmlContent = `<html><head><title>${title}</title>`;
    htmlContent += `<style>
      body { font-family: Segoe UI, Calibri, Arial, sans-serif; margin: 20px; line-height: 1.6; color: #343a40; }
      h1 { color: #3b5a6b; border-bottom: 2px solid #e9ecef; padding-bottom: 10px; }
      h2 { color: #4a6d7c; margin-top: 30px; border-bottom: 1px solid #e9ecef; padding-bottom: 5px;}
      p, pre.report-text { margin-bottom: 10px; }
      pre.report-text { white-space: pre-wrap; word-wrap: break-word; background-color: #f8f9fa; border: 1px solid #e9ecef; padding: 10px; border-radius: 4px; font-family: Consolas, monospace; }
      table { border-collapse: collapse; width: 100%; margin-bottom: 20px; font-size: 0.9em; }
      th, td { border: 1px solid #dee2e6; padding: 8px 10px; text-align: left; vertical-align: top; }
      th { background-color: #f1f5f9; font-weight: 600; color: #4a6d7c; }
      td pre { white-space: pre-wrap; word-wrap: break-word; margin:0; font-family: Consolas, monospace; background: transparent; border: none; padding: 0;}
      img.flow-step-image { max-width: 250px; max-height: 200px; border: 1px solid #ced4da; border-radius: 4px; display: block; margin-top:5px; }
      .status-success td:first-child { border-left: 4px solid #28a745; }
      .status-failure td:first-child { border-left: 4px solid #dc3545; }
      .status-deviation td:first-child { border-left: 4px solid #ffc107; }
    </style></head><body>`;

    htmlContent += `<h1>${title}</h1>`;
    htmlContent += `<p><strong>${language === 'en' ? 'Sprint' : 'Sprint'}:</strong> ${this.escapeHtmlForExport(hu.sprint)}</p>`;
    htmlContent += `<h2>${language === 'en' ? 'Scenario Name' : 'Nombre del Escenario'}:</h2><pre class="report-text">${this.escapeHtmlForExport(report.Nombre_del_Escenario)}</pre>`;

    if (report.Pasos_Analizados && report.Pasos_Analizados.length > 0) {
      htmlContent += `<h2>${language === 'en' ? 'Steps' : 'Pasos'}</h2><table><thead><tr>
        <th>${language === 'en' ? 'Step #' : 'Paso N°'} (Ordered)</th>
        <th>${language === 'en' ? 'Action/Observation' : 'Acción/Observación'}</th>
        <th>${language === 'en' ? 'Input Data (Step)' : 'Dato de Entrada (Paso)'}</th>
        <th>${language === 'en' ? 'Expected Result (Step)' : 'Resultado Esperado (Paso)'}</th>
        <th>${language === 'en' ? 'Actual Result & Status (Step)' : 'Resultado Obtenido y Estado (Paso)'}</th>
        <th>${language === 'en' ? 'Step Image' : 'Imagen del Paso'}</th>
      </tr></thead><tbody>`;

      report.Pasos_Analizados.forEach((paso, index) => {
        const imgSrc = this.getFlowStepImage(hu, paso);
        const statusClass = this.getFlowStepStatusClass(paso);
        htmlContent += `<tr class="${statusClass}">
          <td>${index + 1}</td>
          <td><pre>${this.escapeHtmlForExport(paso.descripcion_accion_observada)}</pre></td>
          <td><pre>${this.escapeHtmlForExport(paso.dato_de_entrada_paso || (language === 'en' ? 'N/A' : 'N/A'))}</pre></td>
          <td><pre>${this.escapeHtmlForExport(paso.resultado_esperado_paso)}</pre></td>
          <td><pre>${this.escapeHtmlForExport(paso.resultado_obtenido_paso_y_estado)}</pre></td>
          <td>${imgSrc ? `<img src="${imgSrc}" alt="${language === 'en' ? 'Image for original step' : 'Imagen para paso original'} ${paso.numero_paso}" class="flow-step-image">` : (language === 'en' ? 'N/A' : 'N/A')}</td>
        </tr>`;
      });
      htmlContent += `</tbody></table>`;
    } else {
      htmlContent += `<p><strong>${language === 'en' ? 'Steps' : 'Pasos'}:</strong> ${language === 'en' ? 'No detailed steps were analyzed or found.' : 'No se analizaron pasos detallados o no se encontraron.'}</p>`;
    }

    htmlContent += `<h2>${language === 'en' ? 'Overall Expected Result of Flow' : 'Resultado Esperado General del Flujo'}:</h2><pre class="report-text">${this.escapeHtmlForExport(report.Resultado_Esperado_General_Flujo)}</pre>`;
    htmlContent += `<h2>${language === 'en' ? 'Overall Conclusion of Flow' : 'Conclusión General del Flujo'}:</h2><pre class="report-text">${this.escapeHtmlForExport(report.Conclusion_General_Flujo)}</pre>`;
    htmlContent += `</body></html>`;

    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8;' });
    const date = new Date().toISOString().split('T')[0];
    const langSuffix = language === 'en' ? 'ENG' : 'ESP';
    saveAs(blob, `Informe_Flujo_${this.escapeFilename(hu.title)}_${langSuffix}_${date}.html`);
}

public exportBugComparisonReportToHtmlLocalized(hu: HUData, language: 'es' | 'en'): void {
    if (hu.originalInput.generationMode !== 'flowComparison' ||
        !hu.bugComparisonReport || hu.bugComparisonReport.length === 0 ||
        hu.bugComparisonReport.some(b => b.titulo_bug.startsWith("Error"))) {
        alert(language === 'en' ? 'No valid bug comparison report to export to HTML.' : 'No hay un informe de comparación de bugs válido para exportar a HTML.');
        return;
    }

    const currentDateForExport = new Date().toISOString().split('T')[0];
    const reportTitle = language === 'en' ? `Flow Comparison Report: ${this.escapeHtmlForExport(hu.title)}` : `Reporte de Comparación de Flujos: ${this.escapeHtmlForExport(hu.title)}`;

    let htmlContent = `<html><head><title>${reportTitle}</title>`;
    htmlContent += `<style>
        body { font-family: Segoe UI, Calibri, Arial, sans-serif; margin: 20px; line-height: 1.5; color: #333; }
        .report-container { max-width: 900px; margin: auto; }
        h1 { color: #3b5a6b; border-bottom: 2px solid #e9ecef; padding-bottom: 10px; }
        h2.main-title { color: #3b5a6b; border-bottom: 2px solid #e9ecef; padding-bottom: 10px; }
        h2.bug-title { font-size: 1.3em; color: #c0392b; margin-top: 0; margin-bottom: 10px; } /* Renamed for clarity */
        .bug-item { border: 1px solid #ddd; border-radius: 5px; padding: 15px; margin-bottom: 20px; background-color: #f9f9f9; }
        .bug-meta, .bug-details p { margin-bottom: 8px; font-size: 0.95em; }
        .bug-meta strong, .bug-details strong { color: #555; }
        .bug-details pre { white-space: pre-wrap; word-wrap: break-word; background-color: #fff; border: 1px solid #eee; padding: 10px; border-radius: 4px; font-family: Consolas, monospace; margin-top: 3px; margin-bottom: 10px;}
        .bug-steps { margin-left: 20px; list-style-type: decimal; }
        .image-ref { font-style: italic; color: #777; font-size: 0.9em; }
        .bug-report-image { max-width: 300px; max-height: 250px; border: 1px solid #ccc; border-radius: 4px; display: block; margin: 10px 0; }
    </style></head><body><div class="report-container">`;

    htmlContent += `<h1 class="main-title">${reportTitle}</h1>`;

    hu.bugComparisonReport.forEach((bug, index) => {
        htmlContent += `<div class="bug-item">`;
        htmlContent += `<h2 class="bug-title">${language === 'en' ? 'Bug' : 'Bug'} #${index + 1}: ${this.escapeHtmlForExport(bug.titulo_bug)}</h2>`;

        htmlContent += `<div class="bug-meta">`;
        htmlContent += `<p><strong>${language === 'en' ? 'Priority' : 'Prioridad'}:</strong> ${this.escapeHtmlForExport(bug.prioridad)} | <strong>${language === 'en' ? 'Severity' : 'Severidad'}:</strong> ${this.escapeHtmlForExport(bug.severidad)}</p>`;
        htmlContent += `<p><strong>${language === 'en' ? 'Date' : 'Fecha'}:</strong> ${currentDateForExport}</p>`;
        htmlContent += `</div>`; // end bug-meta

        htmlContent += `<div class="bug-details">`;
        if (bug.descripcion_diferencia_general) {
             htmlContent += `<p><strong>${language === 'en' ? 'General Difference Description' : 'Descripción General de la Diferencia'}:</strong></p><pre>${this.escapeHtmlForExport(bug.descripcion_diferencia_general)}</pre>`;
        }
        htmlContent += `<p><strong>${language === 'en' ? 'Steps to Reproduce' : 'Pasos para Reproducir'}:</strong></p>`;
        if (bug.pasos_para_reproducir && bug.pasos_para_reproducir.length > 0) {
            htmlContent += `<ol class="bug-steps">`;
            bug.pasos_para_reproducir.forEach(paso => {
                htmlContent += `<li>${this.escapeHtmlForExport(paso.descripcion)}</li>`;
            });
            htmlContent += `</ol>`;
        } else {
            htmlContent += `<p>${language === 'en' ? 'N/A' : 'N/A'}</p>`;
        }

        htmlContent += `<p><strong>${language === 'en' ? 'Expected Result' : 'Resultado Esperado'}:</strong> <span class="image-ref">(${language === 'en' ? 'Ref. Flow A' : 'Ref. Flujo A'}: ${this.escapeHtmlForExport(bug.imagen_referencia_flujo_a || 'N/A')})</span></p>`;
        const imgSrcA = this.getBugReportImage(hu, bug.imagen_referencia_flujo_a, 'A');
        if (imgSrcA) {
            htmlContent += `<img src="${imgSrcA}" alt="${language === 'en' ? 'Expected Image' : 'Imagen Esperada'} ${this.escapeHtmlForExport(bug.imagen_referencia_flujo_a || '')}" class="bug-report-image">`;
        }
        htmlContent += `<pre>${this.escapeHtmlForExport(bug.resultado_esperado)}</pre>`;

        htmlContent += `<p><strong>${language === 'en' ? 'Actual Result' : 'Resultado Actual'}:</strong> <span class="image-ref">(${language === 'en' ? 'Ref. Flow B' : 'Ref. Flujo B'}: ${this.escapeHtmlForExport(bug.imagen_referencia_flujo_b || 'N/A')})</span></p>`;
        const imgSrcB = this.getBugReportImage(hu, bug.imagen_referencia_flujo_b, 'B');
        if (imgSrcB) {
            htmlContent += `<img src="${imgSrcB}" alt="${language === 'en' ? 'Actual Image' : 'Imagen Actual'} ${this.escapeHtmlForExport(bug.imagen_referencia_flujo_b || '')}" class="bug-report-image">`;
        }
        htmlContent += `<pre>${this.escapeHtmlForExport(bug.resultado_actual)}</pre>`;

        htmlContent += `</div>`; // end bug-details
        htmlContent += `</div>`; // end bug-item
    });

    htmlContent += `</div></body></html>`;

    const dateForFilename = new Date().toISOString().split('T')[0];
    const langSuffix = language === 'en' ? 'ENG' : 'ESP';
    saveAs(new Blob([htmlContent], { type: 'text/html;charset=utf-8;' }), `Reporte_Comparacion_Bugs_${this.escapeFilename(hu.title)}_${langSuffix}_${dateForFilename}.html`);
}


private escapeFilename(filename: string): string {
  return filename.replace(/[^a-z0-9_.-]/gi, '_').substring(0, 50);
}

    public isFlowAnalysisReportInErrorState(reportItem?: FlowAnalysisReportItem): boolean {
        if (!reportItem) return true; // Treat no report as an error state for display logic
        const errorScenarioNames = [
            "Error de API",
            "Error de Formato de Respuesta",
            "Error de Formato (No JSON Array)",
            "Error de Formato (No Array)",
            "Error de Formato (Faltan Campos)",
            "Error de Parsing JSON",
            "Secuencia de imágenes no interpretable",
            "Error Crítico en Generación",
            "Error Crítico en Re-Generación",
            "Error Crítico en Re-Generación (Contextualizada)",
            "Respuesta Vacía de IA"
        ];
        return errorScenarioNames.includes(reportItem.Nombre_del_Escenario);
    }

  private escapeCsvField(field: string | number): string {
    if (field === null || field === undefined) { return ''; }
    let result = field.toString();
    result = result.replace(/"/g, '""');
    if (result.includes(',')) {
        result = `"${result}"`;
    }
    return result;
  }

    private escapeHtmlForExport(unsafe: string): string {
        if (typeof unsafe !== 'string') {
            return '';
        }
        return unsafe
             .replace(/&/g, `&`)
             .replace(/</g, `<`)
             .replace(/>/g, `>`)
             .replace(/"/g, `"`)
             .replace(/'/g, `'`);
    }


  public isAnyHuTextBased(): boolean {
    return this.huList.some(hu => hu.originalInput.generationMode === 'text');
  }

  public trackHuById(index: number, hu: HUData): string {
    return hu.id;
  }

  public getFlowStepImage(hu: HUData, paso: FlowAnalysisStep): string | null {
    if (!hu.originalInput.imagesBase64 || hu.originalInput.imagesBase64.length === 0 || !hu.originalInput.imageMimeTypes) {
      return null;
    }
    // The paso.imagen_referencia_entrada can be "Imagen X" or "Imagen X a Imagen Y"
    // For simplicity, we'll try to show the first image mentioned if it's a range.
    const match = paso.imagen_referencia_entrada.match(/Imagen (\d+)/i);
    if (match && match[1]) {
      const imageIndex = parseInt(match[1], 10) - 1; // Input images are 1-indexed in prompt.
      if (imageIndex >= 0 && imageIndex < hu.originalInput.imagesBase64.length) {
        const mimeType = hu.originalInput.imageMimeTypes[imageIndex];
        const base64Data = hu.originalInput.imagesBase64[imageIndex];
        return `data:${mimeType};base64,${base64Data}`;
      }
    }
    return null;
  }
  public getBugReportImage(hu: HUData, imageRefString?: string, flowType?: 'A' | 'B'): string | null {
    if (!imageRefString) return null;

    let imagesArray: string[] | undefined;
    let mimeTypesArray: string[] | undefined;

    if (flowType === 'A') {
        imagesArray = hu.originalInput.imagesBase64FlowA;
        mimeTypesArray = hu.originalInput.imageMimeTypesFlowA;
    } else if (flowType === 'B') {
        imagesArray = hu.originalInput.imagesBase64FlowB;
        mimeTypesArray = hu.originalInput.imageMimeTypesFlowB;
    } else {
        // This case might not be used if flowType A/B is always specified for bug reports.
        imagesArray = hu.originalInput.imagesBase64;
        mimeTypesArray = hu.originalInput.imageMimeTypes;
    }

    if (!imagesArray || imagesArray.length === 0 || !mimeTypesArray) {
        return null;
    }

    // Match "Imagen A.1", "Imagen B.1", or "Imagen 1"
    const match = imageRefString.match(/Imagen (?:[AB]\.)?(\d+)/i);
    if (match && match[1]) {
        const imageIndex = parseInt(match[1], 10) - 1; // Input images are 1-indexed in prompt.
        if (imageIndex >= 0 && imageIndex < imagesArray.length) {
            const mimeType = mimeTypesArray[imageIndex];
            const base64Data = imagesArray[imageIndex];
            return `data:${mimeType};base64,${base64Data}`;
        }
    }
    return null;
  }


  public getFlowStepStatusClass(paso: FlowAnalysisStep): string {
    const statusText = (paso.resultado_obtenido_paso_y_estado || '').toLowerCase();
    if (statusText.includes('exitosa con desviaciones')) {
        return 'status-deviation';
    } else if (statusText.includes('exitosa')) {
        return 'status-success';
    } else if (statusText.includes('fallido') || statusText.includes('fallida')) {
        return 'status-failure';
    }
    return '';
  }

  public isBugReportInErrorState(bugReport?: BugReportItem[]): boolean {
    if (!bugReport || bugReport.length === 0) return false; // No report is not an error in itself for this check
    return bugReport.some(bug =>
        bug.titulo_bug.startsWith("Error de API") ||
        bug.titulo_bug.startsWith("Error de Formato") ||
        bug.titulo_bug.startsWith("Error de Parsing JSON") ||
        bug.titulo_bug.startsWith("Error Crítico")
    );
  }
}