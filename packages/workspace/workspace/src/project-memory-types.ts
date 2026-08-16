/**
 * Browser-safe Project Memory Remote vocabulary. The durable implementation
 * remains host-only in `project-memory.ts`; these structural types are the
 * contract generated Remote clients consume.
 * @module @deepseek-ai/dsh-workspace/project-memory-types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * Browser-safe Workspace identity. The brand string is identical to Workspace
 * Core's `WorkspaceId`, but this contract deliberately does not import the
 * Workspace host package's `types.ts` because that module also names Session
 * host types and would contaminate the Client compilation graph.
 */
export type ProjectMemoryWorkspaceId = Branded<'WorkspaceId'>

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
  readonly workspaceId: ProjectMemoryWorkspaceId
  readonly sections: ProjectMemorySectionsView
  readonly createdAt: string
  readonly updatedAt: string
}

/** Origin of a candidate before it is accepted into durable Project Memory. */
export type ProjectMemoryCandidateSource = 'manual' | 'session' | 'mission' | 'automatic'

/**
 * Advisory relationship supplied by an automatic extractor. It never grants
 * permission to replace committed memory; the Host still computes the review
 * relation against the current authoritative section.
 */
export type ProjectMemoryCandidateReviewHint = 'append' | 'supersedes' | 'conflict'

/** Host-computed relationship between a pending candidate and committed memory. */
export type ProjectMemoryCandidateRelation = 'new' | 'duplicate' | 'merge' | 'supersedes' | 'conflict'

/** One pending candidate waiting for human review. */
export interface ProjectMemoryCandidateView {
  readonly id: string
  readonly workspaceId: ProjectMemoryWorkspaceId
  readonly section: ProjectMemorySection
  readonly text: string
  readonly source: ProjectMemoryCandidateSource
  readonly sourceRef: string | null
  readonly createdAt: string
  /** Advisory extractor signal retained for review/audit; never an overwrite instruction. */
  readonly reviewHint: ProjectMemoryCandidateReviewHint | null
  /** Exact committed block/line an extractor proposes replacing, when any. */
  readonly supersedesText: string | null
  /** Optional concise explanation produced by the extractor. */
  readonly rationale: string | null
  /** Authoritative Host classification against the current committed section. */
  readonly relation: ProjectMemoryCandidateRelation
}

/** Read the Project Memory associated with one stable Workspace identity. */
export interface ProjectMemoryGetRequest {
  readonly workspaceId: ProjectMemoryWorkspaceId
}

/** Replace one canonical Project Memory section. */
export interface ProjectMemorySetSectionRequest {
  readonly workspaceId: ProjectMemoryWorkspaceId
  readonly section: ProjectMemorySection
  readonly text: string
}

/** Atomically replace all six Project Memory sections. */
export interface ProjectMemoryReplaceRequest {
  readonly workspaceId: ProjectMemoryWorkspaceId
  readonly sections: ProjectMemorySectionsView
}

/** Remove the Project Memory sidecar for one registered Workspace. */
export interface ProjectMemoryClearRequest {
  readonly workspaceId: ProjectMemoryWorkspaceId
}

/** Read pending candidate memory for one Workspace. */
export interface ProjectMemoryCandidatesRequest {
  readonly workspaceId: ProjectMemoryWorkspaceId
}

/** Stage one candidate for later human review. */
export interface ProjectMemoryProposeCandidateRequest {
  readonly workspaceId: ProjectMemoryWorkspaceId
  readonly section: ProjectMemorySection
  readonly text: string
  readonly source: ProjectMemoryCandidateSource
  readonly sourceRef: string | null
  readonly reviewHint?: ProjectMemoryCandidateReviewHint
  /** Exact existing block/line proposed for replacement when `reviewHint` is `supersedes`. */
  readonly supersedesText?: string | null
  readonly rationale?: string | null
}

/** Accept or reject one candidate belonging to a Workspace. */
export interface ProjectMemoryReviewCandidateRequest {
  readonly workspaceId: ProjectMemoryWorkspaceId
  readonly candidateId: string
}

/** Current memory; `null` means the Workspace is known but no row exists. */
export interface ProjectMemoryReadValue {
  readonly memory: ProjectMemoryView | null
}

/** Current pending candidate queue for one Workspace. */
export interface ProjectMemoryCandidateQueueValue {
  readonly memory: ProjectMemoryView | null
  readonly candidates: readonly ProjectMemoryCandidateView[]
}

/** Clear acknowledgement; false means the Workspace had no durable memory row. */
export interface ProjectMemoryClearValue {
  readonly cleared: boolean
}

/** The stable Workspace identity no longer exists in Workspace Core. */
export interface ProjectMemoryWorkspaceNotFound {
  readonly code: 'workspace-not-found'
  readonly workspaceId: ProjectMemoryWorkspaceId
}

/** A candidate id is absent or belongs to a different Workspace. */
export interface ProjectMemoryCandidateNotFound {
  readonly code: 'candidate-not-found'
  readonly workspaceId: ProjectMemoryWorkspaceId
  readonly candidateId: string
}

/** A candidate cannot be safely accepted against the current committed section. */
export interface ProjectMemoryCandidateConflict {
  readonly code: 'candidate-conflict'
  readonly workspaceId: ProjectMemoryWorkspaceId
  readonly candidateId: string
}

/** Successful Project Memory Remote operation. */
export interface ProjectMemorySuccess<T> {
  readonly ok: true
  readonly value: T
}

/** Rejected core Project Memory operation. */
export interface ProjectMemoryRejected {
  readonly ok: false
  readonly error: ProjectMemoryWorkspaceNotFound
}

/** Rejected candidate review operation. */
export interface ProjectMemoryCandidateRejected {
  readonly ok: false
  readonly error: ProjectMemoryWorkspaceNotFound | ProjectMemoryCandidateNotFound | ProjectMemoryCandidateConflict
}

/** Result returned by Project Memory get/setSection/replace. */
export type ProjectMemoryReadResult =
  | ProjectMemorySuccess<ProjectMemoryReadValue>
  | ProjectMemoryRejected

/** Result returned by Project Memory clear. */
export type ProjectMemoryClearResult =
  | ProjectMemorySuccess<ProjectMemoryClearValue>
  | ProjectMemoryRejected

/** Result returned by candidate list/propose/accept/reject. */
export type ProjectMemoryCandidateQueueResult =
  | ProjectMemorySuccess<ProjectMemoryCandidateQueueValue>
  | ProjectMemoryCandidateRejected

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The pending candidate queue for one Workspace changed. This is a
     * one-way invalidation hint: consumers re-read the authoritative queue
     * through `projectMemory.listCandidates` rather than trusting event data.
     * @mode emit
     */
    'project-memory/candidates-changed'(workspaceId: ProjectMemoryWorkspaceId): void
  }
}
