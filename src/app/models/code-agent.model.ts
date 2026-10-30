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

/** Archivo del conjunto de cambios de la HU, con su base y destino para el diff. */
export interface WorkItemChangedFile {
  path: string;
  changeType: string;
  baseCommit: string;
  targetCommit: string;
}

/** Cambios de la HU en un repositorio + rama destino (PRs/commits vinculados o rama sin PR). */
export interface WorkItemChangeGroup {
  /** pr: PRs de la HU · commits: commits vinculados · branch: commits de una rama de la HU sin PR. */
  kind?: 'pr' | 'commits' | 'branch';
  projectId: string;
  repositoryId: string;
  repositoryName: string;
  targetBranch: string;
  sourceBranches: string[];
  prs: { id: number; title: string; status: string; sourceBranch: string; targetBranch: string }[];
  commits: { sha: string; comment?: string }[];
  lastDate: string | null;
  lastCommit: string;
  files: WorkItemChangedFile[];
  alsoMergedInto: string[];
}

export interface WorkItemChanges {
  workItemId: number;
  groups: WorkItemChangeGroup[];
  /** PRs vinculados que no se analizan (promociones entre ramas o de otra HU). */
  omitted?: { repositoryName: string; prId: number; title: string; reason: string }[];
  /** Ramas de la HU que no aportan código (vacías, eliminadas o reutilizadas por otra HU). */
  emptyBranches?: { repositoryName: string; branch: string; reason: string }[];
}

/** Clave estable de un grupo de cambios (para incluirlo o excluirlo del análisis). */
export function changeGroupKey(group: Pick<WorkItemChangeGroup, 'repositoryId' | 'targetBranch'>): string {
  return `${group.repositoryId}|${group.targetBranch}`;
}

/** Coincidencias de la búsqueda en todos los repos del aplicativo (Azure Code Search). */
export interface AzureAppSearchResult {
  totalCount: number;
  matches: { repositoryName: string; path: string; line: number; text: string }[];
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
  /** Rama elegida en el formulario. Puede ser null si la HU tiene PRs/commits vinculados. */
  target: CodeExplorationTarget | null;
  /** ID de la HU en Azure Boards: permite usar sus PRs/commits vinculados. */
  workItemId?: number;
  /** Grupos de cambios de la HU que el usuario excluyó del análisis (changeGroupKey). */
  excludedGroups?: string[];
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
