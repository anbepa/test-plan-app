import { Injectable } from '@angular/core';
import { PlanExecution, TestCaseExecution, ExecutionStep, ImageEvidence } from '../../models/hu-data.model';
import { IndexedDbService } from './indexed-db.service';

@Injectable({
  providedIn: 'root'
})
export class ExecutionStorageService {
  private readonly STORAGE_KEY_EXECUTIONS = 'plan_executions'; // Retro-compatibilidad y migración
  private readonly STORAGE_KEY_IMAGES = 'execution_images';
  private readonly STORE_EXECUTIONS = 'executions';
  private readonly STORE_IMAGES = 'images';

  constructor(private idbService: IndexedDbService) {
    this.checkForMigration();
  }

  private async checkForMigration(): Promise<void> {
    try {
      const oldExecs = localStorage.getItem(this.STORAGE_KEY_EXECUTIONS);
      const oldImages = localStorage.getItem(this.STORAGE_KEY_IMAGES);

      if (oldExecs) {
        const execs: PlanExecution[] = JSON.parse(oldExecs);
        for (const e of execs) {
          await this.idbService.put(this.STORE_EXECUTIONS, e);
        }
        localStorage.removeItem(this.STORAGE_KEY_EXECUTIONS);
      }

      if (oldImages) {
        const images: ImageEvidence[] = JSON.parse(oldImages);
        for (const img of images) {
          await this.idbService.put(this.STORE_IMAGES, img);
        }
        localStorage.removeItem(this.STORAGE_KEY_IMAGES);
      }
    } catch (err) {
      console.warn('Fallo en la migración automática a IndexedDB:', err);
    }
  }

  /**
   * Obtiene todas las ejecuciones guardadas
   */
  async getAllExecutions(): Promise<PlanExecution[]> {
    return await this.idbService.getAll(this.STORE_EXECUTIONS);
  }

  /**
   * Obtiene una ejecución específica por ID
   */
  async getExecution(executionId: string): Promise<PlanExecution | null> {
    return await this.idbService.get(this.STORE_EXECUTIONS, executionId);
  }

  /**
   * Obtiene todas las ejecuciones de una HU específica
   */
  async getExecutionsByHU(huId: string): Promise<PlanExecution[]> {
    const executions = await this.getAllExecutions();
    return executions.filter(e => e.huId === huId);
  }

  /**
   * Guarda o actualiza una ejecución
   */
  async saveExecution(execution: PlanExecution): Promise<void> {
    const compactExecution = this.compactExecutionForStorage(execution);
    await this.idbService.put(this.STORE_EXECUTIONS, compactExecution);
  }

  /**
   * Elimina una ejecución y sus imágenes asociadas
   */
  async deleteExecution(executionId: string): Promise<void> {
    try {
      // 1. Obtener la ejecución antes de borrarla para saber qué imágenes borrar
      const execution = await this.getExecution(executionId);

      // 2. Si existe, buscar todas las evidencias en sus pasos
      if (execution) {
        const evidenceIds: string[] = [];
        execution.testCases.forEach(tc => {
          tc.steps.forEach(step => {
            step.evidences.forEach(ev => evidenceIds.push(ev.id));
          });
        });

        // 3. Borrar cada imagen de IndexedDB
        for (const id of evidenceIds) {
          await this.idbService.delete(this.STORE_IMAGES, id);
        }
      }

      // 4. Borrar la ejecución finalmente
      await this.idbService.delete(this.STORE_EXECUTIONS, executionId);
    } catch (error) {
      console.error('Error al eliminar ejecución', error);
      throw new Error('No se pudo eliminar la ejecución por completo.');
    }
  }

  /**
   * Guarda una imagen de evidencia
   */
  async saveImage(image: ImageEvidence): Promise<void> {
    const normalizedImage = this.normalizeImageForStorage(image);
    await this.idbService.put(this.STORE_IMAGES, normalizedImage);
  }

  /**
   * Obtiene todas las imágenes guardadas
   */
  async getAllImages(): Promise<ImageEvidence[]> {
    return await this.idbService.getAll(this.STORE_IMAGES);
  }

  /**
   * Obtiene imágenes de un paso específico
   */
  async getStepImages(stepId: string): Promise<ImageEvidence[]> {
    const images = await this.getAllImages();
    return images.filter(img => img.stepId === stepId);
  }

  /**
   * Elimina una imagen
   */
  async deleteImage(imageId: string): Promise<void> {
    await this.idbService.delete(this.STORE_IMAGES, imageId);
  }

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
  async clearAllExecutions(): Promise<void> {
    await this.idbService.clearStore(this.STORE_EXECUTIONS);
    await this.idbService.clearStore(this.STORE_IMAGES);
  }

  private generateId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
      originalBase64: ''
    };
  }
}

import { DetailedTestCase } from '../../models/hu-data.model';

