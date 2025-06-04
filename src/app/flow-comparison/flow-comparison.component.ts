// anbepa/test-plan-app/test-plan-app-114d3b7ac03726fd5931cc480f86ec71001e021a/src/app/flow-comparison/flow-comparison.component.ts
// src/app/flow-comparison/flow-comparison.component.ts
import { Component, OnInit, ViewChild, ElementRef, Inject, PLATFORM_ID, Output, EventEmitter, Input, ChangeDetectorRef } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { HUData, BugReportItem, ImageAnnotation } from '../models/hu-data.model';
import { GeminiService } from '../services/gemini.service';
import { catchError, finalize, tap } from 'rxjs/operators';
import { Observable, of, forkJoin } from 'rxjs';
// import { saveAs } from 'file-saver'; // Not used in this component directly
import { ImageAnnotationEditorComponent, AnnotationEditorOutput } from '../image-annotation-editor/image-annotation-editor.component';

interface DraggableFlowImage {
  file: File;
  preview: string | ArrayBuffer; // Original preview
  base64: string; // Original base64
  mimeType: string;
  id: string; // Unique ID for dnd and map keys
  annotatedPreview?: string | ArrayBuffer; // Annotated preview (data URL)
  annotatedBase64?: string; // Annotated base64 (for sending to Gemini if needed)
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
  imageUploadErrorFlowA: string | null = null;
  annotationsByImageFlowA: Map<string, ImageAnnotation[]> = new Map();

  draggableImagesFlowB: DraggableFlowImage[] = [];
  imageUploadErrorFlowB: string | null = null;
  annotationsByImageFlowB: Map<string, ImageAnnotation[]> = new Map();

  formError: string | null = null;
  currentFlowTitle: string = '';
  currentFlowSprint: string = '';
  userBugComparisonReanalysisContext: string = '';

  loadingBugComparison: boolean = false;
  bugComparisonError: string | null = null;

  private currentHUData: HUData | null = null;

  showImageEditor: boolean = false;
  imageToEditUrl: string | ArrayBuffer | null = null;
  imageToEditFlowType: 'A' | 'B' | null = null;
  existingAnnotationsForEditor: ImageAnnotation[] = [];
  currentImageBeingEdited: DraggableFlowImage | null = null; 

  @ViewChild('comparisonFlowForm') comparisonFlowFormDirective!: NgForm;
  @ViewChild('imageFilesInputFlowA') imageFilesInputFlowARef: ElementRef<HTMLInputElement> | undefined;
  @ViewChild('imageFilesInputFlowB') imageFilesInputFlowBRef: ElementRef<HTMLInputElement> | undefined;

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
    this.draggableImagesFlowA = []; this.imageUploadErrorFlowA = null; this.annotationsByImageFlowA.clear();
    this.draggableImagesFlowB = []; this.imageUploadErrorFlowB = null; this.annotationsByImageFlowB.clear();
    
    const keptSprint = this.currentFlowSprint;
    this.currentFlowTitle = '';
    this.userBugComparisonReanalysisContext = '';
    this.currentHUData = null;
    this.loadingBugComparison = false;
    this.bugComparisonError = null;

    this.closeImageEditor(); 

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
    return !this.currentFlowSprint || !this.currentFlowTitle ||
           (this.draggableImagesFlowA.length === 0 && this.draggableImagesFlowB.length === 0) || // At least one flow must have images
           (this.draggableImagesFlowB.length === 0); // Flow B is now mandatory
  }
  
  private getMimeTypeFromDataUrl(dataUrl: string): string {
    const match = dataUrl.match(/^data:(.*?);base64,/);
    return match ? match[1] : 'image/png'; // Fallback
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
    let currentAnnotationsMapRef!: Map<string, ImageAnnotation[]>;
    let currentUploadErrorProp!: 'imageUploadErrorFlowA' | 'imageUploadErrorFlowB';
    const maxImages = 10;

    if (flowType === 'A') {
        currentDraggableImagesRef = this.draggableImagesFlowA;
        currentAnnotationsMapRef = this.annotationsByImageFlowA;
        this.imageUploadErrorFlowA = null; currentUploadErrorProp = 'imageUploadErrorFlowA';
    } else if (flowType === 'B') {
        currentDraggableImagesRef = this.draggableImagesFlowB;
        currentAnnotationsMapRef = this.annotationsByImageFlowB;
        this.imageUploadErrorFlowB = null; currentUploadErrorProp = 'imageUploadErrorFlowB';
    } else return;

    this.formError = null;
    currentDraggableImagesRef.length = 0; 
    currentAnnotationsMapRef.clear(); 

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
                element.value = ""; currentDraggableImagesRef.length = 0; currentAnnotationsMapRef.clear(); this.cdr.detectChanges(); return;
            }

            const readerObservable = new Observable<DraggableFlowImage>(observer => {
                const reader = new FileReader();
                reader.onload = () => {
                    const newImageId = flowType + '_' + file.name + '_' + Date.now() + Math.random().toString(16).slice(2);
                    observer.next({ file, preview: reader.result!, base64: (reader.result as string).split(',')[1], mimeType: file.type, id: newImageId });
                    observer.complete();
                };
                reader.onerror = error => { this[currentUploadErrorProp] = `Error al leer "${file.name}".`; observer.error(error); };
                reader.readAsDataURL(file);
            });
            fileProcessingObservables.push(readerObservable);
        }
        if (validationErrorFound) { currentDraggableImagesRef.length = 0; currentAnnotationsMapRef.clear(); this.cdr.detectChanges(); return; }

        if (fileProcessingObservables.length > 0) {
            forkJoin(fileProcessingObservables).subscribe({
                next: (processedImages) => {
                    processedImages.forEach(img => {
                        currentDraggableImagesRef.push(img);
                        currentAnnotationsMapRef.set(img.id, []); 
                    });
                },
                complete: () => { this.comparisonFlowFormDirective?.form.updateValueAndValidity(); this.cdr.detectChanges(); },
                error: () => { element.value = ""; currentDraggableImagesRef.length = 0; currentAnnotationsMapRef.clear(); this.comparisonFlowFormDirective?.form.updateValueAndValidity(); this.cdr.detectChanges(); }
            });
        }
    } else {
        currentDraggableImagesRef.length = 0;
        currentAnnotationsMapRef.clear();
        this.comparisonFlowFormDirective?.form.updateValueAndValidity();
        this.cdr.detectChanges();
    }
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
      this.formError = "Por favor, completa todos los campos requeridos y carga imágenes para el Flujo B (el Flujo A es opcional).";
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

    let contextWithAnnotations = this.userBugComparisonReanalysisContext || '';
    const allAnnotationsFlowA: ImageAnnotation[] = [];
    this.draggableImagesFlowA.forEach((imgItem, imgIndex) => {
        const annotations = this.annotationsByImageFlowA.get(imgItem.id);
        if (annotations && annotations.length > 0) {
            annotations.forEach(ann => {
                allAnnotationsFlowA.push({
                    ...ann, // sequence, description, x, y, width, height
                    imageFilename: imgItem.file.name, 
                    flowType: 'A',
                    imageIndex: imgIndex + 1
                });
            });
        }
    });
    if (allAnnotationsFlowA.length > 0) {
        contextWithAnnotations += "\n\n--- ANOTACIONES FLUJO A ---";
        contextWithAnnotations += "\n" + JSON.stringify(allAnnotationsFlowA.map(a => ({
            imagen: `A.${a.imageIndex} (${a.imageFilename})`,
            seq: a.sequence, desc: a.description, box: [a.x, a.y, a.width, a.height]
        })));
    }

    const allAnnotationsFlowB: ImageAnnotation[] = [];
    this.draggableImagesFlowB.forEach((imgItem, imgIndex) => {
        const annotations = this.annotationsByImageFlowB.get(imgItem.id);
        if (annotations && annotations.length > 0) {
             annotations.forEach(ann => {
                allAnnotationsFlowB.push({
                    ...ann,
                    imageFilename: imgItem.file.name,
                    flowType: 'B',
                    imageIndex: imgIndex + 1
                });
            });
        }
    });
     if (allAnnotationsFlowB.length > 0) {
        contextWithAnnotations += "\n\n--- ANOTACIONES FLUJO B ---";
        contextWithAnnotations += "\n" + JSON.stringify(allAnnotationsFlowB.map(a => ({
            imagen: `B.${a.imageIndex} (${a.imageFilename})`,
            seq: a.sequence, desc: a.description, box: [a.x, a.y, a.width, a.height]
        })));
    }
     if (allAnnotationsFlowA.length > 0 || allAnnotationsFlowB.length > 0) {
      contextWithAnnotations += "\n-------------------------------";
     }

    const huDataToEmit: HUData = {
        originalInput: {
          id: finalId, title: this.currentFlowTitle, sprint: this.currentFlowSprint,
          selectedTechnique: '', generationMode: 'flowComparison',
          imagesBase64FlowA: this.draggableImagesFlowA.map(img => img.annotatedBase64 || img.base64),
          imageMimeTypesFlowA: this.draggableImagesFlowA.map(img => img.annotatedPreview ? this.getMimeTypeFromDataUrl(img.annotatedPreview as string) : img.mimeType),
          imageFilenamesFlowA: this.draggableImagesFlowA.map(img => img.file.name),
          annotationsFlowA: allAnnotationsFlowA, // Store the processed, flat list
          imagesBase64FlowB: this.draggableImagesFlowB.map(img => img.annotatedBase64 || img.base64),
          imageMimeTypesFlowB: this.draggableImagesFlowB.map(img => img.annotatedPreview ? this.getMimeTypeFromDataUrl(img.annotatedPreview as string) : img.mimeType),
          imageFilenamesFlowB: this.draggableImagesFlowB.map(img => img.file.name),
          annotationsFlowB: allAnnotationsFlowB, // Store the processed, flat list
        },
        id: finalId.trim(), title: this.currentFlowTitle.trim(), sprint: this.currentFlowSprint.trim(),
        generatedScope: '', detailedTestCases: [], generatedTestCaseTitles: '',
        editingScope: false, loadingScope: false, errorScope: null, isScopeDetailsOpen: false,
        editingScenarios: false, loadingScenarios: false, errorScenarios: null, showRegenTechniquePicker: false,
        regenSelectedTechnique: '', userTestCaseReanalysisContext: '', isScenariosDetailsOpen: false,
        isEditingDetailedTestCases: false, 
        flowAnalysisReport: undefined, loadingFlowAnalysis: false, errorFlowAnalysis: null,
        isFlowAnalysisDetailsOpen: false, isEditingFlowReportDetails: false, userReanalysisContext: '',
        bugComparisonReport: undefined, 
        loadingBugComparison: true, 
        errorBugComparison: null,
        isBugComparisonDetailsOpen: true, 
        userBugComparisonReanalysisContext: contextWithAnnotations,
      };
    this.currentHUData = huDataToEmit;

    this.geminiService.compareImageFlows(
      huDataToEmit.originalInput.imagesBase64FlowA!, huDataToEmit.originalInput.imageMimeTypesFlowA!,
      huDataToEmit.originalInput.imagesBase64FlowB!, huDataToEmit.originalInput.imageMimeTypesFlowB!,
      contextWithAnnotations
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
        if (this.currentHUData && !this.currentHUData.errorBugComparison && this.currentHUData.bugComparisonReport) {
          this.comparisonGenerated.emit({ ...this.currentHUData }); 
        }
         this.resetForm(); 
      })
    ).subscribe();
  }

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
      }
  
      if (flowType === 'A') this.draggedImageFlowA = null; else if (flowType === 'B') this.draggedImageFlowB = null;
      this.cdr.detectChanges();
    }
  public onImageDragEnd(event?: DragEvent, flowType?: 'A' | 'B'): void {
    if (event?.target instanceof HTMLElement) (event.target as HTMLElement).style.opacity = '1';
    else {
      const draggedHtmlElement = document.querySelector('.image-preview-item[style*="opacity: 0.4"]');
      if (draggedHtmlElement) (draggedHtmlElement as HTMLElement).style.opacity = '1';
    }
    if (flowType === 'A') { this.draggedImageFlowA = null; this.dragOverImageIdFlowA = null; }
    else if (flowType === 'B') { this.draggedImageFlowB = null; this.dragOverImageIdFlowB = null; }
  }
  
  handleCancelFlowForm() { this.resetForm(); this.cancelComparison.emit(); }
  
  isBugReportInErrorState = (r?: BugReportItem[]): boolean => 
    !r || r.length === 0 ? false : r.some(b => 
        b.titulo_bug.startsWith("Error de API") ||
        b.titulo_bug.startsWith("Error de Formato") ||
        b.titulo_bug.startsWith("Error de Parsing JSON") ||
        b.titulo_bug.startsWith("Error Crítico") ||
        b.titulo_bug.startsWith("Error en Análisis de Imágenes") ||
        b.titulo_bug.startsWith("Error en el Análisis de Imágenes") 
    );

  openImageEditorForSpecificImage(imageItem: DraggableFlowImage, flowType: 'A' | 'B'): void {
    this.currentImageBeingEdited = imageItem;
    this.imageToEditUrl = imageItem.annotatedPreview || imageItem.preview;
    this.imageToEditFlowType = flowType;

    const currentMap = flowType === 'A' ? this.annotationsByImageFlowA : this.annotationsByImageFlowB;
    const annotations = currentMap.get(imageItem.id) || [];
    this.existingAnnotationsForEditor = JSON.parse(JSON.stringify(annotations)); 
    
    this.showImageEditor = true;
    this.cdr.detectChanges();
  }

  onAnnotationsApplied(output: AnnotationEditorOutput): void {
    if (this.currentImageBeingEdited && this.imageToEditFlowType) {
      const targetMap = this.imageToEditFlowType === 'A' ? this.annotationsByImageFlowA : this.annotationsByImageFlowB;
      
      const imageArrayIndex = (this.imageToEditFlowType === 'A' ? this.draggableImagesFlowA : this.draggableImagesFlowB)
        .findIndex(img => img.id === this.currentImageBeingEdited!.id);

      const updatedAnnotations = output.annotations.map(ann => ({
          ...ann,
          imageFilename: this.currentImageBeingEdited!.file.name,
          flowType: this.imageToEditFlowType === null ? undefined : this.imageToEditFlowType, // Corrected assignment
          imageIndex: imageArrayIndex + 1 
      }));

      targetMap.set(this.currentImageBeingEdited.id, updatedAnnotations);
      
      if (output.annotatedImageDataUrl) {
          this.currentImageBeingEdited.annotatedPreview = output.annotatedImageDataUrl;
          this.currentImageBeingEdited.annotatedBase64 = output.annotatedImageDataUrl.split(',')[1];
      }
    }
    this.closeImageEditor();
  }

  closeImageEditor(): void {
    this.showImageEditor = false;
    this.imageToEditUrl = null;
    this.imageToEditFlowType = null;
    this.existingAnnotationsForEditor = [];
    this.currentImageBeingEdited = null;
    this.cdr.detectChanges();
  }
}