// src/app/services/local-storage.service.ts
import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HUData } from '../models/hu-data.model';

export interface TestPlanState {
  testPlanTitle: string;
  huList: HUData[];
  repositoryLink: string;
  outOfScopeContent: string;
  strategyContent: string;
  limitationsContent: string;
  assumptionsContent: string;
  teamContent: string;
  lastUpdated: string;
}

@Injectable({
  providedIn: 'root'
})
export class LocalStorageService {
  private readonly STORAGE_KEY = 'test-plan-generator-data';
  private readonly AUTO_SAVE_DEBOUNCE_TIME = 1000; // 1 segundo
  private autoSaveTimeout: any;

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  /**
   * Guarda el estado completo del plan de pruebas en localStorage
   */
  saveTestPlanState(state: TestPlanState): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    try {
      state.lastUpdated = new Date().toISOString();
      const serialized = JSON.stringify(state);
      localStorage.setItem(this.STORAGE_KEY, serialized);
      console.log('✅ Test Plan guardado en localStorage');
    } catch (error) {
      console.error('❌ Error guardando en localStorage:', error);
      this.handleStorageError(error);
    }
  }

  /**
   * Guarda con debounce para evitar múltiples escrituras consecutivas
   */
  autoSaveTestPlanState(state: TestPlanState): void {
    if (this.autoSaveTimeout) {
      clearTimeout(this.autoSaveTimeout);
    }

    this.autoSaveTimeout = setTimeout(() => {
      this.saveTestPlanState(state);
    }, this.AUTO_SAVE_DEBOUNCE_TIME);
  }

  /**
   * Recupera el estado del plan de pruebas desde localStorage
   */
  loadTestPlanState(): TestPlanState | null {
    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }

    try {
      const serialized = localStorage.getItem(this.STORAGE_KEY);
      if (!serialized) {
        return null;
      }

      const state = JSON.parse(serialized) as TestPlanState;
      console.log('✅ Test Plan cargado desde localStorage');
      return state;
    } catch (error) {
      console.error('❌ Error cargando desde localStorage:', error);
      return null;
    }
  }

  /**
   * Limpia el estado guardado en localStorage
   */
  clearTestPlanState(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    try {
      localStorage.removeItem(this.STORAGE_KEY);
      console.log('🗑️ Test Plan eliminado de localStorage');
    } catch (error) {
      console.error('❌ Error eliminando de localStorage:', error);
    }
  }

  /**
   * Verifica si existe un estado guardado
   */
  hasStoredState(): boolean {
    if (!isPlatformBrowser(this.platformId)) {
      return false;
    }

    return localStorage.getItem(this.STORAGE_KEY) !== null;
  }

  /**
   * Obtiene información sobre el estado guardado sin cargarlo completamente
   */
  getStoredStateInfo(): { lastUpdated: string; huCount: number } | null {
    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }

    try {
      const serialized = localStorage.getItem(this.STORAGE_KEY);
      if (!serialized) {
        return null;
      }

      const state = JSON.parse(serialized) as TestPlanState;
      return {
        lastUpdated: state.lastUpdated,
        huCount: state.huList?.length || 0
      };
    } catch (error) {
      console.error('❌ Error obteniendo info del estado guardado:', error);
      return null;
    }
  }

  /**
   * Exporta el estado como archivo JSON para backup
   */
  exportStateAsFile(state: TestPlanState): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    try {
      const dataStr = JSON.stringify(state, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `test-plan-backup-${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      URL.revokeObjectURL(url);
      console.log('📥 Backup exportado exitosamente');
    } catch (error) {
      console.error('❌ Error exportando backup:', error);
    }
  }

  /**
   * Importa el estado desde un archivo JSON
   */
  async importStateFromFile(file: File): Promise<TestPlanState | null> {
    try {
      const text = await file.text();
      const state = JSON.parse(text) as TestPlanState;
      
      // Validación básica
      if (!state.huList || !Array.isArray(state.huList)) {
        throw new Error('Formato de archivo inválido');
      }

      this.saveTestPlanState(state);
      console.log('📤 Backup importado exitosamente');
      return state;
    } catch (error) {
      console.error('❌ Error importando backup:', error);
      return null;
    }
  }

  /**
   * Manejo de errores de almacenamiento (cuota excedida, etc.)
   */
  private handleStorageError(error: any): void {
    if (error.name === 'QuotaExceededError') {
      alert('⚠️ ESPACIO DE ALMACENAMIENTO LOCAL LLENO\n\n' +
            'El navegador ha alcanzado su límite de almacenamiento local (generalmente 5-10 MB).\n\n' +
            '📋 Acciones recomendadas:\n' +
            '• Exporta tu plan de pruebas actual usando el botón "Descargar Plan Completo (.doc)"\n' +
            '• Usa el botón "Limpiar Todo" en la barra de herramientas para liberar espacio\n' +
            '• Elimina historias de usuario antiguas que ya no necesites\n\n' +
            '💡 Tip: Exporta regularmente tus planes para mantener el almacenamiento optimizado.');
    }
  }

  /**
   * Obtiene el tamaño aproximado del almacenamiento usado
   */
  getStorageSize(): number {
    if (!isPlatformBrowser(this.platformId)) {
      return 0;
    }

    const serialized = localStorage.getItem(this.STORAGE_KEY);
    return serialized ? new Blob([serialized]).size : 0;
  }

  /**
   * Formatea el tamaño en un formato legible
   */
  getStorageSizeFormatted(): string {
    const bytes = this.getStorageSize();
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }
}
