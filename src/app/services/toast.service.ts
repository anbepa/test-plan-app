import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info' | 'loading';
  duration?: number; // milliseconds, 0 = infinite
  action?: {
    text: string;
    callback: () => void;
  };
}

@Injectable({
  providedIn: 'root'
})
export class ToastService {
  private toastsSubject = new BehaviorSubject<Toast[]>([]);
  public toasts$ = this.toastsSubject.asObservable();

  private idCounter = 0;

  constructor() {}

  /**
   * Muestra un toast de éxito
   */
  success(message: string, duration: number = 4000): string {
    return this.show({ message, type: 'success', duration });
  }

  /**
   * Muestra un toast de error
   */
  error(message: string, duration: number = 5000): string {
    return this.show({ message, type: 'error', duration });
  }

  /**
   * Muestra un toast de advertencia
   */
  warning(message: string, duration: number = 4500): string {
    return this.show({ message, type: 'warning', duration });
  }

  /**
   * Muestra un toast informativo
   */
  info(message: string, duration: number = 4000): string {
    return this.show({ message, type: 'info', duration });
  }

  /**
   * Muestra un toast de carga (se queda hasta que se cierre manualmente)
   */
  loading(message: string): string {
    return this.show({ message, type: 'loading', duration: 0 });
  }

  /**
   * Muestra un toast personalizado
   */
  show(toast: Omit<Toast, 'id'>): string {
    // Validar que haya mensaje
    if (!toast.message || toast.message.trim() === '') {
      console.warn('⚠️ Intento de mostrar toast sin mensaje:', toast);
      return '';
    }
    
    const id = `toast-${++this.idCounter}`;
    const newToast: Toast = { ...toast, id };
    
    const currentToasts = this.toastsSubject.value;
    this.toastsSubject.next([...currentToasts, newToast]);

    // Auto-remover si tiene duración
    if (toast.duration && toast.duration > 0) {
      setTimeout(() => {
        this.dismiss(id);
      }, toast.duration);
    }

    return id;
  }

  /**
   * Cierra un toast específico por su ID
   */
  dismiss(id: string): void {
    const currentToasts = this.toastsSubject.value;
    this.toastsSubject.next(currentToasts.filter(t => t.id !== id));
  }

  /**
   * Cierra todos los toasts
   */
  dismissAll(): void {
    this.toastsSubject.next([]);
  }

  /**
   * Actualiza un toast existente (útil para cambiar un loading a success/error)
   */
  update(id: string, updates: Partial<Omit<Toast, 'id'>>): void {
    // Validar que si hay mensaje, no esté vacío
    if (updates.message !== undefined && (!updates.message || updates.message.trim() === '')) {
      console.warn('⚠️ Intento de actualizar toast con mensaje vacío:', { id, updates });
      return;
    }
    
    const currentToasts = this.toastsSubject.value;
    const toastIndex = currentToasts.findIndex(t => t.id === id);
    
    if (toastIndex !== -1) {
      const updatedToast = { ...currentToasts[toastIndex], ...updates };
      const newToasts = [...currentToasts];
      newToasts[toastIndex] = updatedToast;
      this.toastsSubject.next(newToasts);

      // Si se actualiza con duración, programar auto-cierre
      if (updates.duration && updates.duration > 0) {
        setTimeout(() => {
          this.dismiss(id);
        }, updates.duration);
      }
    } else {
      console.warn('⚠️ No se encontró toast con ID:', id);
    }
  }
}