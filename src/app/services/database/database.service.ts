import { Injectable } from '@angular/core';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseClientService } from './supabase-client.service';
import { DatabaseHelperService } from './database-helper.service';
import type {
  DbTestPlan,
  DbUserStory,
  DbTestCase,
  DbTestCaseStep,
  DbRiskStrategy,
  DbTestPlanWithRelations,
  DbUserStoryWithRelations,
  DbTestCaseWithRelations
} from '../../models/database.model';
import { DetailedTestCase } from '../../models/hu-data.model';

// Re-export para compatibilidad
export type {
  DbTestPlan,
  DbUserStory,
  DbTestCase,
  DbTestCaseStep,
  DbRiskStrategy,
  DbTestPlanWithRelations,
  DbUserStoryWithRelations,
  DbTestCaseWithRelations
};

@Injectable({
  providedIn: 'root'
})
export class DatabaseService {

  constructor(
    private supabaseClient: SupabaseClientService,
    private dbHelper: DatabaseHelperService
  ) { }

  get supabase(): SupabaseClient {
    return this.supabaseClient.supabase;
  }

  isReady(): boolean {
    return this.supabaseClient.isReady();
  }

  private async getCurrentUserIdOrThrow(): Promise<string> {
    const { data, error } = await this.supabase.auth.getUser();

    if (error) {
      throw new Error(`No se pudo obtener usuario autenticado: ${error.message}`);
    }

    const userId = data.user?.id;
    if (!userId) {
      throw new Error('No hay usuario autenticado para ejecutar esta operación.');
    }

    return userId;
  }

  async saveCompleteTestPlan(
    testPlan: DbTestPlan,
    userStories: DbUserStoryWithRelations[]
  ): Promise<string> {
    console.log('💾 Iniciando guardado transaccional (RPC) en Supabase...');

    try {
      const { data, error } = await this.supabase.rpc('save_complete_test_plan', {
        p_test_plan: testPlan,
        p_user_stories: userStories
      });

      if (error) {
        console.error('❌ Error RPC save_complete_test_plan:', error);
        throw error;
      }

      console.log('✅ Test plan guardado exitosamente (RPC):', data.id);
      return data.id;

    } catch (error: any) {
      console.error('❌ Error en saveCompleteTestPlan (RPC):', error);
      throw new Error(`Error guardando test plan: ${error.message}`);
    }
  }

  async saveIndividualUserStory(userStory: DbUserStoryWithRelations): Promise<string> {
    console.log('💾 Guardando HU individual en Supabase...');

    try {
      const userStoryData: any = {
        test_plan_id: null,
        title: userStory.title,
        description: userStory.description,
        acceptance_criteria: userStory.acceptance_criteria,
        generated_scope: userStory.generated_scope,
        generated_test_case_titles: userStory.generated_test_case_titles,
        generation_mode: userStory.generation_mode,
        sprint: userStory.sprint,
        refinement_technique: userStory.refinement_technique,
        refinement_context: userStory.refinement_context,
        position: userStory.position
      };

      const { data: usData, error: usError } = await this.supabase
        .from('user_stories')
        .insert([userStoryData])
        .select()
        .single();

      if (usError) {
        console.error('❌ Error al guardar user story individual:', usError);
        throw usError;
      }

      console.log(`✅ User story individual guardada: ${usData.id}`);
      const userStoryId = usData.id;

      if (userStory.test_cases && userStory.test_cases.length > 0) {
        for (const tc of userStory.test_cases) {
          const testCaseData: DbTestCase = {
            user_story_id: userStoryId,
            title: tc.title,
            preconditions: tc.preconditions,
            expected_results: tc.expected_results,
            position: tc.position
          };

          const { data: tcData, error: tcError } = await this.supabase
            .from('test_cases')
            .insert([testCaseData])
            .select()
            .single();

          if (tcError) {
            console.error('❌ Error al guardar test case:', tcError);
            throw tcError;
          }

          console.log(`  ✅ Test case guardado: ${tcData.id}`);
          const testCaseId = tcData.id;

          if (tc.test_case_steps && tc.test_case_steps.length > 0) {
            const stepsData = tc.test_case_steps.map(step => ({
              test_case_id: testCaseId,
              step_number: step.step_number,
              action: step.action
            }));

            const { error: stepsError } = await this.supabase
              .from('test_case_steps')
              .insert(stepsData);

            if (stepsError) {
              console.error('❌ Error al guardar steps:', stepsError);
              throw stepsError;
            }

            console.log(`    ✅ ${stepsData.length} steps guardados`);
          }
        }
      }

      console.log('🎉 HU individual guardada exitosamente!');
      return userStoryId;

    } catch (error) {
      console.error('❌ Error al guardar HU individual:', error);
      throw error;
    }
  }

  async associateUserStoriesToTestPlan(
    testPlanId: string,
    userStoryIds: string[]
  ): Promise<void> {
    console.log(`📎 Asociando ${userStoryIds.length} HUs al test plan ${testPlanId}...`);

    try {
      const { error } = await this.supabase
        .from('user_stories')
        .update({ test_plan_id: testPlanId })
        .in('id', userStoryIds);

      if (error) {
        console.error('❌ Error al asociar HUs:', error);
        throw error;
      }

      console.log('✅ HUs asociadas exitosamente al test plan');
    } catch (error) {
      console.error('❌ Error al asociar HUs:', error);
      throw error;
    }
  }

  async getOrphanUserStories(): Promise<DbUserStoryWithRelations[]> {
    console.log('📥 Obteniendo HUs sin test plan...');

    try {
      const { data, error } = await this.supabase
        .from('user_stories')
        .select(`
          *,
          test_cases (
            *,
            test_case_steps (*)
          )
        `)
        .is('test_plan_id', null)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('❌ Error al obtener HUs huérfanas:', error);
        throw error;
      }

      console.log(`✅ ${data?.length || 0} HUs sin test plan encontradas`);
      return data || [];
    } catch (error) {
      console.error('❌ Error al obtener HUs huérfanas:', error);
      throw error;
    }
  }

  async getAllTestPlansWithRelations(page: number = 1, pageSize: number = 10): Promise<{ data: DbTestPlanWithRelations[], count: number }> {
    try {
      const currentUserId = await this.getCurrentUserIdOrThrow();
      console.log(`🔍 Obteniendo test plans desde Supabase (Página ${page}, Tamaño ${pageSize})...`);

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const { data, error, count } = await this.supabase
        .from('test_plans')
        .select(`
          *,
          user_stories (
            *,
            test_cases (
              *,
              test_case_steps (
                id,
                test_case_id,
                step_number,
                action,
                created_at
              )
            )
          )
        `, { count: 'exact' })
        .eq('user_id', currentUserId)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) {
        console.error('❌ Error en query:', error);
        throw error;
      }

      console.log(`✅ ${data?.length || 0} Test Plans recuperados de Supabase (Total: ${count})`);
      return { data: data || [], count: count || 0 };

    } catch (error) {
      console.error('❌ Error al obtener test plans:', error);
      throw error;
    }
  }

  async getTestPlanHeaders(): Promise<DbTestPlan[]> {
    try {
      const currentUserId = await this.getCurrentUserIdOrThrow();
      console.log('🔍 Obteniendo headers de test plans...');
      const { data, error } = await this.supabase
        .from('test_plans')
        .select(`
          id, 
          title, 
          created_at, 
          updated_at, 
          cell_name, 
          team, 
          repository_link, 
          user_stories(
            id,
            sprint,
            test_cases(
              id,
              test_case_steps(id)
            )
          )
        `)
        .eq('user_id', currentUserId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      console.log(`✅ ${data?.length || 0} Headers recuperados`);
      return data || [];
    } catch (error) {
      console.error('❌ Error al obtener headers:', error);
      throw error;
    }
  }

  async getTestPlanHeaderById(id: string): Promise<DbTestPlan | null> {
    try {
      const currentUserId = await this.getCurrentUserIdOrThrow();
      const { data, error } = await this.supabase
        .from('test_plans')
        .select(`
          id,
          title,
          created_at,
          updated_at,
          cell_name,
          team,
          repository_link,
          user_stories(
            id,
            sprint,
            test_cases(
              id,
              test_case_steps(id)
            )
          )
        `)
        .eq('id', id)
        .eq('user_id', currentUserId)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ Error al obtener header del plan:', error);
      return null;
    }
  }

  async getTestPlanById(id: string): Promise<DbTestPlanWithRelations | null> {
    console.log(`📥 Obteniendo test plan ${id}...`);

    try {
      const currentUserId = await this.getCurrentUserIdOrThrow();
      const { data, error } = await this.supabase
        .from('test_plans')
        .select(`
          *,
          user_stories (
            *,
            test_cases (
              *,
              test_case_steps (
                id,
                test_case_id,
                step_number,
                action,
                created_at
              )
            )
          )
        `)
        .eq('id', id)
        .eq('user_id', currentUserId)
        .single();

      if (error) {
        console.error('❌ Error al obtener test plan:', error);
        throw error;
      }

      console.log('✅ Test plan obtenido');
      return data;

    } catch (error) {
      console.error('❌ Error:', error);
      return null;
    }
  }

  async updateTestPlan(id: string, updates: Partial<DbTestPlan>): Promise<boolean> {
    console.log(`📝 Actualizando test plan ${id}...`);

    try {
      const currentUserId = await this.getCurrentUserIdOrThrow();
      const { error } = await this.supabase
        .from('test_plans')
        .update(updates)
        .eq('id', id)
        .eq('user_id', currentUserId);

      if (error) {
        console.error('❌ Error al actualizar:', error);
        throw error;
      }

      console.log('✅ Test plan actualizado');
      return true;

    } catch (error) {
      console.error('❌ Error:', error);
      return false;
    }
  }

  async getRiskStrategyByTestPlanId(testPlanId: string): Promise<DbRiskStrategy | null> {
    try {
      const { data, error } = await this.supabase
        .from('test_plan_risk_strategies')
        .select('*')
        .eq('test_plan_id', testPlanId)
        .maybeSingle();

      if (error) {
        console.error('❌ Error al obtener riesgo del plan:', error);
        throw error;
      }

      return data;
    } catch (error) {
      console.error('❌ Error en getRiskStrategyByTestPlanId:', error);
      return null;
    }
  }

  async upsertRiskStrategy(testPlanId: string, riskData: any): Promise<boolean> {
    try {
      const payload = {
        test_plan_id: testPlanId,
        risk_data: riskData,
        updated_at: new Date().toISOString()
      };

      const { error } = await this.supabase
        .from('test_plan_risk_strategies')
        .upsert(payload, { onConflict: 'test_plan_id' });

      if (error) {
        console.error('❌ Error al guardar riesgo del plan:', error);
        throw error;
      }

      return true;
    } catch (error) {
      console.error('❌ Error en upsertRiskStrategy:', error);
      return false;
    }
  }

  async smartUpdateTestPlan(
    testPlanId: string,
    testPlanData: DbTestPlan,
    userStories: DbUserStoryWithRelations[]
  ): Promise<void> {
    console.log('🧠 Smart Update: Iniciando proceso optimizado...');

    try {
      await this.updateTestPlan(testPlanId, testPlanData);

      const currentTestPlan = await this.getTestPlanById(testPlanId);
      const currentHUs = (currentTestPlan?.user_stories || []).filter(hu => !!hu.id);
      const currentHUMap = new Map(currentHUs.map(hu => [hu.id!, hu]));

      const toInsert: DbUserStoryWithRelations[] = [];
      const toUpdate: DbUserStoryWithRelations[] = [];
      const toDeleteIds: string[] = [];
      const unmodifiedIds: string[] = [];

      for (const incomingHU of userStories) {
        if (incomingHU.id && currentHUMap.has(incomingHU.id)) {
          const existingHU = currentHUMap.get(incomingHU.id)!;
          if (this.dbHelper.hasUserStoryChanged(existingHU, incomingHU)) {
            toUpdate.push(incomingHU);
          } else {
            unmodifiedIds.push(incomingHU.id);
          }
          currentHUMap.delete(incomingHU.id!);
        } else {
          toInsert.push(incomingHU);
        }
      }

      toDeleteIds.push(...currentHUMap.keys());

      console.log(`📊 Resumen Smart Update:
        - Nuevos: ${toInsert.length}
        - Modificados: ${toUpdate.length}
        - Sin cambios: ${unmodifiedIds.length}
        - Eliminados: ${toDeleteIds.length}
      `);

      if (toDeleteIds.length > 0) {
        const { data: deletedHUs, error } = await this.supabase
          .from('user_stories')
          .delete()
          .in('id', toDeleteIds)
          .select('id');

        if (error) throw error;

        const deletedCount = deletedHUs?.length ?? 0;
        if (deletedCount !== toDeleteIds.length) {
          throw new Error(
            `No se pudieron eliminar todas las HUs en BD. Esperadas: ${toDeleteIds.length}, eliminadas: ${deletedCount}`
          );
        }

        console.log(`🗑️ ${deletedCount} HUs eliminadas`);
      }

      if (toInsert.length > 0) {
        toInsert.forEach(hu => hu.test_plan_id = testPlanId);
        await this.persistUserStoriesGraph(testPlanId, toInsert);
        console.log(`✨ ${toInsert.length} HUs nuevas insertadas`);
      }

      if (toUpdate.length > 0) {
        const updatesPayload = toUpdate.map(hu => ({
          id: hu.id,
          test_plan_id: testPlanId,
          custom_id: hu.custom_id,
          title: hu.title,
          description: hu.description,
          acceptance_criteria: hu.acceptance_criteria,
          generated_scope: hu.generated_scope,
          generated_test_case_titles: hu.generated_test_case_titles,
          generation_mode: hu.generation_mode,
          sprint: hu.sprint,
          refinement_technique: hu.refinement_technique,
          refinement_context: hu.refinement_context,
          position: hu.position,
          updated_at: new Date().toISOString()
        }));

        const { error: updateError } = await this.supabase
          .from('user_stories')
          .upsert(updatesPayload);

        if (updateError) throw updateError;

        const updateIds = toUpdate.map(hu => hu.id!);

        const { data: tcsToDelete } = await this.supabase
          .from('test_cases')
          .select('id')
          .in('user_story_id', updateIds);

        if (tcsToDelete && tcsToDelete.length > 0) {
          const tcIds = tcsToDelete.map(tc => tc.id);
          await this.supabase.from('test_case_steps').delete().in('test_case_id', tcIds);
          await this.supabase.from('test_cases').delete().in('id', tcIds);
        }

        await this.persistTestCasesAndSteps(toUpdate);

        console.log(`📝 ${toUpdate.length} HUs actualizadas`);
      }

      console.log('🎉 Smart Update completado exitosamente!');

    } catch (error) {
      console.error('❌ Error en Smart Update:', error);
      throw error;
    }
  }

  private async persistTestCasesAndSteps(userStories: DbUserStoryWithRelations[]): Promise<void> {
    const allTestCases: { usId: string, tc: DbTestCaseWithRelations, originalIndex: number }[] = [];

    userStories.forEach(us => {
      if (us.id && us.test_cases) {
        us.test_cases.forEach(tc => {
          allTestCases.push({ usId: us.id!, tc, originalIndex: 0 });
        });
      }
    });

    if (allTestCases.length === 0) return;

    const tcsToInsert = allTestCases.map(item => ({
      user_story_id: item.usId,
      title: item.tc.title,
      preconditions: item.tc.preconditions,
      expected_results: item.tc.expected_results,
      position: item.tc.position
    }));

    const insertedTestCases = await this.dbHelper.chunkedInsert(
      'test_cases',
      tcsToInsert,
      'id, user_story_id, position'
    );

    const stepsPayload: DbTestCaseStep[] = [];

    if (insertedTestCases.length === allTestCases.length) {
      insertedTestCases.forEach((insertedTc, index) => {
        const originalTc = allTestCases[index].tc;
        const steps = originalTc.test_case_steps || [];

        steps.forEach((step, stepIdx) => {
          if (step.action && step.action.trim()) {
            stepsPayload.push({
              test_case_id: insertedTc.id,
              step_number: step.step_number ?? stepIdx + 1,
              action: step.action
            });
          }
        });
      });

      if (stepsPayload.length > 0) {
        await this.dbHelper.chunkedInsert('test_case_steps', stepsPayload);
      }
    } else {
      console.error('❌ Mismatch en inserción de TCs, no se pueden guardar steps con seguridad.');
    }
  }

  async smartUpdateUserStoryTestCases(userStoryId: string, testCases: DetailedTestCase[]): Promise<void> {
    console.log(`🧠 Smart Update TCs para HU ${userStoryId}. Casos a sincronizar: ${testCases.length}`);
    console.log(`📋 Detalles de casos entrada:`, testCases.map(tc => ({ title: tc.title, dbId: tc.dbId, steps: tc.steps?.length || 0 })));

    if (!userStoryId) {
      console.error('❌ smartUpdateUserStoryTestCases: userStoryId is missing!');
      throw new Error('userStoryId is required for smartUpdateUserStoryTestCases');
    }

    try {
      const { data: existingTCs, error } = await this.supabase
        .from('test_cases')
        .select('*, test_case_steps(*)')
        .eq('user_story_id', userStoryId);
      
      console.log(`📊 TCs existentes en BD: ${existingTCs?.length || 0}`);

      if (error) throw error;

      const existingMap = new Map((existingTCs || []).map(tc => [tc.id, tc]));

      const tcsToInsert: DetailedTestCase[] = [];
      const tcsToUpdate: DetailedTestCase[] = [];
      const tcsToDeleteIds: string[] = [];
      const tcsUnmodifiedIds: string[] = [];

      for (const tc of testCases) {
        if (tc.dbId && existingMap.has(tc.dbId)) {
          const existing = existingMap.get(tc.dbId)!;
          if (this.dbHelper.hasTestCaseChanged(existing, tc)) {
            tcsToUpdate.push(tc);
          } else {
            tcsUnmodifiedIds.push(tc.dbId);
          }
          existingMap.delete(tc.dbId);
        } else {
          tcsToInsert.push(tc);
        }
      }

      tcsToDeleteIds.push(...existingMap.keys());

      console.log(`📊 Resumen TCs:
        - Nuevos: ${tcsToInsert.length}
        - Modificados: ${tcsToUpdate.length}
        - Sin cambios: ${tcsUnmodifiedIds.length}
        - Eliminados: ${tcsToDeleteIds.length}
      `);

      if (tcsToDeleteIds.length > 0) {
        const { error: deleteStepsError } = await this.supabase
          .from('test_case_steps')
          .delete()
          .in('test_case_id', tcsToDeleteIds);

        if (deleteStepsError) throw deleteStepsError;

        const { data: deletedCases, error: deleteCasesError } = await this.supabase
          .from('test_cases')
          .delete()
          .in('id', tcsToDeleteIds)
          .select('id');

        if (deleteCasesError) throw deleteCasesError;

        const deletedCount = deletedCases?.length ?? 0;
        if (deletedCount !== tcsToDeleteIds.length) {
          throw new Error(
            `No se pudieron eliminar todos los TCs en BD. Esperados: ${tcsToDeleteIds.length}, eliminados: ${deletedCount}`
          );
        }

        console.log(`🗑️ ${deletedCount} TCs eliminados`);
      }

      if (tcsToInsert.length > 0) {
        const tcsPayload = tcsToInsert.map(tc => {
          if (!userStoryId) throw new Error('userStoryId missing during payload creation');
          return {
            user_story_id: userStoryId,
            title: tc.title,
            preconditions: tc.preconditions,
            expected_results: tc.expectedResults,
            position: tc.position
          };
        });

        const { data: insertedTCs, error: insertError } = await this.supabase
          .from('test_cases')
          .insert(tcsPayload)
          .select();

        if (insertError) throw insertError;

        if (insertedTCs) {
          const stepsPayload: DbTestCaseStep[] = [];
          insertedTCs.forEach((inserted, idx) => {
            const original = tcsToInsert[idx];
            original.steps.forEach((s, sIdx) => {
              if (s.accion && s.accion.trim()) {
                stepsPayload.push({
                  test_case_id: inserted.id,
                  step_number: sIdx + 1,
                  action: s.accion
                });
              }
            });
          });

          if (stepsPayload.length > 0) {
            await this.dbHelper.chunkedInsert('test_case_steps', stepsPayload);
          }
        }
        console.log(`✨ ${tcsToInsert.length} TCs nuevos insertados`);
      }

      if (tcsToUpdate.length > 0) {
        const updatesPayload = tcsToUpdate.map(tc => ({
          id: tc.dbId,
          user_story_id: userStoryId,
          title: tc.title,
          preconditions: tc.preconditions,
          expected_results: tc.expectedResults,
          position: tc.position,
          updated_at: new Date().toISOString()
        }));

        const { error: updateError } = await this.supabase
          .from('test_cases')
          .upsert(updatesPayload);

        if (updateError) throw updateError;

        const updateIds = tcsToUpdate.map(tc => tc.dbId!);
        const { error: deleteUpdatedStepsError } = await this.supabase
          .from('test_case_steps')
          .delete()
          .in('test_case_id', updateIds);

        if (deleteUpdatedStepsError) throw deleteUpdatedStepsError;

        const newStepsPayload: DbTestCaseStep[] = [];
        tcsToUpdate.forEach(tc => {
          tc.steps.forEach((s, sIdx) => {
            if (s.accion && s.accion.trim()) {
              newStepsPayload.push({
                test_case_id: tc.dbId!,
                step_number: sIdx + 1,
                action: s.accion
              });
            }
          });
        });

        if (newStepsPayload.length > 0) {
          await this.dbHelper.chunkedInsert('test_case_steps', newStepsPayload);
        }
        console.log(`📝 ${tcsToUpdate.length} TCs actualizados`);
      }
      
      // Final summary
      const totalSynced = tcsToInsert.length + tcsToUpdate.length + tcsUnmodifiedIds.length;
      console.log(`✅ SINCRONIZACIÓN COMPLETADA: ${totalSynced} TCs en total (${tcsToInsert.length} nuevos + ${tcsToUpdate.length} actualizados + ${tcsUnmodifiedIds.length} sin cambios)`);

    } catch (error) {
      console.error('❌ Error en smartUpdateUserStoryTestCases:', error);
      throw error;
    }
  }

  async updateCompleteTestPlan(
    testPlanId: string,
    testPlanData: DbTestPlan,
    userStories: DbUserStoryWithRelations[]
  ): Promise<void> {
    console.log('📝 Actualizando test plan completo en Supabase...');

    try {
      const { error: planError } = await this.supabase
        .from('test_plans')
        .update(testPlanData)
        .eq('id', testPlanId);

      if (planError) {
        console.error('❌ Error al actualizar test plan:', planError);
        throw planError;
      }

      console.log('✅ Test plan actualizado');

      const { error: deleteError } = await this.supabase
        .from('user_stories')
        .delete()
        .eq('test_plan_id', testPlanId);

      if (deleteError) {
        console.error('❌ Error al eliminar user stories anteriores:', deleteError);
        throw deleteError;
      }

      console.log('✅ User stories anteriores eliminadas');

      await this.persistUserStoriesGraph(testPlanId, userStories);

      console.log('🎉 Test plan actualizado completamente!');

    } catch (error) {
      console.error('❌ Error general en updateCompleteTestPlan:', error);
      throw error;
    }
  }

  async deleteTestPlan(id: string): Promise<boolean> {
    console.log(`🗑️ Eliminando test plan ${id}...`);

    try {
      const currentUserId = await this.getCurrentUserIdOrThrow();
      const { data: deletedPlans, error } = await this.supabase
        .from('test_plans')
        .delete()
        .eq('id', id)
        .eq('user_id', currentUserId)
        .select('id');

      if (error) {
        console.error('❌ Error al eliminar:', error);
        throw error;
      }

      const deletedCount = deletedPlans?.length ?? 0;
      if (deletedCount === 0) {
        throw new Error(`No se eliminó el test plan ${id}. Verifica políticas RLS/permisos.`);
      }

      console.log(`✅ Test plan eliminado (${deletedCount})`);
      return true;

    } catch (error) {
      console.error('❌ Error:', error);
      return false;
    }
  }

  async getStatistics(): Promise<{
    testPlans: number;
    userStories: number;
    testCases: number;
  }> {
    try {
      const currentUserId = await this.getCurrentUserIdOrThrow();
      const [plansResult, storiesResult, casesResult] = await Promise.all([
        this.supabase.from('test_plans').select('id', { count: 'exact', head: true }).eq('user_id', currentUserId),
        this.supabase.from('user_stories').select('id', { count: 'exact', head: true }).eq('user_id', currentUserId),
        this.supabase.from('test_cases').select('id', { count: 'exact', head: true }).eq('user_id', currentUserId)
      ]);

      return {
        testPlans: plansResult.count || 0,
        userStories: storiesResult.count || 0,
        testCases: casesResult.count || 0
      };
    } catch (error) {
      console.error('❌ Error al obtener estadísticas:', error);
      return { testPlans: 0, userStories: 0, testCases: 0 };
    }
  }

  private async persistUserStoriesGraph(
    testPlanId: string,
    userStories: DbUserStoryWithRelations[]
  ): Promise<void> {
    if (!userStories.length) {
      return;
    }

    const userStoryKeys: string[] = [];
    const userStoriesPayload: DbUserStory[] = userStories.map((us, index) => {
      const resolvedPosition = us.position ?? index;
      userStoryKeys.push(this.dbHelper.makeUserStoryKey(resolvedPosition, us.custom_id));

      return {
        test_plan_id: testPlanId,
        custom_id: us.custom_id,
        title: us.title,
        description: us.description,
        acceptance_criteria: us.acceptance_criteria,
        generated_scope: us.generated_scope,
        generated_test_case_titles: us.generated_test_case_titles,
        generation_mode: us.generation_mode,
        sprint: us.sprint,
        refinement_technique: us.refinement_technique,
        refinement_context: us.refinement_context,
        position: resolvedPosition
      };
    });

    const insertedUserStories = await this.dbHelper.chunkedInsert(
      'user_stories',
      userStoriesPayload,
      'id, position, custom_id'
    );

    console.log(`✅ ${insertedUserStories.length} user stories guardadas`);

    if (!insertedUserStories.length) {
      return;
    }

    const insertedUserStoryMap = new Map<string, { id: string; position: number | null; custom_id: string | null }>();
    insertedUserStories.forEach(us => {
      const key = this.dbHelper.makeUserStoryKey(us.position, us.custom_id);
      if (us.id) {
        insertedUserStoryMap.set(key, us);
      }
    });

    const testCasesPayload: DbTestCase[] = [];
    const testCaseStepsMeta = new Map<string, { steps: { step_number: number | null | undefined; action: string }[] }>();

    userStories.forEach((us, index) => {
      const insertedUs = insertedUserStoryMap.get(userStoryKeys[index]);

      if (!insertedUs?.id) {
        console.warn('⚠️ No se pudo encontrar la user story recién guardada para el índice', index);
        return;
      }

      if (!us.test_cases?.length) {
        return;
      }

      us.test_cases.forEach((tc, tcIndex) => {
        const resolvedPosition = tc.position ?? tcIndex + 1;
        const testCaseKey = this.dbHelper.makeTestCaseKey(insertedUs.id!, resolvedPosition);

        testCasesPayload.push({
          user_story_id: insertedUs.id!,
          title: tc.title,
          preconditions: tc.preconditions,
          expected_results: tc.expected_results,
          position: resolvedPosition
        });

        const steps = tc.test_case_steps
          ?.filter(step => step.action?.trim())
          .map((step, stepIndex) => ({
            step_number: step.step_number ?? stepIndex + 1,
            action: step.action
          })) || [];

        if (steps.length > 0) {
          testCaseStepsMeta.set(testCaseKey, { steps });
        }
      });
    });

    if (!testCasesPayload.length) {
      return;
    }

    const insertedTestCases = await this.dbHelper.chunkedInsert(
      'test_cases',
      testCasesPayload,
      'id, user_story_id, position'
    );

    console.log(`  ✅ ${insertedTestCases.length} test cases guardados`);

    if (!insertedTestCases.length) {
      return;
    }

    const insertedTestCaseMap = new Map<string, { id: string; user_story_id: string; position: number | null }>();
    insertedTestCases.forEach(tc => {
      if (tc.id && tc.user_story_id) {
        insertedTestCaseMap.set(this.dbHelper.makeTestCaseKey(tc.user_story_id, tc.position), tc);
      }
    });

    const stepsPayload: DbTestCaseStep[] = [];

    testCaseStepsMeta.forEach((meta, key) => {
      const insertedTestCase = insertedTestCaseMap.get(key);

      if (!insertedTestCase?.id) {
        console.warn('⚠️ No se pudo encontrar el test case recién guardado para la clave', key);
        return;
      }

      meta.steps.forEach((step, index) => {
        stepsPayload.push({
          test_case_id: insertedTestCase.id!,
          step_number: step.step_number ?? index + 1,
          action: step.action
        });
      });
    });

    if (!stepsPayload.length) {
      return;
    }

    await this.dbHelper.chunkedInsert('test_case_steps', stepsPayload);
    console.log(`    ✅ ${stepsPayload.length} steps guardados`);
  }
}
