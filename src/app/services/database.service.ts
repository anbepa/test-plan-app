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
  private supabase: SupabaseClient;

  constructor() {
    // Validar que las variables de entorno están configuradas
    if (!environment.supabaseUrl || environment.supabaseUrl === '${SUPABASE_URL}') {
      console.error('❌ SUPABASE_URL no está configurada correctamente');
      throw new Error('Variables de entorno de Supabase no configuradas. Verifica la configuración en Vercel.');
    }

    if (!environment.supabaseKey || environment.supabaseKey === '${SUPABASE_SERVICE_KEY}') {
      console.error('❌ SUPABASE_SERVICE_KEY no está configurada correctamente');
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
    console.log('💾 Iniciando guardado en Supabase...');
    console.log('📦 Datos del test plan:', {
      id: testPlan.id,
      title: testPlan.title,
      cantidadUserStories: userStories.length
    });
    
    try {
      // 1. Guardar test plan
      const { data: planData, error: planError } = await this.supabase
        .from('test_plans')
        .insert([testPlan])
        .select()
        .single();

      if (planError) {
        console.error('❌ Error al guardar test plan:', planError);
        console.error('❌ Detalles del error:', {
          message: planError.message,
          details: planError.details,
          hint: planError.hint,
          code: planError.code
        });
        throw new Error(`Error en test_plans: ${planError.message || planError.hint || JSON.stringify(planError)}`);
      }

      console.log('✅ Test plan guardado:', planData.id);
      const testPlanId = planData.id;

      // 2. Guardar user stories
      for (const us of userStories) {
        const userStoryData: any = {
          test_plan_id: testPlanId,
          custom_id: us.custom_id, // Guardar el ID personalizado
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
        };

        const { data: usData, error: usError } = await this.supabase
          .from('user_stories')
          .insert([userStoryData])
          .select()
          .single();

        if (usError) {
          console.error('❌ Error al guardar user story:', usError);
          console.error('❌ Datos de user story que falló:', userStoryData);
          throw new Error(`Error en user_stories: ${usError.message || usError.hint || JSON.stringify(usError)}`);
        }

        console.log(`✅ User story guardada: ${usData.id}`);
        const userStoryId = usData.id;

        // 3. Guardar test cases
        if (us.test_cases && us.test_cases.length > 0) {
          for (const tc of us.test_cases) {
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
              console.error('❌ Datos de test case que falló:', testCaseData);
              throw new Error(`Error en test_cases: ${tcError.message || tcError.hint || JSON.stringify(tcError)}`);
            }

            console.log(`  ✅ Test case guardado: ${tcData.id}`);
            const testCaseId = tcData.id;

            // 4. Guardar steps
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
                console.error('❌ Datos de steps que fallaron:', stepsData);
                throw new Error(`Error en test_case_steps: ${stepsError.message || stepsError.hint || JSON.stringify(stepsError)}`);
              }

              console.log(`    ✅ ${stepsData.length} steps guardados`);
            }
          }
        }
      }

      console.log('🎉 Test plan completo guardado exitosamente!');
      return testPlanId;

    } catch (error) {
      console.error('❌ Error general en saveCompleteTestPlan:', error);
      throw error;
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
  async getAllTestPlansWithRelations(): Promise<DbTestPlanWithRelations[]> {
    try {
      console.log('📥 Obteniendo test plans desde Supabase...');
      
      
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
        .order('created_at', { ascending: false });

      if (error) {
        console.error('❌ Error en query:', error);
        throw error;
      }

      console.log(`✅ ${data?.length || 0} Test Plans recuperados de Supabase`);
      return data || [];

    } catch (error) {
      console.error('❌ Error al obtener test plans:', error);
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

      // 3. Insertar nuevas user stories
      for (const us of userStories) {
        const userStoryData: DbUserStory = {
          test_plan_id: testPlanId,
          custom_id: us.custom_id, // ✅ Preservar el custom_id del usuario
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
        };

        const { data: usData, error: usError } = await this.supabase
          .from('user_stories')
          .insert([userStoryData])
          .select()
          .single();

        if (usError) {
          console.error('❌ Error al guardar user story:', usError);
          throw usError;
        }

        console.log(`✅ User story guardada: ${usData.id}`);
        const userStoryId = usData.id;

        // 4. Guardar test cases
        if (us.test_cases && us.test_cases.length > 0) {
          for (const tc of us.test_cases) {
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

            // 5. Guardar steps
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
      }

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
}
