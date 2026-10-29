/**
 * Modelos del Agente de exploración de código (Azure Repos).
 */

/**
 * Fuente de contexto para generar escenarios:
 *  - criteria:      solo HU + criterios (comportamiento original).
 *  - criteria-code: HU + criterios como fuente principal; el código complementa.
 *  - code:          el código es la fuente principal (criterios opcionales).
 */
export type ContextSource = 'criteria' | 'criteria-code' | 'code';

export interface AzureRepoProject {
  id: string;
  name: string;
}

export interface AzureRepository {
  id: string;
  name: string;
  defaultBranch: string;
  projectId?: string;
}

export interface AzureRepoBranch {
  name: string;
  commitId: string;
}

export interface AzureLinkedBranch {
  projectId: string;
  repositoryId: string;
  branch: string;
}

export interface AzureRepoTree {
  scopePath: string;
  totalFiles: number;
  readableFiles: number;
  truncated: boolean;
  files: string[];
}

export interface AzureRepoFileRequest {
  path: string;
  startLine?: number;
  endLine?: number;
}

export interface AzureRepoFile {
  path: string;
  totalLines?: number;
  startLine?: number;
  endLine?: number;
  truncated?: boolean;
  content?: string;
  error?: string;
}

export interface AzureBranchChange {
  path: string;
  changeType: string;
  originalPath?: string;
}

/** Cambios de la rama de la HU vs su rama base (desde el ancestro común). */
export interface AzureBranchDiff {
  baseBranch: string;
  branch: string;
  commonCommit: string | null;
  targetCommit: string | null;
  aheadCount: number;
  behindCount: number;
  totalChangedFiles: number;
  allChangesIncluded: boolean;
  changes: AzureBranchChange[];
}

export interface AzureFileDiff {
  path: string;
  changeType?: string;
  added?: number;
  removed?: number;
  diff?: string;
  error?: string;
}

export interface AzureRepoSearchResult {
  searchedFiles: number;
  matches: { path: string; line: number; text: string }[];
}

/** Objetivo de exploración seleccionado en el formulario. */
export interface CodeExplorationTarget {
  project: string;
  repositoryId: string;
  repositoryName: string;
  branch: string;
  commitId: string;
  scopePath: string;
  /** Rama contra la que se compara (develop/main). Vacío = explorar sin diff. */
  baseBranch: string;
}

export interface CodeExplorationInput {
  target: CodeExplorationTarget;
  mode: ContextSource;
  description: string;
  acceptanceCriteria: string;
  userRequest: string;
}

export type CodeAgentEventType = 'progress' | 'tool' | 'done' | 'cached';

/** Estado de cada criterio frente al código, según el agente. */
export type CriterionCodeStatus = 'IMPLEMENTADO' | 'PARCIAL' | 'DIFERENTE' | 'SIN EVIDENCIA';

export interface CodeAgentEvent {
  type: CodeAgentEventType;
  message: string;
  /** Solo en done/cached: contexto técnico final en texto. */
  context?: string;
  filesReviewed?: string[];
}
