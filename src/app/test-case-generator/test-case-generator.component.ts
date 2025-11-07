import { Component, OnInit, ViewChild, ElementRef, Inject, PLATFORM_ID, Output, EventEmitter, Input, ChangeDetectorRef } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { DetailedTestCase as OriginalDetailedTestCase, TestCaseStep, HUData as OriginalHUData, GenerationMode } from '../models/hu-data.model';
import { GeminiService } from '../services/gemini.service';
import { ToastService } from '../services/toast.service';
import { catchError, finalize, tap } from 'rxjs/operators';
import { Observable, of, forkJoin } from 'rxjs';
import { saveAs } from 'file-saver';
import { TestCaseEditorComponent, UIDetailedTestCase as EditorUIDetailedTestCase } from '../test-case-editor/test-case-editor.component';

interface UIDetailedTestCase extends OriginalDetailedTestCase {
  isExpanded?: boolean;
}

interface UIHUData extends OriginalHUData {
  detailedTestCases: UIDetailedTestCase[];
}

type ComponentState = 'initialForm' | 'previewingGenerated' | 'editingForRefinement' | 'submitting';

@Component({
  selector: 'app-test-case-generator',
  standalone: true,
  imports: [FormsModule, CommonModule, TestCaseEditorComponent],
  templateUrl: './test-case-generator.component.html',
  styleUrls: ['./test-case-generator.component.css']
})
export class TestCaseGeneratorComponent implements OnInit {
  @Input() initialGenerationMode: GenerationMode = 'text';
  @Input() initialSprint: string = '';
  @Input() accumulatedHUsCount: number = 0;
  @Output() huGenerated = new EventEmitter<OriginalHUData>();
  @Output() huSaved = new EventEmitter<OriginalHUData>();
  @Output() generationCancelled = new EventEmitter<void>();

  componentState: ComponentState = 'initialForm';
  currentGenerationMode: GenerationMode = 'text';

  currentHuId: string = '';
  currentHuTitle: string = '';
  currentSprint: string = '';
  currentDescription: string = '';
  currentAcceptanceCriteria: string = '';
  currentSelectedTechnique: string = '';
  refinementTechnique: string = '';
  userRefinementContext: string = '';

  generatedHUData: UIHUData | null = null;

  formError: string | null = null;
  loadingScope: boolean = false;
  loadingScenarios: boolean = false;
  errorScope: string | null = null;
  errorScenarios: string | null = null;

  draggedTestCaseStep: TestCaseStep | null = null;
  dragOverTestCaseStepId: string | null = null;

  @ViewChild('huForm') huFormDirective!: NgForm;

  private readonly macTemplateId = '1FVRJav4D93FeWVq8GqcmYqaVSFBegamT';
  private readonly windowsTemplateId = '1sJ_zIcabBfKmxEgaOWX6_5oq5xol6CkU';

  constructor(
    private geminiService: GeminiService,
    @Inject(PLATFORM_ID) private platformId: Object,
    private cdr: ChangeDetectorRef,
    private elRef: ElementRef,
    private toastService: ToastService
  ) {}

  ngOnInit(): void {
    this.currentGenerationMode = this.initialGenerationMode;
    this.currentSprint = this.initialSprint;
    this.resetToInitialForm();
  }

  resetToInitialForm(): void {
    this.componentState = 'initialForm';
    this.formError = null;
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
    }, 0);
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
    return !this.currentHuId || !this.currentDescription || !this.currentAcceptanceCriteria || commonRequired;
  }

  private parseFileNameForSorting(fileName: string): { main: number, sub: number } {
    const nameWithoutExtension = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
    const parts = nameWithoutExtension.split(/[^0-9]+/g).filter(Boolean).map(p => parseInt(p, 10));
    return {
      main: parts.length > 0 && !isNaN(parts[0]) ? parts[0] : Infinity,
      sub: parts.length > 1 && !isNaN(parts[1]) ? parts[1] : (parts.length > 0 && !isNaN(parts[0]) ? 0 : Infinity)
    };
  }



  generateIdFromTitle(title: string, mode: GenerationMode): string {
    if (!title || !mode) return '';
    const prefix = "HU_";
    const sanitizedTitle = title.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^\w-]+/g, '');
    return `${prefix}${sanitizedTitle.substring(0, 20)}_${Date.now().toString().slice(-4)}`;
  }

  generateInitialHuAndCases(): void {
    this.formError = null; this.errorScope = null; this.errorScenarios = null;
    if (this.isFormInvalidForGeneration()) {
      this.formError = "Por favor, completa todos los campos requeridos.";
      this.huFormDirective?.form.markAllAsTouched(); return;
    }
    const huData: UIHUData = {
      originalInput: {
        generationMode: this.currentGenerationMode,
        description: this.currentDescription,
        acceptanceCriteria: this.currentAcceptanceCriteria,
        selectedTechnique: this.currentSelectedTechnique,
      },
      id: this.currentHuId.trim(), title: this.currentHuTitle.trim(), sprint: this.currentSprint.trim(),
      generatedScope: '',
      detailedTestCases: [],
      generatedTestCaseTitles: '',
      editingScope: false,
      loadingScope: false, errorScope: null,
      isScopeDetailsOpen: this.currentGenerationMode === 'text'
    };
    this.generatedHUData = huData;
    this.refinementTechnique = this.currentSelectedTechnique;
    this.cdr.detectChanges();

    // NUEVO ENFOQUE: Una sola petición para alcance + casos de prueba
    if (huData.originalInput.generationMode === 'text') {
      this.loadingScope = true;
      this.loadingScenarios = true;
      
      console.log('[GENERATION] Iniciando generación combinada de alcance + casos de prueba');
      
      this.geminiService.generateScopeAndTestCasesCombined(
        huData.originalInput.description!,
        huData.originalInput.acceptanceCriteria!,
        this.currentSelectedTechnique
      ).pipe(
        tap(result => {
          console.log('[GENERATION] Resultado combinado recibido');
          console.log('[GENERATION] Alcance:', result.scope);
          console.log('[GENERATION] Casos de prueba:', result.testCases.length);
          
          if (this.generatedHUData) {
            // Asignar alcance
            this.generatedHUData.generatedScope = result.scope;
            
            // Asignar casos de prueba
            this.generatedHUData.detailedTestCases = result.testCases.map((tc, index) => {
              const detailedTc: UIDetailedTestCase = {
                ...tc,
                steps: Array.isArray(tc.steps) ? tc.steps.map((s: any, i: number) => ({
                  numero_paso: s.numero_paso || (i + 1),
                  accion: s.accion || "Paso no descrito"
                })) : [{ numero_paso: 1, accion: "Pasos en formato incorrecto" }],
                isExpanded: index === 0
              };
              return detailedTc;
            });
            
            this.generatedHUData.generatedTestCaseTitles = this.formatSimpleScenarioTitles(
              result.testCases.map(tc => tc.title)
            );
            
            console.log('[GENERATION] Datos asignados correctamente a generatedHUData');
          }
        }),
        catchError(e => {
          const errorMsg = (typeof e === 'string' ? e : e.message) || 'Error al generar alcance y casos de prueba.';
          console.error('[GENERATION] Error:', errorMsg);
          
          this.errorScope = errorMsg;
          this.errorScenarios = errorMsg;
          
          if (this.generatedHUData) {
            this.generatedHUData.errorScope = errorMsg;
            this.generatedHUData.generatedScope = 'Error al generar el alcance.';
            
            const errorTc: UIDetailedTestCase = {
              title: 'Error Crítico en Generación',
              preconditions: errorMsg,
              steps: [{numero_paso: 1, accion: 'La generación falló. Por favor, intenta nuevamente.'}],
              expectedResults: 'N/A',
              isExpanded: true
            };
            this.generatedHUData.detailedTestCases = [errorTc];
          }
          
          return of(null);
        }),
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
      ).subscribe();
    }
  }

  private _generateOrRefineDetailedTestCases$(
    huData: UIHUData,
    technique: string,
    userContext?: string,
    mode: 'initial' | 'refinement' = 'initial'
  ): Observable<UIDetailedTestCase[]> {
    if (!this.generatedHUData) return of([]);
    this.loadingScenarios = true;
    let genObs$: Observable<OriginalDetailedTestCase[]>;
    if (mode === 'refinement') {
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
      if (huData.originalInput.description && huData.originalInput.acceptanceCriteria) {
        genObs$ = this.geminiService.generateDetailedTestCasesTextBased(huData.originalInput.description, huData.originalInput.acceptanceCriteria, technique, userContext);
      } else {
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
              })) : [{ numero_paso: 1, accion: "Pasos en formato incorrecto" }],
              isExpanded: mode === 'refinement' ? (existingExpansionStates.get(tc.title) || false) : (index === 0)
            };
            return detailedTc;
          });
          this.generatedHUData.generatedTestCaseTitles = this.formatSimpleScenarioTitles(tcs.map(tc => tc.title));
        }
      }),
      catchError(e => {
        const errorMsg = (typeof e === 'string' ? e : e.message) || `Error al ${mode === 'initial' ? 'generar' : 'refinar'} casos de prueba.`;
        this.errorScenarios = errorMsg;
        if (this.generatedHUData) {
          const errorTc: UIDetailedTestCase = {
            title: `Error Crítico en ${mode === 'initial' ? 'Generación' : 'Refinamiento'} `,
            preconditions: errorMsg,
            steps: [],
            expectedResults: "N/A",
            isExpanded: true
          };
          this.generatedHUData.detailedTestCases = [errorTc];
          this.generatedHUData.generatedTestCaseTitles = "Error en el proceso.";
        }
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
      this.refinementTechnique = this.generatedHUData.originalInput.selectedTechnique || '';
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

  toggleTestCaseExpansion(tc: UIDetailedTestCase, tcIndex: number): void {
    if (!this.generatedHUData || !this.generatedHUData.detailedTestCases) return;
    tc.isExpanded = !tc.isExpanded;
    this.cdr.detectChanges();
    if (tc.isExpanded) {
      setTimeout(() => this.autoGrowTextareasInCardByIndex(tcIndex), 0);
    }
  }

  refineHuCasesWithAI(): void {
    if (!this.generatedHUData) {
      this.formError = "No hay datos generados para refinar.";
      return;
    }
    if (!this.refinementTechnique) {
      this.formError = "Por favor, selecciona una técnica para el refinamiento.";
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
    this.cdr.detectChanges();
  }

  // Handlers para el nuevo componente TestCaseEditor
  handleRefineWithAI(event: { technique: string; context: string }): void {
    this.refinementTechnique = event.technique;
    this.userRefinementContext = event.context;
    this.refineHuCasesWithAI();
  }

  handleTestCasesChanged(testCases: EditorUIDetailedTestCase[]): void {
    if (this.generatedHUData) {
      // Guardar la posición actual del scroll antes de actualizar
      const scrollY = window.scrollY;
      const scrollX = window.scrollX;
      
      this.generatedHUData.detailedTestCases = testCases;
      
      // Usar markForCheck en lugar de detectChanges para evitar scroll jumps
      this.cdr.markForCheck();
      
      // Restaurar la posición del scroll
      setTimeout(() => {
        window.scrollTo(scrollX, scrollY);
      }, 0);
    }
  }

  formatSimpleScenarioTitles(titles: string[]): string {
    if (!titles?.length) return 'No se generaron escenarios.';
    return titles.map((t, i) => `${i + 1}. ${t}`).join('\n');
  }

  handleCancelGeneration() {
    // Si hay datos generados, preguntar si quiere guardarlos
    if (this.generatedHUData && 
        this.generatedHUData.detailedTestCases && 
        this.generatedHUData.detailedTestCases.length > 0 &&
        !this.generatedHUData.detailedTestCases[0].title.startsWith('Error')) {
      
      const confirmMessage = `¿Deseas guardar la HU "${this.generatedHUData.title}" antes de cancelar?\n\n` +
                           `⚠️ IMPORTANTE: Si cancelas sin guardar, se perderán todos los casos de prueba generados.\n\n` +
                           `💾 "Guardar HU" = Guardado temporal (solo navegador)\n` +
                           `🗄️ "Confirmar y Añadir al Plan" = Guardado permanente (base de datos)\n\n` +
                           `• Clic en OK = Guardar HU temporalmente y cancelar\n` +
                           `• Clic en Cancelar = Descartar HU completamente`;
      
      if (confirm(confirmMessage)) {
        // Guardar la HU antes de cancelar
        console.log('💾 Usuario eligió GUARDAR la HU antes de cancelar');
        this.saveCurrentHU();
        // No llamamos a resetToInitialForm aquí porque saveCurrentHU ya lo hace
        this.generationCancelled.emit();
      } else {
        // Descartar la HU
        console.log('🗑️ Usuario eligió DESCARTAR la HU');
        this.resetToInitialForm();
        this.generationCancelled.emit();
      }
    } else {
      // No hay datos que guardar, cancelar directamente
      this.resetToInitialForm();
      this.generationCancelled.emit();
    }
  }

  addTestCaseStep(testCase: UIDetailedTestCase): void {
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
    }, 0);
  }

  deleteTestCaseStep(testCase: UIDetailedTestCase, stepIndex: number): void {
    if (testCase.steps) {
      testCase.steps.splice(stepIndex, 1);
      testCase.steps.forEach((step: TestCaseStep, idx: number) => step.numero_paso = idx + 1);
      this.cdr.detectChanges();
    }
  }

  getTestCaseStepDragId(testCase: UIDetailedTestCase, step: TestCaseStep): string {
    const stepIndex = testCase.steps.indexOf(step);
    return `tc-${this.generatedHUData?.id || 'temp'}-step-${stepIndex}`;
  }

  onTestCaseStepDragStart(event: DragEvent, step: TestCaseStep, testCase: UIDetailedTestCase): void {
    this.draggedTestCaseStep = step;
    if (event.dataTransfer) {
      const stepIndex = testCase.steps.indexOf(step);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', stepIndex.toString());
      const targetEl = event.target as HTMLElement;
      const rowEl = targetEl.closest('tr');
      if (rowEl) rowEl.style.opacity = '0.4';
    }
  }

  onTestCaseStepDragOver(event: DragEvent, targetStep: TestCaseStep | undefined, testCase: UIDetailedTestCase): void {
    event.preventDefault();
    if (this.draggedTestCaseStep && event.dataTransfer && targetStep) {
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

  onTestCaseStepDrop(event: DragEvent, targetStep: TestCaseStep | undefined, testCase: UIDetailedTestCase): void {
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

    /**
   * Guarda la HU actual individualmente (sin salir del formulario)
   * Este método permite acumular múltiples HUs antes de confirmar el plan completo
   */
  saveCurrentHU() {
    if (this.generatedHUData && 
        this.generatedHUData.detailedTestCases && 
        this.generatedHUData.detailedTestCases.length > 0 &&
        !this.generatedHUData.detailedTestCases[0].title.startsWith('Error')) {
      
      // Preparar datos usando el mismo método que confirmAndEmitHUDataToPlan
      const dataToEmit: OriginalHUData = this.prepareHUDataForEmit();
      
      console.log('💾 GUARDANDO HU INDIVIDUAL (sin crear plan):', dataToEmit.title);
      console.log('📊 HUs acumuladas antes:', this.accumulatedHUsCount);
      
      // Emitir al padre para que acumule en memoria
      this.huSaved.emit(dataToEmit);
      
      console.log('📊 HUs acumuladas después:', this.accumulatedHUsCount + 1);
      
      // Mostrar confirmación al usuario
      this.toastService.info(`HU "${dataToEmit.title}" guardada temporalmente (${this.accumulatedHUsCount + 1} HUs guardadas)`, 4000);
      
      // Resetear formulario para permitir agregar otra HU
      setTimeout(() => {
        this.resetToInitialForm();
        this.componentState = 'initialForm';
      }, 100);
    } else {
      this.toastService.warning('No hay datos válidos para guardar. Por favor genera casos de prueba primero');
    }
  }

  /**
   * Confirma y envía señal al padre para crear el plan de pruebas
   * Siempre guarda la HU actual (si existe) antes de crear el plan
   */
  confirmAndEmitHUDataToPlan() {
    // Calcular el número total de HUs que se guardarán
    const totalHUs = this.generatedHUData ? this.accumulatedHUsCount + 1 : this.accumulatedHUsCount;
    
    if (totalHUs === 0) {
      this.toastService.warning('No hay HUs para guardar');
      return;
    }
    
    if (this.generatedHUData) {
      this.componentState = 'submitting';
      
      // Preparar datos de la HU actual
      const dataToEmit: OriginalHUData = this.prepareHUDataForEmit();
      
      console.log('📤 CONFIRMANDO Y AÑADIENDO AL PLAN - HU actual:', dataToEmit.title);
      console.log('📊 Contador de HUs acumuladas antes:', this.accumulatedHUsCount);
      
      // Emitir al padre - esto guardará la HU y creará el plan con toasts
      this.huGenerated.emit(dataToEmit);
      
      // Resetear el formulario después de emitir
      setTimeout(() => {
        this.resetToInitialForm();
      }, 500);
      
    } else {
      // Si no hay HU actual, mostrar mensaje
      console.warn('[WARNING] No hay HU generada para añadir al plan');
      console.log('[INFO] HUs acumuladas disponibles:', this.accumulatedHUsCount);
      
      // Si hay HUs guardadas previamente, el plan se puede crear igual
      if (this.accumulatedHUsCount > 0) {
        console.log('[PLAN] Creando plan con HUs guardadas previamente');
        
        // Emitir evento vacío para indicar que se debe crear el plan con las HUs existentes
        this.huGenerated.emit({} as any);
        
        // Resetear el formulario
        setTimeout(() => {
          this.resetToInitialForm();
        }, 500);
      } else {
        this.toastService.warning('No hay HUs guardadas para crear un plan');
      }
    }
  }

  /**
   * Prepara los datos de la HU para emitir al padre
   * Centraliza la lógica de limpieza y formato
   */
  private prepareHUDataForEmit(): OriginalHUData {
    const dataToEmit: OriginalHUData = {
      ...this.generatedHUData!,
      detailedTestCases: (this.generatedHUData!.detailedTestCases || []).map(uiTc => {
        uiTc.title = (uiTc.title || "").trim() || "Caso de prueba sin título";
        uiTc.preconditions = (uiTc.preconditions || "").trim() || "N/A";
        uiTc.expectedResults = (uiTc.expectedResults || "").trim() || "N/A";
        if (uiTc.steps) {
          uiTc.steps.forEach(step => {
            step.accion = (step.accion || "").trim() || "Acción no definida.";
          });
        } else {
          uiTc.steps = [{ numero_paso: 1, accion: "Pasos no definidos." }];
        }
        if (uiTc.steps.length === 0) {
          uiTc.steps.push({ numero_paso: 1, accion: "Pasos no definidos." });
        }
        const { isExpanded, ...originalTc } = uiTc;
        return originalTc as OriginalDetailedTestCase;
      })
    };
    
    dataToEmit.generatedTestCaseTitles = this.formatSimpleScenarioTitles(
      (dataToEmit.detailedTestCases || []).map(tc => tc.title)
    );
    
    if (this.refinementTechnique && dataToEmit.originalInput.selectedTechnique !== this.refinementTechnique) {
      dataToEmit.originalInput.selectedTechnique = this.refinementTechnique;
    }
    
    return dataToEmit;
  }

  exportExecutionMatrixLocal(): void {
    if (!this.generatedHUData || !this.generatedHUData.detailedTestCases || this.generatedHUData.detailedTestCases.length === 0 || this.generatedHUData.detailedTestCases.some(tc => tc.title.startsWith("Error") || tc.title === "Información Insuficiente" || tc.title === "Imágenes no interpretables o técnica no aplicable" || tc.title === "Refinamiento no posible con el contexto actual")) {
      this.toastService.warning('No hay casos de prueba válidos para exportar o los casos generados indican un error');
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
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}