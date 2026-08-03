/**
 * Servicio para validar y consultar planes de pruebas en Azure DevOps
 */

import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  AzureDevOpsWorkItem,
  ValidatedPlanInfo,
  PlanValidationError
} from '../../models/azure-devops-evidence.model';
import { SupabaseClientService } from '../database/supabase-client.service';

@Injectable({
  providedIn: 'root'
})
export class AzureDevOpsEvidenceService {
  private readonly baseUrl = '/api/integrations/azure-devops';
  private readonly apiVersion = '7.1';
  private readonly maxProjectIdExtractionRetries = 3;

  constructor(
    private http: HttpClient,
    private supabaseClient: SupabaseClientService
  ) {}

  /**
   * Valida un ID de plan de pruebas y extrae información del Work Item
   * Incluye extracción automática de projectId desde la respuesta
   */
  async validateTestPlan(planId: string): Promise<ValidatedPlanInfo> {
    // Validar entrada
    const validationError = this.validatePlanIdFormat(planId);
    if (validationError) {
      throw validationError;
    }

    try {
      const headers = await this.buildAuthHeaders();
      const cacheBuster = Date.now();
      
      // Llamar al endpoint del backend que consulta Azure DevOps
      const response = await firstValueFrom(
        this.http.get<AzureDevOpsWorkItem>(
          `${this.baseUrl}/work-items?workItemId=${encodeURIComponent(planId)}&_t=${cacheBuster}`,
          { headers }
        )
      );

      // Validar estructura de respuesta
      const validationResult = this.validateWorkItemResponse(response);
      if (validationResult) {
        throw validationResult;
      }

      // Extraer projectId
      const projectId = this.extractProjectId(response);
      if (!projectId) {
        throw this.createError(
          'CANNOT_EXTRACT_PROJECT_ID',
          'No se pudo extraer el ID del proyecto desde la respuesta de Azure DevOps. Contacte al administrador.'
        );
      }

      // Construir resultado
      const result: ValidatedPlanInfo = {
        planId: String(response.id),
        projectId,
        areaPath: response.fields['System.AreaPath'] || '',
        planTitle: response.fields['System.Title'] || 'Sin título',
        planDescription: response.fields['System.Description'] || '',
        workItemType: response.fields['System.WorkItemType'] || 'Unknown',
        planState: response.fields['System.State'] || 'Unknown',
        sourceUrl: response._links?.self?.href || response.url
      };

      return result;
    } catch (error: any) {
      // Si ya es un PlanValidationError, re-lanzar
      if (error.code && error.message) {
        throw error;
      }

      // Interpretar errores HTTP
      if (error.status === 401 || error.status === 403) {
        throw this.createError(
          'UNAUTHORIZED',
          'No tienes permisos para acceder a este plan. Verifica la configuración de Azure DevOps.'
        );
      }

      if (error.status === 404) {
        throw this.createError(
          'NOT_FOUND',
          `El plan ${planId} no existe en Azure DevOps.`
        );
      }

      if (!navigator.onLine || error.status === 0) {
        throw this.createError(
          'NETWORK_ERROR',
          'Error de conexión. Verifica tu conexión a internet.'
        );
      }

      // Error desconocido
      console.error('Plan validation error:', error);
      throw this.createError(
        'UNKNOWN',
        error?.error?.message || 'Error desconocido al validar el plan'
      );
    }
  }

  /**
   * Actualiza los campos System.Title y System.Description de un Work Item en Azure DevOps
   */
  async updateTestPlanFields(planId: string, title: string, description: string): Promise<any> {
    const validationError = this.validatePlanIdFormat(planId);
    if (validationError) {
      throw validationError;
    }

    try {
      const headers = await this.buildAuthHeaders();
      const payload = { title, description };

      const response = await firstValueFrom(
        this.http.patch<any>(
          `${this.baseUrl}/work-items?workItemId=${encodeURIComponent(planId)}&action=update-fields`,
          payload,
          { headers }
        )
      );

      return response;
    } catch (error: any) {
      console.error('Error updating test plan fields:', error);
      if (error.status === 401 || error.status === 403) {
        throw this.createError(
          'UNAUTHORIZED',
          'No tienes permisos para actualizar este plan en Azure DevOps.'
        );
      }
      if (error.status === 404) {
        throw this.createError(
          'NOT_FOUND',
          `El plan ${planId} no existe en Azure DevOps.`
        );
      }
      throw this.createError(
        'UNKNOWN',
        error?.error?.message || 'Error al actualizar los campos del plan en Azure DevOps'
      );
    }
  }

  /**
   * Sube un archivo adjunto (attachment) a Azure DevOps y luego lo VINCULA (relations)
   * al Work Item indicado. Sin el segundo paso, el archivo queda cargado en Azure DevOps
   * pero no aparece asociado al plan de pruebas.
   *
   * ⚡ Estrategia de upload directo: el archivo binario va desde el browser
   * DIRECTO a Azure DevOps, sin pasar por Vercel (evita límite de 4.5MB).
   */
  async uploadAttachment(planId: string, areaPath: string, fileName: string, fileBase64: string, planTitle?: string): Promise<any> {
    const validationError = this.validatePlanIdFormat(planId);
    if (validationError) {
      throw validationError;
    }

    try {
      const headers = await this.buildAuthHeaders();

      // 1) Obtener config de upload desde Vercel (solo credenciales, ~100 bytes)
      const configParams = new URLSearchParams({
        workItemId: planId,
        action: 'get-upload-config',
        areaPath: areaPath || '',
        fileName
      });

      const uploadConfig = await firstValueFrom(
        this.http.get<{ uploadUrl: string; authHeader: string; organization: string }>(
          `${this.baseUrl}/work-items?${configParams.toString()}`,
          { headers }
        )
      );

      if (!uploadConfig?.uploadUrl || !uploadConfig?.authHeader) {
        throw this.createError('UNKNOWN', 'No se pudo obtener la configuración de carga de Azure DevOps.');
      }

      // 2) Convertir base64 a Blob binario para upload directo (sin overhead de base64)
      const binaryStr = atob(fileBase64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      const fileBlob = new Blob([bytes], { type: 'application/octet-stream' });

      // 3) Subir DIRECTAMENTE a Azure DevOps desde el browser (sin pasar por Vercel)
      const uploadResponse = await fetch(uploadConfig.uploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': uploadConfig.authHeader,
          'Content-Type': 'application/octet-stream',
          'Accept': 'application/json'
        },
        body: fileBlob
      });

      if (!uploadResponse.ok) {
        if (uploadResponse.status === 401 || uploadResponse.status === 403) {
          throw this.createError('UNAUTHORIZED', 'No tienes permisos para adjuntar archivos. Verifica el PAT.');
        }
        throw this.createError('UNKNOWN', `Azure DevOps rechazó la carga (${uploadResponse.status}).`);
      }

      const uploaded = await uploadResponse.json();

      if (!uploaded?.url) {
        throw this.createError('UNKNOWN', 'Azure DevOps no devolvió la URL del adjunto cargado.');
      }

      // 4) Vincular el adjunto recién subido al Work Item (plan) — sí pasa por Vercel (solo metadatos)
      const linkUrl = `${this.baseUrl}/work-items?workItemId=${encodeURIComponent(planId)}&action=link-attachment`;
      const linked = await firstValueFrom(
        this.http.patch<any>(
          linkUrl,
          { attachmentUrl: uploaded.url, planTitle },
          { headers }
        )
      );

      return { ...uploaded, ...linked };
    } catch (error: any) {
      console.error('Error uploading attachment:', error);
      if (error.code && error.message) {
        throw error;
      }
      if (error.status === 401 || error.status === 403) {
        throw this.createError(
          'UNAUTHORIZED',
          'No tienes permisos para adjuntar archivos a este plan. Verifica la configuración de Azure DevOps.'
        );
      }
      if (error.status === 404) {
        throw this.createError(
          'NOT_FOUND',
          `El plan ${planId} no existe en Azure DevOps.`
        );
      }
      throw this.createError(
        'UNKNOWN',
        error?.error?.message || 'Error al subir el adjunto a Azure DevOps'
      );
    }
  }

  /**
   * Valida el formato del ID del plan
   */
  private validatePlanIdFormat(planId: string): PlanValidationError | null {
    if (!planId || !planId.trim()) {
      return this.createError(
        'EMPTY_ID',
        'Ingresa el ID del plan de pruebas.'
      );
    }

    const trimmedId = planId.trim();
    // Permitir números enteros
    if (!/^\d+$/.test(trimmedId)) {
      return this.createError(
        'INVALID_FORMAT',
        'El ID del plan debe ser un número entero.'
      );
    }

    return null;
  }

  /**
   * Valida que la respuesta de Work Item contenga todos los campos requeridos
   */
  private validateWorkItemResponse(response: AzureDevOpsWorkItem): PlanValidationError | null {
    if (!response || !response.id) {
      return this.createError(
        'INVALID_RESPONSE',
        'La respuesta de Azure DevOps es inválida.'
      );
    }

    if (!response.fields) {
      return this.createError(
        'INVALID_RESPONSE',
        'No se encontraron campos en la respuesta de Azure DevOps.'
      );
    }

    if (!response.fields['System.AreaPath']) {
      return this.createError(
        'NO_AREA_PATH',
        'El plan no tiene un área asignada. Configura el AreaPath en Azure DevOps.'
      );
    }

    return null;
  }

  /**
   * Extrae el projectId de la URL de autohref del Work Item
   * Formato esperado: https://dev.azure.com/{org}/{projectId}/_apis/wit/workItems/{id}
   */
  private extractProjectId(response: AzureDevOpsWorkItem): string | null {
    const url = response._links?.self?.href || response.url;
    if (!url) {
      return null;
    }

    // Expresión regular para extraer UUID
    // Patrón: /{uuid}/_apis
    const match = url.match(/\/([0-9a-fA-F-]{36})\/_apis/);
    if (match && match[1]) {
      return match[1];
    }

    return null;
  }

  /**
   * Construcción de error estandarizado
   */
  private createError(code: string, message: string): PlanValidationError {
    return {
      code: code as any,
      message
    };
  }

  /**
   * Construcción de headers de autenticación
   */
  private async buildAuthHeaders(): Promise<HttpHeaders> {
    let { data, error } = await this.supabaseClient.supabase.auth.getSession();
    let session = data.session;

    const isExpired = !!session?.expires_at && session.expires_at * 1000 <= Date.now() + 60_000;

    if ((!session?.access_token || isExpired) && !error) {
      const refreshed = await this.supabaseClient.supabase.auth.refreshSession();
      session = refreshed.data.session ?? null;
      error = refreshed.error ?? null;
    }

    if (!session?.access_token) {
      await this.supabaseClient.supabase.auth.signOut().catch(() => undefined);
      throw new Error('Sesión inválida o expirada. Inicia sesión nuevamente.');
    }

    return new HttpHeaders({ Authorization: `Bearer ${session.access_token}` });
  }
}
