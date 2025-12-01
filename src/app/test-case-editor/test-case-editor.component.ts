import { Component, Input, Output, EventEmitter, ChangeDetectorRef, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DetailedTestCase, TestCaseStep, HUData } from '../models/hu-data.model';
import { ToastService } from '../services/core/toast.service';
import { ConfirmationModalComponent } from '../confirmation-modal/confirmation-modal.component';

export interface UIDetailedTestCase extends DetailedTestCase {
  isExpanded?: boolean;
}

@Component({
  selector: 'app-test-case-editor',
  templateUrl: './test-case-editor.component.html',
  styleUrls: ['./test-case-editor.component.css'],
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmationModalComponent]
})
export class TestCaseEditorComponent implements OnInit, OnDestroy {
  @Input() testCases: UIDetailedTestCase[] = [];
  @Input() huId: string = '';
  @Input() isLoading: boolean = false;
  @Input() refinementTechnique: string = '';
  @Input() userRefinementContext: string = '';
  @Input() showRefinementControls: boolean = true;

  @Output() refineWithAI = new EventEmitter<{ technique: string; context: string }>();
  @Output() testCasesChanged = new EventEmitter<UIDetailedTestCase[]>();
  @Output() cancel = new EventEmitter<void>();
  @Output() refinementTechniqueChange = new EventEmitter<string>();
  @Output() userRefinementContextChange = new EventEmitter<string>();

  draggedStep: TestCaseStep | null = null;
  draggedStepTestCase: UIDetailedTestCase | null = null;
  dragOverStepId: string = '';

  isDeleteModalOpen = false;
  deleteModalTitle = '';
  deleteModalMessage = '';
  pendingDeletion: { type: 'testCase' | 'step' | 'allTestCases'; testCaseIndex?: number; stepIndex?: number } | null = null;

  private debounceTimer: any = null;
  private readonly DEBOUNCE_TIME = 1000;

  constructor(
    private cdr: ChangeDetectorRef,
    private toastService: ToastService
  ) { }

  ngOnInit() {
    if (this.testCases && this.testCases.length > 0 && !this.testCases.some(tc => tc.isExpanded)) {
      this.testCases[0].isExpanded = true;
    }
  }

  toggleTestCaseExpansion(tc: UIDetailedTestCase, tcIndex: number): void {
    const scrollY = window.scrollY;
    const scrollX = window.scrollX;

    const willExpand = !tc.isExpanded;

    if (willExpand) {
      this.ensureSingleExpanded(tcIndex);
    } else {
      tc.isExpanded = false;
    }

    this.cdr.markForCheck();

    setTimeout(() => {
      window.scrollTo(scrollX, scrollY);

      if (tc.isExpanded) {
        this.autoGrowTextareasInCard(tcIndex);
      }
    }, 0);
  }

  onRefineWithAI(): void {
    if (!this.refinementTechnique) {
      this.toastService.warning('Por favor, selecciona una técnica para el refinamiento');
      return;
    }

    this.refineWithAI.emit({
      technique: this.refinementTechnique,
      context: this.userRefinementContext
    });
  }

  onCancel(): void {
    this.cancel.emit();
  }

  addTestCaseStep(testCase: UIDetailedTestCase): void {
    if (!testCase.steps) testCase.steps = [];
    const newStepIndex = testCase.steps.length;

    testCase.steps.push({
      numero_paso: newStepIndex + 1,
      accion: ''
    });

    const tcIndex = this.testCases.indexOf(testCase);

    this.ensureSingleExpanded(tcIndex);

    const scrollY = window.scrollY;
    const scrollX = window.scrollX;
    const activeElement = document.activeElement as HTMLElement;

    this.emitChanges();

    this.cdr.markForCheck();

    setTimeout(() => {
      window.scrollTo(scrollX, scrollY);

      const stepInput = document.querySelector(`textarea[name="stepAction-tc${tcIndex}-step${newStepIndex}"]`) as HTMLTextAreaElement;
      if (stepInput) {
        stepInput.focus();
      }
    }, 0);
  }

  deleteTestCaseStep(testCase: UIDetailedTestCase, stepIndex: number): void {
    if (!testCase.steps) return;
    testCase.steps.splice(stepIndex, 1);
    testCase.steps.forEach((step, idx) => {
      step.numero_paso = idx + 1;
    });

    const tcIndex = this.testCases.indexOf(testCase);
    this.ensureSingleExpanded(tcIndex);

    const scrollY = window.scrollY;
    const scrollX = window.scrollX;

    this.emitChanges();

    this.cdr.markForCheck();

    setTimeout(() => {
      window.scrollTo(scrollX, scrollY);
    }, 0);
  }

  addStep(testCase: UIDetailedTestCase): void {
    this.addTestCaseStep(testCase);
  }

  addTestCase(): void {
    const newTestCase: UIDetailedTestCase = {
      title: 'Nuevo Caso de Prueba',
      preconditions: '',
      steps: [],
      expectedResults: '',
      isExpanded: true
    };
    this.testCases.push(newTestCase);
    const newIndex = this.testCases.length - 1;
    this.ensureSingleExpanded(newIndex);
    this.emitChanges();
    this.cdr.detectChanges();
  }

  deleteTestCase(testCaseIndex: number): void {
    this.pendingDeletion = { type: 'testCase', testCaseIndex };
    this.deleteModalTitle = 'Eliminar caso de prueba';
    this.deleteModalMessage = '¿Estás seguro de eliminar este caso de prueba? Esta acción no se puede deshacer.';
    this.isDeleteModalOpen = true;
  }

  deleteAllTestCases(): void {
    this.pendingDeletion = { type: 'allTestCases' };
    this.deleteModalTitle = 'Eliminar todos los casos de prueba';
    this.deleteModalMessage = '¿Estás seguro de eliminar TODOS los casos de prueba? Esta acción no se puede deshacer.';
    this.isDeleteModalOpen = true;
  }

  // Drag and drop functionality
  onStepDragStart(event: DragEvent, step: TestCaseStep, testCase: UIDetailedTestCase): void {
    this.draggedStep = step;
    this.draggedStepTestCase = testCase;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onStepDragOver(event: DragEvent, step: TestCaseStep, testCase: UIDetailedTestCase): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    this.dragOverStepId = this.getStepDragId(testCase, step);
  }

  onStepDrop(event: DragEvent, targetStep: TestCaseStep, targetTestCase: UIDetailedTestCase): void {
    event.preventDefault();
    event.stopPropagation();

    if (!this.draggedStep || !this.draggedStepTestCase || !targetTestCase.steps) {
      return;
    }

    if (this.draggedStepTestCase !== targetTestCase) {
      this.dragOverStepId = '';
      return;
    }

    const draggedIndex = targetTestCase.steps.indexOf(this.draggedStep);
    const targetIndex = targetTestCase.steps.indexOf(targetStep);

    if (draggedIndex !== -1 && targetIndex !== -1 && draggedIndex !== targetIndex) {
      targetTestCase.steps.splice(draggedIndex, 1);
      targetTestCase.steps.splice(targetIndex, 0, this.draggedStep);

      targetTestCase.steps.forEach((step, idx) => {
        step.numero_paso = idx + 1;
      });

      this.emitChanges();
    }

    this.dragOverStepId = '';
  }

  onStepDragEnd(event: DragEvent): void {
    this.draggedStep = null;
    this.draggedStepTestCase = null;
    this.dragOverStepId = '';
  }

  onStepDragLeave(event: DragEvent): void {
    const relatedTarget = event.relatedTarget as HTMLElement;
    if (!relatedTarget || !event.currentTarget || !(event.currentTarget as HTMLElement).contains(relatedTarget)) {
      this.dragOverStepId = '';
    }
  }

  getStepDragId(testCase: UIDetailedTestCase, step: TestCaseStep): string {
    const tcIndex = this.testCases.indexOf(testCase);
    const stepIndex = testCase.steps?.indexOf(step) ?? -1;
    return `${this.huId}-tc${tcIndex}-step${stepIndex}`;
  }

  autoGrowTextarea(element: any): void {
    if (element && element.style) {
      element.style.height = 'auto';
      element.style.height = (element.scrollHeight) + 'px';
    }
  }

  autoGrowTextareasInCard(tcIndex: number): void {
    setTimeout(() => {
      const card = document.getElementById(`test-case-card-${this.huId}-${tcIndex}`);
      if (card) {
        const textareas = card.querySelectorAll('textarea');
        textareas.forEach((textarea: any) => {
          this.autoGrowTextarea(textarea);
        });
      }
    }, 0);
  }

  emitChanges(): void {
    this.testCasesChanged.emit(this.testCases);
  }

  emitChangesWithDebounce(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.emitChanges();
    }, this.DEBOUNCE_TIME);
  }

  onTestCaseChange(): void {
    this.emitChangesWithDebounce();
  }

  ngOnDestroy(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.emitChanges();
    }
  }

  onRefinementTechniqueChange(): void {
    this.refinementTechniqueChange.emit(this.refinementTechnique);
  }

  onUserRefinementContextChange(): void {
    this.userRefinementContextChange.emit(this.userRefinementContext);
  }

  confirmDeletion(): void {
    if (!this.pendingDeletion) return;

    if (this.pendingDeletion.type === 'testCase' && this.pendingDeletion.testCaseIndex !== undefined) {
      this.testCases.splice(this.pendingDeletion.testCaseIndex, 1);
    } else if (this.pendingDeletion.type === 'step' && this.pendingDeletion.testCaseIndex !== undefined && this.pendingDeletion.stepIndex !== undefined) {
      const targetTestCase = this.testCases[this.pendingDeletion.testCaseIndex];
      if (targetTestCase?.steps) {
        targetTestCase.steps.splice(this.pendingDeletion.stepIndex, 1);
        targetTestCase.steps.forEach((step, idx) => {
          step.numero_paso = idx + 1;
        });
        this.ensureSingleExpanded(this.pendingDeletion.testCaseIndex);
      }
    } else if (this.pendingDeletion.type === 'allTestCases') {
      this.testCases.splice(0, this.testCases.length);
    }

    this.emitChanges();
    this.cdr.detectChanges();
    this.closeDeleteModal();
  }

  closeDeleteModal(): void {
    this.isDeleteModalOpen = false;
    this.pendingDeletion = null;
  }

  requestDeleteStep(testCase: UIDetailedTestCase, stepIndex: number): void {
    const tcIndex = this.testCases.indexOf(testCase);
    this.pendingDeletion = { type: 'step', testCaseIndex: tcIndex, stepIndex };
    this.deleteModalTitle = 'Eliminar paso';
    this.deleteModalMessage = '¿Estás seguro de eliminar este paso del caso de prueba? Esta acción no se puede deshacer.';
    this.isDeleteModalOpen = true;
  }

  private ensureSingleExpanded(activeIndex: number): void {
    this.testCases.forEach((testCase, idx) => {
      testCase.isExpanded = idx === activeIndex && activeIndex >= 0;
    });
  }
}
