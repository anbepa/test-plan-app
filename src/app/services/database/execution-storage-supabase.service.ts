import { Injectable } from '@angular/core';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseClientService } from './supabase-client.service';
import { PlanExecution, AssetEvidence, DetailedTestCase } from '../../models/hu-data.model';

/**
 * Servicio que almacena las ejecuciones de plan en Supabase:
 * - Metadatos (PlanExecution) → tabla `plan_executions` (JSONB)
 * - Imágenes/CSV de evidencia → bucket `execution-evidence` (Storage)
 *
 * Mantiene la MISMA API pública que el antiguo ExecutionStorageService
 * basado en IndexedDB para ser un drop-in replacement.
 *
 * Optimizaciones:
 * - Compresión WebP (calidad 0.85) antes de subir imágenes
 * - Caché en memoria para imágenes ya descargadas
 * - Debounce en saveExecution() para agrupar escrituras rápidas
 * - Upload/delete paralelo con throttle (máx 3 concurrentes)
 */
@Injectable({
  providedIn: 'root'
})
export class ExecutionStorageService {

  private readonly BUCKET = 'execution-evidence';
  private readonly TABLE = 'plan_executions';
  private readonly WEBP_QUALITY = 0.85;
  private readonly MAX_CONCURRENT_UPLOADS = 3;

  /** Caché en memoria: imageId → AssetEvidence con base64 */
  private imageCache = new Map<string, AssetEvidence>();

  /**
   * Índice de rutas en Storage: imageId → ruta completa (userId/execId/file.webp)
   * Se construye UNA sola vez por sesión y evita re-listar carpetas repetidamente.
   */
  private storageIndex = new Map<string, string>();
  private storageIndexBuilt = false;
  private storageIndexPromise: Promise<void> | null = null;

  /** Cached user ID to avoid repeated getUser() calls that trigger NavigatorLock errors */
  private cachedUserId: string | null = null;

  /** Debounce para saveExecution: executionId → timeoutId */
  private saveDebounceMap = new Map<string, any>();
  private pendingSaves = new Map<string, { execution: PlanExecution, resolve: () => void, reject: (e: any) => void }[]>();

  constructor(private supabaseClient: SupabaseClientService) {}

  private get supabase(): SupabaseClient {
    return this.supabaseClient.supabase;
  }

  private async getCurrentUserId(): Promise<string> {
    if (this.cachedUserId) {
      return this.cachedUserId;
    }

    // Try getSession first (uses local storage, no network call, avoids lock contention)
    try {
      const { data: sessionData } = await this.supabase.auth.getSession();
      if (sessionData?.session?.user?.id) {
        this.cachedUserId = sessionData.session.user.id;
        return this.cachedUserId;
      }
    } catch (_) { /* fall through to getUser */ }

    // Fallback to getUser with retry
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { data, error } = await this.supabase.auth.getUser();
        if (!error && data.user?.id) {
          this.cachedUserId = data.user.id;
          return this.cachedUserId;
        }
      } catch (e) {
        if (attempt === 0) {
          await new Promise(r => setTimeout(r, 100));
          continue;
        }
      }
    }

    throw new Error('No hay usuario autenticado.');
  }

  // ════════════════════════════════════════════════════════════
  // EJECUCIONES (tabla plan_executions)
  // ════════════════════════════════════════════════════════════

  /**
   * Obtiene todas las ejecuciones del usuario autenticado
   */
  async getAllExecutions(): Promise<PlanExecution[]> {
    const userId = await this.getCurrentUserId();
    const { data, error } = await this.supabase
      .from(this.TABLE)
      .select('id, hu_id, hu_title, execution_data, created_at, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('❌ Error al obtener ejecuciones:', error);
      throw error;
    }

    return (data || []).map(row => this.rowToExecution(row));
  }

  /**
   * Obtiene una ejecución específica por ID
   */
  async getExecution(executionId: string): Promise<PlanExecution | null> {
    const userId = await this.getCurrentUserId();
    const { data, error } = await this.supabase
      .from(this.TABLE)
      .select('id, hu_id, hu_title, execution_data, created_at, updated_at')
      .eq('id', executionId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('❌ Error al obtener ejecución:', error);
      return null;
    }

    return data ? this.rowToExecution(data) : null;
  }

  /**
   * Obtiene todas las ejecuciones de una HU específica
   */
  async getExecutionsByHU(huId: string): Promise<PlanExecution[]> {
    const userId = await this.getCurrentUserId();
    const { data, error } = await this.supabase
      .from(this.TABLE)
      .select('id, hu_id, hu_title, execution_data, created_at, updated_at')
      .eq('user_id', userId)
      .eq('hu_id', huId)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('❌ Error al obtener ejecuciones por HU:', error);
      return [];
    }

    return (data || []).map(row => this.rowToExecution(row));
  }

  /**
   * Guarda o actualiza una ejecución (con debounce de 500ms)
   */
  async saveExecution(execution: PlanExecution): Promise<void> {
    // Deep-clone at call time to avoid debounce saving a mutated reference
    const snapshot: PlanExecution = JSON.parse(JSON.stringify(execution));

    return new Promise<void>((resolve, reject) => {
      // Acumular promises pendientes
      if (!this.pendingSaves.has(snapshot.id)) {
        this.pendingSaves.set(snapshot.id, []);
      }
      this.pendingSaves.get(snapshot.id)!.push({ execution: snapshot, resolve, reject });

      // Cancelar debounce anterior
      if (this.saveDebounceMap.has(snapshot.id)) {
        clearTimeout(this.saveDebounceMap.get(snapshot.id));
      }

      // Programar escritura con debounce
      const timeoutId = setTimeout(async () => {
        this.saveDebounceMap.delete(snapshot.id);
        const pending = this.pendingSaves.get(snapshot.id) || [];
        this.pendingSaves.delete(snapshot.id);

        // Tomar la última ejecución (más actualizada)
        const latest = pending[pending.length - 1].execution;

        try {
          await this.doSaveExecution(latest);
          pending.forEach(p => p.resolve());
        } catch (err) {
          pending.forEach(p => p.reject(err));
        }
      }, 500);

      this.saveDebounceMap.set(snapshot.id, timeoutId);
    });
  }

  private async doSaveExecution(execution: PlanExecution): Promise<void> {
    const userId = await this.getCurrentUserId();
    const compactExecution = this.compactExecutionForStorage(execution);

    const { error } = await this.supabase
      .from(this.TABLE)
      .upsert({
        id: execution.id,
        user_id: userId,
        hu_id: execution.huId,
        hu_title: execution.huTitle,
        execution_data: compactExecution,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

    if (error) {
      console.error('❌ Error al guardar ejecución:', error);
      throw error;
    }
  }

  /**
   * Elimina una ejecución y todos sus archivos de evidencia del bucket
   */
  async deleteExecution(executionId: string): Promise<void> {
    try {
      const userId = await this.getCurrentUserId();

      // 1. Eliminar carpeta entera del bucket
      await this.deleteStorageFolder(`${userId}/${executionId}`);

      // 2. Eliminar registro de la tabla
      const { error } = await this.supabase
        .from(this.TABLE)
        .delete()
        .eq('id', executionId)
        .eq('user_id', userId);

      if (error) {
        console.error('❌ Error al eliminar ejecución:', error);
        throw error;
      }

      // 3. Limpiar caché de imágenes de esta ejecución
      this.clearCacheForExecution(executionId);
    } catch (error) {
      console.error('Error al eliminar ejecución:', error);
      throw new Error('No se pudo eliminar la ejecución por completo.');
    }
  }

  // ════════════════════════════════════════════════════════════
  // IMÁGENES/EVIDENCIAS (bucket execution-evidence)
  // ════════════════════════════════════════════════════════════

  /**
   * Guarda una imagen/CSV de evidencia en Supabase Storage.
   * Las imágenes se comprimen a WebP antes de subir.
   */
  async saveImage(image: AssetEvidence): Promise<void> {
    if (!image.id) return;

    const userId = await this.getCurrentUserId();

    // Determinar el executionId desde el path del stepId o el contexto
    const executionId = this.extractExecutionIdFromContext(image);

    if (image.type === 'csv') {
      await this.saveCsvEvidence(userId, executionId, image);
    } else {
      await this.saveImageEvidence(userId, executionId, image);
    }

    // Actualizar caché e invalidar índice (la nueva imagen tiene una ruta nueva)
    this.imageCache.set(image.id, { ...image });
    this.invalidateStorageIndex();
  }

  /**
   * Devuelve una imagen ya cacheada en memoria sin hacer petición de red.
   */
  getCachedImage(imageId: string): AssetEvidence | null {
    return this.imageCache.get(imageId) ?? null;
  }

  /**
   * Construye el índice imageId→ruta listando el bucket UNA sola vez.
   * Todas las llamadas posteriores comparten la misma Promise para evitar
   * peticiones duplicadas si se invoca en paralelo.
   */
  async buildStorageIndex(): Promise<void> {
    if (this.storageIndexBuilt) return;
    if (this.storageIndexPromise) return this.storageIndexPromise;

    this.storageIndexPromise = (async () => {
      try {
        const userId = await this.getCurrentUserId();

        // 1 petición: lista carpetas de ejecución del usuario
        const { data: execFolders, error } = await this.supabase.storage
          .from(this.BUCKET)
          .list(userId, { limit: 200 });

        if (error || !execFolders) return;

        // 1 petición por carpeta (normalmente 1-5 carpetas)
        const folderListPromises = execFolders
          .filter(f => f.name)
          .map(async folder => {
            const folderPath = `${userId}/${folder.name}`;
            const { data: files } = await this.supabase.storage
              .from(this.BUCKET)
              .list(folderPath, { limit: 1000 });

            if (!files) return;
            for (const file of files) {
              if (!file.name || file.name.endsWith('.meta.json')) continue;
              // Extraer imageId del nombre de archivo (formato: imageId.ext)
              const dotIdx = file.name.indexOf('.');
              const imgId = dotIdx > 0 ? file.name.substring(0, dotIdx) : file.name;
              this.storageIndex.set(imgId, `${folderPath}/${file.name}`);
            }
          });

        await Promise.all(folderListPromises);
        this.storageIndexBuilt = true;
      } catch (e) {
        console.warn('buildStorageIndex error:', e);
      } finally {
        this.storageIndexPromise = null;
      }
    })();

    return this.storageIndexPromise;
  }

  /**
   * Invalida el índice (llamar después de subir/eliminar imágenes).
   */
  invalidateStorageIndex(): void {
    this.storageIndex.clear();
    this.storageIndexBuilt = false;
  }

  /**
   * Hidrata SOLO las evidencias de un paso concreto.
   * Usa el índice para evitar re-listar carpetas.
   * Ideal para lazy load paso a paso.
   */
  async hydrateStepEvidence(stepEvidences: AssetEvidence[]): Promise<AssetEvidence[]> {
    if (!stepEvidences?.length) return stepEvidences;

    const pending = stepEvidences.filter(ev => ev.id && !this.imageCache.has(ev.id));
    if (pending.length === 0) {
      // All cached — just reassign
      return stepEvidences.map(ev => this.imageCache.get(ev.id) ? { ...ev, ...this.imageCache.get(ev.id)!, stepId: ev.stepId } : ev);
    }

    // Ensure index is built before downloading
    await this.buildStorageIndex();

    await Promise.all(pending.map(ev => this.getImage(ev.id).catch(() => {})));

    return stepEvidences.map(ev => {
      const cached = this.imageCache.get(ev.id);
      return cached ? { ...ev, ...cached, stepId: ev.stepId } : ev;
    });
  }

  /**
   * Obtiene una imagen/CSV por ID desde caché o Storage
   */
  async getImage(imageId: string): Promise<AssetEvidence | null> {
    // 1. Revisar caché en memoria
    if (this.imageCache.has(imageId)) {
      return this.imageCache.get(imageId)!;
    }

    // 2. Resolver ruta desde el índice (evita re-listar carpetas)
    await this.buildStorageIndex();

    // 3. Buscar en Storage
    try {
      const userId = await this.getCurrentUserId();
      const filePath = this.storageIndex.get(imageId) || await this.findFileInStorage(userId, imageId);

      if (!filePath) return null;

      const { data, error } = await this.supabase.storage
        .from(this.BUCKET)
        .download(filePath);

      if (error || !data) return null;

      const isJson = filePath.endsWith('.json');

      if (isJson) {
        const text = await data.text();
        const asset: AssetEvidence = JSON.parse(text);
        this.imageCache.set(imageId, asset);
        return asset;
      } else {
        // Imagen → convertir Blob a data URL
        const base64 = await this.blobToDataURL(data);
        const asset: AssetEvidence = {
          id: imageId,
          stepId: '',
          fileName: filePath.split('/').pop() || '',
          type: 'image',
          base64Data: base64,
          originalBase64: base64,
          timestamp: Date.now()
        };

        // Intentar cargar metadata JSON adicional si existe
        const metaPath = filePath.replace(/\.(webp|png|jpe?g)$/i, '.meta.json');
        try {
          const { data: metaBlob } = await this.supabase.storage
            .from(this.BUCKET)
            .download(metaPath);

          if (metaBlob) {
            const metaText = await metaBlob.text();
            const meta = JSON.parse(metaText);
            Object.assign(asset, meta);
            asset.base64Data = base64;
          }
        } catch {
          // No metadata file — that's fine
        }

        this.imageCache.set(imageId, asset);
        return asset;
      }
    } catch (err) {
      console.error('Error al obtener imagen desde Storage:', err);
      return null;
    }
  }

  /**
   * Obtiene todas las imágenes del usuario (para exportación).
   * Se basa en la caché local + descarga las que falten.
   */
  async getAllImages(): Promise<AssetEvidence[]> {
    return Array.from(this.imageCache.values());
  }

  /**
   * Obtiene imágenes de un paso específico desde la caché
   */
  async getStepImages(stepId: string): Promise<AssetEvidence[]> {
    return Array.from(this.imageCache.values()).filter(img => img.stepId === stepId);
  }

  /**
   * Elimina una imagen del Storage y la caché
   */
  async deleteImage(imageId: string): Promise<void> {
    try {
      const userId = await this.getCurrentUserId();
      // Use index first to avoid re-listing folders
      await this.buildStorageIndex();
      const filePath = this.storageIndex.get(imageId) || await this.findFileInStorage(userId, imageId);

      if (filePath) {
        // Borrar imagen + metadata asociada
        const metaPath = filePath.replace(/\.(webp|png|jpe?g|json)$/i, '.meta.json');
        const filesToDelete = [filePath];
        if (!filePath.endsWith('.json') && !filePath.endsWith('.meta.json')) {
          filesToDelete.push(metaPath);
        }

        await this.supabase.storage
          .from(this.BUCKET)
          .remove(filesToDelete);
      }

      this.imageCache.delete(imageId);
      this.storageIndex.delete(imageId);
    } catch (err) {
      console.error('Error al eliminar imagen:', err);
    }
  }

  /**
   * Limpia evidencias huérfanas
   */
  async cleanupOrphanedImages(evidenceIds: string[]): Promise<void> {
    if (!evidenceIds || evidenceIds.length === 0) return;

    await this.runWithThrottle(
      evidenceIds.map(id => () => this.deleteImage(id)),
      this.MAX_CONCURRENT_UPLOADS
    );
  }

  // ════════════════════════════════════════════════════════════
  // CREACIÓN DE EJECUCIONES (lógica de negocio)
  // ════════════════════════════════════════════════════════════

  /**
   * Crea una nueva ejecución de plan
   */
  createPlanExecution(huId: string, huTitle: string, testCases: DetailedTestCase[]): PlanExecution {
    return {
      id: this.generateId(),
      huId,
      huTitle,
      testCases: (testCases || []).map((tc, index) => ({
        testCaseId: `tc_${index}`,
        title: tc.title,
        preconditions: tc.preconditions,
        steps: (tc.steps || []).map((step, stepIndex) => ({
          stepId: `${tc.title.replace(/\s+/g, '_')}_step_${stepIndex}`,
          numero_paso: step.numero_paso,
          accion: step.accion,
          status: 'pending' as const,
          notes: '',
          evidences: []
        })),
        expectedResults: tc.expectedResults,
        status: 'pending' as const
      })),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  /**
   * Actualiza el estado de un paso
   */
  async updateStepStatus(
    executionId: string,
    testCaseId: string,
    stepId: string,
    status: 'pending' | 'in-progress' | 'completed' | 'failed'
  ): Promise<void> {
    const execution = await this.getExecution(executionId);
    if (!execution) return;

    const testCase = execution.testCases.find(tc => tc.testCaseId === testCaseId);
    if (!testCase) return;

    const step = testCase.steps.find(s => s.stepId === stepId);
    if (step) {
      step.status = status;
      execution.updatedAt = Date.now();
      await this.saveExecution(execution);
    }
  }

  /**
   * Obtiene estadísticas de una ejecución
   */
  async getExecutionStats(executionId: string) {
    const execution = await this.getExecution(executionId);
    if (!execution) return null;

    let totalSteps = 0;
    let executedSteps = 0; // Se cuentan tanto exitosos como fallidos
    let totalImages = 0;

    execution.testCases.forEach(tc => {
      tc.steps.forEach(step => {
        totalSteps++;
        if (step.status === 'completed' || step.status === 'failed') executedSteps++;
        totalImages += (step.evidences || []).length;
      });
    });

    return {
      totalTestCases: execution.testCases.length,
      totalSteps,
      completedSteps: executedSteps,
      completionPercentage: totalSteps > 0 ? (executedSteps / totalSteps) * 100 : 0,
      totalImages
    };
  }

  /**
   * Limpia todas las ejecuciones del usuario
   */
  async clearAllExecutions(): Promise<void> {
    const userId = await this.getCurrentUserId();

    // Borrar todos los archivos del bucket del usuario
    await this.deleteStorageFolder(userId);

    // Borrar todos los registros
    const { error } = await this.supabase
      .from(this.TABLE)
      .delete()
      .eq('user_id', userId);

    if (error) {
      console.error('Error limpiando ejecuciones:', error);
    }

    this.imageCache.clear();
  }

  // ════════════════════════════════════════════════════════════
  // HYDRATE: Descarga perezosa de imágenes para una ejecución
  // ════════════════════════════════════════════════════════════

  /**
   * Hidrata TODAS las evidencias de una ejecución descargándolas de Storage.
   * Se usa al abrir la vista de ejecución para tener todas las imágenes lisas.
   */
  async hydrateAllEvidence(execution: PlanExecution): Promise<void> {
    const allEvidenceIds: string[] = [];

    for (const tc of execution.testCases) {
      for (const step of tc.steps) {
        for (const ev of (step.evidences || [])) {
          if (ev.id && !this.imageCache.has(ev.id)) {
            allEvidenceIds.push(ev.id);
          }
        }
      }
    }

    if (allEvidenceIds.length === 0) return;

    // Descargar en paralelo con throttle
    await this.runWithThrottle(
      allEvidenceIds.map(id => () => this.getImage(id).then(() => { })),
      this.MAX_CONCURRENT_UPLOADS
    );

    // Re-asignar base64 a cada evidencia
    for (const tc of execution.testCases) {
      for (const step of tc.steps) {
        step.evidences = (step.evidences || []).map(ev => {
          const cached = this.imageCache.get(ev.id);
          if (cached) {
            return {
              ...ev,
              ...cached,
              stepId: ev.stepId // preservar stepId original
            };
          }
          return ev;
        });
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // INTERNOS: compresión, storage helpers
  // ════════════════════════════════════════════════════════════

  /**
   * Mantiene un ID de ejecución activo en el servicio para resolver
   * a qué carpeta subir las imágenes.
   */
  private _activeExecutionId: string = '';

  setActiveExecutionId(executionId: string): void {
    this._activeExecutionId = executionId;
  }

  private extractExecutionIdFromContext(image: AssetEvidence): string {
    // Usar el execution ID activo si está configurado
    if (this._activeExecutionId) {
      return this._activeExecutionId;
    }
    // Fallback: usar un prefijo genérico
    return 'unassigned';
  }

  private async saveImageEvidence(userId: string, executionId: string, image: AssetEvidence): Promise<void> {
    if (!image.base64Data) return;

    // Comprimir a WebP si es posible
    let fileBlob: Blob;
    let extension: string;

    try {
      fileBlob = await this.compressToWebP(image.base64Data);
      extension = 'webp';
    } catch {
      // Fallback: subir como está (png/jpeg)
      fileBlob = this.dataURLtoBlob(image.base64Data);
      extension = image.base64Data.includes('image/png') ? 'png' : 'jpeg';
    }

    const filePath = `${userId}/${executionId}/${image.id}.${extension}`;

    const { error } = await this.supabase.storage
      .from(this.BUCKET)
      .upload(filePath, fileBlob, {
        cacheControl: '3600',
        upsert: true,
        contentType: `image/${extension}`
      });

    if (error) {
      console.error('❌ Error al subir imagen:', error);
      throw error;
    }

    // Guardar metadata por separado (sin base64)
    const meta: Partial<AssetEvidence> = {
      id: image.id,
      stepId: image.stepId,
      fileName: image.fileName,
      type: image.type,
      editorStateJson: image.editorStateJson,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      timestamp: image.timestamp
    };

    const metaPath = `${userId}/${executionId}/${image.id}.meta.json`;
    const metaBlob = new Blob([JSON.stringify(meta)], { type: 'application/json' });

    await this.supabase.storage
      .from(this.BUCKET)
      .upload(metaPath, metaBlob, {
        cacheControl: '3600',
        upsert: true,
        contentType: 'application/json'
      });
  }

  private async saveCsvEvidence(userId: string, executionId: string, asset: AssetEvidence): Promise<void> {
    const filePath = `${userId}/${executionId}/${asset.id}.json`;

    // Serializar todo el asset (sin base64, porque CSV no tiene)
    const serialized: any = {
      id: asset.id,
      stepId: asset.stepId,
      fileName: asset.fileName,
      type: asset.type,
      tabularData: asset.tabularData,
      rowColors: asset.rowColors,
      csvConfig: asset.csvConfig,
      timestamp: asset.timestamp
    };

    const blob = new Blob([JSON.stringify(serialized)], { type: 'application/json' });

    const { error } = await this.supabase.storage
      .from(this.BUCKET)
      .upload(filePath, blob, {
        cacheControl: '3600',
        upsert: true,
        contentType: 'application/json'
      });

    if (error) {
      console.error('❌ Error al subir CSV:', error);
      throw error;
    }
  }

  /**
   * Comprime una data URL de imagen a WebP usando Canvas
   */
  private compressToWebP(dataUrl: string): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (typeof document === 'undefined') {
        reject(new Error('No DOM available'));
        return;
      }

      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('No canvas context'));
            return;
          }

          ctx.drawImage(img, 0, 0);

          canvas.toBlob(
            (blob) => {
              if (blob) {
                resolve(blob);
              } else {
                reject(new Error('Compression failed'));
              }
            },
            'image/webp',
            this.WEBP_QUALITY
          );
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = dataUrl;
    });
  }

  private dataURLtoBlob(dataUrl: string): Blob {
    const arr = dataUrl.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    const bstr = atob(arr[1]);
    const u8arr = new Uint8Array(bstr.length);
    for (let i = 0; i < bstr.length; i++) {
      u8arr[i] = bstr.charCodeAt(i);
    }
    return new Blob([u8arr], { type: mime });
  }

  private blobToDataURL(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Blob to data URL failed'));
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Busca un archivo en el bucket del usuario por su ID (prefijo de nombre)
   */
  private async findFileInStorage(userId: string, imageId: string): Promise<string | null> {
    try {
      // Listar todas las carpetas de ejecución del usuario
      const { data: execFolders, error } = await this.supabase.storage
        .from(this.BUCKET)
        .list(userId, { limit: 100 });

      if (error || !execFolders) return null;

      // Buscar en cada carpeta de ejecución
      for (const folder of execFolders) {
        if (!folder.name) continue;

        const folderPath = `${userId}/${folder.name}`;
        const { data: files } = await this.supabase.storage
          .from(this.BUCKET)
          .list(folderPath, { limit: 200 });

        if (!files) continue;

        // Buscar archivos que comiencen con el imageId (sin extensión)
        const match = files.find(f =>
          f.name.startsWith(imageId + '.') && !f.name.endsWith('.meta.json')
        );

        if (match) {
          return `${folderPath}/${match.name}`;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Elimina todos los archivos de una carpeta en el bucket
   */
  private async deleteStorageFolder(folderPath: string): Promise<void> {
    try {
      const { data: files } = await this.supabase.storage
        .from(this.BUCKET)
        .list(folderPath, { limit: 1000 });

      if (!files || files.length === 0) return;

      // Puede haber subcarpetas
      for (const item of files) {
        if (item.id === null) {
          // Es una carpeta → recursión
          await this.deleteStorageFolder(`${folderPath}/${item.name}`);
        }
      }

      const filePaths = files
        .filter(f => f.id !== null)
        .map(f => `${folderPath}/${f.name}`);

      if (filePaths.length > 0) {
        await this.supabase.storage
          .from(this.BUCKET)
          .remove(filePaths);
      }
    } catch (err) {
      console.error('Error eliminando carpeta de Storage:', err);
    }
  }

  private clearCacheForExecution(executionId: string): void {
    // No podemos saber exactamente cuáles imágenes son de esta ejecución por ID,
    // pero si se va a eliminar la ejecución completa eso es OK.
    // La caché se limpiará progresivamente. 
    // En un enfoque más robusto recopilaríamos los IDs de las evidencias antes de borrar.
  }

  /**
   * Ejecuta un array de funciones asíncronas con concurrencia limitada
   */
  private async runWithThrottle(tasks: (() => Promise<void>)[], maxConcurrent: number): Promise<void> {
    const executing: Promise<void>[] = [];

    for (const task of tasks) {
      const p = task().then(() => {
        executing.splice(executing.indexOf(p), 1);
      });
      executing.push(p);

      if (executing.length >= maxConcurrent) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);
  }

  /**
   * Compacta la ejecución para almacenar en JSONB (sin base64 en evidencias)
   */
  private compactExecutionForStorage(execution: PlanExecution): PlanExecution {
    return {
      ...execution,
      testCases: (execution.testCases || []).map((testCase) => ({
        ...testCase,
        steps: (testCase.steps || []).map((step) => ({
          ...step,
          evidences: (step.evidences || []).map((evidence) => ({
            id: evidence.id,
            stepId: evidence.stepId,
            type: evidence.type || 'image',
            fileName: evidence.fileName,
            timestamp: evidence.timestamp,
            naturalWidth: evidence.naturalWidth,
            naturalHeight: evidence.naturalHeight,
            // NO guardar base64 en la tabla — solo en Storage
            base64Data: '',
            originalBase64: ''
          }))
        }))
      }))
    };
  }

  /**
   * Convierte un row de la tabla a PlanExecution
   */
  private rowToExecution(row: any): PlanExecution {
    const data = row.execution_data || {};
    return {
      id: row.id || data.id,
      huId: row.hu_id || data.huId,
      huTitle: row.hu_title || data.huTitle,
      testCases: data.testCases || [],
      createdAt: data.createdAt || new Date(row.created_at).getTime(),
      updatedAt: data.updatedAt || new Date(row.updated_at).getTime(),
      completedAt: data.completedAt
    };
  }

  private generateId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
