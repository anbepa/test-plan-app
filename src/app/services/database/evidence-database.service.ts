import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { ToastService } from '../core/toast.service';

@Injectable({
  providedIn: 'root'
})
export class EvidenceDatabaseService {
  private supabase: SupabaseClient;
  private imageCache = new Map<string, string>();
  private cachedUserId: string | null = null;

  constructor(private toast: ToastService) {
    this.supabase = createClient(environment.supabaseUrl, environment.supabaseKey);
  }

  /**
   * Busca una HU en la tabla específica de evidencias
   */
  async searchEvidenceHU(query: string): Promise<any[]> {
    const userId = await this.getCurrentUserId();
    if (!userId || !query) return [];

    const isNumber = /^\d+$/.test(query);
    let dbQuery = this.supabase
      .from('evidence_hus')
      .select('*')
      .eq('user_id', userId);

    if (isNumber) {
      dbQuery = dbQuery.or(`numero.eq.${query},title.ilike.%${query}%`);
    } else {
      dbQuery = dbQuery.ilike('title', `%${query}%`);
    }

    const { data, error } = await dbQuery.limit(5);
    if (error) {
      console.error('Error searching evidence HUs:', error);
      return [];
    }
    return data || [];
  }

  /**
   * Obtiene o crea una HU para evidencias
   */
  async getOrCreateEvidenceHU(numero: string, title: string): Promise<string> {
    const userId = await this.getCurrentUserId();
    if (!userId) throw new Error('Usuario no autenticado');

    // 1. Buscar si existe
    const stories = await this.searchEvidenceHU(numero);
    const exactMatch = stories.find(s => s.numero?.toString() === numero.toString());

    if (exactMatch) return exactMatch.id;

    // 2. Si no existe, crearla
    const { data, error } = await this.supabase
      .from('evidence_hus')
      .insert([{
        numero: numero,
        title: title,
        user_id: userId
      }])
      .select()
      .single();

    if (error) throw error;
    return data.id;
  }

  /**
   * Sube una imagen al Storage de Supabase con compresión WebP
   */
  async uploadImageToStorage(fileData: string, fileName: string): Promise<string> {
    try {
      const userId = await this.getCurrentUserId();
      if (!userId) throw new Error('Usuario no autenticado para subir archivos');

      const matches = fileData.match(/^data:([^;]+);base64,(.+)$/);
      const mimeType = matches ? matches[1] : 'application/octet-stream';

      let bodyBlob: Blob;
      let contentType = mimeType;
      let path = '';

      const isCSV = mimeType.includes('csv') || fileName.endsWith('.csv');
      const isXLSX = mimeType.includes('sheet') || mimeType.includes('excel') || fileName.endsWith('.xlsx');

      if (!isCSV && !isXLSX && mimeType.startsWith('image/') && !mimeType.includes('svg')) {
        // 1. COMPRESIÓN A WEBP
        bodyBlob = await this.compressToWebP(fileData);
        contentType = 'image/webp';
        const cleanName = fileName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        path = `${userId}/${Date.now()}_${cleanName}.webp`;
      } else {
        // 2. ARCHIVO DE DATOS (CSV, XLSX, etc) - NO COMPRIMIR
        const base64Data = matches ? matches[2] : fileData;
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        bodyBlob = new Blob([byteArray], { type: mimeType });
        
        // Mantener extensión original para archivos de datos
        const extension = fileName.includes('.') ? fileName.split('.').pop() : (isCSV ? 'csv' : 'xlsx');
        const baseName = fileName.includes('.') ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName;
        const cleanName = baseName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        path = `${userId}/${Date.now()}_${cleanName}.${extension}`;
      }

      console.log(`[STORAGE] Intentando subir a evidence-analysis: ${path} (Tipo: ${contentType})`);

      const { data, error } = await this.supabase.storage
        .from('evidence-analysis')
        .upload(path, bodyBlob, {
          contentType: contentType,
          cacheControl: '3600',
          upsert: true
        });

      if (error) {
        console.error('[STORAGE ERROR]', error);
        throw error;
      }

      const { data: urlData } = this.supabase.storage
        .from('evidence-analysis')
        .getPublicUrl(path);

      console.log(`[STORAGE SUCCESS] URL: ${urlData.publicUrl}`);
      return urlData.publicUrl;
    } catch (e: any) {
      console.error('Error crítico en Storage:', e);
      this.toast.error(`Error de almacenamiento: ${e.message || 'Verifica las políticas RLS'}`);
      throw e; // Lanzamos el error para NO guardar Base64 en la tabla
    }
  }

  private compressToWebP(dataUrl: string, quality = 0.7): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        // Limitar tamaño máximo para asegurar rendimiento
        const MAX_WIDTH = 1920;
        let width = img.width;
        let height = img.height;

        if (width > MAX_WIDTH) {
          height = (MAX_WIDTH / width) * height;
          width = MAX_WIDTH;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('No se pudo obtener el contexto del canvas'));

        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('La conversión a Blob falló'));
        }, 'image/webp', quality);
      };
      img.onerror = () => reject(new Error('Error al cargar la imagen para compresión'));
      img.src = dataUrl;
    });
  }

  private async getCurrentUserId(): Promise<string | null> {
    if (this.cachedUserId) return this.cachedUserId;
    const { data: { user } } = await this.supabase.auth.getUser();
    this.cachedUserId = user?.id || null;
    return this.cachedUserId;
  }

  async saveEvidenceReport(reportData: any, evidenceFiles: any[], huNumber?: string): Promise<string> {
    try {
      const userId = await this.getCurrentUserId();

      const scenarioToInsert = {
        nombre_del_escenario: reportData.escenario_prueba || reportData.nombre_escenario || 'Análisis de Evidencias',
        id_caso: reportData.id_caso?.toString() || '1',
        precondiciones: reportData.precondiciones || '',
        resultado_esperado: reportData.resultado_esperado || '',
        resultado_obtenido: reportData.resultado_obtenido || '',
        estado_general: reportData.estado_general || 'Exitoso',
        historia_usuario: huNumber || reportData.historia_usuario || null,
        user_id: userId,
        fecha_ejecucion: new Date().toISOString().split('T')[0],
        // Campo adicional para asociar a la tabla de evidence_hus si fuera necesario en el futuro
        // user_story_id: some_id
      };

      const { data: scenario, error: scenarioError } = await this.supabase
        .from('test_scenarios')
        .insert([scenarioToInsert])
        .select()
        .single();

      if (scenarioError) throw scenarioError;

      if (reportData.pasos && reportData.pasos.length > 0) {
        const stepsToInsert = reportData.pasos.map((step: any) => ({
          scenario_id: scenario.id,
          numero_paso: step.numero_paso,
          descripcion_accion_observada: step.descripcion,
          imagen_referencia: step.imagen_referencia
        }));

        const { data: insertedSteps, error: stepsError } = await this.supabase
          .from('test_scenario_steps')
          .insert(stepsToInsert)
          .select();

        if (stepsError) throw stepsError;

        if (evidenceFiles && evidenceFiles.length > 0) {
          await this.saveImages(scenario.id, evidenceFiles, insertedSteps || []);
        }
      }

      return scenario.id;
    } catch (error) {
      console.error('Error en saveEvidenceReport:', error);
      this.toast.error('Error al guardar el reporte');
      throw error;
    }
  }

  async getReports(huFilter?: string): Promise<any[]> {
    const userId = await this.getCurrentUserId();
    if (!userId) return [];

    let query = this.supabase
      .from('test_scenarios')
      .select(`
        id,
        id_caso,
        historia_usuario,
        nombre_del_escenario,
        estado_general,
        created_at,
        test_scenario_steps (count)
      `)
      .eq('user_id', userId);

    if (huFilter) {
      query = query.eq('historia_usuario', huFilter.toString().trim());
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;
    console.log('DEBUG: Reportes cargados de Supabase:', data);

    return (data || []).map(r => ({
      ...r,
      steps_count: r.test_scenario_steps?.[0]?.count || 0
    }));
  }

  async getReportsPaginated(params: {
    huFilter?: string;
    textFilter?: string;
    statusFilter?: string;
    page: number;
    pageSize: number;
  }): Promise<{ data: any[], total: number }> {
    const userId = await this.getCurrentUserId();
    if (!userId) return { data: [], total: 0 };

    let query = this.supabase
      .from('test_scenarios')
      .select(`
        id,
        id_caso,
        historia_usuario,
        nombre_del_escenario,
        estado_general,
        created_at,
        test_scenario_steps (count)
      `, { count: 'exact' })
      .eq('user_id', userId);

    if (params.huFilter) {
      query = query.eq('historia_usuario', params.huFilter.toString().trim());
    }

    if (params.textFilter) {
      // Búsqueda por id_caso o nombre_del_escenario
      query = query.or(`id_caso.ilike.%${params.textFilter}%,nombre_del_escenario.ilike.%${params.textFilter}%`);
    }

    if (params.statusFilter) {
      // La base de datos puede tener nulos o variaciones de 'Exitoso'
      if (params.statusFilter.toLowerCase() === 'exitoso') {
        // Exitoso incluye aquellos con estado explícito Exitoso o nulos (que por defecto se asumen Exitoso en el front)
        query = query.or(`estado_general.ilike.exitoso%,estado_general.is.null,estado_general.eq.''`);
      } else {
        query = query.ilike('estado_general', `${params.statusFilter}%`);
      }
    }

    const from = (params.page - 1) * params.pageSize;
    const to = from + params.pageSize - 1;

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;

    const mappedData = (data || []).map(r => ({
      ...r,
      steps_count: r.test_scenario_steps?.[0]?.count || 0
    }));

    return { data: mappedData, total: count || 0 };
  }

  async getReportIds(huFilter?: string): Promise<string[]> {
    const userId = await this.getCurrentUserId();
    if (!userId) return [];

    let query = this.supabase
      .from('test_scenarios')
      .select('id')
      .eq('user_id', userId);

    if (huFilter) {
      query = query.ilike('historia_usuario', `%${huFilter}%`);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;
    console.log('DEBUG: IDs de Reporte cargados de Supabase:', data);
    return (data || []).map(r => r.id);
  }

  async getReportById(id: string): Promise<any> {
    const { data, error } = await this.supabase
      .from('test_scenarios')
      .select(`
        *,
        test_scenario_steps (*),
        report_images (*)
      `)
      .eq('id', id)
      .single();

    if (error) throw error;
    console.log('DEBUG: Reporte cargado de Supabase:', data);

    // Asegurar que las imágenes existan y estén ordenadas
    if (data.report_images) {
      data.report_images.sort((a: any, b: any) => (a.image_order || 0) - (b.image_order || 0));
    }

    // Asegurar que los pasos existan y estén ordenados
    if (data.test_scenario_steps) {
      data.test_scenario_steps.sort((a: any, b: any) => (a.numero_paso || 0) - (b.numero_paso || 0));
    } else {
      data.test_scenario_steps = [];
    }

    return data;
  }

  private async saveImages(scenarioId: string, files: any[], steps: any[]) {
    const imagesToInsert: any[] = [];

    // 1. Parsear todas las asociaciones posibles primero
    const associations: { stepId: string, imageIndex: number }[] = [];
    steps.forEach(step => {
      if (step.imagen_referencia && step.imagen_referencia !== 'N/A') {
        // 1. Intentar hacer match directo con el nombre del archivo
        const matchedByName = files.findIndex(f => f.name && (f.name === step.imagen_referencia || step.imagen_referencia.includes(f.name)));
        if (matchedByName >= 0) {
          associations.push({ stepId: step.id, imageIndex: matchedByName });
        } else {
          // 2. Limpiar fechas y nombres de archivo con extensiones para evitar capturar números incorrectos
          const cleanRef = step.imagen_referencia
            .replace(/\d{2}[\/\-]\d{2}[\/\-]\d{4}/g, '')
            .replace(/\(\d+\)\.(?:xlsx|csv|jpg|png|jpeg)/gi, '');
          
          const matches = cleanRef.match(/\d+/g);
          if (matches) {
            matches.forEach((m: string) => {
              const imageIndex = parseInt(m, 10) - 1; // 0-based
              if (imageIndex >= 0 && imageIndex < files.length) {
                associations.push({ stepId: step.id, imageIndex });
              }
            });
          }
        }
      }
    });

    // 2. Procesar cada archivo de imagen/documento
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // Si no hay URL pública ni dataURL, saltar
      if (!file.publicUrl && (!file.dataURL || !file.dataURL.startsWith('data:'))) continue;

      try {
        // Reutilizar la URL si ya se subió previamente en el componente
        const imageUrl = file.publicUrl || await this.uploadImageToStorage(file.dataURL, file.name || `evidencia_${i+1}`);

        const imageAssociations = associations.filter(a => a.imageIndex === i);

        if (imageAssociations.length > 0) {
          // Crear un registro por cada paso que referencia esta imagen
          imageAssociations.forEach(assoc => {
            imagesToInsert.push({
              report_id: scenarioId,
              step_id: assoc.stepId,
              file_name: file.name || `evidencia_${i+1}`,
              file_type: file.type || 'image/webp',
              image_url: imageUrl,
              image_order: i + 1,
              is_video: file.isVideo || false,
              video_url: file.isVideo ? imageUrl : null,
              is_stored_in_storage: true
            });
          });
        } else {
          // Si no tiene asociación, se guarda como evidencia general del reporte
          imagesToInsert.push({
            report_id: scenarioId,
            step_id: null,
            file_name: file.name || `evidencia_${i+1}`,
            file_type: file.type || 'image/webp',
            image_url: imageUrl,
            image_order: i + 1,
            is_video: file.isVideo || false,
            video_url: file.isVideo ? imageUrl : null,
            is_stored_in_storage: true
          });
        }
      } catch (uploadError) {
        console.error(`Error procesando imagen ${i+1}:`, uploadError);
      }
    }

    if (imagesToInsert.length > 0) {
      const { error } = await this.supabase
        .from('report_images')
        .insert(imagesToInsert);
      if (error) console.error('Error al insertar registros de imágenes:', error);
    }
  }

  async deleteReport(id: string): Promise<void> {
    const userId = await this.getCurrentUserId();
    if (!userId) throw new Error('No autorizado');

    const { error, count } = await this.supabase
      .from('test_scenarios')
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw error;
    if (count === 0) throw new Error('No se pudo borrar el registro físico de BD (verifica RLS)');
  }

  async deleteReportsByHU(huNumber: string): Promise<void> {
    const userId = await this.getCurrentUserId();
    if (!userId || !huNumber) return;

    // 1. Eliminar los escenarios asociados
    const { error: scenariosError, count } = await this.supabase
      .from('test_scenarios')
      .delete({ count: 'exact' })
      .eq('user_id', userId)
      .eq('historia_usuario', huNumber);

    if (scenariosError) {
      console.error('Error al eliminar reportes por HU:', scenariosError);
      throw scenariosError;
    }

    if (count === 0) {
      console.warn('Ningún escenario físico eliminado para esta HU.');
    }

    // 2. Eliminar la entrada en la tabla de HUs de evidencias (si existe)
    const { error: huError } = await this.supabase
      .from('evidence_hus')
      .delete()
      .eq('user_id', userId)
      .eq('numero', huNumber);

    if (huError) {
      console.warn('Error al eliminar la entrada de HU (puede que no exista):', huError);
    }
  }

  async deleteAllReports(): Promise<void> {
    const userId = await this.getCurrentUserId();
    if (!userId) return;

    // 1. Eliminar todos los escenarios asociados a este usuario
    const { error: scenariosError } = await this.supabase
      .from('test_scenarios')
      .delete()
      .eq('user_id', userId);

    if (scenariosError) {
      console.error('Error al eliminar todos los escenarios:', scenariosError);
      throw scenariosError;
    }

    // 2. Eliminar todas las HUs de este usuario
    const { error: huError } = await this.supabase
      .from('evidence_hus')
      .delete()
      .eq('user_id', userId);

    if (huError) {
      console.warn('Error al eliminar todas las entradas de HU:', huError);
    }
  }

  async updateScenario(id: string, data: any, steps?: any[]): Promise<void> {
    try {
      // 1. CAPTURAR ASOCIACIONES ACTUALES (Mapear numero_paso -> [image_ids])
      // Y también capturar por descripción para mayor robustez
      const { data: currentImages } = await this.supabase
        .from('report_images')
        .select('id, step_id, image_order')
        .eq('report_id', id);

      const { data: currentSteps } = await this.supabase
        .from('test_scenario_steps')
        .select('id, numero_paso, descripcion_accion_observada')
        .eq('scenario_id', id);

      const stepToImagesMap = new Map<number, string[]>();
      const descToImagesMap = new Map<string, string[]>();

      if (currentImages && currentSteps) {
        currentSteps.forEach(s => {
          const imgs = currentImages.filter(img => img.step_id === s.id).map(img => img.id);
          if (imgs.length > 0) {
            stepToImagesMap.set(s.numero_paso, imgs);
            if (s.descripcion_accion_observada) {
              descToImagesMap.set(s.descripcion_accion_observada.trim().toLowerCase(), imgs);
            }
          }
        });
      }

      // 2. Actualizar datos básicos del escenario
      const { error: scenarioError } = await this.supabase
        .from('test_scenarios')
        .update({
          ...data,
          updated_at: new Date().toISOString()
        })
        .eq('id', id);

      if (scenarioError) throw scenarioError;

      if (steps && steps.length >= 0) {
        // 2.5. Desvincular las imágenes temporalmente para evitar que el ON DELETE CASCADE las destruya
        const { error: detachError } = await this.supabase
          .from('report_images')
          .update({ step_id: null })
          .eq('report_id', id);

        if (detachError) console.warn('Error desvinculando imágenes antes de actualizar:', detachError);

        // 3. Eliminar pasos existentes
        const { error: deleteError } = await this.supabase
          .from('test_scenario_steps')
          .delete()
          .eq('scenario_id', id);

        if (deleteError) console.warn('Error eliminando pasos antiguos:', deleteError);

        // 4. Insertar nuevos pasos y obtener sus IDs
        const stepsToInsert = steps.map((step, index) => ({
          scenario_id: id,
          numero_paso: step.numero_paso || (index + 1),
          descripcion_accion_observada: step.descripcion || step.descripcion_accion_observada,
          imagen_referencia: step.imagen_referencia || 'N/A'
        }));

        if (stepsToInsert.length > 0) {
          const { data: insertedSteps, error: stepsError } = await this.supabase
            .from('test_scenario_steps')
            .insert(stepsToInsert)
            .select();

          if (stepsError) throw stepsError;

          // 5. RESTAURAR ASOCIACIONES DE IMÁGENES
          if (insertedSteps && insertedSteps.length > 0) {
            for (const step of insertedSteps) {
              // A. Intentar por descripción exacta (mejor si hubo reordenamiento manual)
              const desc = (step.descripcion_accion_observada || '').trim().toLowerCase();
              let imageIds = descToImagesMap.get(desc);

              // B. Intentar por número de paso (si la descripción cambió pero el orden se mantuvo)
              if (!imageIds || imageIds.length === 0) {
                imageIds = stepToImagesMap.get(step.numero_paso);
              }

              if (imageIds && imageIds.length > 0) {
                for (const imageId of imageIds) {
                  await this.supabase
                    .from('report_images')
                    .update({ step_id: step.id })
                    .eq('id', imageId);
                }
                continue;
              }

              // C. Intentar por referencia de texto (imagen_referencia)
              if (step.imagen_referencia && step.imagen_referencia !== 'N/A') {
                const imgByName = currentImages?.find((img: any) => img.file_name && (img.file_name === step.imagen_referencia || step.imagen_referencia.includes(img.file_name)));
                if (imgByName) {
                  await this.supabase
                    .from('report_images')
                    .update({ step_id: step.id })
                    .eq('report_id', id)
                    .eq('id', imgByName.id);
                } else {
                  // 2. Extraer orden limpiando el string de fechas y extensiones
                  const cleanRef = step.imagen_referencia
                    .replace(/\d{2}[\/\-]\d{2}[\/\-]\d{4}/g, '')
                    .replace(/\(\d+\)\.(?:xlsx|csv|jpg|png|jpeg)/gi, '');
                    
                  const matches = cleanRef.match(/\d+/g);
                  if (matches) {
                    for (const m of matches) {
                      const order = parseInt(m, 10);
                      await this.supabase
                        .from('report_images')
                        .update({ step_id: step.id })
                        .eq('report_id', id)
                        .eq('image_order', order);
                    }
                  }
                }
              }
            }
          }
        }
      }

    } catch (error) {
      console.error('Error en updateScenario:', error);
      throw error;
    }
  }

  async updateStep(stepId: string, description: string): Promise<void> {
    const { error } = await this.supabase
      .from('test_scenario_steps')
      .update({ descripcion_accion_observada: description })
      .eq('id', stepId);
    if (error) throw error;
  }

  async deleteStepsBulk(stepIds: string[]): Promise<void> {
    const { error } = await this.supabase
      .from('test_scenario_steps')
      .delete()
      .in('id', stepIds);
    if (error) throw error;
  }

  async deleteStep(stepId: string): Promise<void> {
    const { error } = await this.supabase
      .from('test_scenario_steps')
      .delete()
      .eq('id', stepId);
    if (error) throw error;
  }

  async updateStepNumber(stepId: string, num: number): Promise<void> {
    const { error } = await this.supabase
      .from('test_scenario_steps')
      .update({ numero_paso: num })
      .eq('id', stepId);
    if (error) throw error;
  }

  /**
   * Intercambia las imágenes entre dos pasos
   */
  async swapStepImages(image1Id: string, step1Id: string, image2Id: string, step2Id: string): Promise<void> {
    const { error: err1 } = await this.supabase
      .from('report_images')
      .update({ step_id: step2Id })
      .eq('id', image1Id);

    if (err1) throw err1;

    const { error: err2 } = await this.supabase
      .from('report_images')
      .update({ step_id: step1Id })
      .eq('id', image2Id);

    if (err2) throw err2;
  }

  /**
   * Copia una imagen a otro paso
   */
  async copyImageToStep(image: any, targetStepId: string): Promise<void> {
    const { id, created_at, ...rest } = image;
    const { error } = await this.supabase
      .from('report_images')
      .insert([{
          ...rest,
          step_id: targetStepId,
          created_at: new Date().toISOString()
      }]);
    if (error) throw error;
  }

  /**
   * Elimina una imagen de reporte
   */
  async deleteReportImage(imageId: string): Promise<void> {
    const { error } = await this.supabase
      .from('report_images')
      .delete()
      .eq('id', imageId);
    if (error) throw error;
  }

  /**
   * Añade un nuevo paso manual a un escenario
   */
  async addStep(scenarioId: string, numeroPaso: number, descripcion: string): Promise<any> {
    const { data, error } = await this.supabase
      .from('test_scenario_steps')
      .insert([{
        scenario_id: scenarioId,
        numero_paso: numeroPaso,
        descripcion_accion_observada: descripcion,
        imagen_referencia: 'N/A'
      }])
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Sube una imagen y la asocia directamente a un paso
   */
  async saveImageForStep(scenarioId: string, stepId: string, fileData: string, fileName: string, order: number): Promise<void> {
    const imageUrl = await this.uploadImageToStorage(fileData, fileName);

    const { error } = await this.supabase
      .from('report_images')
      .insert([{
        report_id: scenarioId,
        step_id: stepId,
        file_name: fileName,
        file_type: 'image/webp',
        image_url: imageUrl,
        image_order: order,
        is_video: false,
        is_stored_in_storage: true
      }]);

    if (error) throw error;
  }
}
