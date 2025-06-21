// src/app/flow-analysis/flow-analysis.component.ts
import { Component, OnInit, ViewChild, ElementRef, Inject, PLATFORM_ID, Output, EventEmitter, Input, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ImageAnnotationEditorComponent, AnnotationEditorOutput } from '../image-annotation-editor/image-annotation-editor.component';
import { HUData, FlowAnalysisReportItem, FlowAnalysisStep, ImageAnnotation, GuidedFlowStepContext, AIPreAnalysisResult } from '../models/hu-data.model';
import { GeminiService } from '../services/gemini.service';
import { finalize } from 'rxjs/operators';
import { Observable, Subscription } from 'rxjs';
import { saveAs } from 'file-saver';

interface DraggableFlowImage {
  file: File;
  preview: string | ArrayBuffer;
  base64: string;
  mimeType: string;
  id: string;
}

type ComponentState = 'form' | 'guidedAnalysis' | 'finalizingReport' | 'displayingReport';

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
  formError: string | null = null;
  currentFlowTitle: string = '';
  currentFlowSprint: string = '';
  loadingFlowAnalysis: boolean = false; 
  flowAnalysisError: string | null = null;
  
  guidedStepsContext: GuidedFlowStepContext[] = [];
  currentStepIndex: number = -1;
  isCurrentStepAiLoading: boolean = false;
  currentStepAiAnalysis: AIPreAnalysisResult | null = null;
  currentStepUserDescription: string = '';
  stepValidationError: string | null = null;

  draggedImage: DraggableFlowImage | null = null;
  dragOverImageId: string | null = null;

  isEditingFlowReportDetails: boolean = false;
  userReanalysisContext: string = '';
  draggedFlowStep: FlowAnalysisStep | null = null;
  dragOverFlowStepId: string | null = null;

  showImageEditor: boolean = false;
  imageToEditUrl: string | ArrayBuffer | null = null;
  existingAnnotationsForEditor: ImageAnnotation[] = [];
  
  @ViewChild('flowAnalysisForm') flowAnalysisFormDirective!: NgForm;
  private formStatusSubscription!: Subscription;
  @ViewChild('flowAnalysisImageInput') flowAnalysisImageInputRef!: ElementRef<HTMLInputElement>;

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
    if (this.componentState !== 'guidedAnalysis' || this.currentStepIndex === -1 || !this.guidedStepsContext[this.currentStepIndex]) return null;
    const currentImage = this.guidedStepsContext[this.currentStepIndex].image;
    return {
        file: currentImage.file,
        preview: currentImage.preview,
        base64: currentImage.base64,
        mimeType: currentImage.mimeType,
        id: currentImage.filename,
    }
  }

  isFormInvalid(): boolean {
    if (!this.flowAnalysisFormDirective || !this.flowAnalysisFormDirective.form) return true;
    return !this.currentFlowSprint || !this.currentFlowTitle || this.draggableImages.length === 0;
  }
  
  isLastStep(): boolean {
    return this.currentStepIndex === this.draggableImages.length - 1;
  }

  resetToForm(): void {
    this.componentState = 'form';
    this.isSubmitting = false;
    this.generatedAnalysisData = null;
    this.formError = null;
    this.draggableImages = [];
    this.imageUploadError = null;
    const keptSprint = this.currentFlowSprint || this.initialSprint;
    this.currentFlowTitle = '';
    this.loadingFlowAnalysis = false;
    this.flowAnalysisError = null;
    this.isEditingFlowReportDetails = false;
    this.userReanalysisContext = '';
    this.draggedImage = null;
    this.dragOverImageId = null;
    this.draggedFlowStep = null;
    this.dragOverFlowStepId = null;
    this.guidedStepsContext = [];
    this.currentStepIndex = -1;
    this.isCurrentStepAiLoading = false;
    this.currentStepAiAnalysis = null;
    this.currentStepUserDescription = '';
    this.stepValidationError = null;
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

  handleCancelFlowForm() {
    this.cancelAnalysis.emit();
  }

  confirmAndAddToPlan(): void {
    if (!this.generatedAnalysisData) return;
    this.isSubmitting = true;
    setTimeout(() => {
      this.analysisGenerated.emit(this.generatedAnalysisData!);
      this.isSubmitting = false;
    }, 300);
  }

  startGuidedAnalysis(): void {
    this.flowAnalysisFormDirective.form.markAllAsTouched();
    if (this.isFormInvalid()) { this.formError = "Completa los campos requeridos y carga al menos una imagen."; return; }
    this.formError = null;
    this.componentState = 'guidedAnalysis';
    this.guidedStepsContext = this.draggableImages.map((img, index) => ({
      step: index + 1,
      image: { file: img.file, base64: img.base64, mimeType: img.mimeType, filename: img.file.name, preview: img.preview },
      aiPreAnalysis: null, userDescription: '', annotations: [],
    }));
    this.currentStepIndex = 0;
    this.loadStepData();
  }

  loadStepData(): void {
      if (this.currentStepIndex < 0 || this.currentStepIndex >= this.guidedStepsContext.length) return;
      this.isCurrentStepAiLoading = true;
      this.currentStepAiAnalysis = null;
      this.stepValidationError = null;
      const currentStep = this.guidedStepsContext[this.currentStepIndex];
      if(currentStep.aiPreAnalysis) {
        this.currentStepAiAnalysis = currentStep.aiPreAnalysis;
        this.currentStepUserDescription = currentStep.userDescription;
        this.isCurrentStepAiLoading = false;
        this.cdr.detectChanges();
        return;
      }
      let apiCall$: Observable<AIPreAnalysisResult>;
      if (this.currentStepIndex === 0) {
          apiCall$ = this.geminiService.preAnalyzeSingleImage(currentStep.image.base64, currentStep.image.mimeType);
      } else {
          const previousStepContext = this.guidedStepsContext[this.currentStepIndex - 1];
          const contextString = this.formatPreviousStepContextForPrompt(previousStepContext);
          apiCall$ = this.geminiService.analyzeNextImageInFlow(currentStep.image.base64, currentStep.image.mimeType, contextString);
      }
      apiCall$.pipe(finalize(() => { this.isCurrentStepAiLoading = false; this.cdr.detectChanges(); })).subscribe({
          next: (result) => {
              currentStep.aiPreAnalysis = result;
              if (!currentStep.userDescription) currentStep.userDescription = result.description;
              this.currentStepUserDescription = currentStep.userDescription;
              this.currentStepAiAnalysis = result;
          },
          error: (err) => { this.stepValidationError = `Error de IA en el paso ${this.currentStepIndex + 1}: ${err.message}`; }
      });
  }

  formatPreviousStepContextForPrompt(previousStep: GuidedFlowStepContext): string {
    const triggerAction = previousStep.annotations.find(a => a.type === 'trigger');
    const inputs = previousStep.annotations.filter(a => a.type === 'input');
    let context = `En el paso anterior (Paso ${previousStep.step}), el usuario estaba en una pantalla descrita como: "${previousStep.userDescription}".\n`;
    if (triggerAction) context += `La acción principal que realizó fue en el elemento: "${triggerAction.description}".\n`;
    if (inputs.length > 0) context += `Se ingresaron los siguientes datos:\n${inputs.map(i => `- En el campo '${i.description}', se ingresó el valor: '${i.elementValue}'`).join('\n')}\n`;
    return context;
  }

  goToNextStep(): void {
      this.stepValidationError = null;
      const currentStep = this.guidedStepsContext[this.currentStepIndex];
      if (!this.isLastStep()) {
        const triggerActions = currentStep.annotations.filter(a => a.type === 'trigger');
        if (triggerActions.length === 0) { this.stepValidationError = "Debes definir una 'Acción de Disparo' (trigger) para indicar cómo se avanza al siguiente paso."; return; }
        if (triggerActions.length > 1) { this.stepValidationError = "Solo puedes tener una 'Acción de Disparo' (trigger) por paso."; return; }
      }
      currentStep.userDescription = this.currentStepUserDescription;
      if (this.isLastStep()) {
          this.generateFinalReport();
      } else {
          this.currentStepIndex++;
          this.currentStepUserDescription = this.guidedStepsContext[this.currentStepIndex].userDescription || '';
          this.loadStepData();
      }
  }

  goToPreviousStep(): void {
      if (this.currentStepIndex > 0) {
          this.stepValidationError = null;
          this.guidedStepsContext[this.currentStepIndex].userDescription = this.currentStepUserDescription;
          this.currentStepIndex--;
          const previousStep = this.guidedStepsContext[this.currentStepIndex];
          this.currentStepAiAnalysis = previousStep.aiPreAnalysis;
          this.currentStepUserDescription = previousStep.userDescription;
          this.cdr.detectChanges();
      }
  }

  generateFinalReport(): void {
    this.componentState = 'finalizingReport';
    this.loadingFlowAnalysis = true;
    this.flowAnalysisError = null;
    const structuredContext = this.guidedStepsContext.map(step => {
        const trigger = step.annotations.find(a => a.type === 'trigger');
        return {
            step: step.step, description: step.userDescription, image_filename: step.image.filename,
            action: trigger ? { type: 'trigger', element: trigger.description } : null,
            inputs: step.annotations.filter(a => a.type === 'input').map(i => ({ element: i.description, value: i.elementValue || '' })),
            verification: step.annotations.filter(a => a.type === 'verification').map(v => ({ element: v.description, value: v.elementValue || '' }))
        };
    });
    const structuredContextJSON = JSON.stringify(structuredContext, null, 2);
    const finalId = this.generateIdFromTitle(this.currentFlowTitle);
    this.generatedAnalysisData = this.createInitialHUData(finalId);
    this.geminiService.generateFinalFlowReport(structuredContextJSON).pipe(
        finalize(() => {
            this.loadingFlowAnalysis = false;
            this.componentState = 'displayingReport';
            this.cdr.detectChanges();
        })
    ).subscribe({
        next: (report) => { if (this.generatedAnalysisData) this.generatedAnalysisData.flowAnalysisReport = report; },
        error: (err) => { this.flowAnalysisError = err.message; if (this.generatedAnalysisData) this.generatedAnalysisData.errorFlowAnalysis = err.message; }
    });
  }

  createInitialHUData(finalId: string): HUData {
    return {
        id: finalId, title: this.currentFlowTitle, sprint: this.currentFlowSprint,
        originalInput: { id: finalId, title: this.currentFlowTitle, sprint: this.currentFlowSprint, generationMode: 'flowAnalysis', selectedTechnique: '', guidedFlowSteps: JSON.parse(JSON.stringify(this.guidedStepsContext)) },
        generatedScope: '', detailedTestCases: [], generatedTestCaseTitles: '', editingScope: false, loadingScope: false, errorScope: null, isScopeDetailsOpen: false,
        editingScenarios: false, loadingScenarios: false, errorScenarios: null, showRegenTechniquePicker: false,
        regenSelectedTechnique: '', userTestCaseReanalysisContext: '', isScenariosDetailsOpen: false, isEditingDetailedTestCases: false,
        isFlowAnalysisDetailsOpen: true, loadingFlowAnalysis: true
    };
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files) return;
    this.imageUploadError = null;
    const files = Array.from(input.files);
    if (files.length + this.draggableImages.length > 20) { this.imageUploadError = "No puedes subir más de 20 imágenes en total."; return; }
    const fileReadPromises = files.map(file => {
        if (file.size > 4 * 1024 * 1024) { this.imageUploadError = `El archivo ${file.name} es demasiado grande (máx 4MB).`; return Promise.resolve(null); }
        return new Promise<DraggableFlowImage | null>((resolve) => {
            const reader = new FileReader();
            reader.onload = (e: any) => resolve({ file, preview: e.target.result, base64: e.target.result.split(',')[1], mimeType: file.type, id: `${file.name}-${Date.now()}` });
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
        });
    });
    Promise.all(fileReadPromises).then(newImages => {
        const validImages = newImages.filter((img): img is DraggableFlowImage => img !== null);
        this.draggableImages.push(...validImages);
        this.sortImagesByName();
        this.cdr.detectChanges();
    });
  }

  sortImagesByName() {
    this.draggableImages.sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true, sensitivity: 'base' }));
  }

  openImageEditorForCurrentStep(): void {
    if (this.currentStepIndex === -1) return;
    const currentStepContext = this.guidedStepsContext[this.currentStepIndex];
    this.imageToEditUrl = currentStepContext.image.annotatedPreview || currentStepContext.image.preview;
    this.existingAnnotationsForEditor = JSON.parse(JSON.stringify(currentStepContext.annotations));
    this.showImageEditor = true;
    this.cdr.detectChanges();
  }

  onAnnotationsApplied(output: AnnotationEditorOutput): void {
    if (this.currentStepIndex !== -1) {
      const currentStepContext = this.guidedStepsContext[this.currentStepIndex];
      currentStepContext.annotations = output.annotations;
      if (output.annotatedImageDataUrl) currentStepContext.image.annotatedPreview = output.annotatedImageDataUrl;
      this.cdr.detectChanges();
    }
    this.closeImageEditor();
  }
  
  closeImageEditor() { this.showImageEditor = false; this.imageToEditUrl = null; this.existingAnnotationsForEditor = []; }
  onImageDragStart(event: DragEvent, image: DraggableFlowImage) { this.draggedImage = image; if(event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; }
  onImageDragOver(event: DragEvent, image?: DraggableFlowImage) { event.preventDefault(); this.dragOverImageId = image ? image.id : null; }
  onImageDragLeave(event: DragEvent) { this.dragOverImageId = null; }
  onImageDrop(event: DragEvent, targetImage: DraggableFlowImage) {
    event.preventDefault(); if (!this.draggedImage) return;
    const draggedIndex = this.draggableImages.findIndex(img => img.id === this.draggedImage!.id);
    const targetIndex = this.draggableImages.findIndex(img => img.id === targetImage.id);
    if (draggedIndex > -1 && targetIndex > -1) { this.draggableImages.splice(draggedIndex, 1); this.draggableImages.splice(targetIndex, 0, this.draggedImage); }
    this.draggedImage = null; this.dragOverImageId = null;
  }
  onImageDragEnd(event: DragEvent) { this.draggedImage = null; this.dragOverImageId = null; }
  
  onStepDragStart(event: DragEvent, step: FlowAnalysisStep) { this.draggedFlowStep = step; if(event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; }
  onStepDragOver(event: DragEvent, step?: FlowAnalysisStep) { event.preventDefault(); if(step && this.generatedAnalysisData) this.dragOverFlowStepId = this.generatedAnalysisData!.id + '-' + step.numero_paso; }
  onStepDragLeave(event: DragEvent) { this.dragOverFlowStepId = null; }
  onStepDrop(event: DragEvent, targetStep: FlowAnalysisStep) {
    event.preventDefault(); if (!this.draggedFlowStep || !this.generatedAnalysisData?.flowAnalysisReport?.[0]) return;
    const steps = this.generatedAnalysisData.flowAnalysisReport[0].Pasos_Analizados;
    const draggedIndex = steps.findIndex(s => s.numero_paso === this.draggedFlowStep!.numero_paso);
    const targetIndex = steps.findIndex(s => s.numero_paso === targetStep.numero_paso);
    if (draggedIndex > -1 && targetIndex > -1) { steps.splice(draggedIndex, 1); steps.splice(targetIndex, 0, this.draggedFlowStep); steps.forEach((s, i) => s.numero_paso = i + 1); }
    this.draggedFlowStep = null; this.dragOverFlowStepId = null;
  }
  onStepDragEnd(event: DragEvent) { this.draggedFlowStep = null; this.dragOverFlowStepId = null; }
  
  generateIdFromTitle(title: string): string { const sanitized = title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim(); return sanitized.replace(/\s+/g, '-'); }
  isFlowAnalysisReportInErrorState(report?: FlowAnalysisReportItem): boolean { return !!report?.Conclusion_General_Flujo?.toLowerCase().includes('error'); }
  
  getFlowStepStatusClass(paso: FlowAnalysisStep): string {
    const estado = (paso.resultado_obtenido_paso_y_estado || '').toLowerCase();
    if (estado.includes('exitosa')) return 'status-success';
    if (estado.includes('fallido')) return 'status-failure';
    if (estado.includes('desviaciones')) return 'status-deviation';
    return '';
  }

  getFlowStepImage(data: HUData, paso: FlowAnalysisStep): string | ArrayBuffer | undefined {
    const context = data.originalInput.guidedFlowSteps?.find(s => s.image.filename === paso.imagen_referencia_entrada);
    return context?.image.annotatedPreview || context?.image.preview;
  }

  openImageInNewTab(filename: string): void {
    if (!this.generatedAnalysisData?.originalInput.guidedFlowSteps) return;
    const context = this.generatedAnalysisData.originalInput.guidedFlowSteps.find(s => s.image.filename === filename);
    const preview = context?.image.preview;
    if (isPlatformBrowser(this.platformId) && typeof preview === 'string') {
        const imageWindow = window.open("");
        imageWindow?.document.write(`<img src="${preview}" style="max-width:100%;">`);
    }
  }

  refineFlowAnalysisReport(): void {
    if (!this.generatedAnalysisData || !this.generatedAnalysisData.originalInput.guidedFlowSteps || !this.generatedAnalysisData.flowAnalysisReport) {
      alert("No hay datos de análisis válidos para refinar.");
      return;
    }
    this.loadingFlowAnalysis = true;
    this.flowAnalysisError = null;

    const imagesBase64 = this.generatedAnalysisData.originalInput.guidedFlowSteps.map(s => s.image.base64);
    const mimeTypes = this.generatedAnalysisData.originalInput.guidedFlowSteps.map(s => s.image.mimeType);
    
    this.geminiService.refineFlowAnalysisFromImagesAndContext(
      imagesBase64,
      mimeTypes,
      this.generatedAnalysisData.flowAnalysisReport[0],
      this.userReanalysisContext
    ).pipe(
      finalize(() => {
        this.loadingFlowAnalysis = false;
        this.cdr.detectChanges();
      })
    ).subscribe({
      next: report => {
        if (this.generatedAnalysisData) this.generatedAnalysisData.flowAnalysisReport = report;
      },
      error: err => this.flowAnalysisError = err.message
    });
  }
  
  private escapeCsvField = (f: any): string => {
    let s = String(f === null || f === undefined ? '' : f);
    if (s.includes('"') || s.includes(',') || s.includes('\n')) {
      s = `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  private escapeFilename = (name: string): string => name.replace(/[^a-z0-9_.-]/gi, '_').substring(0, 50);

  private escapeHtmlForExport = (u: string | undefined | null): string => {
    if (!u) return '';
    return u.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  };

  exportAsJson(data: any, filename: string): void {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    saveAs(blob, `${filename}.json`);
  }

  exportAsMarkdown(reports: FlowAnalysisReportItem[] | undefined, filename: string): void {
    if (!reports || reports.length === 0) return;
    let mdContent = '';
    reports.forEach(report => {
        mdContent += `# Reporte de Análisis de Flujo: ${report.Nombre_del_Escenario}\n\n`;
        mdContent += `## Pasos Analizados\n\n`;
        report.Pasos_Analizados.forEach(step => {
            mdContent += `### Paso ${step.numero_paso}\n`;
            mdContent += `- **Acción Observada:** ${step.descripcion_accion_observada}\n`;
            mdContent += `- **Elemento Clave:** ${step.elemento_clave_y_ubicacion_aproximada}\n`;
            if (step.dato_de_entrada_paso && step.dato_de_entrada_paso !== 'N/A') mdContent += `- **Dato de Entrada:** ${step.dato_de_entrada_paso}\n`;
            mdContent += `- **Resultado Esperado:** ${step.resultado_esperado_paso}\n`;
            mdContent += `- **Resultado Obtenido:** ${step.resultado_obtenido_paso_y_estado}\n`;
            mdContent += `- **Imagen de Entrada:** ${step.imagen_referencia_entrada}\n`;
            if (step.imagen_referencia_salida && step.imagen_referencia_salida !== 'N/A') mdContent += `- **Imagen de Salida:** ${step.imagen_referencia_salida}\n\n`;
            else mdContent += `\n`;
        });
        mdContent += `## Conclusiones\n\n`;
        mdContent += `**Resultado Esperado General:** ${report.Resultado_Esperado_General_Flujo}\n\n`;
        mdContent += `**Conclusión General:** ${report.Conclusion_General_Flujo}\n\n`;
    });
    const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8' });
    saveAs(blob, `${this.generateIdFromTitle(reports[0].Nombre_del_Escenario)}.md`);
  }
  
  exportFlowAnalysisReportToHtmlLocalized(lang: 'es' | 'en'): void {
    if (!this.generatedAnalysisData?.flowAnalysisReport?.[0]) { alert('No hay reporte para exportar.'); return; }
    const report = this.generatedAnalysisData.flowAnalysisReport[0];
    const date = new Date().toISOString().split('T')[0];
    const title = lang === 'en' ? `Flow Analysis Report: ${this.escapeHtmlForExport(report.Nombre_del_Escenario)}` : `Informe de Análisis de Flujo: ${this.escapeHtmlForExport(report.Nombre_del_Escenario)}`;
    let html = `<html><head><meta charset="UTF-8"><title>${title}</title><style>body{font-family:Segoe UI,Calibri,Arial,sans-serif;margin:20px;line-height:1.6;color:#333}.report-container{max-width:900px;margin:auto}h1{color:#3b5a6b;border-bottom:2px solid #e9ecef;padding-bottom:10px}h2{font-size:1.4em;color:#4a6d7c;margin-top:20px;margin-bottom:10px;padding-bottom:5px;border-bottom:1px dashed #e0e0e0}table{width:100%;border-collapse:collapse;margin-bottom:20px;font-size:.9em}th,td{border:1px solid #ddd;padding:8px;text-align:left;vertical-align:top}th{background-color:#f2f2f2;font-weight:600}img.flow-step-image{max-width:500px;max-height:100px;border:1px solid #ccc;border-radius:4px;display:block;margin:5px 0;background-color:#fff;object-fit:contain}tr.status-success td:first-child{border-left:5px solid #28a745!important}tr.status-failure td:first-child{border-left:5px solid #dc3545!important}tr.status-deviation td:first-child{border-left:5px solid #ffc107!important}.conclusion-section p{margin-bottom:8px} .conclusion-section strong{color:#555}</style></head><body><div class="report-container"><h1>${title}</h1><p><strong>${lang === 'en' ? 'Date' : 'Fecha'}:</strong> ${date}</p>`;
    html += `<h2>${lang === 'en' ? 'Analyzed Steps' : 'Pasos Analizados'}:</h2>`;
    if (report.Pasos_Analizados?.length) {
        html += `<table><thead><tr><th>${lang === 'en' ? 'Step' : 'Paso'}</th><th>${lang === 'en' ? 'Action/Observation' : 'Acción/Observación'}</th><th>${lang === 'en' ? 'Input Data' : 'Dato Entrada'}</th><th>${lang === 'en' ? 'Expected Result' : 'Res. Esperado'}</th><th>${lang === 'en' ? 'Actual Result & Status' : 'Res. Obtenido y Estado'}</th><th>${lang === 'en' ? 'Step Image' : 'Imagen Paso'}</th></tr></thead><tbody>`;
        report.Pasos_Analizados.forEach(paso => {
            const imgSrc = this.getFlowStepImage(this.generatedAnalysisData!, paso);
            html += `<tr class="${this.getFlowStepStatusClass(paso)}"><td>${paso.numero_paso}</td><td>${this.escapeHtmlForExport(paso.descripcion_accion_observada)}</td><td>${this.escapeHtmlForExport(paso.dato_de_entrada_paso || 'N/A')}</td><td>${this.escapeHtmlForExport(paso.resultado_esperado_paso)}</td><td>${this.escapeHtmlForExport(paso.resultado_obtenido_paso_y_estado)}</td><td>${imgSrc ? `<img src="${imgSrc as string}" alt="Imagen para paso ${paso.numero_paso}" class="flow-step-image">` : 'N/A'}</td></tr>`;
        });
        html += `</tbody></table>`;
    } else { html += `<p><em>${lang === 'en' ? 'No detailed steps were analyzed.' : 'No se analizaron pasos detallados.'}</em></p>`; }
    html += `<div class="conclusion-section"><h2>${lang === 'en' ? 'General Conclusions' : 'Conclusiones Generales'}:</h2><p><strong>${lang === 'en' ? 'Overall Expected Result' : 'Resultado Esperado General'}:</strong> ${this.escapeHtmlForExport(report.Resultado_Esperado_General_Flujo)}</p><p><strong>${lang === 'en' ? 'Overall Conclusion' : 'Conclusión General'}:</strong> ${this.escapeHtmlForExport(report.Conclusion_General_Flujo)}</p></div></div></body></html>`;
    saveAs(new Blob([html], { type: 'text/html;charset=utf-8;' }), `AnalisisFlujo_${this.escapeFilename(this.generatedAnalysisData!.title || 'Reporte')}_${lang === 'en' ? 'ENG' : 'ESP'}_${date}.html`);
  }
  
  exportFlowAnalysisReportToCsv(): void {
    if (!this.generatedAnalysisData?.flowAnalysisReport?.[0]?.Pasos_Analizados?.length) { alert('No hay datos válidos para exportar.'); return; }
    const report = this.generatedAnalysisData.flowAnalysisReport[0];
    const csvHeader = ["Nombre del Escenario", "Número de Paso", "Descripción de la Acción Observada", "Dato de Entrada (Paso)", "Resultado Esperado (Paso)", "Resultado Obtenido (Paso) y Estado", "Resultado Esperado General del Flujo", "Conclusión General del Flujo"];
    const csvRows = report.Pasos_Analizados.map(paso => [ this.escapeCsvField(report.Nombre_del_Escenario), this.escapeCsvField(paso.numero_paso), this.escapeCsvField(paso.descripcion_accion_observada), this.escapeCsvField(paso.dato_de_entrada_paso || 'N/A'), this.escapeCsvField(paso.resultado_esperado_paso), this.escapeCsvField(paso.resultado_obtenido_paso_y_estado), this.escapeCsvField(report.Resultado_Esperado_General_Flujo), this.escapeCsvField(report.Conclusion_General_Flujo) ]);
    const csvFullContent = [csvHeader.join(','), ...csvRows.map(row => row.join(','))].join('\r\n');
    saveAs(new Blob(["\uFEFF" + csvFullContent], { type: 'text/csv;charset=utf-8;' }), `AnalisisFlujo_${this.escapeFilename(this.generatedAnalysisData!.title || 'Reporte')}_${new Date().toISOString().split('T')[0]}.csv`);
  }
}