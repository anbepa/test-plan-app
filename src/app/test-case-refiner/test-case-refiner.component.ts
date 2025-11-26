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

  async saveData(): Promise<boolean> {
    if (!this.hu || !this.testPlanId) {
      return false;
    }

    try {
      this.isLoading = true;

      // Buscar el user story en la base de datos
      const { data: userStories, error: fetchError } = await this.databaseService.supabase
        .from('user_stories')
        .select('id')
        .eq('test_plan_id', this.testPlanId)
        .eq('custom_id', this.hu.id)
        .limit(1)
        .single();

      if (fetchError) {
        console.error('Error al buscar user story:', fetchError);
        throw fetchError;
      }

      if (!userStories) {
        throw new Error('User story no encontrado');
      }

      const userStoryId = userStories.id;

      // Actualizar el user story con la técnica y contexto de refinamiento
      const { error: updateError } = await this.databaseService.supabase
        .from('user_stories')
        .update({
          refinement_technique: this.hu.refinementTechnique || null,
          refinement_context: this.hu.refinementContext || null
        })
        .eq('id', userStoryId);

      if (updateError) {
        console.error('Error al actualizar user story:', updateError);
        throw updateError;
      }

      // Eliminar los test cases antiguos
      const { error: deleteError } = await this.databaseService.supabase
        .from('test_cases')
        .delete()
        .eq('user_story_id', userStoryId);

      if (deleteError) {
        console.error('Error al eliminar test cases antiguos:', deleteError);
        throw deleteError;
      }

      // Insertar los nuevos test cases
      if (this.hu.detailedTestCases && this.hu.detailedTestCases.length > 0) {
        for (const tc of this.hu.detailedTestCases) {
          // Insertar el test case
          const { data: testCaseData, error: tcError } = await this.databaseService.supabase
            .from('test_cases')
            .insert({
              user_story_id: userStoryId,
              title: tc.title,
              preconditions: tc.preconditions,
              expected_results: tc.expectedResults
            })
            .select('id')
            .single();

          if (tcError) {
            console.error('Error al insertar test case:', tcError);
            throw tcError;
          }

          // Insertar los pasos del test case
          if (tc.steps && tc.steps.length > 0) {
            const stepsToInsert = tc.steps.map(step => ({
              test_case_id: testCaseData.id,
              step_number: step.numero_paso,
              action: step.accion
            }));

            const { error: stepsError } = await this.databaseService.supabase
              .from('test_case_steps')
              .insert(stepsToInsert);

            if (stepsError) {
              console.error('Error al insertar pasos:', stepsError);
              throw stepsError;
            }
          }
        }
      }

      this.isLoading = false;
      return true;
    } catch (error) {
      console.error('Error al guardar:', error);
      this.toastService.error('Error al guardar los cambios en la base de datos');
      this.isLoading = false;
      return false;
    }
  }

  async save(): Promise<void> {
    const success = await this.saveData();
    if (success) {
      this.toastService.success('Cambios guardados correctamente');
    }
  }

  async saveAndReturn(): Promise<void> {
    const success = await this.saveData();
    if (success) {
      this.toastService.success('Cambios guardados correctamente');
      this.goBack();
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
