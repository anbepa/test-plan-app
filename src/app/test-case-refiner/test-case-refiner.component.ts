import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TestCaseEditorComponent } from '../test-case-editor/test-case-editor.component';
import { HUData, DetailedTestCase } from '../models/hu-data.model';
import { DatabaseService } from '../services/database.service';
import { GeminiService } from '../services/gemini.service';
import { ToastService } from '../services/toast.service';
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

    const { data: userStory, error } = await this.databaseService.supabase
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
      `)
      .eq('test_plan_id', this.testPlanId)
      .eq('custom_id', this.hu.id)
      .single();

    if (error) {
      console.error('Error al cargar user story:', error);
      throw error;
    }

    this.userStoryDbId = userStory?.id || null;
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

    const existingTestCaseMap = new Map<string, DbTestCaseWithRelations>(
      (this.existingDbTestCases || []).map(tc => [tc.id as string, tc])
    );

    const remainingTestCaseIds = new Set(existingTestCaseMap.keys());

    for (const tc of this.hu.detailedTestCases) {
      if (tc.dbId && existingTestCaseMap.has(tc.dbId)) {
        const existingTc = existingTestCaseMap.get(tc.dbId)!;
        remainingTestCaseIds.delete(tc.dbId);
        await this.updateTestCaseIfNeeded(tc, existingTc);
        await this.syncTestCaseSteps(tc, existingTc);
      } else {
        await this.insertTestCase(tc, userStoryId);
      }
    }

    // Eliminar casos que ya no existen en la HU refinada
    for (const tcId of remainingTestCaseIds) {
      await this.databaseService.supabase.from('test_case_steps').delete().eq('test_case_id', tcId);
      await this.databaseService.supabase.from('test_cases').delete().eq('id', tcId);
    }

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

  private async updateTestCaseIfNeeded(tc: DetailedTestCase, existingTc: DbTestCaseWithRelations): Promise<void> {
    const updates: any = {};

    if (tc.title !== existingTc.title) updates.title = tc.title;
    if (tc.preconditions !== (existingTc.preconditions || '')) updates.preconditions = tc.preconditions;
    if (tc.expectedResults !== (existingTc.expected_results || '')) updates.expected_results = tc.expectedResults;
    if (tc.position !== (existingTc.position ?? null)) updates.position = tc.position ?? null;

    if (Object.keys(updates).length > 0) {
      const { error } = await this.databaseService.supabase
        .from('test_cases')
        .update(updates)
        .eq('id', existingTc.id);

      if (error) {
        console.error('Error al actualizar test case:', error);
        throw error;
      }
    }
  }

  private async insertTestCase(tc: DetailedTestCase, userStoryId: string): Promise<void> {
    const { data: testCaseData, error: tcError } = await this.databaseService.supabase
      .from('test_cases')
      .insert({
        user_story_id: userStoryId,
        title: tc.title,
        preconditions: tc.preconditions,
        expected_results: tc.expectedResults,
        position: tc.position ?? null
      })
      .select('id')
      .single();

    if (tcError) {
      console.error('Error al insertar test case:', tcError);
      throw tcError;
    }

    tc.dbId = testCaseData?.id;

    if (tc.steps && tc.steps.length > 0) {
      await this.insertSteps(tc, tc.dbId!);
    }
  }

  private async insertSteps(tc: DetailedTestCase, testCaseId: string): Promise<void> {
    const stepsPayload = (tc.steps || []).map((step, idx) => ({
      test_case_id: testCaseId,
      step_number: idx + 1,
      action: step.accion
    }));

    if (stepsPayload.length === 0) return;

    const { data: insertedSteps, error } = await this.databaseService.supabase
      .from('test_case_steps')
      .insert(stepsPayload)
      .select('id, step_number');

    if (error) {
      console.error('Error al insertar pasos:', error);
      throw error;
    }

    if (insertedSteps) {
      insertedSteps.forEach(inserted => {
        const localStep = tc.steps?.[inserted.step_number - 1];
        if (localStep) {
          localStep.dbId = inserted.id;
        }
      });
    }
  }

  private async syncTestCaseSteps(tc: DetailedTestCase, existingTc: DbTestCaseWithRelations): Promise<void> {
    const existingSteps = (existingTc.test_case_steps || []).map(step => ({ ...step } as DbTestCaseStep));
    const existingStepMap = new Map<string, DbTestCaseStep>(existingSteps.map(step => [step.id as string, step]));
    const remainingStepIds = new Set(existingStepMap.keys());

    tc.steps = tc.steps || [];

    for (const [idx, step] of tc.steps.entries()) {
      step.numero_paso = idx + 1;
      if (!step.accion || !step.accion.trim()) {
        step.accion = `Paso ${idx + 1}`;
      }

      if (step.dbId && existingStepMap.has(step.dbId)) {
        const existingStep = existingStepMap.get(step.dbId)!;
        remainingStepIds.delete(step.dbId);

        if (existingStep.action !== step.accion || existingStep.step_number !== step.numero_paso) {
          const { error } = await this.databaseService.supabase
            .from('test_case_steps')
            .update({
              action: step.accion,
              step_number: step.numero_paso
            })
            .eq('id', step.dbId);

          if (error) {
            console.error('Error al actualizar paso:', error);
            throw error;
          }
        }
      } else {
        const { data, error } = await this.databaseService.supabase
          .from('test_case_steps')
          .insert({
            test_case_id: existingTc.id,
            step_number: step.numero_paso,
            action: step.accion
          })
          .select('id')
          .single();

        if (error) {
          console.error('Error al insertar paso:', error);
          throw error;
        }

        step.dbId = data?.id;
      }
    }

    // Eliminar pasos que ya no existen
    for (const stepId of remainingStepIds) {
      await this.databaseService.supabase
        .from('test_case_steps')
        .delete()
        .eq('id', stepId);
    }
  }
}
