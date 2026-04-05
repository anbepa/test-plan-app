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
