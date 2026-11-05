import { Injectable } from '@angular/core';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseClientService } from './supabase-client.service';
import { DatabaseHelperService } from './database-helper.service';
import {
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
  /**
   * Última versión cargada de cada plan, para mostrar al instante al navegar
   * entre detalle, previsualización, secciones y riesgos mientras se consulta
   * la versión actual. Cualquier escritura la invalida.
   */
  private readonly planCache = new Map<string, { plan: DbTestPlanWithRelations; at: number }>();
  private readonly PLAN_CACHE_TTL_MS = 10 * 60 * 1000;

  getCachedTestPlan(id: string): DbTestPlanWithRelations | null {
    const entry = this.planCache.get(id);
    if (!entry || Date.now() - entry.at > this.PLAN_CACHE_TTL_MS) return null;
    return structuredClone(entry.plan);
  }

  invalidateTestPlanCache(id?: string): void {
    if (id) this.planCache.delete(id); else this.planCache.clear();
  }


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
    this.invalidateTestPlanCache();
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
    this.invalidateTestPlanCache();
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
            test_case_steps!test_case_steps_test_case_id_fkey (*)
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

  async getAllTestPlansWithRelations(page: number = 1, pageSize: number = 10): Promise<{ data: any[], count: number }> {
    try {
      const currentUserId = await this.getCurrentUserIdOrThrow();
      console.log(`🔍 Obteniendo test plans desde Supabase (Página ${page}, Tamaño ${pageSize})...`);

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const { data, error, count } = await this.supabase
        .from('test_plans')
        .select(`
          id, title, cell_name, team, created_at, updated_at, repository_link,
          user_stories (
            id, custom_id, title, sprint, description, acceptance_criteria, position, test_plan_id,
            test_cases:test_cases(count)
          )
        `, { count: 'exact' })
        .eq('user_id', currentUserId)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) {
        console.error('❌ Error en query:', error);
        throw error;
      }

      return { data: data || [], count: count || 0 };
    } catch (error) {
      console.error('❌ Error al obtener test plans:', error);
      throw error;
    }
  }

  /**
   * Planes para el selector de "Nueva ejecución": liviano y paginado.
   * Trae solo lo necesario para elegir (sin descripción ni criterios de cada HU)
   * y busca en el servidor por título del plan, ID o título de la HU, para que el
   * selector funcione igual con 20 planes que con miles.
   */
  async getPlansForPicker(
    search: string = '',
    page: number = 1,
    pageSize: number = 25
  ): Promise<{ data: any[]; count: number; matchedHuIds: string[] }> {
    const currentUserId = await this.getCurrentUserIdOrThrow();
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    // Caracteres reservados por los filtros de PostgREST (or/ilike).
    const term = search.replace(/[%,()*\\]/g, ' ').trim();

    let query = this.supabase
      .from('test_plans')
      .select(`
        id, title, created_at,
        user_stories ( id, custom_id, title, sprint, position, test_cases:test_cases(count) )
      `, { count: 'exact' })
      .eq('user_id', currentUserId)
      .order('created_at', { ascending: false })
      .range(from, to);

    let matchedHuIds: string[] = [];
    if (term) {
      // HUs cuyo ID o título coinciden: se incluyen sus planes aunque el título del plan no coincida.
      const { data: hus } = await this.supabase
        .from('user_stories')
        .select('id, test_plan_id')
        .or(`custom_id.ilike.%${term}%,title.ilike.%${term}%`)
        .limit(300);
      matchedHuIds = (hus || []).map((h: any) => h.id);
      const planIds = Array.from(new Set((hus || []).map((h: any) => h.test_plan_id).filter(Boolean)));
      query = planIds.length
        ? query.or(`title.ilike.%${term}%,id.in.(${planIds.join(',')})`)
        : query.ilike('title', `%${term}%`);
    }

    const { data, error, count } = await query;
    if (error) {
      console.error('❌ Error al buscar planes para el selector:', error);
      throw error;
    }
    return { data: data || [], count: count || 0, matchedHuIds };
  }

  async getTestPlanSummariesPaginated(page: number = 1, pageSize: number = 10): Promise<{ data: any[], count: number }> {
    try {
      const currentUserId = await this.getCurrentUserIdOrThrow();
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const { data, error, count } = await this.supabase
        .from('v_test_plan_summary')
        .select('*', { count: 'exact' })
        .eq('user_id', currentUserId)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;
      return { data: data || [], count: count || 0 };
    } catch (error) {
      console.error('❌ Error en getTestPlanSummariesPaginated:', error);
      throw error;
    }
  }

  async getTestPlanHeaders(): Promise<any[]> {
    try {
      const currentUserId = await this.getCurrentUserIdOrThrow();
      console.log('🔍 Obteniendo resúmenes optimizados de test plans...');
      const { data, error } = await this.supabase
        .from('v_test_plan_summary')
        .select('*')
        .eq('user_id', currentUserId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      console.log(`✅ ${data?.length || 0} Resúmenes recuperados de la vista`);
      return data || [];
    } catch (error) {
      console.error('❌ Error al obtener headers desde la vista:', error);
      throw error;
    }
  }

  async getTestPlanHeaderById(id: string): Promise<any | null> {
    try {
      const currentUserId = await this.getCurrentUserIdOrThrow();
      const { data, error } = await this.supabase
        .from('v_test_plan_summary')
        .select('*')
        .eq('id', id)
        .eq('user_id', currentUserId)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ Error al obtener resumen del plan por ID:', error);
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
              test_case_steps!test_case_steps_test_case_id_fkey (*)
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
      const sorted = sortPlanRelations(data);
      if (sorted?.id) this.planCache.set(sorted.id, { plan: structuredClone(sorted), at: Date.now() });
      return sorted;

    } catch (error) {
      console.error('❌ Error:', error);
      return null;
    }
  }

  async getUserStoryWithTestCases(userStoryId: string): Promise<any | null> {
    console.log(`📥 Obteniendo detalles completos de HU ${userStoryId}...`);
    try {
      const { data, error } = await this.supabase
        .from('user_stories')
        .select(`
          *,
          test_cases (
            *,
            test_case_steps!test_case_steps_test_case_id_fkey (
              id,
              test_case_id,
              step_number,
              action,
              created_at
            )
          )
        `)
        .eq('id', userStoryId)
        .single();

      if (error) throw error;
      // Orden estable: casos por posición y pasos por número. Sin esto el orden
      // dependía de la base de datos y cambiaba tras cada actualización.
      if (data?.test_cases) {
        data.test_cases = sortTestCasesByPosition(data.test_cases).map((tc: any) => ({
          ...tc,
          test_case_steps: [...(tc.test_case_steps || [])].sort((a: any, b: any) => (a.step_number ?? 0) - (b.step_number ?? 0))
        }));
      }
      return data;
    } catch (error) {
      console.error('❌ Error al obtener detalles de la HU:', error);
      return null;
    }
  }

  async updateTestPlan(id: string, updates: Partial<DbTestPlan>): Promise<boolean> {
    this.invalidateTestPlanCache();
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
    this.invalidateTestPlanCache();
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

        console.log(`📝 ${toUpdate.length} HUs actualizadas (solo metadata, TCs sin tocar)`);
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
    this.invalidateTestPlanCache();
    console.log(`🧠 Smart Update TCs para HU ${userStoryId}. Casos a sincronizar: ${testCases.length}`);

    if (!userStoryId) {
      console.error('❌ smartUpdateUserStoryTestCases: userStoryId is missing!');
      throw new Error('userStoryId is required for smartUpdateUserStoryTestCases');
    }

    try {
      const { data: existingTCs, error } = await this.supabase
        .from('test_cases')
        .select('*, test_case_steps!test_case_steps_test_case_id_fkey(*)')
        .eq('user_story_id', userStoryId);
      
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

      if (tcsToDeleteIds.length > 0) {
        const { error: deleteStepsError } = await this.supabase
          .from('test_case_steps')
          .delete()
          .in('test_case_id', tcsToDeleteIds);

        if (deleteStepsError) throw deleteStepsError;

        const { error: deleteCasesError } = await this.supabase
          .from('test_cases')
          .delete()
          .in('id', tcsToDeleteIds);

        if (deleteCasesError) throw deleteCasesError;
      }

      if (tcsToInsert.length > 0) {
        const tcsPayload = tcsToInsert.map(tc => ({
          user_story_id: userStoryId,
          title: tc.title,
          preconditions: tc.preconditions,
          expected_results: tc.expectedResults,
          position: tc.position
        }));

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
        await this.supabase
          .from('test_case_steps')
          .delete()
          .in('test_case_id', updateIds);

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
      }
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
    this.invalidateTestPlanCache();
    try {
      const { error: planError } = await this.supabase
        .from('test_plans')
        .update(testPlanData)
        .eq('id', testPlanId);

      if (planError) throw planError;

      await this.supabase
        .from('user_stories')
        .delete()
        .eq('test_plan_id', testPlanId);

      await this.persistUserStoriesGraph(testPlanId, userStories);
    } catch (error) {
      console.error('❌ Error general en updateCompleteTestPlan:', error);
      throw error;
    }
  }

  async deleteTestPlan(id: string): Promise<boolean> {
    this.invalidateTestPlanCache();
    try {
      const currentUserId = await this.getCurrentUserIdOrThrow();
      const { error } = await this.supabase
        .from('test_plans')
        .delete()
        .eq('id', id)
        .eq('user_id', currentUserId);

      if (error) throw error;
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

  private async persistUserStoriesGraph(testPlanId: string, userStories: DbUserStoryWithRelations[]): Promise<void> {
    const husToInsert = userStories.map(us => ({
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
      position: us.position
    }));

    const insertedHUs = await this.dbHelper.chunkedInsert(
      'user_stories',
      husToInsert,
      'id, custom_id, title, position'
    );

    if (insertedHUs.length !== userStories.length) {
      throw new Error('Mismatch in inserted user stories count');
    }

    const testCasesPayload: any[] = [];
    const tcMetadata: { originalUs: DbUserStoryWithRelations, insertedId: string }[] = [];

    insertedHUs.forEach((insertedHu, index) => {
      const originalUs = userStories[index];
      const tcs = originalUs.test_cases || [];
      
      tcs.forEach(tc => {
        testCasesPayload.push({
          user_story_id: insertedHu.id,
          title: tc.title,
          preconditions: tc.preconditions,
          expected_results: tc.expected_results,
          position: tc.position
        });
        tcMetadata.push({ originalUs, insertedId: insertedHu.id });
      });
    });

    if (testCasesPayload.length === 0) return;

    const insertedTCs = await this.dbHelper.chunkedInsert(
      'test_cases',
      testCasesPayload,
      'id, user_story_id, title'
    );

    const stepsPayload: any[] = [];
    insertedTCs.forEach((insertedTc, index) => {
      const originalTc = tcMetadata[index].originalUs.test_cases?.find(tc => tc.title === insertedTc.title);
      if (!originalTc) return;

      const steps = originalTc.test_case_steps || [];
      steps.forEach((step, stepIdx) => {
        stepsPayload.push({
          test_case_id: insertedTc.id,
          step_number: step.step_number ?? stepIdx + 1,
          action: step.action
        });
      });
    });

    if (stepsPayload.length > 0) {
      await this.dbHelper.chunkedInsert('test_case_steps', stepsPayload);
    }
  }
  /** Guarda el contexto y la técnica con que el analista refinó los escenarios de la HU. */
  async updateUserStoryRefinement(userStoryId: string, refinementContext: string, refinementTechnique: string): Promise<void> {
    const { error } = await this.supabase
      .from('user_stories')
      .update({ refinement_context: refinementContext, refinement_technique: refinementTechnique, updated_at: new Date().toISOString() })
      .eq('id', userStoryId);
    if (error) throw error;
  }

  async saveHuScenariosTransactional(userStoryId: string, testCases: DetailedTestCase[]): Promise<any> {
    this.invalidateTestPlanCache();
    console.log(`🛡️ Guardado transaccional para HU ${userStoryId}...`);
    
    // Preparar el payload para el RPC
    const payload = testCases.map((tc, index) => ({
      temp_id: `temp_${index}`,
      title: tc.title,
      preconditions: tc.preconditions || '',
      expectedResults: tc.expectedResults || '',
      position: index,
      steps: (tc.steps || []).map((s, sIdx) => ({
        step_number: sIdx + 1,
        action: s.accion
      }))
    }));

    try {
      const { data, error } = await this.supabase.rpc('save_hu_scenarios_safe', {
        p_user_story_id: userStoryId,
        p_test_cases: payload
      });

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ Error en guardado transaccional:', error);
      throw error;
    }
  }

  /**
   * Guarda o actualiza un único caso de prueba y sus pasos sin afectar al resto.
   */
  /**
   * Guarda un solo caso. Un caso existente conserva su posición (antes se
   * sobrescribía con el índice en pantalla y podían quedar dos casos con la
   * misma posición, lo que reordenaba la lista y hacía editar otro caso).
   * Un caso nuevo va al final de la HU.
   */
  async saveSingleTestCase(userStoryId: string, testCase: DetailedTestCase, _displayIndex?: number): Promise<DetailedTestCase> {
    this.invalidateTestPlanCache();
    try {
      let testCaseId = testCase.dbId;
      const fields = {
        title: testCase.title,
        preconditions: testCase.preconditions || '',
        expected_results: testCase.expectedResults || ''
      };

      // 1. Actualizar el caso existente o insertarlo al final
      if (testCaseId) {
        const { error: tcError } = await this.supabase
          .from('test_cases')
          .update(fields)
          .eq('id', testCaseId);
        if (tcError) throw tcError;
      } else {
        const { data: last } = await this.supabase
          .from('test_cases')
          .select('position')
          .eq('user_story_id', userStoryId)
          .order('position', { ascending: false, nullsFirst: false })
          .limit(1);
        const nextPosition = ((last && last[0]?.position) ?? -1) + 1;
        const { data: tcData, error: tcError } = await this.supabase
          .from('test_cases')
          .insert({ ...fields, user_story_id: userStoryId, position: nextPosition })
          .select('id')
          .single();
        if (tcError) throw tcError;
        testCaseId = tcData.id;
      }

      // 2. Eliminar pasos anteriores (si existe)
      const { error: delError } = await this.supabase
        .from('test_case_steps')
        .delete()
        .eq('test_case_id', testCaseId);
      
      if (delError) throw delError;

      // 3. Insertar pasos nuevos
      if (testCase.steps && testCase.steps.length > 0) {
        // Filtrar pasos vacíos
        const validSteps = testCase.steps.filter(s => s.accion?.trim());
        if (validSteps.length > 0) {
          const stepsToInsert = validSteps.map((s, idx) => ({
            test_case_id: testCaseId,
            step_number: idx + 1,
            action: s.accion
          }));

          const { error: stepError } = await this.supabase
            .from('test_case_steps')
            .insert(stepsToInsert);
          
          if (stepError) throw stepError;
        }
      }

      return { ...testCase, dbId: testCaseId };
    } catch (error) {
      console.error('❌ Error guardando caso individual:', error);
      throw error;
    }
  }
}

/** Ordena casos por posición; los empates conservan el orden de creación. */
export function sortTestCasesByPosition<T extends { position?: number | null; created_at?: string | null }>(cases: T[]): T[] {
  return cases
    .map((tc, index) => ({ tc, index }))
    .sort((a, b) =>
      (a.tc.position ?? Number.MAX_SAFE_INTEGER) - (b.tc.position ?? Number.MAX_SAFE_INTEGER)
      || String(a.tc.created_at || '').localeCompare(String(b.tc.created_at || ''))
      || a.index - b.index)
    .map(({ tc }) => tc);
}

/** HUs, casos y pasos de un plan en orden estable (posición / número de paso). */
export function sortPlanRelations<T extends { user_stories?: any[] }>(plan: T): T {
  if (!plan?.user_stories) return plan;
  plan.user_stories = sortTestCasesByPosition(plan.user_stories).map((us: any) => ({
    ...us,
    test_cases: sortTestCasesByPosition(us.test_cases || []).map((tc: any) => ({
      ...tc,
      test_case_steps: [...(tc.test_case_steps || [])].sort((a: any, b: any) => (a.step_number ?? 0) - (b.step_number ?? 0))
    }))
  }));
  return plan;
}
