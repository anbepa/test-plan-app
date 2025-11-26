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
import { DetailedTestCase } from '../models/hu-data.model';

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
   * Actualizar un test plan de forma inteligente (batch insert/update)
   * Identifica cambios y solo procesa lo necesario.
   */
  async smartUpdateTestPlan(
    testPlanId: string,
    testPlanData: DbTestPlan,
    userStories: DbUserStoryWithRelations[]
  ): Promise<void> {
    console.log('🧠 Smart Update: Iniciando proceso optimizado...');

    try {
      // 1. Actualizar metadatos del test plan
      await this.updateTestPlan(testPlanId, testPlanData);

      // 2. Obtener estado actual de la BD para comparar
      const currentTestPlan = await this.getTestPlanById(testPlanId);
      const currentHUs = (currentTestPlan?.user_stories || []).filter(hu => !!hu.id);
      const currentHUMap = new Map(currentHUs.map(hu => [hu.id!, hu]));

      const toInsert: DbUserStoryWithRelations[] = [];
      const toUpdate: DbUserStoryWithRelations[] = [];
      const toDeleteIds: string[] = [];
      const unmodifiedIds: string[] = [];

      // 3. Identificar Nuevos y Modificados
      for (const incomingHU of userStories) {
        // Si tiene ID y existe en el mapa actual, es candidato a update o unmodified
        if (incomingHU.id && currentHUMap.has(incomingHU.id)) {
          const existingHU = currentHUMap.get(incomingHU.id)!;
          if (this.hasUserStoryChanged(existingHU, incomingHU)) {
            toUpdate.push(incomingHU);
          } else {
            unmodifiedIds.push(incomingHU.id);
          }
          // Marcar como procesado eliminándolo del mapa
          currentHUMap.delete(incomingHU.id!);
        } else {
          // Es nuevo (no tiene ID o el ID no está en BD)
          toInsert.push(incomingHU);
        }
      }

      // 4. Identificar Eliminados (los que quedaron en el mapa)
      toDeleteIds.push(...currentHUMap.keys());

      console.log(`📊 Resumen Smart Update:
        - Nuevos: ${toInsert.length}
        - Modificados: ${toUpdate.length}
        - Sin cambios: ${unmodifiedIds.length}
        - Eliminados: ${toDeleteIds.length}
      `);

      // 5. Ejecutar acciones

      // A) ELIMINAR
      if (toDeleteIds.length > 0) {
        const { error } = await this.supabase.from('user_stories').delete().in('id', toDeleteIds);
        if (error) throw error;
        console.log(`🗑️ ${toDeleteIds.length} HUs eliminadas`);
      }

      // B) INSERTAR NUEVOS
      if (toInsert.length > 0) {
        // Asignar test_plan_id a los nuevos
        toInsert.forEach(hu => hu.test_plan_id = testPlanId);
        await this.persistUserStoriesGraph(testPlanId, toInsert);
        console.log(`✨ ${toInsert.length} HUs nuevas insertadas`);
      }

      // C) ACTUALIZAR MODIFICADOS
      if (toUpdate.length > 0) {
        // 1. Actualizar campos de las HUs (Upsert es eficiente)
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

        // 2. Reemplazar Test Cases (Borrar y Recrear para las HUs modificadas)
        const updateIds = toUpdate.map(hu => hu.id!);

        // Borrar TCs antiguos
        // Primero borrar sus steps
        const { error: deleteStepsError } = await this.supabase
          .from('test_case_steps')
          .delete()
          .in('test_case_id', toUpdate.flatMap(hu => hu.test_cases?.map(tc => tc.id) || [])); // Esto puede ser costoso si no tenemos los IDs de los TCs a borrar. 

        // Mejor estrategia: obtener los IDs de los TCs que vamos a borrar.
        // Pero aquí estamos borrando TODOS los TCs de las HUs modificadas para recrearlos.
        // Necesitamos saber los IDs de esos TCs.

        // Consultar IDs de TCs a borrar
        const { data: tcsToDelete } = await this.supabase
          .from('test_cases')
          .select('id')
          .in('user_story_id', updateIds);

        if (tcsToDelete && tcsToDelete.length > 0) {
          const tcIds = tcsToDelete.map(tc => tc.id);
          await this.supabase.from('test_case_steps').delete().in('test_case_id', tcIds);
          await this.supabase.from('test_cases').delete().in('id', tcIds);
        }

        // Insertar nuevos TCs
        await this.persistTestCasesAndSteps(toUpdate);

        console.log(`📝 ${toUpdate.length} HUs actualizadas`);
      }

      console.log('🎉 Smart Update completado exitosamente!');

    } catch (error) {
      console.error('❌ Error en Smart Update:', error);
      throw error;
    }
  }

  private hasUserStoryChanged(existing: DbUserStoryWithRelations, incoming: DbUserStoryWithRelations): boolean {
    const simplify = (hu: DbUserStoryWithRelations) => ({
      title: hu.title,
      sprint: hu.sprint,
      desc: hu.description,
      ac: hu.acceptance_criteria,
      scope: hu.generated_scope,
      tech: hu.refinement_technique,
      ctx: hu.refinement_context,
      tcs: (hu.test_cases || []).map(tc => ({
        title: tc.title,
        pre: tc.preconditions,
        exp: tc.expected_results,
        steps: (tc.test_case_steps || []).map(s => s.action)
      }))
    });

    return JSON.stringify(simplify(existing)) !== JSON.stringify(simplify(incoming));
  }

  private async persistTestCasesAndSteps(userStories: DbUserStoryWithRelations[]): Promise<void> {
    const testCasesPayload: DbTestCase[] = [];
    const testCaseStepsMeta = new Map<string, { steps: { step_number: number | null | undefined; action: string }[] }>();

    userStories.forEach((us) => {
      if (!us.id || !us.test_cases?.length) return;

      us.test_cases.forEach((tc, tcIndex) => {
        const resolvedPosition = tc.position ?? tcIndex + 1;
        // Usamos un ID temporal o dejamos que la BD lo genere?
        // Si estamos insertando, la BD genera. Pero necesitamos linkear los steps.
        // Necesitamos insertar TCs, obtener sus IDs, y luego insertar Steps.
        // Como es batch, no podemos obtener IDs fácilmente uno por uno.
        // Solución: Usar persistUserStoriesGraph logic de chunkedInsert con select.

        // Pero persistUserStoriesGraph usa indices de array para mapear.
        // Aquí podemos hacer lo mismo si aplanamos la lista.
      });
    });

    // Reutilicemos la lógica de persistUserStoriesGraph pero adaptada
    // Aplanamos todos los TCs de todas las HUs
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

    const insertedTestCases = await this.chunkedInsert(
      'test_cases',
      tcsToInsert,
      'id, user_story_id, position' // Necesitamos ID para los steps
    );

    // Ahora los steps
    // El problema es mapear insertedTestCases con los steps originales.
    // insertedTestCases viene en orden? Sí, normalmente.
    // Asumimos orden preservado.

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
        await this.chunkedInsert('test_case_steps', stepsPayload);
      }
    } else {
      console.error('❌ Mismatch en inserción de TCs, no se pueden guardar steps con seguridad.');
    }
  }

  /**
   * Actualizar los casos de prueba de una HU de forma inteligente
   */
  async smartUpdateUserStoryTestCases(userStoryId: string, testCases: DetailedTestCase[]): Promise<void> {
    console.log(`🧠 Smart Update TCs para HU ${userStoryId}...`);

    if (!userStoryId) {
      console.error('❌ smartUpdateUserStoryTestCases: userStoryId is missing!');
      throw new Error('userStoryId is required for smartUpdateUserStoryTestCases');
    }

    try {
      // 1. Obtener estado actual
      const { data: existingTCs, error } = await this.supabase
        .from('test_cases')
        .select('*, test_case_steps(*)')
        .eq('user_story_id', userStoryId);

      if (error) throw error;

      const existingMap = new Map((existingTCs || []).map(tc => [tc.id, tc]));

      const tcsToInsert: DetailedTestCase[] = [];
      const tcsToUpdate: DetailedTestCase[] = [];
      const tcsToDeleteIds: string[] = [];
      const tcsUnmodifiedIds: string[] = [];

      // 2. Clasificar
      for (const tc of testCases) {
        if (tc.dbId && existingMap.has(tc.dbId)) {
          const existing = existingMap.get(tc.dbId)!;
          if (this.hasTestCaseChanged(existing, tc)) {
            tcsToUpdate.push(tc);
          } else {
            tcsUnmodifiedIds.push(tc.dbId);
          }
          existingMap.delete(tc.dbId);
        } else {
          tcsToInsert.push(tc);
        }
      }

      // Los que quedan en el mapa son para borrar
      tcsToDeleteIds.push(...existingMap.keys());

      console.log(`📊 Resumen TCs:
        - Nuevos: ${tcsToInsert.length}
        - Modificados: ${tcsToUpdate.length}
        - Sin cambios: ${tcsUnmodifiedIds.length}
        - Eliminados: ${tcsToDeleteIds.length}
      `);

      // 3. Ejecutar acciones

      // A) DELETE
      if (tcsToDeleteIds.length > 0) {
        // Primero eliminar los pasos asociados (Constraint FK)
        await this.supabase.from('test_case_steps').delete().in('test_case_id', tcsToDeleteIds);

        // Luego eliminar los test cases
        await this.supabase.from('test_cases').delete().in('id', tcsToDeleteIds);
        console.log(`🗑️ ${tcsToDeleteIds.length} TCs eliminados`);
      }

      // B) INSERT
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

        // Insertar pasos para los nuevos TCs
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
            await this.chunkedInsert('test_case_steps', stepsPayload);
          }
        }
        console.log(`✨ ${tcsToInsert.length} TCs nuevos insertados`);
      }

      // C) UPDATE
      if (tcsToUpdate.length > 0) {
        // Actualizar campos de TCs
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

        // Reemplazar pasos para TCs modificados (Estrategia: Borrar y Recrear pasos)
        const updateIds = tcsToUpdate.map(tc => tc.dbId!);

        // Borrar pasos antiguos
        await this.supabase
          .from('test_case_steps')
          .delete()
          .in('test_case_id', updateIds);

        // Insertar nuevos pasos
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
          await this.chunkedInsert('test_case_steps', newStepsPayload);
        }
        console.log(`📝 ${tcsToUpdate.length} TCs actualizados`);
      }

    } catch (error) {
      console.error('❌ Error en smartUpdateUserStoryTestCases:', error);
      throw error;
    }
  }

  private hasTestCaseChanged(existing: any, incoming: DetailedTestCase): boolean {
    // Simplificar para comparar
    const simplifyExisting = {
      t: existing.title,
      p: existing.preconditions || '',
      e: existing.expected_results || '',
      pos: existing.position,
      s: (existing.test_case_steps || []).sort((a: any, b: any) => a.step_number - b.step_number).map((s: any) => s.action)
    };

    const simplifyIncoming = {
      t: incoming.title,
      p: incoming.preconditions || '',
      e: incoming.expectedResults || '',
      pos: incoming.position,
      s: (incoming.steps || []).map(s => s.accion)
    };

    return JSON.stringify(simplifyExisting) !== JSON.stringify(simplifyIncoming);
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
