import { Injectable } from '@angular/core';
import { Escenario } from '../test-matrix-execution/test-matrix-execution.component'; // Importamos la interfaz
import { HUData } from '../models/hu-data.model';

const STORAGE_KEY = 'matrizDePruebasState';
const PLAN_STORAGE_KEY = 'planDePruebasState';

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

  guardarPlanDePruebas(huList: HUData[]): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const estadoSerializado = JSON.stringify(huList);
      localStorage.setItem(PLAN_STORAGE_KEY, estadoSerializado);
    } catch (e) {
      console.error('Error al guardar plan de pruebas en localStorage:', e);
    }
  }

  cargarPlanDePruebas(): HUData[] | null {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    try {
      const estadoGuardado = localStorage.getItem(PLAN_STORAGE_KEY);
      if (estadoGuardado) {
        return JSON.parse(estadoGuardado) as HUData[];
      }
      return null;
    } catch (e) {
      console.error('Error al cargar plan de pruebas desde localStorage:', e);
      return null;
    }
  }

  limpiarPlanDePruebas(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    localStorage.removeItem(PLAN_STORAGE_KEY);
  }
} 