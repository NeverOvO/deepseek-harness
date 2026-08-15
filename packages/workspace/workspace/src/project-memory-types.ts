/**
 * Browser-safe Project Memory Remote vocabulary. The durable implementation
 * remains host-only in `project-memory.ts`; these structural types are the
 * contract generated Remote clients consume.
 * @module @deepseek-ai/dsh-workspace/project-memory-types
 */

import type { WorkspaceId } from './types.ts'

/** Canonical editable Project Memory sections, in product order. */
export type ProjectMemorySection =
  | 'architecture'
  | 'commands'
  | 'conventions'
  | 'decisions'
  | 'knownIssues'
  | 'definitionOfDone'

/** Complete editable Project Memory payload. */
export interface ProjectMemorySectionsView {
  readonly architecture: string
  readonly commands: string
  readonly conventions: string
  readonly decisions: string
  readonly knownIssues: string
  readonly definitionOfDone: string
}

/** Durable Project Memory projection returned to trusted Workbench clients. */
export interface ProjectMemoryView {
  readonly workspaceId: WorkspaceId
  readonly sections: ProjectMemorySectionsView
  readonly createdAt: string
  readonly updatedAt: string
}

/** Read the Project Memory associated with one stable Workspace identity. */
export interface ProjectMemoryGetRequest {
  readonly workspaceId: WorkspaceId
}

/** Replace one canonical Project Memory section. */
export interface ProjectMemorySetSectionRequest {
  readonly workspaceId: WorkspaceId
  readonly section: ProjectMemorySection
  readonly text: string
}

/** Atomically replace all six Project Memory sections. */
export interface ProjectMemoryReplaceRequest {
  readonly workspaceId: WorkspaceId
  readonly sections: ProjectMemorySectionsView
}

/** Remove the Project Memory sidecar for one registered Workspace. */
export interface ProjectMemoryClearRequest {
  readonly workspaceId: WorkspaceId
}

/** Current memory; `null` means the Workspace is known but no row exists. */
export interface ProjectMemoryReadValue {
  readonly memory: ProjectMemoryView | null
}

/** Clear acknowledgement; false means the Workspace had no durable memory row. */
export interface ProjectMemoryClearValue {
  readonly cleared: boolean
}

/** The stable Workspace identity no longer exists in Workspace Core. */
export interface ProjectMemoryWorkspaceNotFound {
  readonly code: 'workspace-not-found'
  readonly workspaceId: WorkspaceId
}

/** Successful Project Memory Remote operation. */
export interface ProjectMemorySuccess<T> {
  readonly ok: true
  readonly value: T
}

/** Rejected Project Memory Remote operation. */
export interface ProjectMemoryRejected {
  readonly ok: false
  readonly error: ProjectMemoryWorkspaceNotFound
}

/** Result returned by Project Memory get/setSection/replace. */
export type ProjectMemoryReadResult =
  | ProjectMemorySuccess<ProjectMemoryReadValue>
  | ProjectMemoryRejected

/** Result returned by Project Memory clear. */
export type ProjectMemoryClearResult =
  | ProjectMemorySuccess<ProjectMemoryClearValue>
  | ProjectMemoryRejected
