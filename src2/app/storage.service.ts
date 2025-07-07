import { Injectable } from '@angular/core';
import { Escenario } from './app.component'; // Importamos la interfaz

const STORAGE_KEY = 'matrizDePruebasState';

@Injectable({
  providedIn: 'root'
})
export class StorageService {

  constructor() { }

  /**
   * Guarda el array completo de escenarios en localStorage.
   * @param escenarios El estado actual de los escenarios.
   */
  guardarEscenarios(escenarios: Escenario[]): void {
    try {
      const estadoSerializado = JSON.stringify(escenarios);
      localStorage.setItem(STORAGE_KEY, estadoSerializado);
    } catch (e) {
      console.error('Error al guardar en localStorage:', e);
    }
  }

  /**
   * Carga los escenarios desde localStorage.
   * @returns El array de escenarios guardado, o null si no hay nada.
   */
  cargarEscenarios(): Escenario[] | null {
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

  /**
   * Limpia el estado guardado en localStorage.
   */
  limpiarEstado(): void {
    localStorage.removeItem(STORAGE_KEY);
  }
}