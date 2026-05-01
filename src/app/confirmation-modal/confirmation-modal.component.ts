import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
    selector: 'app-confirmation-modal',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './confirmation-modal.component.html',
    styleUrls: ['./confirmation-modal.component.css']
})
export class ConfirmationModalComponent {
    @Input() isOpen = false;
    @Input() title = 'Confirmación';
    @Input() message = '¿Estás seguro?';
    @Input() confirmText = 'Confirmar';
    @Input() cancelText = 'Cancelar';
    @Input() type: 'danger' | 'warning' | 'info' = 'info';
    @Input() mode: 'confirm' | 'progress' = 'confirm';
    @Input() progressHint = 'Este proceso puede tardar unos segundos.';
    @Input() progressStep = 'Procesando...';
    @Input() showProgressBar = true;
    @Input() allowBackdropClose = true;
    /** Texto de razonamiento interno (CoT) del modelo recibido vía stream */
    @Input() streamingReasoning: string = '';
    /** Contenido JSON generándose en tiempo real vía stream */
    @Input() streamingContent: string = '';

    /** Calcula el porcentaje de progreso basado en las fases del stream */
    get streamProgress(): number {
        if (this.streamingPhase === 'idle') return 0;
        if (this.streamingPhase === 'thinking') {
            // 0-40% mientras está pensando (razonamiento CoT)
            return Math.min(40, 5 + (this.streamingReasoning?.length ?? 0) / 100);
        }
        if (this.streamingPhase === 'generating') {
            // 40-95% mientras genera contenido (JSON)
            return Math.min(95, 40 + (this.streamingContent?.length ?? 0) / 200);
        }
        return 0;
    }

    /** Porcentaje redondeado sin decimales */
    get streamProgressPercent(): number {
        return Math.round(this.streamProgress);
    }

    /** Fase actual del stream: pensando (CoT), generando (JSON) o inactivo */
    get streamingPhase(): 'idle' | 'thinking' | 'generating' {
        if (this.streamingContent?.trim()) return 'generating';
        if (this.streamingReasoning?.trim()) return 'thinking';
        return 'idle';
    }

    /** Mensaje amigable según la fase */
    get streamingPhaseLabel(): string {
        if (this.streamingPhase === 'thinking') {
            return 'Analizando criterios de aceptación y diseñando escenarios…';
        }
        if (this.streamingPhase === 'generating') {
            return 'Construyendo casos de prueba…';
        }
        return '';
    }

    /** Extrae los títulos de casos de prueba del JSON parcial del stream */
    get streamingCaseTitles(): string[] {
        if (!this.streamingContent) return [];
        const regex = /"title"\s*:\s*"([^"]+)"/g;
        const titles: string[] = [];
        let match;
        while ((match = regex.exec(this.streamingContent)) !== null) {
            titles.push(match[1]);
        }
        return titles;
    }

    /** Devuelve los últimos N caracteres del texto para mostrar en el modal */
    getLastChars(text: string, n: number): string {
        if (!text) return '';
        return text.length > n ? '…' + text.slice(-n) : text;
    }

    @Output() confirm = new EventEmitter<void>();
    @Output() cancel = new EventEmitter<void>();

    get isProgressMode(): boolean {
        return this.mode === 'progress';
    }

    onOverlayClick(): void {
        if (this.isProgressMode || !this.allowBackdropClose) return;
        this.onCancel();
    }

    onConfirm() {
        if (this.isProgressMode) return;
        this.confirm.emit();
        this.close();
    }

    onCancel() {
        if (this.isProgressMode) return;
        this.cancel.emit();
        this.close();
    }

    close() {
        this.isOpen = false;
    }

    open() {
        this.isOpen = true;
    }
}
