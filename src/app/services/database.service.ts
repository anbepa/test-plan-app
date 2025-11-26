// src/app/services/database.service.ts
import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';
import type {
  DbTestPlan,
  DbUserStory,
  DbTestCase,
  DbTestCaseStep,
  DbImage,
  DbTestPlanWithRelations,
  DbUserStoryWithRelations,
  DbTestCaseWithRelations
} from '../models/database.model';

// Re-export para compatibilidad con otros componentes
export type {
  DbTestPlan,
  DbUserStory,
  DbTestCase,
  DbTestCaseStep,
  DbImage,
  DbTestPlanWithRelations,
  DbUserStoryWithRelations,
  DbTestCaseWithRelations
};

@Injectable({
  providedIn: 'root'
})
export class DatabaseService {
  public supabase: SupabaseClient;
  private static readonly INSERT_CHUNK_SIZE = 200;

  constructor() {
    // Validar que las variables de entorno están configuradas
    if (!environment.supabaseUrl || environment.supabaseUrl === '${SUPABASE_URL}') {
      console.error('❌ SUPABASE_URL no está configurada correctamente');
      throw new Error('Variables de entorno de Supabase no configuradas. Verifica la configuración en Vercel.');
    }

    if (!environment.supabaseKey || environment.supabaseKey === '${SUPABASE_KEY}') {
      console.error('❌ SUPABASE_KEY no está configurada correctamente');
      throw new Error('Variables de entorno de Supabase no configuradas. Verifica la configuración en Vercel.');
    }

    // Inicializar cliente de Supabase con environment.ts
    this.supabase = createClient(
      environment.supabaseUrl,
      environment.supabaseKey
    );

    console.log('✅ DatabaseService inicializado con environment.ts');
  }

  /**
   * Verificar si la base de datos está lista
   */
  isReady(): boolean {
    return !!(environment.supabaseUrl && environment.supabaseKey);
  }

  /**
   * Guardar un test plan completo con todas sus relaciones
   */
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

  /**
   * Guardar una Historia de Usuario individual (sin asociar a un test plan todavía)
   * Retorna el ID de la user story guardada
   */
  async saveIndividualUserStory(userStory: DbUserStoryWithRelations): Promise<string> {
    console.log('💾 Guardando HU individual en Supabase...');

    try {
      // 1. Guardar user story sin test_plan_id (será null)
      const userStoryData: any = {
        test_plan_id: null, // Sin test plan todavía
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

      // 2. Guardar test cases asociados
      if (userStory.test_cases && userStory.test_cases.length > 0) {
        for (const tc of userStory.test_cases) {
          const testCaseData: DbTestCase = {
            user_story_id: userStoryId,
            title: tc.title,
            preconditions: tc.preconditions,
            expected_results: tc.expected_results,
            position: tc.position  // ✅ CORREGIDO: Guardar position
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

          // 3. Guardar steps
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

  /**
   * Asociar HUs existentes a un test plan
   * Toma HUs que tienen test_plan_id = null y las asocia al test plan
   */
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

  /**
   * Obtener HUs que no están asociadas a ningún test plan (test_plan_id = null)
   */
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

  /**
   * Obtener todos los test plans con sus relaciones
   */
  async getAllTestPlansWithRelations(page: number = 1, pageSize: number = 10): Promise<{ data: DbTestPlanWithRelations[], count: number }> {
    try {
      console.log(`🔍 Obteniendo test plans desde Supabase (Página ${page}, Tamaño ${pageSize})...`);

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const { data, error, count } = await this.supabase
        .from('test_plans')
        .select(`
          *,
          user_stories (
            *,
            images (
              id,
              user_story_id,
              image_base64,
              position,
              created_at
            ),
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

  /**
   * Obtener solo los encabezados de los test plans para el listado (Optimizado)
   */
  async getTestPlanHeaders(): Promise<DbTestPlan[]> {
    try {
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
        .order('created_at', { ascending: false });

      if (error) throw error;

      console.log(`✅ ${data?.length || 0} Headers recuperados`);
      return data || [];
    } catch (error) {
      console.error('❌ Error al obtener headers:', error);
      throw error;
    }
  }

  /**
   * Obtener un test plan específico por ID
   */
  async getTestPlanById(id: string): Promise<DbTestPlanWithRelations | null> {
    console.log(`📥 Obteniendo test plan ${id}...`);

    try {

      const { data, error } = await this.supabase
        .from('test_plans')
        .select(`
          *,
          user_stories (
            *,
            images (
              id,
              user_story_id,
              image_base64,
              position,
              created_at
            ),
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

  /**
   * Actualizar un test plan (solo información básica)
   */
  async updateTestPlan(id: string, updates: Partial<DbTestPlan>): Promise<boolean> {
    console.log(`📝 Actualizando test plan ${id}...`);

    try {

      const { error } = await this.supabase
        .from('test_plans')
        .update(updates)
        .eq('id', id);

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

  /**
   * Actualizar un test plan completo con todas sus relaciones
   * Elimina las relaciones anteriores y crea nuevas
   */
  async updateCompleteTestPlan(
    testPlanId: string,
    testPlanData: DbTestPlan,
    userStories: DbUserStoryWithRelations[]
  ): Promise<void> {
    console.log('📝 Actualizando test plan completo en Supabase...');

    try {

      // 1. Actualizar test plan
      const { error: planError } = await this.supabase
        .from('test_plans')
        .update(testPlanData)
        .eq('id', testPlanId);

      if (planError) {
        console.error('❌ Error al actualizar test plan:', planError);
        throw planError;
      }

      console.log('✅ Test plan actualizado');

      // 2. Eliminar user stories anteriores (cascade delete eliminará test cases y steps)
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

  /**
   * Eliminar un test plan completo (cascade delete)
   */
  async deleteTestPlan(id: string): Promise<boolean> {
    console.log(`🗑️ Eliminando test plan ${id}...`);

    try {

      const { error } = await this.supabase
        .from('test_plans')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('❌ Error al eliminar:', error);
        throw error;
      }

      console.log('✅ Test plan eliminado');
      return true;

    } catch (error) {
      console.error('❌ Error:', error);
      return false;
    }
  }

  /**
   * Obtener estadísticas básicas
   */
  async getStatistics(): Promise<{
    testPlans: number;
    userStories: number;
    testCases: number;
  }> {
    try {

      const [plansResult, storiesResult, casesResult] = await Promise.all([
        this.supabase.from('test_plans').select('id', { count: 'exact', head: true }),
        this.supabase.from('user_stories').select('id', { count: 'exact', head: true }),
        this.supabase.from('test_cases').select('id', { count: 'exact', head: true })
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

  private makeUserStoryKey(position: number | null | undefined, customId?: string | null): string {
    return `${position ?? -1}::${customId ?? ''}`;
  }

  private makeTestCaseKey(userStoryId: string, position: number | null | undefined): string {
    return `${userStoryId}::${position ?? -1}`;
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
      userStoryKeys.push(this.makeUserStoryKey(resolvedPosition, us.custom_id));

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

    const insertedUserStories = await this.chunkedInsert(
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
      const key = this.makeUserStoryKey(us.position, us.custom_id);
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
        const testCaseKey = this.makeTestCaseKey(insertedUs.id!, resolvedPosition);

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

    const insertedTestCases = await this.chunkedInsert(
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
        insertedTestCaseMap.set(this.makeTestCaseKey(tc.user_story_id, tc.position), tc);
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

    await this.chunkedInsert('test_case_steps', stepsPayload);
    console.log(`    ✅ ${stepsPayload.length} steps guardados`);
  }

  private async chunkedInsert<T extends Record<string, any>>(
    table: 'user_stories' | 'test_cases' | 'test_case_steps',
    rows: T[],
    selectColumns?: string
  ): Promise<any[]> {
    if (!rows.length) {
      return [];
    }

    const chunkSize = DatabaseService.INSERT_CHUNK_SIZE;
    const accumulated: any[] = [];

    for (let start = 0; start < rows.length; start += chunkSize) {
      const chunk = rows.slice(start, start + chunkSize);
      let query = this.supabase
        .from(table)
        .insert(chunk);

      if (selectColumns) {
        const { data, error } = await query.select(selectColumns);

        if (error) {
          console.error(`❌ Error al insertar lote en ${table}:`, error);
          throw new Error(`Error en ${table}: ${error.message || error.hint || JSON.stringify(error)}`);
        }

        accumulated.push(...(data || []));
      } else {
        const { error } = await query;

        if (error) {
          console.error(`❌ Error al insertar lote en ${table}:`, error);
          throw new Error(`Error en ${table}: ${error.message || error.hint || JSON.stringify(error)}`);
        }
      }
    }

    return accumulated;
  }
}
