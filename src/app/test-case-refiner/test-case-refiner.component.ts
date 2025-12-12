import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TestCaseEditorComponent } from '../test-case-editor/test-case-editor.component';
import { HUData, DetailedTestCase } from '../models/hu-data.model';
import { DatabaseService } from '../services/database/database.service';
import { AiUnifiedService } from '../services/ai/ai-unified.service';
import { ToastService } from '../services/core/toast.service';
import { DbTestCaseWithRelations, DbTestCaseStep } from '../models/database.model';

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
  private userStoryDbId: string | null = null;
  private existingDbTestCases: DbTestCaseWithRelations[] = [];

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private location: Location,
    private databaseService: DatabaseService,
    private aiService: AiUnifiedService,
    private toastService: ToastService
  ) { }

  ngOnInit(): void {
    // Obtener datos de la navegación
    const navigation = this.router.getCurrentNavigation();
    const state = navigation?.extras?.state || history.state;

    if (state && state['hu']) {
      this.hu = state['hu'];
      this.testPlanId = state['testPlanId'] || '';
      this.initializeData();
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

    // Guardar la técnica y contexto en el HU
    this.hu.refinementTechnique = event.technique;
    this.hu.refinementContext = event.context;

    try {
      this.aiService.refineTestCasesDirect(
        this.hu.originalInput,
        this.hu.detailedTestCases,
        event.technique,
        event.context
      ).subscribe({
        next: (result: any) => {
          if (result?.testCases && this.hu) {
            this.hu.detailedTestCases = result.testCases;
            this.toastService.success('Casos de prueba refinados con éxito');
          }
        },
        error: (error) => {
          console.error('Error al refinar casos de prueba:', error);
          this.toastService.error('Error al refinar casos de prueba con IA');
        },
        complete: () => {
          // No action needed
        }
      });
    } catch (error) {
      console.error('Error al iniciar refinamiento:', error);
      this.toastService.error('Error al iniciar refinamiento');
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
      await this.loadUserStoryData();

      if (!this.userStoryDbId) {
        throw new Error('User story no encontrado');
      }

      await this.updateUserStoryMetadata(this.userStoryDbId);
      await this.syncTestCasesWithDatabase(this.userStoryDbId);

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

  private async initializeData(): Promise<void> {
    try {
      await this.loadUserStoryData();
    } catch (error) {
      console.error('Error al inicializar datos del refinador:', error);
    }
  }

  private async loadUserStoryData(): Promise<void> {
    if (!this.hu || !this.testPlanId) return;

    let query = this.databaseService.supabase
      .from('user_stories')
      .select(`
        id,
        test_cases (
          id,
          user_story_id,
          title,
          preconditions,
          expected_results,
          position,
          test_case_steps (
            id,
            test_case_id,
            step_number,
            action
          )
        )
      `);

    // Priorizar búsqueda por UUID si existe, es más seguro
    if (this.hu.dbUuid) {
      query = query.eq('id', this.hu.dbUuid);
    } else {
      query = query.eq('test_plan_id', this.testPlanId)
        .eq('custom_id', this.hu.id);
    }

    // Usar limit(1).single() para evitar error si hay duplicados (PGRST116)
    const { data: userStory, error } = await query.limit(1).single();

    if (error) {
      console.error('Error al cargar user story:', error);
      throw error;
    }

    this.userStoryDbId = userStory?.id || null;
    if (this.hu && this.userStoryDbId) {
      this.hu.dbUuid = this.userStoryDbId;
    }
    this.existingDbTestCases = this.sortTestCasesByPosition(userStory?.test_cases || []);
    this.alignLocalTestCasesWithDb();
  }

  private sortTestCasesByPosition(testCases: DbTestCaseWithRelations[]): DbTestCaseWithRelations[] {
    return [...(testCases || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }

  private alignLocalTestCasesWithDb(): void {
    if (!this.hu?.detailedTestCases?.length || !this.existingDbTestCases.length) return;

    const sortedExisting = this.existingDbTestCases;

    this.hu.detailedTestCases.forEach((tc, tcIdx) => {
      const dbTc = sortedExisting[tcIdx];
      if (dbTc) {
        tc.dbId = tc.dbId || dbTc.id || undefined;
        tc.position = tc.position ?? dbTc.position ?? undefined;
        const sortedSteps = (dbTc.test_case_steps || []).sort((a, b) => (a.step_number ?? 0) - (b.step_number ?? 0));
        tc.steps?.forEach((step, stepIdx) => {
          const dbStep = sortedSteps[stepIdx];
          if (dbStep) {
            step.dbId = step.dbId || dbStep.id || undefined;
          }
        });
      }
    });
  }

  private async updateUserStoryMetadata(userStoryId: string): Promise<void> {
    const { error: updateError } = await this.databaseService.supabase
      .from('user_stories')
      .update({
        refinement_technique: this.hu?.refinementTechnique || null,
        refinement_context: this.hu?.refinementContext || null
      })
      .eq('id', userStoryId);

    if (updateError) {
      console.error('Error al actualizar user story:', updateError);
      throw updateError;
    }
  }

  private async syncTestCasesWithDatabase(userStoryId: string): Promise<void> {
    if (!this.hu?.detailedTestCases) return;

    this.populateDefaultStepActions();

    // Usar el método optimizado del servicio
    await this.databaseService.smartUpdateUserStoryTestCases(userStoryId, this.hu.detailedTestCases);

    // Refrescar estado local con los IDs actualizados
    await this.loadUserStoryData();
  }

  private populateDefaultStepActions(): void {
    if (!this.hu?.detailedTestCases) return;

    this.hu.detailedTestCases.forEach(tc => {
      tc.steps = tc.steps || [];
      tc.steps.forEach((step, idx) => {
        step.numero_paso = idx + 1;
        if (!step.accion || !step.accion.trim()) {
          step.accion = `Paso ${idx + 1}`;
        }
      });
    });
  }
}
