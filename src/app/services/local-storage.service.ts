// src/app/services/local-storage.service.ts
import { Injectable } from '@angular/core';
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
  private readonly STORAGE_KEY = 'testPlanState';

  constructor() {}

  /**
   * Verifica si hay un estado guardado en localStorage
   */
  hasStoredState(): boolean {
    if (typeof window === 'undefined' || !window.localStorage) {
      return false;
    }
    const stored = localStorage.getItem(this.STORAGE_KEY);
    return stored !== null && stored.length > 0;
  }

  /**
   * Obtiene información del estado guardado
   */
  getStoredStateInfo(): { huCount: number; lastUpdated: string } | null {
    if (!this.hasStoredState()) {
      return null;
    }
    
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (!stored) return null;
      
      const state: TestPlanState = JSON.parse(stored);
      return {
        huCount: state.huList?.length || 0,
        lastUpdated: state.lastUpdated || 'Desconocido'
      };
    } catch (error) {
      console.error('Error al obtener info del estado guardado:', error);
      return null;
    }
  }

  /**
   * Carga el estado desde localStorage
   */
  loadTestPlanState(): TestPlanState | null {
    if (!this.hasStoredState()) {
      return null;
    }
    
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (!stored) return null;
      
      return JSON.parse(stored) as TestPlanState;
    } catch (error) {
      console.error('Error al cargar el estado desde localStorage:', error);
      return null;
    }
  }

  /**
   * Guarda el estado en localStorage (auto-save)
   */
  autoSaveTestPlanState(state: TestPlanState): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    
    try {
      const stateWithTimestamp = {
        ...state,
        lastUpdated: new Date().toISOString()
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(stateWithTimestamp));
    } catch (error) {
      console.error('Error al guardar el estado en localStorage:', error);
    }
  }

  /**
   * Limpia el estado guardado
   */
  clearTestPlanState(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    
    try {
      localStorage.removeItem(this.STORAGE_KEY);
    } catch (error) {
      console.error('Error al limpiar el estado:', error);
    }
  }

  /**
   * Exporta el estado como archivo JSON
   */
  exportStateAsFile(state: TestPlanState): void {
    try {
      const dataStr = JSON.stringify(state, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = `test-plan-backup-${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error al exportar el estado:', error);
    }
  }

  /**
   * Importa el estado desde un archivo JSON
   */
  async importStateFromFile(file: File): Promise<TestPlanState | null> {
    try {
      const text = await file.text();
      const state = JSON.parse(text) as TestPlanState;
      
      // Validar que tenga la estructura correcta
      if (!state || typeof state.testPlanTitle === 'undefined') {
        return null;
      }
      
      // Guardar el estado importado
      this.autoSaveTestPlanState(state);
      
      return state;
    } catch (error) {
      console.error('Error al importar el estado:', error);
      return null;
    }
  }

  /**
   * Obtiene el tamaño del almacenamiento formateado
   */
  getStorageSizeFormatted(): string {
    if (typeof window === 'undefined' || !window.localStorage) {
      return '0 KB';
    }
    
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (!stored) return '0 KB';
      
      const bytes = new Blob([stored]).size;
      const kb = bytes / 1024;
      
      if (kb < 1024) {
        return `${kb.toFixed(2)} KB`;
      } else {
        return `${(kb / 1024).toFixed(2)} MB`;
      }
    } catch (error) {
      console.error('Error al calcular el tamaño:', error);
      return '0 KB';
    }
  }
}
