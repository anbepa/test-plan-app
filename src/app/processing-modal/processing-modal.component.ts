import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CoTStepResult } from '../services/gemini.service';

@Component({
    selector: 'app-processing-modal',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './processing-modal.component.html',
    styleUrls: ['./processing-modal.component.css']
})
export class ProcessingModalComponent implements OnChanges {
    @Input() isVisible: boolean = false;
    @Input() currentStepResult: CoTStepResult | null = null;

    steps = [
        { id: 'ARCHITECT', label: 'Arquitecto', icon: '📐', description: 'Definiendo estrategia...' },
        { id: 'GENERATOR', label: 'Generador', icon: '⚙️', description: 'Creando casos de prueba...' },
        { id: 'AUDITOR', label: 'Auditor', icon: '🔍', description: 'Verificando calidad...' }
    ];

    stepStatus: { [key: string]: 'pending' | 'in_progress' | 'completed' | 'error' } = {
        'ARCHITECT': 'pending',
        'GENERATOR': 'pending',
        'AUDITOR': 'pending'
    };

    currentMessage: string = 'Iniciando proceso...';

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['isVisible'] && this.isVisible) {
            this.reset();
        }

        if (changes['currentStepResult'] && this.currentStepResult) {
            this.updateStatus(this.currentStepResult);
        }
    }

    private reset(): void {
        this.stepStatus = {
            'ARCHITECT': 'pending',
            'GENERATOR': 'pending',
            'AUDITOR': 'pending'
        };
        this.currentMessage = 'Iniciando proceso...';
    }

    private updateStatus(result: CoTStepResult): void {
        this.stepStatus[result.step] = result.status;
        if (result.message) {
            this.currentMessage = result.message;
        }

        // Auto-complete previous steps if current is in progress
        if (result.status === 'in_progress') {
            const stepOrder = ['ARCHITECT', 'GENERATOR', 'AUDITOR'];
            const currentIndex = stepOrder.indexOf(result.step);
            for (let i = 0; i < currentIndex; i++) {
                this.stepStatus[stepOrder[i]] = 'completed';
            }
        }
    }
}
