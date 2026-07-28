/**
 * Modelo para gestión de evidencias en Azure DevOps
 * Incluye validación de planes, carga de archivos y vinculación
 */

// ─────────────────────────────────────────
// Estados del flujo
// ─────────────────────────────────────────

export enum EvidenceUploadState {
  IDLE = 'IDLE',
  VALIDATING_PLAN = 'VALIDATING_PLAN',
  PLAN_VALIDATED = 'PLAN_VALIDATED',
  GENERATING_SERENITY = 'GENERATING_SERENITY',
  WAITING_FOR_SERENITY = 'WAITING_FOR_SERENITY',
  COMPRESSING_EVIDENCE = 'COMPRESSING_EVIDENCE',
  UPLOADING_ATTACHMENT = 'UPLOADING_ATTACHMENT',
  LINKING_ATTACHMENT = 'LINKING_ATTACHMENT',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED'
}

export const EVIDENCE_UPLOAD_STATE_LABELS: Record<EvidenceUploadState, string> = {
  [EvidenceUploadState.IDLE]: 'Iniciando',
  [EvidenceUploadState.VALIDATING_PLAN]: 'Validando plan',
  [EvidenceUploadState.PLAN_VALIDATED]: 'Plan validado',
  [EvidenceUploadState.GENERATING_SERENITY]: 'Generando evidencia Serenity',
  [EvidenceUploadState.WAITING_FOR_SERENITY]: 'Esperando finalización de Serenity',
  [EvidenceUploadState.COMPRESSING_EVIDENCE]: 'Comprimiendo evidencia',
  [EvidenceUploadState.UPLOADING_ATTACHMENT]: 'Subiendo archivo',
  [EvidenceUploadState.LINKING_ATTACHMENT]: 'Vinculando evidencia',
  [EvidenceUploadState.COMPLETED]: 'Proceso completado',
  [EvidenceUploadState.FAILED]: 'Error',
  [EvidenceUploadState.CANCELLED]: 'Operación cancelada'
};

// ─────────────────────────────────────────
// Validación de plan
// ─────────────────────────────────────────

export interface AzureDevOpsWorkItem {
  id: number;
  fields: {
    'System.Title': string;
    'System.Description'?: string;
    'System.AreaPath': string;
    'System.WorkItemType': string;
    'System.State': string;
    [key: string]: any;
  };
  _links?: {
    self?: { href: string };
  };
  url?: string;
  relations?: any[];
}

export interface ValidatedPlanInfo {
  planId: string;
  projectId: string;
  areaPath: string;
  planTitle: string;
  planDescription: string;
  workItemType: string;
  planState: string;
  sourceUrl?: string;
}

export interface PlanValidationError {
  code: 'EMPTY_ID' | 'INVALID_FORMAT' | 'NOT_FOUND' | 'UNAUTHORIZED' | 'INVALID_RESPONSE' | 'NO_AREA_PATH' | 'CANNOT_EXTRACT_PROJECT_ID' | 'INVALID_WORK_ITEM_TYPE' | 'NETWORK_ERROR' | 'UNKNOWN';
  message: string;
}

// ─────────────────────────────────────────
// Compresión de ZIP
// ─────────────────────────────────────────

export interface CompressionProgress {
  phase: 'preparing' | 'validating' | 'compressing' | 'done';
  filesProcessed?: number;
  totalFiles?: number;
  currentFileName?: string;
}

export interface EvidenceCompressionResult {
  zipBlob: Blob;
  fileName: string;
  fileSize: number;
}

// ─────────────────────────────────────────
// Carga a Azure DevOps
// ─────────────────────────────────────────

export interface AttachmentUploadRequest {
  projectId: string;
  fileName: string;
  areaPath: string;
  fileBlob: Blob;
}

export interface AttachmentUploadResponse {
  id: string;
  url: string;
  size?: number;
}

export interface AttachmentLinkingRequest {
  planId: string;
  attachmentUrl: string;
  planTitle: string;
}

// ─────────────────────────────────────────
// Estado global del proceso
// ─────────────────────────────────────────

export interface EvidenceUploadProgress {
  state: EvidenceUploadState;
  error?: PlanValidationError | { code: string; message: string };
  validatedPlan?: ValidatedPlanInfo;
  serenityProgress?: {
    phase: string;
    statusMessage?: string;
    percentage?: number;
  };
  compressionProgress?: CompressionProgress;
  uploadProgress?: {
    percentage: number;
    uploaded?: number;
    total?: number;
  };
  attachmentUrl?: string;
  attachmentId?: string;
  resultMessage?: string;
}

// ─────────────────────────────────────────
// Configuración parametrizable
// ─────────────────────────────────────────

export interface SerenityZipNameConfig {
  template: string; // ej: "Evidencia_{{planId}}_{{timestamp}}"
  createdAt?: number;
}

export const DEFAULT_SERENITY_ZIP_NAME_TEMPLATE = 'Evidencia_{{planId}}_{{timestamp}}';

// Variables soportadas en la plantilla
export enum ZipNameVariable {
  PLAN_ID = 'planId',
  PLAN_TITLE = 'planTitle',
  TIMESTAMP = 'timestamp',
  EXECUTION_ID = 'executionId',
  ENVIRONMENT = 'environment',
  USER_STORY_ID = 'userStoryId'
}

export interface ZipNameResolutionContext {
  planId: string;
  planTitle: string;
  timestamp: string;
  executionId?: string;
  environment?: string;
  userStoryId?: string;
}

// ─────────────────────────────────────────
// Reintentos
// ─────────────────────────────────────────

export enum RetryableStep {
  PLAN_VALIDATION = 'PLAN_VALIDATION',
  SERENITY_GENERATION = 'SERENITY_GENERATION',
  COMPRESSION = 'COMPRESSION',
  ATTACHMENT_UPLOAD = 'ATTACHMENT_UPLOAD',
  ATTACHMENT_LINKING = 'ATTACHMENT_LINKING'
}

export interface RetryAttempt {
  step: RetryableStep;
  attempt: number;
  timestamp: number;
}
