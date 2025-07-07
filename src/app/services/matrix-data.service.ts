import { Injectable } from '@angular/core';
import { Escenario } from '../test-matrix-execution/test-matrix-execution.component';

@Injectable({ providedIn: 'root' })
export class MatrixDataService {
  private escenarios: Escenario[] = [];

  setEscenarios(escenarios: Escenario[]): void {
    this.escenarios = escenarios;
  }

  getEscenarios(): Escenario[] {
    return this.escenarios;
  }

  clear(): void {
    this.escenarios = [];
  }
} 