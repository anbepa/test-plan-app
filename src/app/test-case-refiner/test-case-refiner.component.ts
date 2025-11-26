import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TestCaseEditorComponent } from '../test-case-editor/test-case-editor.component';
import { HUData, DetailedTestCase } from '../models/hu-data.model';
import { DatabaseService } from '../services/database.service';
import { GeminiService } from '../services/gemini.service';
import { ToastService } from '../services/toast.service';

@Component({
  selector: 'app-test-case-refiner',
  standalone: true,
  imports: [CommonModule, FormsModule, TestCaseEditorComponent],
  templateUrl: './test-case-refiner.component.html',
  styleUrls: ['./test-case-refiner.component.css']
})
export class TestCaseRefinerComponent implements OnInit, OnDestroy {
  hu: HUData | null = null;
  testPlanId: string = '';
  isLoading: boolean = false;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private location: Location,
    private databaseService: DatabaseService,
    private geminiService: GeminiService,
    private toastService: ToastService
  ) { }

  ngOnInit(): void {
    // Obtener datos de la navegación
    const navigation = this.router.getCurrentNavigation();
    const state = navigation?.extras?.state || history.state;

    if (state && state['hu']) {
      this.hu = state['hu'];
      this.testPlanId = state['testPlanId'] || '';
    } else {
      // Si no hay datos, redirigir al viewer
      this.toastService.error('No se encontraron datos para editar');
      this.router.navigate(['/viewer']);
    }
  }

  ngOnDestroy(): void {
    // Cleanup si es necesario
  }

  async handleRefineWithAI(event: { technique: string; context: string }): Promise<void> {
    if (!this.hu || !this.hu.detailedTestCases) return;

    this.isLoading = true;

    try {
      // Guardar la técnica y contexto en el HU
      this.hu.refinementTechnique = event.technique;
      this.hu.refinementContext = event.context;

      // Llamar al servicio de Gemini para refinar
      const refinedTestCases$ = this.geminiService.refineDetailedTestCases(
        this.hu.originalInput,
        this.hu.detailedTestCases,
        event.technique,
        event.context
      );

      refinedTestCases$.subscribe({
        next: (refinedTestCases) => {
          if (this.hu) {
            this.hu.detailedTestCases = refinedTestCases;
          }
          this.toastService.success('Casos de prueba refinados con éxito');
          this.isLoading = false;
        },
        error: (error) => {
          console.error('Error al refinar casos de prueba:', error);
          this.toastService.error('Error al refinar casos de prueba con IA');
          this.isLoading = false;
        }
      });
    } catch (error) {
      console.error('Error al refinar casos de prueba:', error);
      this.toastService.error('Error al refinar casos de prueba con IA');
      this.isLoading = false;
    }
  }

  handleTestCasesChanged(testCases: DetailedTestCase[]): void {
    if (this.hu) {
      this.hu.detailedTestCases = testCases;
    }
  }

  async saveAndReturn(): Promise<void> {
    if (!this.hu || !this.testPlanId) {
      this.goBack();
      return;
    }

    try {
      // Aquí puedes agregar lógica para guardar en la base de datos si es necesario
      this.toastService.success('Cambios guardados correctamente');
      this.goBack();
    } catch (error) {
      console.error('Error al guardar:', error);
      this.toastService.error('Error al guardar los cambios');
    }
  }

  goBack(): void {
    // Volver a la vista anterior con los datos actualizados
    if (this.hu && this.testPlanId) {
      this.router.navigate(['/viewer'], {
        queryParams: { id: this.testPlanId },
        state: {
          updatedHU: this.hu,
          testPlanId: this.testPlanId
        }
      });
    } else {
      this.location.back();
    }
  }

  onRefinementTechniqueChange(technique: string): void {
    if (this.hu) {
      this.hu.refinementTechnique = technique;
    }
  }

  onUserRefinementContextChange(context: string): void {
    if (this.hu) {
      this.hu.refinementContext = context;
    }
  }
}
