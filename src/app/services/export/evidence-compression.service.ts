/**
 * Servicio para crear y administrar archivos ZIP con evidencias Serenity
 * Maneja compresión, sanitización de nombres y limpieza de temporales
 */

import { Injectable } from '@angular/core';
import { 
  ZipNameResolutionContext, 
  EvidenceCompressionResult,
  CompressionProgress,
  ZipNameVariable,
  DEFAULT_SERENITY_ZIP_NAME_TEMPLATE,
  SerenityZipNameConfig
} from '../../models/azure-devops-evidence.model';

declare const JSZip: any; // JSZip cargado desde CDN

@Injectable({
  providedIn: 'root'
})
export class EvidenceCompressionService {
  private readonly MAX_FILENAME_LENGTH = 255;
  private readonly FORBIDDEN_CHARS_REGEX = /[<>:"|?*\\/]/g;
  private readonly MAX_SAFE_NAME_LENGTH = 200;

  constructor() {
    this.ensureJSZipLoaded();
  }

  /**
   * Resuelve la plantilla de nombre del ZIP usando variables disponibles
   */
  resolveZipName(context: ZipNameResolutionContext, template?: string): string {
    const finalTemplate = template || DEFAULT_SERENITY_ZIP_NAME_TEMPLATE;
    
    let resolved = finalTemplate
      .replace(`{{${ZipNameVariable.PLAN_ID}}}`, context.planId)
      .replace(`{{${ZipNameVariable.PLAN_TITLE}}}`, context.planTitle)
      .replace(`{{${ZipNameVariable.TIMESTAMP}}}`, context.timestamp)
      .replace(`{{${ZipNameVariable.EXECUTION_ID}}}`, context.executionId || 'unknown')
      .replace(`{{${ZipNameVariable.ENVIRONMENT}}}`, context.environment || 'default')
      .replace(`{{${ZipNameVariable.USER_STORY_ID}}}`, context.userStoryId || 'unknown');

    // Sanitizar
    const sanitized = this.sanitizeFileName(resolved);

    // Validar que no esté vacío
    if (!sanitized || sanitized.trim() === '') {
      return this.getFallbackName(context.planId);
    }

    // Asegurar extensión única
    if (!sanitized.toLowerCase().endsWith('.zip')) {
      return sanitized + '.zip';
    }

    return sanitized;
  }

  /**
   * Comprime una carpeta de Serenity dentro de un ZIP
   * La estructura final es: nombreZip.zip -> nombreZip/ -> [contenido de Serenity]
   */
  async compressSerenityOutput(
    serenityOutputPath: string | Blob | Uint8Array,
    zipName: string,
    onProgress?: (progress: CompressionProgress) => void
  ): Promise<EvidenceCompressionResult> {
    onProgress?.({ phase: 'preparing' });

    try {
      // Crear instancia de ZIP
      const zip = new JSZip();

      // Crear carpeta raíz con el nombre sin extensión
      const rootFolderName = this.getFileNameWithoutExtension(zipName);
      const rootFolder = zip.folder(rootFolderName);

      if (!rootFolder) {
        throw new Error('No se pudo crear la carpeta raíz en el ZIP');
      }

      // Agregar contenido de Serenity a la carpeta raíz
      // Esto varía dependiendo de cómo se acceda a los archivos Serenity
      // Por ahora, asumimos que se pasará como estructura de objetos/blobs
      if (typeof serenityOutputPath === 'string') {
        throw new Error('Path-based compression not supported yet. Use Blob or structured data.');
      }

      onProgress?.({ phase: 'validating' });

      // Aquí se agregarían los archivos reales
      // Esta es una estructura placeholder que será extendida según necesidad
      if (serenityOutputPath instanceof Blob) {
        // Por ahora, simplemente agregar el blob
        rootFolder.file('serenity-output.zip', serenityOutputPath);
      } else if (serenityOutputPath instanceof Uint8Array) {
        rootFolder.file('serenity-output.bin', serenityOutputPath);
      }

      onProgress?.({ phase: 'compressing' });

      // Generar ZIP
      const blob = await rootFolder.parent.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
        streamFiles: true
      });

      onProgress?.({ phase: 'done' });

      return {
        zipBlob: blob,
        fileName: this.ensureZipExtension(zipName),
        fileSize: blob.size
      };
    } catch (error) {
      console.error('Compression error:', error);
      throw new Error(`Error al comprimir evidencia: ${error instanceof Error ? error.message : 'Error desconocido'}`);
    }
  }

  /**
   * Comprime múltiples archivos individuales en un ZIP
   * Útil cuando se tienen archivos dispersos
   */
  async compressFiles(
    files: Map<string, Blob>,
    zipName: string,
    onProgress?: (progress: CompressionProgress) => void
  ): Promise<EvidenceCompressionResult> {
    onProgress?.({ phase: 'preparing', totalFiles: files.size });

    try {
      const zip = new JSZip();
      const rootFolderName = this.getFileNameWithoutExtension(zipName);
      const rootFolder = zip.folder(rootFolderName);

      if (!rootFolder) {
        throw new Error('No se pudo crear la carpeta raíz en el ZIP');
      }

      let processed = 0;
      for (const [filePath, blob] of files.entries()) {
        rootFolder.file(filePath, blob);
        processed++;
        onProgress?.({ 
          phase: 'compressing',
          filesProcessed: processed,
          totalFiles: files.size,
          currentFileName: filePath
        });
      }

      onProgress?.({ phase: 'validating', filesProcessed: processed, totalFiles: files.size });

      const finalBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
        streamFiles: true
      });

      if (finalBlob.size === 0) {
        throw new Error('El ZIP generado está vacío');
      }

      onProgress?.({ phase: 'done' });

      return {
        zipBlob: finalBlob,
        fileName: this.ensureZipExtension(zipName),
        fileSize: finalBlob.size
      };
    } catch (error) {
      console.error('File compression error:', error);
      throw new Error(`Error al comprimir archivos: ${error instanceof Error ? error.message : 'Error desconocido'}`);
    }
  }

  /**
   * Valida que JSZip esté disponible
   */
  private ensureJSZipLoaded(): void {
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip no está cargado. Verifica que el script esté incluido en index.html');
    }
  }

  /**
   * Sanitiza nombres de archivo removiendo caracteres no permitidos
   */
  private sanitizeFileName(fileName: string): string {
    let sanitized = fileName
      .trim()
      // Remover caracteres prohibidos
      .replace(this.FORBIDDEN_CHARS_REGEX, '_')
      // Remover espacios múltiples
      .replace(/\s+/g, '_')
      // Remover caracteres de control y no-ASCII problemáticos
      .replace(/[^\x20-\x7E]/g, '_')
      // Remover puntos/guiones al inicio
      .replace(/^[\.-]+/, '')
      // Remover puntos/guiones al final
      .replace(/[\.-]+$/, '');

    // Limitar longitud (dejando espacio para .zip)
    if (sanitized.length > this.MAX_SAFE_NAME_LENGTH) {
      sanitized = sanitized.substring(0, this.MAX_SAFE_NAME_LENGTH);
    }

    return sanitized;
  }

  /**
   * Obtiene nombre de archivo sin extensión
   */
  private getFileNameWithoutExtension(fileName: string): string {
    if (fileName.toLowerCase().endsWith('.zip')) {
      return fileName.slice(0, -4);
    }
    return fileName;
  }

  /**
   * Asegura que el nombre tenga extensión .zip
   */
  private ensureZipExtension(fileName: string): string {
    const sanitized = this.getFileNameWithoutExtension(fileName);
    return sanitized + '.zip';
  }

  /**
   * Nombre fallback en caso de que la resolución falle
   */
  private getFallbackName(planId: string): string {
    return `Evidencia_Plan_${planId}_${Date.now()}.zip`;
  }

  /**
   * Crea un contexto de resolución con información disponible
   */
  createResolutionContext(
    planId: string,
    planTitle: string,
    executionId?: string,
    environment?: string,
    userStoryId?: string
  ): ZipNameResolutionContext {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:-]/g, '').split('.')[0]; // YYYYMMDDTHHMMSS

    return {
      planId,
      planTitle: this.sanitizeFileName(planTitle),
      timestamp,
      executionId,
      environment,
      userStoryId
    };
  }
}
