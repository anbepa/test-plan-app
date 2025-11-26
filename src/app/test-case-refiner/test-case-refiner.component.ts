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
    const testCasesToInsert: { tc: DetailedTestCase; payload: any }[] = [];
    const testCasesToUpdate: any[] = [];
    const stepInsertRequests: { payload: { test_case_id: string; step_number: number; action: string }; tc: DetailedTestCase; stepIndex: number }[] = [];
    const stepUpdates: { id: string; step_number: number; action: string }[] = [];
    const stepDeletions: string[] = [];

    for (const [tcIdx, tc] of this.hu.detailedTestCases.entries()) {
      tc.position = tc.position ?? tcIdx;

      if (tc.dbId && existingTestCaseMap.has(tc.dbId)) {
        const existingTc = existingTestCaseMap.get(tc.dbId)!;
        remainingTestCaseIds.delete(tc.dbId);

        const updates = this.getTestCaseUpdates(tc, existingTc);
        if (Object.keys(updates).length > 1) { // includes id
          testCasesToUpdate.push(updates);
        }

        const { stepsToInsert, stepsToUpdate, stepsToDelete } = this.calculateStepChanges(tc, existingTc);
        stepInsertRequests.push(...stepsToInsert);
        stepUpdates.push(...stepsToUpdate);
        stepDeletions.push(...stepsToDelete);
      } else {
        testCasesToInsert.push({
          tc,
          payload: {
            user_story_id: userStoryId,
            title: tc.title,
            preconditions: tc.preconditions,
            expected_results: tc.expectedResults,
            position: tc.position ?? null
          }
        });
      }
    }

    if (testCasesToInsert.length > 0) {
      const insertPayload = testCasesToInsert.map(item => item.payload);
      const { data: insertedTestCases, error: insertError } = await this.databaseService.supabase
        .from('test_cases')
        .insert(insertPayload)
        .select('id, position');

      if (insertError) {
        console.error('Error al insertar test cases:', insertError);
        throw insertError;
      }

      insertedTestCases?.forEach((inserted, idx) => {
        const target = testCasesToInsert[idx];
        if (target) {
          target.tc.dbId = inserted.id;
          const emptyExisting: Partial<DbTestCaseWithRelations> = { test_case_steps: [] };
          const { stepsToInsert } = this.calculateStepChanges(target.tc, emptyExisting, inserted.id);
          stepInsertRequests.push(...stepsToInsert);
        }
      });
    }

    if (testCasesToUpdate.length > 0) {
      const { error: updateError } = await this.databaseService.supabase
        .from('test_cases')
        .upsert(testCasesToUpdate, { onConflict: 'id' });

      if (updateError) {
        console.error('Error al actualizar test cases:', updateError);
        throw updateError;
      }
    }

    if (stepInsertRequests.length > 0) {
      const stepPayload = stepInsertRequests.map(request => request.payload);
      const { data: insertedSteps, error: insertStepsError } = await this.databaseService.supabase
        .from('test_case_steps')
        .insert(stepPayload)
        .select('id, test_case_id, step_number');

      if (insertStepsError) {
        console.error('Error al insertar pasos:', insertStepsError);
        throw insertStepsError;
      }

      const stepMap = new Map(stepInsertRequests.map(req => [`${req.payload.test_case_id}-${req.payload.step_number}`, req]));
      insertedSteps?.forEach(inserted => {
        const key = `${inserted.test_case_id}-${inserted.step_number}`;
        const request = stepMap.get(key);
        if (request) {
          request.tc.steps![request.stepIndex].dbId = inserted.id;
        }
      });
    }

    if (stepUpdates.length > 0) {
      const { error: stepUpdateError } = await this.databaseService.supabase
        .from('test_case_steps')
        .upsert(stepUpdates, { onConflict: 'id' });

      if (stepUpdateError) {
        console.error('Error al actualizar pasos:', stepUpdateError);
        throw stepUpdateError;
      }
    }

    if (stepDeletions.length > 0) {
      const { error: stepDeletionError } = await this.databaseService.supabase
        .from('test_case_steps')
        .delete()
        .in('id', stepDeletions);

      if (stepDeletionError) {
        console.error('Error al eliminar pasos:', stepDeletionError);
        throw stepDeletionError;
      }
    }

    if (remainingTestCaseIds.size > 0) {
      const idsToDelete = Array.from(remainingTestCaseIds);
      const { error: deleteStepsError } = await this.databaseService.supabase.from('test_case_steps').delete().in('test_case_id', idsToDelete);
      if (deleteStepsError) {
        console.error('Error al eliminar pasos huérfanos:', deleteStepsError);
        throw deleteStepsError;
      }

      const { error: deleteTcError } = await this.databaseService.supabase.from('test_cases').delete().in('id', idsToDelete);
      if (deleteTcError) {
        console.error('Error al eliminar test cases:', deleteTcError);
        throw deleteTcError;
      }
    }

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

  private getTestCaseUpdates(tc: DetailedTestCase, existingTc: DbTestCaseWithRelations): any {
    const updates: any = { id: existingTc.id };

    if (tc.title !== existingTc.title) updates.title = tc.title;
    if (tc.preconditions !== (existingTc.preconditions || '')) updates.preconditions = tc.preconditions;
    if (tc.expectedResults !== (existingTc.expected_results || '')) updates.expected_results = tc.expectedResults;
    if (tc.position !== (existingTc.position ?? null)) updates.position = tc.position ?? null;

    return updates;
  }

  private calculateStepChanges(
    tc: DetailedTestCase,
    existingTc: Partial<DbTestCaseWithRelations>,
    overrideTestCaseId?: string
  ): {
    stepsToInsert: { payload: { test_case_id: string; step_number: number; action: string }; tc: DetailedTestCase; stepIndex: number }[];
    stepsToUpdate: { id: string; step_number: number; action: string }[];
    stepsToDelete: string[];
  } {
    const existingSteps = (existingTc.test_case_steps || []).map(step => ({ ...step } as DbTestCaseStep));
    const existingStepMap = new Map<string, DbTestCaseStep>(existingSteps.map(step => [step.id as string, step]));
    const remainingStepIds = new Set(existingStepMap.keys());

    tc.steps = tc.steps || [];

    const stepsToInsert: { payload: { test_case_id: string; step_number: number; action: string }; tc: DetailedTestCase; stepIndex: number }[] = [];
    const stepsToUpdate: { id: string; step_number: number; action: string }[] = [];

    for (const [idx, step] of tc.steps.entries()) {
      step.numero_paso = idx + 1;
      if (!step.accion || !step.accion.trim()) {
        step.accion = `Paso ${idx + 1}`;
      }

      if (step.dbId && existingStepMap.has(step.dbId)) {
        const existingStep = existingStepMap.get(step.dbId)!;
        remainingStepIds.delete(step.dbId);

        if (existingStep.action !== step.accion || existingStep.step_number !== step.numero_paso) {
          stepsToUpdate.push({
            id: step.dbId,
            action: step.accion,
            step_number: step.numero_paso
          });
        }
      } else if (overrideTestCaseId || existingTc.id) {
        const testCaseId = overrideTestCaseId || (existingTc.id as string);
        stepsToInsert.push({
          tc,
          stepIndex: idx,
          payload: {
            test_case_id: testCaseId,
            step_number: step.numero_paso,
            action: step.accion
          }
        });
      }
    }

    const stepsToDelete = Array.from(remainingStepIds);

    return { stepsToInsert, stepsToUpdate, stepsToDelete };
  }
}
