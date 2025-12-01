import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CoTStepResult } from '../services/ai/gemini.service';

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
        { id: 'ARCHITECT', label: 'Arquitecto', icon: '1', description: 'Definiendo estrategia...' },
        { id: 'GENERATOR', label: 'Generador', icon: '2', description: 'Creando casos de prueba...' },
        { id: 'AUDITOR', label: 'Auditor', icon: '3', description: 'Verificando calidad...' }
    ];

    stepStatus: { [key: string]: 'pending' | 'in_progress' | 'completed' | 'error' } = {
        'ARCHITECT': 'pending',
        'GENERATOR': 'pending',
        'AUDITOR': 'pending'
    };

    currentMessage: string = 'Iniciando proceso...';

    processDetails: string | null = null;

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
        this.currentMessage = 'Iniciando análisis inteligente...';
        this.processDetails = null;
    }

    private updateStatus(result: CoTStepResult): void {
        this.stepStatus[result.step] = result.status;

        // Mensajes más amigables según el paso
        if (result.status === 'in_progress') {
            if (result.step === 'ARCHITECT') this.currentMessage = 'Analizando requisitos y definiendo estrategia de pruebas...';
            if (result.step === 'GENERATOR') this.currentMessage = 'Redactando escenarios de prueba detallados paso a paso...';
            if (result.step === 'AUDITOR') this.currentMessage = 'Revisando consistencia, ortografía y cobertura...';
        } else if (result.message) {
            this.currentMessage = result.message;
        }

        // Extraer detalles interesantes
        if (result.step === 'ARCHITECT' && result.status === 'completed' && result.data?.scope_definition) {
            this.processDetails = `Alcance definido: ${result.data.scope_definition.substring(0, 150)}...`;
        }

        if (result.step === 'GENERATOR' && result.status === 'completed' && result.data?.detailedTestCases) {
            const count = result.data.detailedTestCases.length;
            this.processDetails = `Se han redactado ${count} casos de prueba preliminares.`;
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
