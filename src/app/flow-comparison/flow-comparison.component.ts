// src/app/flow-comparison/flow-comparison.component.ts
import { Component, OnInit, ViewChild, ElementRef, Inject, PLATFORM_ID, Output, EventEmitter, Input, ChangeDetectorRef } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { HUData, GenerationMode, BugReportItem, ImageAnnotation } from '../models/hu-data.model';
import { GeminiService } from '../services/gemini.service';
import { catchError, finalize, tap } from 'rxjs/operators';
import { Observable, of, forkJoin } from 'rxjs';
import { saveAs } from 'file-saver';
import { ImageAnnotationEditorComponent } from '../image-annotation-editor/image-annotation-editor.component'; // Importa el nuevo componente

interface DraggableFlowImage {
  file: File;
  preview: string | ArrayBuffer;
  base64: string;
  mimeType: string;
  id: string;
}

@Component({
  selector: 'app-flow-comparison',
  standalone: true,
  imports: [FormsModule, CommonModule, ImageAnnotationEditorComponent],
  templateUrl: './flow-comparison.component.html',
  styleUrls: ['./flow-comparison.component.css']
})
export class FlowComparisonComponent implements OnInit {
  @Input() initialSprint: string = '';
  @Output() comparisonGenerated = new EventEmitter<HUData>();
  @Output() cancelComparison = new EventEmitter<void>();

  draggableImagesFlowA: DraggableFlowImage[] = [];
  imagesBase64FlowA: string[] = [];
  imageMimeTypesFlowA: string[] = [];
  imageUploadErrorFlowA: string | null = null;
  annotationsFlowA: ImageAnnotation[] = []; // Para almacenar anotaciones del Flujo A

  draggableImagesFlowB: DraggableFlowImage[] = [];
  imagesBase64FlowB: string[] = [];
  imageMimeTypesFlowB: string[] = [];
  imageUploadErrorFlowB: string | null = null;
  annotationsFlowB: ImageAnnotation[] = []; // Para almacenar anotaciones del Flujo B

  formError: string | null = null;
  currentFlowTitle: string = '';
  currentFlowSprint: string = '';
  userBugComparisonReanalysisContext: string = ''; // Este campo ahora puede incluir anotaciones serializadas

  loadingBugComparison: boolean = false;
  bugComparisonError: string | null = null;

  // Store the generated HUData for potential re-analysis within this component
  private currentHUData: HUData | null = null;

  // ESTADO DEL EDITOR DE IMÁGENES
  showImageEditor: boolean = false;
  imageToEditUrl: string | ArrayBuffer | null = null;
  imageToEditFlowType: 'A' | 'B' | null = null;
  existingAnnotationsForEditor: ImageAnnotation[] = [];


  @ViewChild('comparisonFlowForm') comparisonFlowFormDirective!: NgForm;
  @ViewChild('imageFilesInputFlowA') imageFilesInputFlowARef: ElementRef<HTMLInputElement> | undefined;
  @ViewChild('imageFilesInputFlowB') imageFilesInputFlowBRef: ElementRef<HTMLInputElement> | undefined;

  // Drag and Drop state
  draggedImageFlowA: DraggableFlowImage | null = null;
  dragOverImageIdFlowA: string | null = null;
  draggedImageFlowB: DraggableFlowImage | null = null;
  dragOverImageIdFlowB: string | null = null;

  constructor(
    private geminiService: GeminiService,
    @Inject(PLATFORM_ID) private platformId: Object,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.currentFlowSprint = this.initialSprint;
    this.resetForm();
  }

  resetForm(): void {
    this.formError = null;
    this.draggableImagesFlowA = []; this.imagesBase64FlowA = []; this.imageMimeTypesFlowA = []; this.imageUploadErrorFlowA = null; this.annotationsFlowA = [];
    this.draggableImagesFlowB = []; this.imagesBase64FlowB = []; this.imageMimeTypesFlowB = []; this.imageUploadErrorFlowB = null; this.annotationsFlowB = [];
    
    const keptSprint = this.currentFlowSprint;
    this.currentFlowTitle = '';
    this.userBugComparisonReanalysisContext = '';
    this.currentHUData = null;
    this.loadingBugComparison = false;
    this.bugComparisonError = null;

    // Reiniciar estado del editor
    this.showImageEditor = false;
    this.imageToEditUrl = null;
    this.imageToEditFlowType = null;
    this.existingAnnotationsForEditor = [];

    if (isPlatformBrowser(this.platformId)) {
      if (this.imageFilesInputFlowARef?.nativeElement) this.imageFilesInputFlowARef.nativeElement.value = '';
      if (this.imageFilesInputFlowBRef?.nativeElement) this.imageFilesInputFlowBRef.nativeElement.value = '';
    }

    this.comparisonFlowFormDirective?.resetForm({ currentFlowSprint: keptSprint });
     this.currentFlowSprint = keptSprint;
     setTimeout(() => {
        if (this.comparisonFlowFormDirective?.form) {
            this.comparisonFlowFormDirective.form.markAsPristine();
            this.comparisonFlowFormDirective.form.markAsUntouched();
            this.comparisonFlowFormDirective.form.updateValueAndValidity();
        }
        this.cdr.detectChanges();
     },0);
  }

  isFormInvalid(): boolean {
    if (!this.comparisonFlowFormDirective || !this.comparisonFlowFormDirective.form) {
      return true;
    }
    // VALIDACIÓN MODIFICADA: Ahora el Flujo A es opcional, pero al menos uno debe estar presente.
    return !this.currentFlowSprint || !this.currentFlowTitle ||
           (this.draggableImagesFlowA.length === 0 && this.draggableImagesFlowB.length === 0);
  }

  private parseFileNameForSorting(fileName: string): { main: number, sub: number } {
    const nameWithoutExtension = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
    const parts = nameWithoutExtension.split(/[^0-9]+/g).filter(Boolean).map(p => parseInt(p, 10));
    return {
        main: parts.length > 0 && !isNaN(parts[0]) ? parts[0] : Infinity,
        sub: parts.length > 1 && !isNaN(parts[1]) ? parts[1] : (parts.length > 0 && !isNaN(parts[0]) ? 0 : Infinity)
    };
  }

  onFileSelected(event: Event, flowType: 'A' | 'B'): void {
    let currentDraggableImagesRef!: DraggableFlowImage[];
    let currentUploadErrorProp!: 'imageUploadErrorFlowA' | 'imageUploadErrorFlowB';
    let currentAnnotationsRef!: ImageAnnotation[];
    const maxImages = 10;

    if (flowType === 'A') {
        currentDraggableImagesRef = this.draggableImagesFlowA;
        this.imageUploadErrorFlowA = null; currentUploadErrorProp = 'imageUploadErrorFlowA';
        currentAnnotationsRef = this.annotationsFlowA;
    } else if (flowType === 'B') {
        currentDraggableImagesRef = this.draggableImagesFlowB;
        this.imageUploadErrorFlowB = null; currentUploadErrorProp = 'imageUploadErrorFlowB';
        currentAnnotationsRef = this.annotationsFlowB;
    } else return;

    this.formError = null;
    currentDraggableImagesRef.length = 0;
    currentAnnotationsRef.length = 0; // Reset annotations when files change

    const element = event.currentTarget as HTMLInputElement;
    const fileList: FileList | null = element.files;

    if (fileList && fileList.length > 0) {
        if (fileList.length > maxImages) {
            this[currentUploadErrorProp] = `Puedes seleccionar un máximo de ${maxImages} imágenes.`; element.value = ""; return;
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
                 this[currentUploadErrorProp] = `"${file.name}" excede 4MB.`; validationErrorFound = true;
            }
            if (!['image/jpeg', 'image/png'].includes(file.type) && !validationErrorFound) {
                this[currentUploadErrorProp] = `Formato inválido: "${file.name}". Solo JPG/PNG.`; validationErrorFound = true;
            }

            if (validationErrorFound) {
                element.value = "";
                currentDraggableImagesRef.length = 0;
                currentAnnotationsRef.length = 0; // Asegurarse de que las anotaciones también se reseteen
                this.updateBase64Arrays(flowType);
                this.cdr.detectChanges();
                return;
            }

            const readerObservable = new Observable<DraggableFlowImage>(observer => {
                const reader = new FileReader();
                reader.onload = () => {
                    observer.next({ file, preview: reader.result!, base64: (reader.result as string).split(',')[1], mimeType: file.type, id: flowType + '_' + file.name + '_' + Date.now() + Math.random().toString(16).slice(2) });
                    observer.complete();
                };
                reader.onerror = error => { this[currentUploadErrorProp] = `Error al leer "${file.name}".`; observer.error(error); };
                reader.readAsDataURL(file);
            });
            fileProcessingObservables.push(readerObservable);
        }
        if (validationErrorFound) { currentDraggableImagesRef.length = 0; currentAnnotationsRef.length = 0; this.updateBase64Arrays(flowType); this.cdr.detectChanges(); return; }

        if (fileProcessingObservables.length > 0) {
            forkJoin(fileProcessingObservables).subscribe({
                next: (processedImages) => {
                    processedImages.forEach(img => currentDraggableImagesRef.push(img));
                    this.updateBase64Arrays(flowType);
                },
                complete: () => { this.comparisonFlowFormDirective?.form.updateValueAndValidity(); this.cdr.detectChanges(); },
                error: () => { element.value = ""; currentDraggableImagesRef.length = 0; currentAnnotationsRef.length = 0; this.updateBase64Arrays(flowType); this.comparisonFlowFormDirective?.form.updateValueAndValidity(); this.cdr.detectChanges(); }
            });
        }
    } else {
        currentDraggableImagesRef.length = 0;
        currentAnnotationsRef.length = 0;
        this.updateBase64Arrays(flowType);
        this.comparisonFlowFormDirective?.form.updateValueAndValidity();
        this.cdr.detectChanges();
    }
  }

  private updateBase64Arrays(flowType: 'A' | 'B'): void {
    if (flowType === 'A') {
        this.imagesBase64FlowA = this.draggableImagesFlowA.map(di => di.base64);
        this.imageMimeTypesFlowA = this.draggableImagesFlowA.map(di => di.mimeType);
    } else if (flowType === 'B') {
        this.imagesBase64FlowB = this.draggableImagesFlowB.map(di => di.base64);
        this.imageMimeTypesFlowB = this.draggableImagesFlowB.map(di => di.mimeType);
    }
    this.cdr.detectChanges();
  }

  generateIdFromTitle(title: string): string {
    if (!title) return '';
    const prefix = "COMP_";
    const sanitizedTitle = title.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^\w-]+/g, '');
    return `${prefix}${sanitizedTitle.substring(0, 20)}_${Date.now().toString().slice(-4)}`;
  }

  processComparison(): void {
    this.formError = null; this.bugComparisonError = null;
    if (this.isFormInvalid()) {
      this.formError = "Por favor, completa todos los campos requeridos y carga al menos un conjunto de imágenes (Flujo A o Flujo B).";
      if (this.comparisonFlowFormDirective?.form) {
        Object.values(this.comparisonFlowFormDirective.form.controls).forEach(control => {
          if (control.invalid && control.enabled) control.markAsTouched();
        });
      }
      return;
    }

    const finalId = this.generateIdFromTitle(this.currentFlowTitle);
    if (!finalId) { this.formError = "El título es necesario para generar el ID de la comparación."; return; }

    this.loadingBugComparison = true;

    // Prepara el userContext incluyendo las anotaciones
    let contextWithAnnotations = this.userBugComparisonReanalysisContext;
    if (this.annotationsFlowA.length > 0 || this.annotationsFlowB.length > 0) {
      contextWithAnnotations += "\n\n--- ANOTACIONES ADICIONALES ---";
      if (this.annotationsFlowA.length > 0) {
        contextWithAnnotations += "\nFlujo A Anotaciones: " + JSON.stringify(this.annotationsFlowA.map(a => ({ seq: a.sequence, desc: a.description, box: [a.x, a.y, a.width, a.height] })));
      }
      if (this.annotationsFlowB.length > 0) {
        contextWithAnnotations += "\nFlujo B Anotaciones: " + JSON.stringify(this.annotationsFlowB.map(a => ({ seq: a.sequence, desc: a.description, box: [a.x, a.y, a.width, a.height] })));
      }
      contextWithAnnotations += "\n-------------------------------";
    }

    const huDataToEmit: HUData = {
        originalInput: {
          id: finalId, title: this.currentFlowTitle, sprint: this.currentFlowSprint,
          selectedTechnique: '', // Not applicable for pure comparison
          generationMode: 'flowComparison',
          imagesBase64FlowA: [...this.imagesBase64FlowA],
          imageMimeTypesFlowA: [...this.imageMimeTypesFlowA],
          imagesBase64FlowB: [...this.imagesBase64FlowB],
          imageMimeTypesFlowB: [...this.imageMimeTypesFlowB],
          annotationsFlowA: [...this.annotationsFlowA], // Guardar las anotaciones en HUData
          annotationsFlowB: [...this.annotationsFlowB], // Guardar las anotaciones en HUData
        },
        id: finalId.trim(), title: this.currentFlowTitle.trim(), sprint: this.currentFlowSprint.trim(),
        generatedScope: '', detailedTestCases: [], generatedTestCaseTitles: '',
        // Other HUData fields initialized
        editingScope: false, editingScenarios: false, loadingScope: false, errorScope: null,
        loadingScenarios: false, errorScenarios: null, showRegenTechniquePicker: false,
        regenSelectedTechnique: '', userTestCaseReanalysisContext: '', isScopeDetailsOpen: false,
        isScenariosDetailsOpen: false, isEditingDetailedTestCases: false,
        flowAnalysisReport: undefined, loadingFlowAnalysis: false, errorFlowAnalysis: null,
        isFlowAnalysisDetailsOpen: false, isEditingFlowReportDetails: false, userReanalysisContext: '',
        bugComparisonReport: undefined, // This will be filled by the service
        loadingBugComparison: true, // Set for this specific HUData instance too
        errorBugComparison: null,
        isBugComparisonDetailsOpen: true, // Open by default when generated
        userBugComparisonReanalysisContext: contextWithAnnotations, // Pasar el contexto completo
      };
    this.currentHUData = huDataToEmit; // Store for re-analysis

    this.geminiService.compareImageFlows(
      this.imagesBase64FlowA, this.imageMimeTypesFlowA,
      this.imagesBase64FlowB, this.imageMimeTypesFlowB,
      contextWithAnnotations // Pasar el userContext que incluye las anotaciones
    ).pipe(
      tap(report => {
        if (this.currentHUData) {
          this.currentHUData.bugComparisonReport = report;
          this.currentHUData.errorBugComparison = null;
          if (this.isBugReportInErrorState(report)) {
            const firstError = report.find(item => item.titulo_bug.startsWith("Error"));
            this.currentHUData.errorBugComparison = `${firstError?.titulo_bug}: ${firstError?.resultado_actual || 'Detalles no disponibles en el error.'}`;
            this.bugComparisonError = this.currentHUData.errorBugComparison;
          }
        }
      }),
      catchError(error => {
        this.bugComparisonError = (typeof error === 'string' ? error : error.message) || 'Error al generar comparación.';
        if (this.currentHUData) {
            this.currentHUData.errorBugComparison = this.bugComparisonError;
            this.currentHUData.bugComparisonReport = [{ titulo_bug: "Error Crítico en Comparación", id_bug:"ERR-CRIT", prioridad:"Alta", severidad:"Crítica", pasos_para_reproducir: [], resultado_actual: this.bugComparisonError ?? "Error desconocido", resultado_esperado: "Reporte de bugs." } as BugReportItem];
        }
        return of(this.currentHUData?.bugComparisonReport || []);
      }),
      finalize(() => {
        this.loadingBugComparison = false;
        if (this.currentHUData) this.currentHUData.loadingBugComparison = false;
        this.cdr.detectChanges();
        // Emit only if there's no critical error during generation
        if (this.currentHUData && !this.currentHUData.errorBugComparison && this.currentHUData.bugComparisonReport) {
          this.comparisonGenerated.emit({ ...this.currentHUData }); // Emit a copy
        }
         this.resetForm();
      })
    ).subscribe();
  }

  // --- Drag and Drop Logic for Images (A and B) ---
  public onImageDragStart(event: DragEvent, image: DraggableFlowImage, flowType: 'A' | 'B'): void {
    if (flowType === 'A') this.draggedImageFlowA = image;
    else if (flowType === 'B') this.draggedImageFlowB = image;

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', image.id);
      (event.target as HTMLElement).style.opacity = '0.4';
    }
  }

  public onImageDragOver(event: DragEvent, targetImage?: DraggableFlowImage, flowType?: 'A' | 'B'): void {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

    if (flowType === 'A') this.dragOverImageIdFlowA = targetImage ? targetImage.id : null;
    else if (flowType === 'B') this.dragOverImageIdFlowB = targetImage ? targetImage.id : null;
  }

  public onImageDragLeave(event: DragEvent, flowType?: 'A' | 'B'): void {
    if (flowType === 'A') this.dragOverImageIdFlowA = null;
    else if (flowType === 'B') this.dragOverImageIdFlowB = null;
  }

  public onImageDrop(event: DragEvent, targetImage: DraggableFlowImage, flowType: 'A' | 'B'): void {
    event.preventDefault();
    let currentDraggedImage: DraggableFlowImage | null = null;
    let currentDraggableImages: DraggableFlowImage[] = [];

    if (flowType === 'A') { currentDraggedImage = this.draggedImageFlowA; currentDraggableImages = this.draggableImagesFlowA; this.dragOverImageIdFlowA = null; }
    else if (flowType === 'B') { currentDraggedImage = this.draggedImageFlowB; currentDraggableImages = this.draggableImagesFlowB; this.dragOverImageIdFlowB = null; }
    else return;

    const draggedHtmlElement = document.querySelector('.image-preview-item[style*="opacity: 0.4"]');
    if (draggedHtmlElement) (draggedHtmlElement as HTMLElement).style.opacity = '1';

    if (!currentDraggedImage || currentDraggedImage.id === targetImage.id) {
      if (flowType === 'A') this.draggedImageFlowA = null; else if (flowType === 'B') this.draggedImageFlowB = null;
      return;
    }

    const fromIndex = currentDraggableImages.findIndex(img => img.id === currentDraggedImage!.id);
    const toIndex = currentDraggableImages.findIndex(img => img.id === targetImage.id);

    if (fromIndex !== -1 && toIndex !== -1) {
      const itemToMove = currentDraggableImages.splice(fromIndex, 1)[0];
      currentDraggableImages.splice(toIndex, 0, itemToMove);
      this.updateBase64Arrays(flowType);
    }

    if (flowType === 'A') this.draggedImageFlowA = null; else if (flowType === 'B') this.draggedImageFlowB = null;
  }

  public onImageDragEnd(event?: DragEvent, flowType?: 'A' | 'B'): void {
    if (event?.target instanceof HTMLElement) (event.target as HTMLElement).style.opacity = '1';
    else {
      const draggedHtmlElement = document.querySelector('.image-preview-item[style*="opacity: 0.4"]');
      if (draggedHtmlElement) (draggedHtmlElement as HTMLElement).style.opacity = '1';
    }
    if (flowType === 'A') { this.draggedImageFlowA = null; this.dragOverImageIdFlowA = null; }
    else if (flowType === 'B') { this.draggedImageFlowB = null; this.dragOverImageIdFlowB = null; } // CORRECCIÓN
  }

  handleCancelFlowForm() {
    this.resetForm();
    this.cancelComparison.emit();
  }

  isBugReportInErrorState = (r?: BugReportItem[]): boolean =>
    !r || r.length === 0 ? false : r.some(b =>
        b.titulo_bug.startsWith("Error de API") ||
        b.titulo_bug.startsWith("Error de Formato") ||
        b.titulo_bug.startsWith("Error de Parsing JSON") ||
        b.titulo_bug.startsWith("Error Crítico") ||
        b.titulo_bug.startsWith("Error en el Análisis de Imágenes")
    );

  // --- MÉTODOS PARA EL EDITOR DE IMÁGENES ---
  openImageEditor(flowType: 'A' | 'B'): void {
    let images: DraggableFlowImage[] = [];
    if (flowType === 'A') {
      images = this.draggableImagesFlowA;
      this.existingAnnotationsForEditor = [...this.annotationsFlowA];
    } else if (flowType === 'B') {
      images = this.draggableImagesFlowB;
      this.existingAnnotationsForEditor = [...this.annotationsFlowB];
    }

    if (images.length > 0) {
      // Para simplificar, abrimos el editor con la primera imagen cargada.
      // En un caso real, podrías querer un selector de imagen si hay varias.
      this.imageToEditUrl = images[0].preview;
      this.imageToEditFlowType = flowType;
      this.showImageEditor = true;
    } else {
      alert(`No hay imágenes en el Flujo ${flowType} para editar.`);
    }
  }

  onAnnotationsSaved(annotations: ImageAnnotation[]): void {
    if (this.imageToEditFlowType === 'A') {
      this.annotationsFlowA = annotations;
    } else if (this.imageToEditFlowType === 'B') {
      this.annotationsFlowB = annotations;
    }
    this.closeImageEditor();
  }

  closeImageEditor(): void {
    this.showImageEditor = false;
    this.imageToEditUrl = null;
    this.imageToEditFlowType = null;
    this.existingAnnotationsForEditor = [];
  }
}