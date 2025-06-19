// src/app/flow-analysis/flow-analysis.component.ts
import { Component, OnInit, ViewChild, ElementRef, Inject, PLATFORM_ID, Output, EventEmitter, Input, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ImageAnnotationEditorComponent, AnnotationEditorOutput } from '../image-annotation-editor/image-annotation-editor.component';
import { HUData, FlowAnalysisReportItem, FlowAnalysisStep, ImageAnnotation } from '../models/hu-data.model';
import { GeminiService } from '../services/gemini.service';
import { catchError, finalize, tap } from 'rxjs/operators';
import { Observable, of, Subscription, forkJoin } from 'rxjs';
import { saveAs } from 'file-saver';

interface DraggableFlowImage {
  file: File;
  preview: string | ArrayBuffer;
  base64: string;
  mimeType: string;
  id: string;
  annotations?: ImageAnnotation[]; 
  annotatedPreview?: string | ArrayBuffer; 
  annotatedBase64?: string; 
}

type ComponentState = 'form' | 'displayingReport'; 

@Component({
  selector: 'app-flow-analysis',
  standalone: true,
  imports: [FormsModule, CommonModule, ImageAnnotationEditorComponent],
  templateUrl: './flow-analysis.component.html',
  styleUrls: ['./flow-analysis.component.css']
})
export class FlowAnalysisComponent implements OnInit, OnDestroy {
  @Input() initialSprint: string = '';
  @Output() analysisGenerated = new EventEmitter<HUData>();
  @Output() cancelAnalysis = new EventEmitter<void>();

  componentState: ComponentState = 'form';
  isSubmitting: boolean = false;
  generatedAnalysisData: HUData | null = null;

  draggableImages: DraggableFlowImage[] = [];
  imageUploadError: string | null = null;
  annotationsByImage: Map<string, ImageAnnotation[]> = new Map();

  formError: string | null = null;
  currentFlowTitle: string = '';
  currentFlowSprint: string = '';

  loadingFlowAnalysis: boolean = false;
  flowAnalysisError: string | null = null;

  draggedImage: DraggableFlowImage | null = null;
  dragOverImageId: string | null = null;

  isEditingFlowReportDetails: boolean = false;
  userReanalysisContext: string = ''; 
  draggedFlowStep: FlowAnalysisStep | null = null;
  dragOverFlowStepId: string | null = null;

  showImageEditor: boolean = false;
  imageToEditUrl: string | ArrayBuffer | null = null;
  existingAnnotationsForEditor: ImageAnnotation[] = [];
  currentImageBeingEditedId: string | null = null;

  @ViewChild('flowAnalysisForm') flowAnalysisFormDirective!: NgForm;
  private formStatusSubscription!: Subscription;
  @ViewChild('flowAnalysisImageInput') flowAnalysisImageInputRef: ElementRef<HTMLInputElement> | undefined;

  constructor(
    private geminiService: GeminiService,
    @Inject(PLATFORM_ID) private platformId: Object,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.currentFlowSprint = this.initialSprint || 'Sprint Actual';
    this.resetToForm();
  }
  
  ngOnDestroy(): void {
    if (this.formStatusSubscription) {
      this.formStatusSubscription.unsubscribe();
    }
  }

  get imageBeingEditedObject(): DraggableFlowImage | null {
    if (!this.currentImageBeingEditedId) return null;
    return this.draggableImages.find(img => img.id === this.currentImageBeingEditedId) || null;
  }

  resetToForm(): void {
    this.componentState = 'form';
    this.isSubmitting = false;
    this.generatedAnalysisData = null;
    this.formError = null;
    this.draggableImages = [];
    this.annotationsByImage.clear(); 
    this.imageUploadError = null;
    const keptSprint = this.currentFlowSprint || this.initialSprint;
    this.currentFlowTitle = '';
    this.loadingFlowAnalysis = false;
    this.flowAnalysisError = null;
    this.isEditingFlowReportDetails = false;
    this.userReanalysisContext = '';
    this.closeImageEditor();

    if (isPlatformBrowser(this.platformId) && this.flowAnalysisImageInputRef?.nativeElement) {
      this.flowAnalysisImageInputRef.nativeElement.value = '';
    }
    if (this.flowAnalysisFormDirective) {
      this.flowAnalysisFormDirective.resetForm({ currentFlowSprint: keptSprint, currentFlowTitle: '' });
    }
    this.currentFlowSprint = keptSprint;
    setTimeout(() => {
      if (this.flowAnalysisFormDirective?.form) {
        this.flowAnalysisFormDirective.form.markAsPristine();
        this.flowAnalysisFormDirective.form.markAsUntouched();
        this.flowAnalysisFormDirective.form.updateValueAndValidity();
      }
      this.cdr.detectChanges();
    }, 0);
  }

  isFormInvalid(): boolean {
    if (!this.flowAnalysisFormDirective || !this.flowAnalysisFormDirective.form) return true;
    return !this.currentFlowSprint || !this.currentFlowTitle || this.draggableImages.length === 0;
  }

  private parseFileNameForSorting(fileName: string): { main: number, sub: number } {
      const nameWithoutExtension = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
      const parts = nameWithoutExtension.split(/[^0-9]+/g).filter(Boolean).map(p => parseInt(p, 10));
      return { main: parts.length > 0 && !isNaN(parts[0]) ? parts[0] : Infinity, sub: parts.length > 1 && !isNaN(parts[1]) ? parts[1] : (parts.length > 0 && !isNaN(parts[0]) ? 0 : Infinity) };
  }

  onFileSelected(event: Event): void {
    this.imageUploadError = null; this.formError = null; 
    this.draggableImages.length = 0; this.annotationsByImage.clear();
    const maxImages = 20;
    const element = event.currentTarget as HTMLInputElement;
    const fileList: FileList | null = element.files;

    if (fileList?.length) {
        if (fileList.length > maxImages) { this.imageUploadError = `Máximo ${maxImages} imágenes.`; element.value = ""; return; }
        let filesArray = Array.from(fileList).sort((a,b) => { 
            const pA = this.parseFileNameForSorting(a.name); const pB = this.parseFileNameForSorting(b.name);
            return pA.main !== pB.main ? pA.main - pB.main : pA.sub - pB.sub;
        });
        const fileProcessingObservables: Observable<DraggableFlowImage>[] = [];
        let validationErrorFound = false;
        for (const file of filesArray) {
            if (validationErrorFound) continue; 
            if (file.size > 4 * 1024 * 1024) { this.imageUploadError = `"${file.name}" excede 4MB.`; validationErrorFound = true; }
            if (!['image/jpeg', 'image/png'].includes(file.type) && !validationErrorFound) { this.imageUploadError = `Formato inválido: "${file.name}".`; validationErrorFound = true; }
            if (validationErrorFound) { element.value = ""; this.draggableImages = []; this.annotationsByImage.clear(); this.cdr.detectChanges(); return; }
            
            const readerObservable = new Observable<DraggableFlowImage>(observer => {
                const reader = new FileReader();
                const newImageId = 'FLOW_IMG_' + file.name + '_' + Date.now() + Math.random().toString(16).slice(2);
                reader.onload = () => { 
                    observer.next({ file, preview: reader.result!, base64: (reader.result as string).split(',')[1], mimeType: file.type, id: newImageId, annotations: [] }); 
                    observer.complete(); 
                };
                reader.onerror = error => { this.imageUploadError = `Error al leer "${file.name}".`; observer.error(error); };
                reader.readAsDataURL(file);
            });
            fileProcessingObservables.push(readerObservable);
        }
        if (validationErrorFound) { this.draggableImages = []; this.annotationsByImage.clear(); this.cdr.detectChanges(); return; }
        if (fileProcessingObservables.length > 0) {
            forkJoin(fileProcessingObservables).subscribe({
                next: (processedImages) => { 
                    processedImages.forEach(img => {
                        this.draggableImages.push(img);
                        this.annotationsByImage.set(img.id, []);
                    });
                },
                error: () => { element.value = ""; this.draggableImages = []; this.annotationsByImage.clear(); },
                complete: () => { this.flowAnalysisFormDirective?.form.updateValueAndValidity(); this.cdr.detectChanges(); }
            });
        }
    } else { this.draggableImages = []; this.annotationsByImage.clear(); this.flowAnalysisFormDirective?.form.updateValueAndValidity(); this.cdr.detectChanges(); }
  }
  
  private getMimeTypeFromDataUrl(dataUrl: string): string { const match = dataUrl.match(/^data:(.*?);base64,/); return match ? match[1] : 'image/png'; }
  onImageDragStart(event: DragEvent, image: DraggableFlowImage): void { this.draggedImage = image; if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', image.id); (event.target as HTMLElement).style.opacity = '0.4'; } }
  onImageDragOver(event: DragEvent, targetImage?: DraggableFlowImage): void { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'; this.dragOverImageId = targetImage ? targetImage.id : null; }
  onImageDragLeave(event: DragEvent): void { this.dragOverImageId = null; }
  onImageDrop(event: DragEvent, targetImage: DraggableFlowImage): void { event.preventDefault(); this.dragOverImageId = null; const dEl = document.querySelector<HTMLElement>('.image-preview-item[style*="opacity: 0.4"]'); if (dEl) dEl.style.opacity = '1'; if (!this.draggedImage || this.draggedImage.id === targetImage.id) { this.draggedImage = null; return; } const fromI = this.draggableImages.findIndex(i => i.id === this.draggedImage!.id), toI = this.draggableImages.findIndex(i => i.id === targetImage.id); if (fromI!==-1 && toI!==-1) { const item = this.draggableImages.splice(fromI,1)[0]; this.draggableImages.splice(toI,0,item); } this.draggedImage = null; this.cdr.detectChanges(); }
  onImageDragEnd(event?: DragEvent): void { if (event?.target instanceof HTMLElement) (event.target as HTMLElement).style.opacity = '1'; else { const dEl = document.querySelector<HTMLElement>('.image-preview-item[style*="opacity: 0.4"]'); if (dEl) dEl.style.opacity = '1'; } this.draggedImage = null; this.dragOverImageId = null; }
  
  generateIdFromTitle(title: string): string {
    if (!title) return '';
    const prefix = "FLOW_";
    const sanitizedTitle = title.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^\w-]+/g, '');
    return `${prefix}${sanitizedTitle.substring(0, 20)}_${Date.now().toString().slice(-4)}`;
  }

  processFlowAnalysis(): void {
    this.formError = null; this.flowAnalysisError = null;
    if (this.isFormInvalid()) {
      this.formError = "Por favor, completa todos los campos requeridos (Título, Sprint) y carga imágenes.";
      if (this.draggableImages.length === 0) this.formError = "Por favor, selecciona al menos una imagen para el análisis.";
      if (this.flowAnalysisFormDirective?.form) Object.values(this.flowAnalysisFormDirective.form.controls).forEach(c => { if (c.invalid && c.enabled) c.markAsTouched();});
      return;
    }
    const finalId = this.generateIdFromTitle(this.currentFlowTitle);
    if (!finalId) { this.formError = "El título es necesario para generar el ID del flujo."; return; }

    // MEJORA: Construcción del contexto de anotaciones enriquecido
    let annotationsContextString = '';
    let allAnnotationsForHU: ImageAnnotation[] = [];
    this.draggableImages.forEach((imgItem, index) => {
      const annotations = this.annotationsByImage.get(imgItem.id);
      if (annotations && annotations.length > 0) {
        annotationsContextString += `Para Imagen ${index + 1} (${imgItem.file.name}):\n`;
        annotations.forEach(ann => {
          annotationsContextString += `  - Anotación #${ann.sequence} ('${ann.description}') en coordenadas normalizadas (x:${ann.x.toFixed(2)}, y:${ann.y.toFixed(2)}, w:${ann.width.toFixed(2)}, h:${ann.height.toFixed(2)}).\n`;
          // Añadimos la información enriquecida si existe
          if (ann.elementType) {
            annotationsContextString += `    - Tipo de Elemento: '${ann.elementType}'\n`;
          }
          if (ann.elementValue) {
            annotationsContextString += `    - Valor/Texto Asociado: '${ann.elementValue}'\n`;
          }
          allAnnotationsForHU.push({ ...ann, imageFilename: imgItem.file.name, imageIndex: index + 1 });
        });
      }
    });

    if(annotationsContextString) {
        annotationsContextString = "INFORMACIÓN DE ANOTACIONES PROPORCIONADA POR EL USUARIO (priorizar para el análisis):\n" + annotationsContextString;
    }

    const imagesBase64ForService = this.draggableImages.map(img => img.annotatedBase64 || img.base64);
    const imageMimeTypesForService = this.draggableImages.map(img => img.annotatedPreview ? this.getMimeTypeFromDataUrl(img.annotatedPreview as string) : img.mimeType);

    const huData: HUData = {
      originalInput: {
        id: finalId, title: this.currentFlowTitle, sprint: this.currentFlowSprint,
        selectedTechnique: '', generationMode: 'flowAnalysis',
        imagesBase64: imagesBase64ForService, imageMimeTypes: imageMimeTypesForService,
        imageFilenames: this.draggableImages.map(img => img.file.name),
        annotationsFlowA: allAnnotationsForHU,
      },
      id: finalId.trim(), title: this.currentFlowTitle.trim(), sprint: this.currentFlowSprint.trim(),
      generatedScope: '', detailedTestCases: [], generatedTestCaseTitles: '',
      editingScope: false, loadingScope: false, errorScope: null, isScopeDetailsOpen: false,
      editingScenarios: false, loadingScenarios: false, errorScenarios: null, 
      showRegenTechniquePicker: false, regenSelectedTechnique: '', userTestCaseReanalysisContext: '',
      isScenariosDetailsOpen: false, isEditingDetailedTestCases: false,
      flowAnalysisReport: undefined, loadingFlowAnalysis: true, errorFlowAnalysis: null,
      isFlowAnalysisDetailsOpen: true, isEditingFlowReportDetails: false, 
      userReanalysisContext: annotationsContextString.trim(), 
      bugComparisonReport: undefined, loadingBugComparison: false, errorBugComparison: null,
      isBugComparisonDetailsOpen: false, userBugComparisonReanalysisContext: ''
    };

    this.loadingFlowAnalysis = true;
    this.geminiService.generateFlowAnalysisFromImages(
        huData.originalInput.imagesBase64!, 
        huData.originalInput.imageMimeTypes!,
        annotationsContextString.trim() 
    ).pipe(
        tap(report => {
            huData.flowAnalysisReport = report;
            huData.errorFlowAnalysis = null;
            if (this.isFlowAnalysisReportInErrorState(report?.[0])) {
                huData.errorFlowAnalysis = `${report[0].Nombre_del_Escenario}: ${report[0].Pasos_Analizados?.[0]?.descripcion_accion_observada || 'Detalles no disponibles.'}`;
            }
        }),
        catchError(error => {
            huData.errorFlowAnalysis = (typeof error === 'string' ? error : error.message) || 'Error al generar análisis de flujo.';
            huData.flowAnalysisReport = [{ Nombre_del_Escenario: "Error Crítico en Generación", Pasos_Analizados: [{ numero_paso: 1, descripcion_accion_observada: huData.errorFlowAnalysis!, imagen_referencia_entrada: "N/A", elemento_clave_y_ubicacion_aproximada: "N/A", dato_de_entrada_paso:"N/A", resultado_esperado_paso: "N/A", resultado_obtenido_paso_y_estado: "Análisis fallido."}], Resultado_Esperado_General_Flujo: "N/A", Conclusion_General_Flujo: "El análisis de flujo no pudo completarse." }];
            return of(huData.flowAnalysisReport);
        }),
        finalize(() => {
            huData.loadingFlowAnalysis = false;
            this.loadingFlowAnalysis = false;
            this.generatedAnalysisData = huData;
            if (huData.errorFlowAnalysis) {
                this.flowAnalysisError = huData.errorFlowAnalysis;
                this.componentState = 'form';
            } else {
                this.flowAnalysisError = null;
                this.componentState = 'displayingReport';
            }
            this.cdr.detectChanges();
        })
    ).subscribe();
  }

  handleCancelFlowForm() {
    this.resetToForm(); 
    this.cancelAnalysis.emit(); 
  }

  openImageEditorFor(imageItem: DraggableFlowImage): void {
    this.currentImageBeingEditedId = imageItem.id;
    this.imageToEditUrl = imageItem.annotatedPreview || imageItem.preview;
    const annotations = this.annotationsByImage.get(imageItem.id) || [];
    this.existingAnnotationsForEditor = JSON.parse(JSON.stringify(annotations));
    this.showImageEditor = true;
    this.cdr.detectChanges();
  }

  onAnnotationsApplied(output: AnnotationEditorOutput): void {
    if (this.currentImageBeingEditedId) {
        const imageToUpdate = this.draggableImages.find(img => img.id === this.currentImageBeingEditedId);
        if (imageToUpdate) {
            const imageIndexInDraggableArray = this.draggableImages.indexOf(imageToUpdate);
            const updatedAnnotations = output.annotations.map(ann => ({
                ...ann,
                imageFilename: imageToUpdate.file.name,
                imageIndex: imageIndexInDraggableArray + 1
            }));
            this.annotationsByImage.set(imageToUpdate.id, updatedAnnotations);
            imageToUpdate.annotations = updatedAnnotations;
            if (output.annotatedImageDataUrl) {
                imageToUpdate.annotatedPreview = output.annotatedImageDataUrl;
                imageToUpdate.annotatedBase64 = output.annotatedImageDataUrl.split(',')[1];
            } else {
                imageToUpdate.annotatedPreview = undefined; 
                imageToUpdate.annotatedBase64 = undefined;
            }
            this.cdr.detectChanges();
        }
    }
    this.closeImageEditor();
  }

  closeImageEditor(): void {
    this.showImageEditor = false;
    this.imageToEditUrl = null;
    this.existingAnnotationsForEditor = [];
    this.currentImageBeingEditedId = null;
    this.cdr.detectChanges();
  }

  regenerateFlowAnalysis(): void {
    if (!this.generatedAnalysisData || !this.generatedAnalysisData.originalInput.imagesBase64?.length || !this.generatedAnalysisData.flowAnalysisReport?.length) {
        alert("Solo se puede re-analizar un flujo con imágenes y un informe previo."); return;
    }
    this.loadingFlowAnalysis = true; this.flowAnalysisError = null;
    if(this.generatedAnalysisData) {
        this.generatedAnalysisData.loadingFlowAnalysis = true; 
        this.generatedAnalysisData.errorFlowAnalysis = null;
    }
    
    let contextForRefinement = '';
    const originalAnnotations = this.generatedAnalysisData.originalInput.annotationsFlowA;
    if (originalAnnotations && originalAnnotations.length > 0) {
        contextForRefinement += "INFORMACIÓN DE ANOTACIONES PROPORCIONADA POR EL USUARIO (para análisis inicial):\n";
        originalAnnotations.forEach(ann => {
             contextForRefinement += `Para Imagen ${ann.imageIndex} (${ann.imageFilename}):\n  - Anotación #${ann.sequence} ('${ann.description}') en coords (x:${ann.x.toFixed(2)}, y:${ann.y.toFixed(2)}, w:${ann.width.toFixed(2)}, h:${ann.height.toFixed(2)}).\n`;
             if (ann.elementType) {
                contextForRefinement += `    - Tipo de Elemento: '${ann.elementType}'\n`;
             }
             if (ann.elementValue) {
                contextForRefinement += `    - Valor/Texto Asociado: '${ann.elementValue}'\n`;
             }
        });
    }
    if (this.userReanalysisContext.trim()) {
        contextForRefinement += (contextForRefinement ? "\n\n" : "") + "CONTEXTO ADICIONAL TEXTUAL PARA RE-ANÁLISIS DEL INFORME:\n" + this.userReanalysisContext.trim();
    }
    this.generatedAnalysisData.userReanalysisContext = contextForRefinement.trim();

    this.geminiService.refineFlowAnalysisFromImagesAndContext(
        this.generatedAnalysisData.originalInput.imagesBase64!, 
        this.generatedAnalysisData.originalInput.imageMimeTypes!, 
        this.generatedAnalysisData.flowAnalysisReport[0], 
        this.generatedAnalysisData.userReanalysisContext
    ).pipe(
        tap(report => {
            if (this.generatedAnalysisData) {
              this.generatedAnalysisData.flowAnalysisReport = report; 
              this.generatedAnalysisData.errorFlowAnalysis = null;
              if (this.isFlowAnalysisReportInErrorState(report?.[0])) {
                  this.generatedAnalysisData.errorFlowAnalysis = `${report[0].Nombre_del_Escenario}: ${report[0].Pasos_Analizados?.[0]?.descripcion_accion_observada || 'Detalles no disponibles.'}`;
                  this.flowAnalysisError = this.generatedAnalysisData.errorFlowAnalysis;
              } else {
                this.flowAnalysisError = null;
              }
              this.isEditingFlowReportDetails = false;
            }
        }),
        catchError(error => {
            const errorMsg = (typeof error === 'string' ? error : error.message) || 'Error al re-generar análisis.';
            this.flowAnalysisError = errorMsg;
            if(this.generatedAnalysisData) {
              this.generatedAnalysisData.errorFlowAnalysis = errorMsg;
              this.generatedAnalysisData.flowAnalysisReport = this.generatedAnalysisData.flowAnalysisReport || [{ Nombre_del_Escenario: "Error Crítico en Re-Generación", Pasos_Analizados: [{ numero_paso: 1, descripcion_accion_observada: errorMsg, imagen_referencia_entrada: "N/A", elemento_clave_y_ubicacion_aproximada: "N/A", dato_de_entrada_paso:"N/A", resultado_esperado_paso: "N/A", resultado_obtenido_paso_y_estado: "Análisis fallido."}], Resultado_Esperado_General_Flujo: "N/A", Conclusion_General_Flujo: "Re-análisis fallido." }];
            }
            return of(this.generatedAnalysisData?.flowAnalysisReport || []);
        }),
        finalize(() => { 
          this.loadingFlowAnalysis = false; 
          if(this.generatedAnalysisData) this.generatedAnalysisData.loadingFlowAnalysis = false;
          this.cdr.detectChanges(); 
        })
    ).subscribe();
  }
  
  toggleEditFlowReportDetails(): void {
    if(this.generatedAnalysisData) {
        this.isEditingFlowReportDetails = !this.isEditingFlowReportDetails;
        if (!this.isEditingFlowReportDetails && this.generatedAnalysisData.flowAnalysisReport?.[0]?.Pasos_Analizados) {
            this.generatedAnalysisData.flowAnalysisReport[0].Pasos_Analizados.forEach((paso, index) => {
                paso.numero_paso = index + 1;
            });
        }
        this.cdr.detectChanges();
    }
  }

  deleteFlowAnalysisStep(reportIndex: number, stepIndex: number): void {
    if (this.generatedAnalysisData?.flowAnalysisReport?.[reportIndex]?.Pasos_Analizados) {
        this.generatedAnalysisData.flowAnalysisReport[reportIndex].Pasos_Analizados.splice(stepIndex, 1);
        this.generatedAnalysisData.flowAnalysisReport[reportIndex].Pasos_Analizados.forEach((paso, idx) => {
            paso.numero_paso = idx + 1;
        });
        this.cdr.detectChanges();
    }
  }

  addFlowAnalysisStep(reportIndex: number): void {
    if (this.generatedAnalysisData?.flowAnalysisReport?.[reportIndex]?.Pasos_Analizados) {
        const newStep: FlowAnalysisStep = {
            numero_paso: this.generatedAnalysisData.flowAnalysisReport[reportIndex].Pasos_Analizados.length + 1,
            descripcion_accion_observada: '',
            imagen_referencia_entrada: 'Nueva', 
            elemento_clave_y_ubicacion_aproximada: '',
            dato_de_entrada_paso: '',
            resultado_esperado_paso: '',
            resultado_obtenido_paso_y_estado: ''
        };
        this.generatedAnalysisData.flowAnalysisReport[reportIndex].Pasos_Analizados.push(newStep);
        this.cdr.detectChanges();
    }
  }
  
  getFlowStepDragId(paso: FlowAnalysisStep, hu: HUData | null): string {
    if (!hu) return `flow-step-${paso.numero_paso}-${Math.random().toString(16).slice(2,8)}`;
    const report = hu.flowAnalysisReport?.[0];
    if (report && report.Pasos_Analizados) {
        const stepIndex = report.Pasos_Analizados.indexOf(paso);
        if (stepIndex !== -1) {
            return `flow-${hu.id}-step-${stepIndex}`;
        }
    }
    return `flow-step-${paso.numero_paso}-${Math.random().toString(16).slice(2,8)}`;
  }

  onFlowStepDragStart(event: DragEvent, paso: FlowAnalysisStep, hu: HUData | null): void {
    if (!hu || this.isEditingFlowReportDetails) { event.preventDefault(); return; } 
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

  onFlowStepDragOver(event: DragEvent, targetPaso: FlowAnalysisStep | undefined, hu: HUData | null): void {
    event.preventDefault();
     if (this.draggedFlowStep && event.dataTransfer && targetPaso && hu) {
        event.dataTransfer.dropEffect = 'move';
        this.dragOverFlowStepId = this.getFlowStepDragId(targetPaso, hu);
     } else if (!targetPaso && event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
        this.dragOverFlowStepId = `dropzone-end-flow-${hu?.id || 'temp'}`;
     }
  }

  onFlowStepDragLeave(event: DragEvent): void {
    this.dragOverFlowStepId = null;
  }

  onFlowStepDrop(event: DragEvent, targetPaso: FlowAnalysisStep | undefined, hu: HUData | null): void {
    event.preventDefault(); this.dragOverFlowStepId = null;
    document.querySelectorAll('.flow-analysis-steps-table tbody tr[style*="opacity: 0.4"]').forEach(el => (el as HTMLElement).style.opacity = '1');

    if (!this.draggedFlowStep || !hu || !hu.flowAnalysisReport?.[0]?.Pasos_Analizados) {
        this.draggedFlowStep = null; return;
    }
    
    const pasosAnalizados = hu.flowAnalysisReport[0].Pasos_Analizados;
    const fromIndex = pasosAnalizados.indexOf(this.draggedFlowStep);
    let toIndex = -1;

    if (targetPaso) {
        if (this.draggedFlowStep === targetPaso) { this.draggedFlowStep = null; return; }
        toIndex = pasosAnalizados.indexOf(targetPaso);
    } else {
        toIndex = pasosAnalizados.length;
    }


    if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
      const itemToMove = pasosAnalizados.splice(fromIndex, 1)[0];
      if (targetPaso || toIndex < pasosAnalizados.length) {
        pasosAnalizados.splice(toIndex, 0, itemToMove);
      } else {
        pasosAnalizados.push(itemToMove);
      }
      pasosAnalizados.forEach((paso, index) => { paso.numero_paso = index + 1; });
      this.cdr.detectChanges(); 
    }
    this.draggedFlowStep = null;
  }

  onFlowStepDragEnd(event: DragEvent): void {
    document.querySelectorAll('.flow-analysis-steps-table tbody tr[style*="opacity: 0.4"]').forEach(el => (el as HTMLElement).style.opacity = '1');
    this.draggedFlowStep = null; this.dragOverFlowStepId = null;
  }

  isFlowAnalysisReportInErrorState(r?: FlowAnalysisReportItem): boolean {
    if (!r) return true;
    return ["Error de API", "Error de Formato de Respuesta", "Error de Formato (No JSON Array)", "Error de Formato (No Array)", "Error de Formato (Faltan Campos)", "Error de Parsing JSON", "Secuencia de imágenes no interpretable", "Error Crítico en Generación", "Error Crítico en Re-Generación", "Error Crítico en Re-Generación (Contextualizada)", "Respuesta Vacía de IA"].includes(r.Nombre_del_Escenario);
  }

  getFlowStepImage(hu: HUData | null, paso: FlowAnalysisStep): string | null {
    if (!hu || !hu.originalInput.imagesBase64 || !hu.originalInput.imageMimeTypes || !hu.originalInput.imageFilenames) return null;
    
    const imageRefToUse = paso.imagen_referencia_salida || paso.imagen_referencia_entrada;
    if (!imageRefToUse) return null;
    
    let imagesToUse: string[] = hu.originalInput.imagesBase64;
    let mimeTypesToUse: string[] = hu.originalInput.imageMimeTypes;
    let filenamesToUse: string[] = hu.originalInput.imageFilenames;

    const filenameInRefMatch = imageRefToUse.match(/\(([^)]+)\)$/);
    let imageIndex = -1;

    if (filenameInRefMatch && filenameInRefMatch[1]) {
        const targetFilename = filenameInRefMatch[1];
        imageIndex = filenamesToUse.findIndex(fn => fn === targetFilename);
    }
    
    if (imageIndex === -1) {
        const numberMatch = imageRefToUse.match(/Imagen (\d+)/i);
        if (numberMatch && numberMatch[1]) {
          imageIndex = parseInt(numberMatch[1], 10) - 1;
        }
    }
    
    if (imageIndex >= 0 && imageIndex < imagesToUse.length && imageIndex < mimeTypesToUse.length) {
      return `data:${mimeTypesToUse[imageIndex]};base64,${imagesToUse[imageIndex]}`;
    }
    return null;
  }

  getFlowStepStatusClass(paso: FlowAnalysisStep): string {
    const status = (paso.resultado_obtenido_paso_y_estado || '').toLowerCase();
    if (status.includes('exitosa con desviaciones') || status.includes('parcialmente exitosa')) return 'status-deviation';
    if (status.includes('exitosa')) return 'status-success';
    if (status.includes('fallido') || status.includes('fallida') || status.includes('error')) return 'status-failure';
    return '';
  }
  
  exportFlowAnalysisReportToCsv(): void {
    if (!this.generatedAnalysisData || !this.generatedAnalysisData.flowAnalysisReport?.[0]?.Pasos_Analizados?.length || this.isFlowAnalysisReportInErrorState(this.generatedAnalysisData.flowAnalysisReport[0])) {
      alert('No hay datos de análisis de flujo válidos para exportar.'); return;
    }
    const hu = this.generatedAnalysisData;
    const report = hu.flowAnalysisReport![0];
    const csvHeader = ["Nombre del Escenario", "Número de Paso", "Descripción de la Acción Observada", "Dato de Entrada (Paso)", "Resultado Esperado (Paso)", "Resultado Obtenido (Paso) y Estado", "Resultado Esperado General del Flujo", "Conclusión General del Flujo"];
    const csvRows = report.Pasos_Analizados.map(paso => [this.escapeCsvField(report.Nombre_del_Escenario), this.escapeCsvField(paso.numero_paso), this.escapeCsvField(paso.descripcion_accion_observada), this.escapeCsvField(paso.dato_de_entrada_paso || 'N/A'), this.escapeCsvField(paso.resultado_esperado_paso), this.escapeCsvField(paso.resultado_obtenido_paso_y_estado), this.escapeCsvField(report.Resultado_Esperado_General_Flujo), this.escapeCsvField(report.Conclusion_General_Flujo)]);
    const csvFullContent = [csvHeader.join(','), ...csvRows.map(row => row.join(','))].join('\r\n');
    saveAs(new Blob(["\uFEFF" + csvFullContent], { type: 'text/csv;charset=utf-8;' }), `AnalisisFlujo_${this.escapeFilename(hu.title || 'Reporte')}_${new Date().toISOString().split('T')[0]}.csv`);
  }

  exportFlowAnalysisReportToHtmlLocalized(language: 'es' | 'en'): void {
    if (!this.generatedAnalysisData || !this.generatedAnalysisData.flowAnalysisReport?.[0] || this.isFlowAnalysisReportInErrorState(this.generatedAnalysisData.flowAnalysisReport[0])) {
        alert(language === 'en' ? 'No valid flow analysis report to export.' : 'No hay informe de análisis de flujo válido para exportar.'); return;
    }
    const hu = this.generatedAnalysisData;
    const report = hu.flowAnalysisReport![0];
    const date = new Date().toISOString().split('T')[0];
    const title = language === 'en' ? `Flow Analysis Report: ${this.escapeHtmlForExport(report.Nombre_del_Escenario)}` : `Informe de Análisis de Flujo: ${this.escapeHtmlForExport(report.Nombre_del_Escenario)}`;
    let html = `<html><head><meta charset="UTF-8"><title>${title}</title><style>
    body{font-family:Segoe UI,Calibri,Arial,sans-serif;margin:20px;line-height:1.6;color:#333}
    .report-container{max-width:900px;margin:auto}
    h1{color:#3b5a6b;border-bottom:2px solid #e9ecef;padding-bottom:10px}
    h2{font-size:1.4em;color:#4a6d7c;margin-top:20px;margin-bottom:10px;padding-bottom:5px;border-bottom:1px dashed #e0e0e0}
    table{width:100%;border-collapse:collapse;margin-bottom:20px;font-size:.9em}
    th,td{border:1px solid #ddd;padding:8px;text-align:left;vertical-align:top}
    th{background-color:#f2f2f2;font-weight:600}
    tr.evidence-row td { 
      padding: 10px; 
      text-align: center; 
      background-color: #fdfdfd; 
      border-top: none;
    }
    img.evidence-image {
        max-width: 500px;
        height: auto;
        border: 1px solid #ccc;
        border-radius: 4px;
        display: block;
        margin: 5px auto;
        background-color: #fff;
        object-fit: contain;
    }
    tr.status-success td:first-child{border-left:5px solid #28a745!important}
    tr.status-failure td:first-child{border-left:5px solid #dc3545!important}
    tr.status-deviation td:first-child{border-left:5px solid #ffc107!important}
    .conclusion-section p{margin-bottom:8px} .conclusion-section strong{color:#555}
    </style></head><body><div class="report-container"><h1>${title}</h1><p><strong>${language === 'en' ? 'Date' : 'Fecha'}:</strong> ${date}</p>`;
    
    html += `<h2>${language === 'en' ? 'Analyzed Steps' : 'Pasos Analizados'}:</h2>`;
    if (report.Pasos_Analizados?.length) {
        html += `<table><thead><tr>
        <th>${language === 'en' ? 'Step' : 'Paso'}</th>
        <th>${language === 'en' ? 'Action/Observation' : 'Acción/Observación'}</th>
        <th>${language === 'en' ? 'Input Data' : 'Dato Entrada'}</th>
        <th>${language === 'en' ? 'Expected Result' : 'Res. Esperado'}</th>
        <th>${language === 'en' ? 'Actual Result & Status' : 'Res. Obtenido y Estado'}</th>
        </tr></thead><tbody>`;
        report.Pasos_Analizados.forEach(paso => {
            const imgSrc = this.getFlowStepImage(hu, paso);
            html += `<tr class="${this.getFlowStepStatusClass(paso)}">
            <td>${paso.numero_paso}</td>
            <td>${this.escapeHtmlForExport(paso.descripcion_accion_observada)}</td>
            <td>${this.escapeHtmlForExport(paso.dato_de_entrada_paso || 'N/A')}</td>
            <td>${this.escapeHtmlForExport(paso.resultado_esperado_paso)}</td>
            <td>${this.escapeHtmlForExport(paso.resultado_obtenido_paso_y_estado)}</td>
            </tr>`;
            if (imgSrc) {
              html += `<tr class="evidence-row">
                <td colspan="5">
                  <img src="${imgSrc}" alt="Evidencia para paso ${paso.numero_paso}" class="evidence-image">
                </td>
              </tr>`;
            }
        });
        html += `</tbody></table>`;
    } else { html += `<p><em>${language === 'en' ? 'No detailed steps were analyzed.' : 'No se analizaron pasos detallados.'}</em></p>`; }
    html += `<div class="conclusion-section"><h2>${language === 'en' ? 'General Conclusions' : 'Conclusiones Generales'}:</h2><p><strong>${language === 'en' ? 'Overall Expected Result' : 'Resultado Esperado General'}:</strong> ${this.escapeHtmlForExport(report.Resultado_Esperado_General_Flujo)}</p><p><strong>${language === 'en' ? 'Overall Conclusion' : 'Conclusión General'}:</strong> ${this.escapeHtmlForExport(report.Conclusion_General_Flujo)}</p></div></div></body></html>`;
    
 
    saveAs(new Blob([html], { type: 'text/html;charset=utf-8;' }), `AnalisisFlujo_${this.escapeFilename(hu.title || 'Reporte')}_${language === 'en' ? 'ENG' : 'ESP'}_${date}.html`);
  }

  private escapeCsvField = (f: string | number | undefined | null): string => { if (f === null || f === undefined) return ''; const s = String(f); return (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) ? `"${s.replace(/"/g, '""')}"` : s; };
  private escapeFilename = (filename: string): string => filename.replace(/[^a-z0-9_.\-]/gi, '_').substring(0, 50);
  private escapeHtmlForExport = (u: string | undefined | null): string => { if (!u) return ''; return u.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); };

  confirmAndAddToPlan(): void {
    if (this.generatedAnalysisData) {
      this.isSubmitting = true; 
      let finalContextForHuData = '';
      const originalAnnotations = this.generatedAnalysisData.originalInput.annotationsFlowA; 
      if(originalAnnotations && originalAnnotations.length > 0){
        finalContextForHuData += "INFORMACIÓN DE ANOTACIONES PROPORCIONADA POR EL USUARIO (para análisis inicial):\n";
        originalAnnotations.forEach(ann => {
            finalContextForHuData += `Para Imagen ${ann.imageIndex} (${ann.imageFilename}):\n  - Anotación #${ann.sequence} ('${ann.description}') en coordenadas normalizadas (x:${ann.x.toFixed(2)}, y:${ann.y.toFixed(2)}, w:${ann.width.toFixed(2)}, h:${ann.height.toFixed(2)}).\n`;
            if (ann.elementType) {
                finalContextForHuData += `    - Tipo de Elemento: '${ann.elementType}'\n`;
            }
            if (ann.elementValue) {
                finalContextForHuData += `    - Valor/Texto Asociado: '${ann.elementValue}'\n`;
            }
        });
      }
      if (this.userReanalysisContext.trim()) { 
        finalContextForHuData += (finalContextForHuData ? "\n\n" : "") + "CONTEXTO ADICIONAL TEXTUAL PARA RE-ANÁLISIS DEL INFORME:\n" + this.userReanalysisContext.trim();
      }
      this.generatedAnalysisData.userReanalysisContext = finalContextForHuData.trim();
      this.analysisGenerated.emit({ ...this.generatedAnalysisData });
    }
  }
}