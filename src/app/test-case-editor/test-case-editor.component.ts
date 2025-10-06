// src/app/test-case-editor/test-case-editor.component.ts
import { Component, Input, Output, EventEmitter, ChangeDetectorRef, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DetailedTestCase, TestCaseStep, HUData } from '../models/hu-data.model';

export interface UIDetailedTestCase extends DetailedTestCase {
  isExpanded?: boolean;
}

@Component({
  selector: 'app-test-case-editor',
  templateUrl: './test-case-editor.component.html',
  styleUrls: ['./test-case-editor.component.css'],
  standalone: true,
  imports: [CommonModule, FormsModule]
})
export class TestCaseEditorComponent implements OnInit {
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

  // Drag and drop state
  draggedStep: TestCaseStep | null = null;
  draggedStepTestCase: UIDetailedTestCase | null = null;
  dragOverStepId: string = '';

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    // Inicializar el primer caso como expandido si no hay ninguno expandido
    if (this.testCases && this.testCases.length > 0 && !this.testCases.some(tc => tc.isExpanded)) {
      this.testCases[0].isExpanded = true;
    }
  }

  toggleTestCaseExpansion(tc: UIDetailedTestCase, tcIndex: number): void {
    tc.isExpanded = !tc.isExpanded;
    this.cdr.detectChanges();
    if (tc.isExpanded) {
      setTimeout(() => this.autoGrowTextareasInCard(tcIndex), 0);
    }
  }

  onRefineWithAI(): void {
    if (!this.refinementTechnique) {
      alert('Por favor, selecciona una técnica para el refinamiento.');
      return;
    }
    
    // Validar pasos antes de refinar
    this.testCases.forEach(tc => {
      if (tc.steps) {
        tc.steps.forEach(step => {
          if (!step.accion || step.accion.trim() === '') {
            step.accion = "Acción no definida por el usuario.";
          }
        });
      }
    });
    
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
    testCase.steps.push({ 
      numero_paso: testCase.steps.length + 1, 
      accion: '' 
    });
    this.emitChanges();
    this.cdr.detectChanges();
  }

  deleteTestCaseStep(testCase: UIDetailedTestCase, stepIndex: number): void {
    if (!testCase.steps) return;
    testCase.steps.splice(stepIndex, 1);
    // Renumerar pasos
    testCase.steps.forEach((step, idx) => {
      step.numero_paso = idx + 1;
    });
    this.emitChanges();
    this.cdr.detectChanges();
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

    // Solo permitir reordenar dentro del mismo caso de prueba
    if (this.draggedStepTestCase !== targetTestCase) {
      this.dragOverStepId = '';
      return;
    }

    const draggedIndex = targetTestCase.steps.indexOf(this.draggedStep);
    const targetIndex = targetTestCase.steps.indexOf(targetStep);

    if (draggedIndex !== -1 && targetIndex !== -1 && draggedIndex !== targetIndex) {
      // Reordenar
      targetTestCase.steps.splice(draggedIndex, 1);
      targetTestCase.steps.splice(targetIndex, 0, this.draggedStep);
      
      // Renumerar
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

  onTestCaseChange(): void {
    this.emitChanges();
  }

  onRefinementTechniqueChange(): void {
    this.refinementTechniqueChange.emit(this.refinementTechnique);
  }

  onUserRefinementContextChange(): void {
    this.userRefinementContextChange.emit(this.userRefinementContext);
  }
}
