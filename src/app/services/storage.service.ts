import { Injectable } from '@angular/core';
import { Escenario } from '../test-matrix-execution/test-matrix-execution.component'; // Importamos la interfaz

const STORAGE_KEY = 'matrizDePruebasState';

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  constructor() { }

  guardarEscenarios(escenarios: Escenario[]): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const estadoSerializado = JSON.stringify(escenarios);
      localStorage.setItem(STORAGE_KEY, estadoSerializado);
    } catch (e) {
      console.error('Error al guardar en localStorage:', e);
    }
  }

  cargarEscenarios(): Escenario[] | null {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    try {
      const estadoGuardado = localStorage.getItem(STORAGE_KEY);
      if (estadoGuardado) {
        return JSON.parse(estadoGuardado) as Escenario[];
      }
      return null;
    } catch (e) {
      console.error('Error al cargar desde localStorage:', e);
      return null;
    }
  }

  limpiarEstado(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    localStorage.removeItem(STORAGE_KEY);
  }
} 