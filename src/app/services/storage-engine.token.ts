// src/app/services/storage-engine.token.ts
import { InjectionToken } from '@angular/core';

/**
 * Contract for any storage backend used by LocalStorageService.
 * This abstraction cumple con el principio de inversión de dependencias
 * permitiendo reemplazar la implementación (por ejemplo, para SSR o tests)
 * sin cambiar la lógica de negocio.
 */
export interface StorageEngine {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Implementación segura que opera solo cuando window.localStorage está disponible.
 * Cuando no existe (SSR), expone una implementación no operativa para evitar errores.
 */
function createBrowserStorageEngine(): StorageEngine {
  const isBrowser = typeof window !== 'undefined' && !!window.localStorage;

  if (!isBrowser) {
    return {
      getItem: () => null,
      setItem: () => void 0,
      removeItem: () => void 0
    };
  }

  return {
    getItem: (key: string) => window.localStorage.getItem(key),
    setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
    removeItem: (key: string) => window.localStorage.removeItem(key)
  };
}

export const STORAGE_ENGINE = new InjectionToken<StorageEngine>('STORAGE_ENGINE', {
  providedIn: 'root',
  factory: () => createBrowserStorageEngine()
});
