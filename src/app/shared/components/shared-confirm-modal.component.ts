import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-shared-confirm-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-md p-4 animate-fade-in" *ngIf="isOpen">
      <div class="bg-white rounded-[28px] shadow-2xl border border-gray-100 max-w-md w-full overflow-hidden transform transition-all animate-scale-in">
        <div class="p-8 text-center">
          <div [ngClass]="{
            'w-16 h-16 rounded-2xl flex items-center justify-center mb-6 mx-auto': true,
            'bg-red-50 text-red-500': variant === 'danger',
            'bg-blue-50 text-blue-500': variant === 'primary'
          }">
            <svg *ngIf="variant === 'danger'" class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <svg *ngIf="variant === 'primary'" class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          
          <h3 class="text-2xl font-bold text-gray-900 mb-2 tracking-tight">{{ title }}</h3>
          <p class="text-sm text-gray-500 mb-8 leading-relaxed">
            {{ message }}
          </p>
          
          <div class="flex flex-col gap-3">
            <button
              (click)="onConfirm.emit()"
              [ngClass]="{
                'w-full py-4 font-bold rounded-2xl transition-all shadow-lg active:scale-95': true,
                'bg-red-500 text-white hover:bg-red-600 shadow-red-200': variant === 'danger',
                'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-200': variant === 'primary'
              }"
            >
              {{ confirmText }}
            </button>
            <button
              (click)="onClose.emit()"
              class="w-full py-3 text-sm font-bold text-gray-500 hover:text-gray-700 transition-colors"
            >
              {{ cancelText }}
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .animate-fade-in {
      animation: fadeIn 0.2s ease-out;
    }
    .animate-scale-in {
      animation: scaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes scaleIn {
      from { opacity: 0; transform: scale(0.9); }
      to { opacity: 1; transform: scale(1); }
    }
  `]
})
export class SharedConfirmModalComponent {
  @Input() isOpen = false;
  @Input() title = '¿Estás seguro?';
  @Input() message = 'Esta acción no se puede deshacer.';
  @Input() confirmText = 'Eliminar';
  @Input() cancelText = 'Cancelar';
  @Input() variant: 'danger' | 'primary' = 'danger';

  @Output() onClose = new EventEmitter<void>();
  @Output() onConfirm = new EventEmitter<void>();
}
