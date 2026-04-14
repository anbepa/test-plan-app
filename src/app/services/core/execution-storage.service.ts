import { Injectable } from '@angular/core';
import { PlanExecution, TestCaseExecution, ExecutionStep, ImageEvidence } from '../../models/hu-data.model';

@Injectable({
  providedIn: 'root'
})
export class ExecutionStorageService {
  private readonly STORAGE_KEY_EXECUTIONS = 'plan_executions';
  private readonly STORAGE_KEY_IMAGES = 'execution_images';
  private readonly MAX_IMAGES_STORED = 120;

  /**
   * Obtiene todas las ejecuciones guardadas
   */
  getAllExecutions(): PlanExecution[] {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY_EXECUTIONS);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('Error al obtener ejecuciones', error);
      return [];
    }
  }

  /**
   * Obtiene una ejecución específica por ID
   */
  getExecution(executionId: string): PlanExecution | null {
    const executions = this.getAllExecutions();
    return executions.find(e => e.id === executionId) || null;
  }

  /**
   * Obtiene todas las ejecuciones de una HU específica
   */
  getExecutionsByHU(huId: string): PlanExecution[] {
    const executions = this.getAllExecutions();
    return executions.filter(e => e.huId === huId);
  }

  /**
   * Guarda o actualiza una ejecución
   */
  saveExecution(execution: PlanExecution): void {
    try {
      const executions = this.getAllExecutions();
      const index = executions.findIndex(e => e.id === execution.id);
      const compactExecution = this.compactExecutionForStorage(execution);

      if (index >= 0) {
        executions[index] = compactExecution;
      } else {
        executions.push(compactExecution);
      }

      localStorage.setItem(this.STORAGE_KEY_EXECUTIONS, JSON.stringify(executions));
    } catch (error) {
      console.error('Error al guardar ejecución', error);
      throw new Error('No se pudo guardar la ejecución');
    }
  }

  /**
   * Elimina una ejecución
   */
  deleteExecution(executionId: string): void {
    try {
      const executions = this.getAllExecutions();
      const filtered = executions.filter(e => e.id !== executionId);
      localStorage.setItem(this.STORAGE_KEY_EXECUTIONS, JSON.stringify(filtered));

      // Eliminar imágenes asociadas
      const images = this.getAllImages();
      const filteredImages = images.filter(img => !this.isImageFromExecution(img, executionId));
      localStorage.setItem(this.STORAGE_KEY_IMAGES, JSON.stringify(filteredImages));
    } catch (error) {
      console.error('Error al eliminar ejecución', error);
      throw new Error('No se pudo eliminar la ejecución');
    }
  }

  /**
   * Guarda una imagen de evidencia
   */
  saveImage(image: ImageEvidence): void {
    try {
      const images = this.getAllImages();
      const normalizedImage = this.normalizeImageForStorage(image);
      const index = images.findIndex(img => img.id === normalizedImage.id);

      if (index >= 0) {
        images[index] = normalizedImage;
      } else {
        images.push(normalizedImage);
      }

      const prunedImages = this.pruneImagesForQuota(images);

      localStorage.setItem(this.STORAGE_KEY_IMAGES, JSON.stringify(prunedImages));
    } catch (error) {
      if (this.isQuotaExceeded(error)) {
        try {
          const images = this.getAllImages();
          const normalizedImage = this.normalizeImageForStorage(image);
          const filtered = images.filter(img => img.id !== normalizedImage.id);
          filtered.push(normalizedImage);

          const aggressivelyPruned = this.pruneImagesForQuota(filtered, true);
          localStorage.setItem(this.STORAGE_KEY_IMAGES, JSON.stringify(aggressivelyPruned));
          return;
        } catch (retryError) {
          console.error('Error al guardar imagen (reintento con poda)', retryError);
          throw new Error('No hay espacio suficiente en el navegador para más evidencias. Elimina evidencias antiguas o reduce el tamaño de la imagen.');
        }
      }

      console.error('Error al guardar imagen', error);
      throw new Error('No se pudo guardar la imagen');
    }
  }

  /**
   * Obtiene todas las imágenes guardadas
   */
  getAllImages(): ImageEvidence[] {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY_IMAGES);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('Error al obtener imágenes', error);
      return [];
    }
  }

  /**
   * Obtiene imágenes de un paso específico
   */
  getStepImages(stepId: string): ImageEvidence[] {
    const images = this.getAllImages();
    return images.filter(img => img.stepId === stepId);
  }

  /**
   * Elimina una imagen
   */
  deleteImage(imageId: string): void {
    try {
      const images = this.getAllImages();
      const filtered = images.filter(img => img.id !== imageId);
      localStorage.setItem(this.STORAGE_KEY_IMAGES, JSON.stringify(filtered));
    } catch (error) {
      console.error('Error al eliminar imagen', error);
      throw new Error('No se pudo eliminar la imagen');
    }
  }

  /**
   * Crea una nueva ejecución de plan
   */
  createPlanExecution(huId: string, huTitle: string, testCases: DetailedTestCase[]): PlanExecution {
    const execution: PlanExecution = {
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
          status: 'pending',
          notes: '',
          evidences: []
        })),
        expectedResults: tc.expectedResults,
        status: 'pending'
      })),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    return execution;
  }

  /**
   * Actualiza el estado de un paso
   */
  updateStepStatus(
    executionId: string,
    testCaseId: string,
    stepId: string,
    status: 'pending' | 'in-progress' | 'completed' | 'failed'
  ): void {
    const execution = this.getExecution(executionId);
    if (!execution) return;

    const testCase = execution.testCases.find(tc => tc.testCaseId === testCaseId);
    if (!testCase) return;

    const step = testCase.steps.find(s => s.stepId === stepId);
    if (step) {
      step.status = status;
      execution.updatedAt = Date.now();
      this.saveExecution(execution);
    }
  }

  /**
   * Obtiene estadísticas de una ejecución
   */
  getExecutionStats(executionId: string) {
    const execution = this.getExecution(executionId);
    if (!execution) return null;

    let totalSteps = 0;
    let completedSteps = 0;
    let totalImages = 0;

    execution.testCases.forEach(tc => {
      tc.steps.forEach(step => {
        totalSteps++;
        if (step.status === 'completed') completedSteps++;
        totalImages += step.evidences.length;
      });
    });

    return {
      totalTestCases: execution.testCases.length,
      totalSteps,
      completedSteps,
      completionPercentage: totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0,
      totalImages
    };
  }

  /**
   * Limpia todas las ejecuciones
   */
  clearAllExecutions(): void {
    try {
      localStorage.removeItem(this.STORAGE_KEY_EXECUTIONS);
      localStorage.removeItem(this.STORAGE_KEY_IMAGES);
    } catch (error) {
      console.error('Error al limpiar ejecuciones', error);
    }
  }

  private generateId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private isImageFromExecution(image: ImageEvidence, executionId: string): boolean {
    // Las imágenes están asociadas a pasos que están en la ejecución
    const execution = this.getExecution(executionId);
    if (!execution) return false;

    for (const testCase of execution.testCases) {
      for (const step of testCase.steps) {
        if (step.evidences.some(e => e.id === image.id)) {
          return true;
        }
      }
    }

    return false;
  }

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
            fileName: evidence.fileName,
            timestamp: evidence.timestamp,
            naturalWidth: evidence.naturalWidth,
            naturalHeight: evidence.naturalHeight,
            // Se omiten base64/originalBase64 para no duplicar payload pesado.
            base64Data: '',
            originalBase64: ''
          }))
        }))
      }))
    };
  }

  private normalizeImageForStorage(image: ImageEvidence): ImageEvidence {
    return {
      ...image,
      // Evita duplicar dos cadenas base64 por imagen en localStorage.
      originalBase64: ''
    };
  }

  private pruneImagesForQuota(images: ImageEvidence[], aggressive = false): ImageEvidence[] {
    const maxCount = aggressive ? Math.min(40, this.MAX_IMAGES_STORED) : this.MAX_IMAGES_STORED;
    const sorted = [...images].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const byCount = sorted.slice(0, maxCount);

    // Presupuesto conservador para localStorage compartido con otras llaves.
    const budgetBytes = aggressive ? 3_200_000 : 4_200_000;
    const kept: ImageEvidence[] = [];
    let used = 0;

    for (const img of byCount) {
      const imgSize = this.getApproxBytes(img);
      if (used + imgSize > budgetBytes) continue;
      kept.push(img);
      used += imgSize;
    }

    return kept;
  }

  private getApproxBytes(value: unknown): number {
    try {
      return new TextEncoder().encode(JSON.stringify(value)).length;
    } catch {
      return JSON.stringify(value).length * 2;
    }
  }

  private isQuotaExceeded(error: unknown): boolean {
    if (!(error instanceof DOMException)) return false;
    return error.name === 'QuotaExceededError' || error.code === 22 || error.code === 1014;
  }

  private readonly DetailedTestCase = null; // Import helper
}

// Importar la interfaz aquí para evitar circular dependency
import { DetailedTestCase } from '../../models/hu-data.model';
