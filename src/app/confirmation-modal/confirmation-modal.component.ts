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

    @Output() confirm = new EventEmitter<void>();
    @Output() cancel = new EventEmitter<void>();

    onConfirm() {
        this.confirm.emit();
        this.close();
    }

    onCancel() {
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
