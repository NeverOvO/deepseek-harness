/**
 * Durable Project Memory sidecar keyed by stable {@link WorkspaceId} values.
 * Project Memory deliberately lives in its own storage domain and never writes
 * metadata into a user's source tree.
 * @module @deepseek-ai/dsh-workspace/project-memory
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { DomainChanged, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type { WorkspaceId } from './types.ts'
import type { WorkspaceRegistry } from './index.ts'
import type {
  ProjectMemoryCandidateConflict,
  ProjectMemoryCandidateNotFound,
  ProjectMemoryCandidateQueueResult,
  ProjectMemoryCandidateQueueValue,
  ProjectMemoryCandidateRejected,
  ProjectMemoryCandidateRelation,
  ProjectMemoryCandidateReviewHint,
  ProjectMemoryCandidateSource,
  ProjectMemoryCandidateView,
  ProjectMemoryCandidatesRequest,
  ProjectMemoryClearRequest,
  ProjectMemoryClearResult,
  ProjectMemoryGetRequest,
  ProjectMemoryProposeCandidateRequest,
  ProjectMemoryReadResult,
  ProjectMemoryReadValue,
  ProjectMemoryRejected,
  ProjectMemoryReplaceRequest,
  ProjectMemoryReviewCandidateRequest,
  ProjectMemorySetSectionRequest,
  ProjectMemorySuccess,
  ProjectMemoryView,
} from './project-memory-types.ts'

/** Stable section order used by persistence, UI projections, and prompt assembly. */
export const projectMemorySectionNames = [
  'architecture',
  'commands',
  'conventions',
  'decisions',
  'knownIssues',
  'definitionOfDone',
] as const

/** One editable Project Memory section. */
export type ProjectMemorySection = typeof projectMemorySectionNames[number]

/** Complete six-section Project Memory payload. */
export interface ProjectMemorySections {
  /** Architectural boundaries, subsystems, and important relationships. */
  readonly architecture: string
  /** Project-specific build, test, run, release, and maintenance commands. */
  readonly commands: string
  /** Coding, product, repository, and collaboration conventions. */
  readonly conventions: string
  /** Durable decisions whose rationale should survive individual sessions. */
  readonly decisions: string
  /** Known defects, limitations, risks, and intentionally deferred work. */
  readonly knownIssues: string
  /** Acceptance criteria that define when the current project work is complete. */
  readonly definitionOfDone: string
}

/** Durable value stored under one WorkspaceId in the sidecar domain. */
export interface ProjectMemoryRecord {
  /** The six canonical Project Memory sections. */
  readonly sections: ProjectMemorySections
  /** ISO-8601 creation timestamp for this memory record. */
  readonly createdAt: string
  /** ISO-8601 timestamp of the latest material section change. */
  readonly updatedAt: string
}

/** Public immutable projection combining the durable key and value. */
export interface ProjectMemory extends ProjectMemoryRecord {
  /** Stable workspace identity owning this memory. */
  readonly workspaceId: WorkspaceId
}

/** Durable pending-candidate record kept outside the committed memory domain. */
interface ProjectMemoryCandidateRecord {
  readonly workspaceId: string
  readonly section: ProjectMemorySection
  readonly text: string
  readonly source: ProjectMemoryCandidateSource
  readonly sourceRef: string | null
  readonly createdAt: string
  /** Optional extractor signal. Old v1 rows legitimately omit this field. */
  readonly reviewHint?: ProjectMemoryCandidateReviewHint | undefined
  /** Exact existing block/line proposed for replacement. Old v1 rows omit it. */
  readonly supersedesText?: string | null | undefined
  /** Optional extractor explanation. Old v1 rows legitimately omit this field. */
  readonly rationale?: string | null | undefined
}

/** A write addressed a workspace that is not registered in Workspace Core. */
export class ProjectMemoryUnknownWorkspaceError extends Error {
  constructor(readonly workspaceId: WorkspaceId) {
    super(`cannot write Project Memory for unknown workspace '${workspaceId}'`)
    this.name = 'ProjectMemoryUnknownWorkspaceError'
  }
}

/** A review action addressed a candidate absent from the requested Workspace. */
class ProjectMemoryUnknownCandidateError extends Error {
  constructor(readonly workspaceId: WorkspaceId, readonly candidateId: string) {
    super(`cannot review Project Memory candidate '${candidateId}' for workspace '${workspaceId}'`)
    this.name = 'ProjectMemoryUnknownCandidateError'
  }
}

/** A review action cannot safely apply against the current authoritative section. */
class ProjectMemoryCandidateConflictError extends Error {
  constructor(readonly workspaceId: WorkspaceId, readonly candidateId: string) {
    super(`cannot safely accept Project Memory candidate '${candidateId}' for workspace '${workspaceId}'`)
    this.name = 'ProjectMemoryCandidateConflictError'
  }
}

const projectMemorySectionsSchema = z.object({
  architecture: z.string(),
  commands: z.string(),
  conventions: z.string(),
  decisions: z.string(),
  knownIssues: z.string(),
  definitionOfDone: z.string(),
})

/** Durable-boundary schema for one Project Memory record. */
export const projectMemoryRecordSchema = z.object({
  sections: projectMemorySectionsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})

const projectMemoryCandidateRecordSchema: z.ZodType<ProjectMemoryCandidateRecord> = z.object({
  workspaceId: z.string(),
  section: z.enum(projectMemorySectionNames),
  text: z.string(),
  source: z.enum(['manual', 'session', 'mission', 'automatic']),
  sourceRef: z.string().nullable(),
  createdAt: z.string(),
  reviewHint: z.enum(['append', 'supersedes', 'conflict']).optional(),
  supersedesText: z.string().nullable().optional(),
  rationale: z.string().nullable().optional(),
})

/**
 * Project Memory uses a separate data domain rather than extending the
 * `workspace` domain. The WorkspaceId is the table key, so path changes never
 * rename or fork memory and user repositories receive no sidecar files.
 */
export const projectMemoryDomainSpec = defineDomain({
  name: 'project_memory',
  version: 1,
  tables: {
    memories: domainTable<WorkspaceId, ProjectMemoryRecord>(projectMemoryRecordSchema),
  },
})

/**
 * Pending candidates are intentionally isolated from committed memory. This
 * keeps the already-shipped `project_memory` v1 layout stable and ensures an
 * unreviewed suggestion can never enter model context merely by being queued.
 */
export const projectMemoryCandidateDomainSpec = defineDomain({
  name: 'project_memory_candidates',
  version: 1,
  tables: {
    candidates: domainTable<string, ProjectMemoryCandidateRecord>(projectMemoryCandidateRecordSchema),
  },
})

const EMPTY_SECTIONS: ProjectMemorySections = Object.freeze({
  architecture: '',
  commands: '',
  conventions: '',
  decisions: '',
  knownIssues: '',
  definitionOfDone: '',
})

const PROJECT_MEMORY_HEADINGS: Readonly<Record<ProjectMemorySection, string>> = Object.freeze({
  architecture: 'Architecture',
  commands: 'Commands',
  conventions: 'Conventions',
  decisions: 'Decisions',
  knownIssues: 'Known Issues',
  definitionOfDone: 'Definition of Done',
})

/** Provider-independent hard ceiling for the model-facing Project Memory snapshot. */
export const PROJECT_MEMORY_CONTEXT_CHAR_BUDGET = 16_000
/** Per-section ceiling before the global Project Memory context budget is shared. */
export const PROJECT_MEMORY_CONTEXT_SECTION_CHAR_BUDGET = 4_000
const PROJECT_MEMORY_CONTEXT_TRUNCATION_MARKER = '\n\n[… Project Memory context truncated …]\n\n'
const PROJECT_MEMORY_CONTEXT_HEADER = 'Yanami Project Memory — durable workspace context stored by DSH outside the user repository. '
  + 'Use it as remembered project guidance and verify it against current files when facts may have changed.'

function sectionsSnapshot(sections: ProjectMemorySections): ProjectMemorySections {
  return Object.freeze({
    architecture: sections.architecture,
    commands: sections.commands,
    conventions: sections.conventions,
    decisions: sections.decisions,
    knownIssues: sections.knownIssues,
    definitionOfDone: sections.definitionOfDone,
  })
}

function recordSnapshot(workspaceId: WorkspaceId, record: ProjectMemoryRecord): ProjectMemory {
  return Object.freeze({
    workspaceId,
    sections: sectionsSnapshot(record.sections),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  })
}

/** Stable comparison form that preserves case and punctuation-sensitive project identifiers. */
function canonicalCandidateText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Exact/block/line containment without broad substring matches such as command prefixes. */
function committedContainsCandidate(current: string, candidate: string): boolean {
  const target = canonicalCandidateText(candidate)
  if (target.length === 0) return false
  const committed = canonicalCandidateText(current)
  if (committed === target) return true
  const blocks = current.split(/\n\s*\n/).map(canonicalCandidateText)
  if (blocks.includes(target)) return true
  const lines = current.split('\n').map(canonicalCandidateText).filter(Boolean)
  return lines.includes(target)
}

/**
 * Replace exactly one committed full section, blank-line block, or line.
 * Ambiguous and stale targets return undefined rather than guessing.
 */
function replaceExactCandidateTarget(current: string, target: string, candidate: string): string | undefined {
  const canonicalTarget = canonicalCandidateText(target)
  const normalizedCandidate = normalizeSectionText(candidate)
  if (canonicalTarget.length === 0 || normalizedCandidate === '') return undefined
  if (canonicalCandidateText(current) === canonicalTarget) return normalizedCandidate

  const blocks = current.split(/\n\s*\n/)
  const blockMatches = blocks.flatMap((block, index) =>
    canonicalCandidateText(block) === canonicalTarget ? [index] : [])
  if (blockMatches.length === 1) {
    const next = [...blocks]
    next[blockMatches[0] as number] = normalizedCandidate
    return next.join('\n\n')
  }
  if (blockMatches.length > 1) return undefined

  const lines = current.split('\n')
  const lineMatches = lines.flatMap((line, index) =>
    canonicalCandidateText(line) === canonicalTarget ? [index] : [])
  if (lineMatches.length !== 1) return undefined
  const next = [...lines]
  next[lineMatches[0] as number] = normalizedCandidate
  return next.join('\n')
}

function candidateRelation(
  record: ProjectMemoryCandidateRecord,
  currentSection: string,
): ProjectMemoryCandidateRelation {
  if (committedContainsCandidate(currentSection, record.text)) return 'duplicate'
  if (record.reviewHint === 'conflict') return 'conflict'
  if (record.reviewHint === 'supersedes') {
    const target = record.supersedesText ?? ''
    return replaceExactCandidateTarget(currentSection, target, record.text) === undefined
      ? 'conflict'
      : 'supersedes'
  }
  if (currentSection.trim().length === 0) return 'new'
  return 'merge'
}

function candidateSnapshot(
  id: string,
  record: ProjectMemoryCandidateRecord,
  currentSection: string,
): ProjectMemoryCandidateView {
  return Object.freeze({
    id,
    workspaceId: record.workspaceId as WorkspaceId,
    section: record.section,
    text: record.text,
    source: record.source,
    sourceRef: record.sourceRef,
    createdAt: record.createdAt,
    reviewHint: record.reviewHint ?? null,
    supersedesText: record.supersedesText ?? null,
    rationale: record.rationale ?? null,
    relation: candidateRelation(record, currentSection),
  })
}

function hasContent(sections: ProjectMemorySections): boolean {
  return projectMemorySectionNames.some(section => sections[section].trim().length > 0)
}

function normalizeSectionText(text: string): string {
  return text.trim().length === 0 ? '' : text
}

function normalizeRationale(rationale: string | null | undefined): string | null {
  if (rationale === undefined || rationale === null) return null
  const normalized = rationale.trim()
  return normalized.length === 0 ? null : normalized
}

function normalizeSupersedesText(text: string | null | undefined): string | null {
  if (text === undefined || text === null) return null
  const normalized = text.trim()
  return normalized.length === 0 ? null : normalized
}

function mergeCandidateText(current: string, candidate: string): string {
  const normalizedCandidate = normalizeSectionText(candidate)
  if (normalizedCandidate === '') return current
  if (current.trim() === '') return normalizedCandidate
  if (committedContainsCandidate(current, normalizedCandidate)) return current
  return `${current.trimEnd()}\n\n${normalizedCandidate}`
}

/** Keep both the oldest and newest facts when model context must be shortened. */
function truncateProjectMemoryContextText(text: string, maxChars: number): string {
  const normalized = text.trim()
  if (normalized.length <= maxChars) return normalized
  if (maxChars <= PROJECT_MEMORY_CONTEXT_TRUNCATION_MARKER.length) {
    return PROJECT_MEMORY_CONTEXT_TRUNCATION_MARKER.slice(0, maxChars)
  }
  const available = maxChars - PROJECT_MEMORY_CONTEXT_TRUNCATION_MARKER.length
  const headChars = Math.ceil(available / 2)
  const tailChars = Math.floor(available / 2)
  const tail = tailChars === 0 ? '' : normalized.slice(-tailChars).trimStart()
  return `${normalized.slice(0, headChars).trimEnd()}${PROJECT_MEMORY_CONTEXT_TRUNCATION_MARKER}${tail}`
}

/** Freeze one host memory snapshot before it crosses the typed Remote boundary. */
function remoteSnapshot(memory: ProjectMemory): ProjectMemoryView {
  return Object.freeze({
    workspaceId: memory.workspaceId,
    sections: Object.freeze({
      architecture: memory.sections.architecture,
      commands: memory.sections.commands,
      conventions: memory.sections.conventions,
      decisions: memory.sections.decisions,
      knownIssues: memory.sections.knownIssues,
      definitionOfDone: memory.sections.definitionOfDone,
    }),
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  })
}

function remoteReadValue(memory: ProjectMemory | undefined): ProjectMemoryReadValue {
  return Object.freeze({ memory: memory === undefined ? null : remoteSnapshot(memory) })
}

function remoteSuccess<T>(value: T): ProjectMemorySuccess<T> {
  return Object.freeze({ ok: true, value })
}

function remoteWorkspaceMissing(workspaceId: WorkspaceId): ProjectMemoryRejected {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code: 'workspace-not-found', workspaceId }),
  })
}

function remoteCandidateMissing(workspaceId: WorkspaceId, candidateId: string): ProjectMemoryCandidateRejected {
  const error: ProjectMemoryCandidateNotFound = Object.freeze({
    code: 'candidate-not-found',
    workspaceId,
    candidateId,
  })
  return Object.freeze({ ok: false, error })
}

function remoteCandidateConflict(workspaceId: WorkspaceId, candidateId: string): ProjectMemoryCandidateRejected {
  const error: ProjectMemoryCandidateConflict = Object.freeze({
    code: 'candidate-conflict',
    workspaceId,
    candidateId,
  })
  return Object.freeze({ ok: false, error })
}

/**
 * Render the model-facing Project Memory snapshot. The full durable value stays
 * available to Workbench, while this provider-independent view has deterministic
 * per-section and global character ceilings so long-lived memory cannot crowd
 * the conversation window without bound.
 */
export function renderProjectMemoryContext(memory: ProjectMemory): string {
  const entries = projectMemorySectionNames.flatMap((section) => {
    const text = memory.sections[section]
    if (text.trim().length === 0) return []
    return [{ heading: `## ${PROJECT_MEMORY_HEADINGS[section]}\n`, text }]
  })
  if (entries.length === 0) return ''

  const separatorChars = entries.length * 2
  const headingChars = entries.reduce((total, entry) => total + entry.heading.length, 0)
  const bodyBudget = Math.max(
    0,
    Math.floor((PROJECT_MEMORY_CONTEXT_CHAR_BUDGET
      - PROJECT_MEMORY_CONTEXT_HEADER.length
      - separatorChars
      - headingChars) / entries.length),
  )
  const perSectionBudget = Math.min(PROJECT_MEMORY_CONTEXT_SECTION_CHAR_BUDGET, bodyBudget)
  const sections = entries.map(entry =>
    `${entry.heading}${truncateProjectMemoryContextText(entry.text, perSectionBudget)}`)
  return [PROJECT_MEMORY_CONTEXT_HEADER, ...sections].join('\n\n')
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    projectMemory: ProjectMemoryService
    workspaceRegistry: WorkspaceRegistry
  }
}

/**
 * Host-side Project Memory storage service and typed Remote owner. Committed
 * memory and pending candidates occupy separate domains; only committed memory
 * is ever rendered into model context.
 */
export class ProjectMemoryService extends TypertRemoteService {
  static inject = ['storageDomain', 'workspaceRegistry']

  private table?: KvTable<WorkspaceId, ProjectMemoryRecord>
  private candidateTable?: KvTable<string, ProjectMemoryCandidateRecord>
  private operationTail: Promise<void> = Promise.resolve()
  private mutationAdmissionOpen = true

  constructor(ctx: Context) {
    super(ctx, 'projectMemory')
  }

  /** Open committed-memory and candidate-review domains and bind Workspace cleanup. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(projectMemoryDomainSpec)
    const candidateDomain = await this.ctx.storageDomain.open(projectMemoryCandidateDomainSpec)
    this.table = domain.table('memories')
    this.candidateTable = candidateDomain.table('candidates')

    this.ctx.on('domain/changed', (change: DomainChanged) => {
      if (change.domain !== 'workspace'
        || change.table !== 'workspaces'
        || change.operation !== 'deleted') return
      const workspaceId = change.key as WorkspaceId
      void this.clearWorkspaceSidecars(workspaceId).catch((error: unknown) => {
        this.ctx.logger.warn(
          `Project Memory cleanup failed for deleted workspace '${change.key}': ${String(error)}`,
        )
      })
    })

    this.ctx.effect(() => async () => {
      this.mutationAdmissionOpen = false
      await this.operationTail
      await candidateDomain.close()
      await domain.close()
    }, 'project-memory.domainClose')
  }

  /** Read one workspace's committed Project Memory synchronously from the domain cache. */
  get(workspaceId: WorkspaceId): ProjectMemory | undefined {
    const record = this.requireTable().get(workspaceId)
    return record === undefined ? undefined : recordSnapshot(workspaceId, record)
  }

  /** Return an empty six-section value without materializing a durable row. */
  empty(): ProjectMemorySections {
    return EMPTY_SECTIONS
  }

  /** Pending candidates for one Workspace, oldest first. Relations are computed against current memory. */
  candidates(workspaceId: WorkspaceId): readonly ProjectMemoryCandidateView[] {
    const sections = this.get(workspaceId)?.sections ?? EMPTY_SECTIONS
    return Object.freeze(
      [...this.requireCandidateTable().entries()]
        .filter(([, record]) => record.workspaceId === workspaceId)
        .map(([id, record]) => candidateSnapshot(id, record, sections[record.section]))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    )
  }

  /** Replace one committed section while preserving the others. */
  setSection(
    workspaceId: WorkspaceId,
    section: ProjectMemorySection,
    text: string,
  ): Promise<ProjectMemory | undefined> {
    return this.enqueue(async () => await this.setSectionNow(workspaceId, section, text))
  }

  /** Replace all six committed sections in one durable write. */
  replace(
    workspaceId: WorkspaceId,
    sections: ProjectMemorySections,
  ): Promise<ProjectMemory | undefined> {
    return this.enqueue(async () => {
      this.assertKnownWorkspace(workspaceId)
      const table = this.requireTable()
      const current = table.get(workspaceId)
      const nextSections = sectionsSnapshot({
        architecture: normalizeSectionText(sections.architecture),
        commands: normalizeSectionText(sections.commands),
        conventions: normalizeSectionText(sections.conventions),
        decisions: normalizeSectionText(sections.decisions),
        knownIssues: normalizeSectionText(sections.knownIssues),
        definitionOfDone: normalizeSectionText(sections.definitionOfDone),
      })
      if (!hasContent(nextSections)) {
        if (current !== undefined) await table.delete(workspaceId)
        return undefined
      }
      if (current !== undefined
        && projectMemorySectionNames.every(section => current.sections[section] === nextSections[section])) {
        return recordSnapshot(workspaceId, current)
      }

      const now = new Date().toISOString()
      const next: ProjectMemoryRecord = Object.freeze({
        sections: nextSections,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      })
      await table.put(workspaceId, next)
      return recordSnapshot(workspaceId, next)
    })
  }

  /** Remove one committed Project Memory record without touching pending candidates. */
  clear(workspaceId: WorkspaceId): Promise<boolean> {
    return this.enqueue(async () => await this.requireTable().delete(workspaceId))
  }

  /** Stage one pending candidate, deduplicating canonical pending text and replacement target in the same section. */
  proposeCandidate(
    workspaceId: WorkspaceId,
    section: ProjectMemorySection,
    text: string,
    source: ProjectMemoryCandidateSource,
    sourceRef: string | null,
    reviewHint?: ProjectMemoryCandidateReviewHint,
    rationale?: string | null,
    supersedesText?: string | null,
  ): Promise<ProjectMemoryCandidateView> {
    return this.enqueue(async () => {
      this.assertKnownWorkspace(workspaceId)
      const normalized = normalizeSectionText(text)
      if (normalized === '') throw new Error('Project Memory candidate text must not be empty')
      const normalizedSupersedes = normalizeSupersedesText(supersedesText)
      const table = this.requireCandidateTable()
      const canonical = canonicalCandidateText(normalized)
      const canonicalSupersedes = canonicalCandidateText(normalizedSupersedes ?? '')
      const currentSection = this.get(workspaceId)?.sections[section] ?? ''
      for (const [id, record] of table.entries()) {
        if (record.workspaceId === workspaceId
          && record.section === section
          && canonicalCandidateText(record.text) === canonical
          && canonicalCandidateText(record.supersedesText ?? '') === canonicalSupersedes) {
          return candidateSnapshot(id, record, currentSection)
        }
      }
      const id = randomUUID()
      const record: ProjectMemoryCandidateRecord = Object.freeze({
        workspaceId,
        section,
        text: normalized,
        source,
        sourceRef,
        ...(reviewHint === undefined ? {} : { reviewHint }),
        supersedesText: normalizedSupersedes,
        rationale: normalizeRationale(rationale),
        createdAt: new Date().toISOString(),
      })
      await table.put(id, record)
      return candidateSnapshot(id, record, currentSection)
    })
  }

  /** Accept a pending candidate only when its Host-computed relation is safe at commit time. */
  acceptCandidate(workspaceId: WorkspaceId, candidateId: string): Promise<ProjectMemory | undefined> {
    return this.enqueue(async () => {
      this.assertKnownWorkspace(workspaceId)
      const table = this.requireCandidateTable()
      const candidate = table.get(candidateId)
      if (candidate === undefined || candidate.workspaceId !== workspaceId) {
        throw new ProjectMemoryUnknownCandidateError(workspaceId, candidateId)
      }
      const currentMemory = this.get(workspaceId)
      const current = currentMemory?.sections[candidate.section] ?? ''
      const relation = candidateRelation(candidate, current)
      if (relation === 'conflict') {
        throw new ProjectMemoryCandidateConflictError(workspaceId, candidateId)
      }

      let memory: ProjectMemory | undefined
      if (relation === 'duplicate') {
        memory = currentMemory
      } else if (relation === 'supersedes') {
        const replaced = replaceExactCandidateTarget(current, candidate.supersedesText ?? '', candidate.text)
        if (replaced === undefined) {
          throw new ProjectMemoryCandidateConflictError(workspaceId, candidateId)
        }
        memory = await this.setSectionNow(workspaceId, candidate.section, replaced)
      } else {
        memory = await this.setSectionNow(
          workspaceId,
          candidate.section,
          mergeCandidateText(current, candidate.text),
        )
      }
      await table.delete(candidateId)
      return memory
    })
  }

  /** Reject one pending candidate without changing committed Project Memory. */
  rejectCandidate(workspaceId: WorkspaceId, candidateId: string): Promise<void> {
    return this.enqueue(async () => {
      this.assertKnownWorkspace(workspaceId)
      const table = this.requireCandidateTable()
      const candidate = table.get(candidateId)
      if (candidate === undefined || candidate.workspaceId !== workspaceId) {
        throw new ProjectMemoryUnknownCandidateError(workspaceId, candidateId)
      }
      await table.delete(candidateId)
    })
  }

  /** Read the sidecar through the generated `projectMemory.get` Remote method. */
  @Remote('get')
  async remoteGet(request: ProjectMemoryGetRequest): Promise<ProjectMemoryReadResult> {
    if (this.ctx.workspaceRegistry.get(request.workspaceId) === undefined) {
      return remoteWorkspaceMissing(request.workspaceId)
    }
    return remoteSuccess(remoteReadValue(this.get(request.workspaceId)))
  }

  /** Replace one section through the generated `projectMemory.setSection` Remote method. */
  @Remote('setSection')
  async remoteSetSection(request: ProjectMemorySetSectionRequest): Promise<ProjectMemoryReadResult> {
    try {
      return remoteSuccess(remoteReadValue(await this.setSection(
        request.workspaceId,
        request.section,
        request.text,
      )))
    } catch (error: unknown) {
      if (error instanceof ProjectMemoryUnknownWorkspaceError) return remoteWorkspaceMissing(error.workspaceId)
      throw error
    }
  }

  /** Atomically replace all six sections through `projectMemory.replace`. */
  @Remote('replace')
  async remoteReplace(request: ProjectMemoryReplaceRequest): Promise<ProjectMemoryReadResult> {
    try {
      return remoteSuccess(remoteReadValue(await this.replace(request.workspaceId, request.sections)))
    } catch (error: unknown) {
      if (error instanceof ProjectMemoryUnknownWorkspaceError) return remoteWorkspaceMissing(error.workspaceId)
      throw error
    }
  }

  /** Clear the committed sidecar through `projectMemory.clear`. */
  @Remote('clear')
  async remoteClear(request: ProjectMemoryClearRequest): Promise<ProjectMemoryClearResult> {
    if (this.ctx.workspaceRegistry.get(request.workspaceId) === undefined) {
      return remoteWorkspaceMissing(request.workspaceId)
    }
    return remoteSuccess(Object.freeze({ cleared: await this.clear(request.workspaceId) }))
  }

  /** List candidates waiting for human review. */
  @Remote('listCandidates')
  async remoteListCandidates(request: ProjectMemoryCandidatesRequest): Promise<ProjectMemoryCandidateQueueResult> {
    if (this.ctx.workspaceRegistry.get(request.workspaceId) === undefined) {
      return remoteWorkspaceMissing(request.workspaceId)
    }
    return remoteSuccess(this.remoteCandidateQueue(request.workspaceId))
  }

  /** Stage a candidate without changing model-facing committed memory. */
  @Remote('proposeCandidate')
  async remoteProposeCandidate(
    request: ProjectMemoryProposeCandidateRequest,
  ): Promise<ProjectMemoryCandidateQueueResult> {
    try {
      await this.proposeCandidate(
        request.workspaceId,
        request.section,
        request.text,
        request.source,
        request.sourceRef,
        request.reviewHint,
        request.rationale,
        request.supersedesText,
      )
      return remoteSuccess(this.remoteCandidateQueue(request.workspaceId))
    } catch (error: unknown) {
      if (error instanceof ProjectMemoryUnknownWorkspaceError) return remoteWorkspaceMissing(error.workspaceId)
      throw error
    }
  }

  /** Accept one candidate and atomically revalidate its review relation before mutation. */
  @Remote('acceptCandidate')
  async remoteAcceptCandidate(
    request: ProjectMemoryReviewCandidateRequest,
  ): Promise<ProjectMemoryCandidateQueueResult> {
    try {
      await this.acceptCandidate(request.workspaceId, request.candidateId)
      return remoteSuccess(this.remoteCandidateQueue(request.workspaceId))
    } catch (error: unknown) {
      if (error instanceof ProjectMemoryUnknownWorkspaceError) return remoteWorkspaceMissing(error.workspaceId)
      if (error instanceof ProjectMemoryUnknownCandidateError) {
        return remoteCandidateMissing(error.workspaceId, error.candidateId)
      }
      if (error instanceof ProjectMemoryCandidateConflictError) {
        return remoteCandidateConflict(error.workspaceId, error.candidateId)
      }
      throw error
    }
  }

  /** Reject one candidate without touching committed memory. */
  @Remote('rejectCandidate')
  async remoteRejectCandidate(
    request: ProjectMemoryReviewCandidateRequest,
  ): Promise<ProjectMemoryCandidateQueueResult> {
    try {
      await this.rejectCandidate(request.workspaceId, request.candidateId)
      return remoteSuccess(this.remoteCandidateQueue(request.workspaceId))
    } catch (error: unknown) {
      if (error instanceof ProjectMemoryUnknownWorkspaceError) return remoteWorkspaceMissing(error.workspaceId)
      if (error instanceof ProjectMemoryUnknownCandidateError) {
        return remoteCandidateMissing(error.workspaceId, error.candidateId)
      }
      throw error
    }
  }

  private remoteCandidateQueue(workspaceId: WorkspaceId): ProjectMemoryCandidateQueueValue {
    const memory = this.get(workspaceId)
    return Object.freeze({
      memory: memory === undefined ? null : remoteSnapshot(memory),
      candidates: this.candidates(workspaceId),
    })
  }

  private async setSectionNow(
    workspaceId: WorkspaceId,
    section: ProjectMemorySection,
    text: string,
  ): Promise<ProjectMemory | undefined> {
    this.assertKnownWorkspace(workspaceId)
    const table = this.requireTable()
    const current = table.get(workspaceId)
    const normalized = normalizeSectionText(text)
    const currentSections = current?.sections ?? EMPTY_SECTIONS
    if (currentSections[section] === normalized) {
      return current === undefined ? undefined : recordSnapshot(workspaceId, current)
    }

    const sections = sectionsSnapshot({ ...currentSections, [section]: normalized })
    if (!hasContent(sections)) {
      if (current !== undefined) await table.delete(workspaceId)
      return undefined
    }

    const now = new Date().toISOString()
    const next: ProjectMemoryRecord = Object.freeze({
      sections,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    })
    await table.put(workspaceId, next)
    return recordSnapshot(workspaceId, next)
  }

  private assertKnownWorkspace(workspaceId: WorkspaceId): void {
    if (this.ctx.workspaceRegistry.get(workspaceId) === undefined) {
      throw new ProjectMemoryUnknownWorkspaceError(workspaceId)
    }
  }

  private requireTable(): KvTable<WorkspaceId, ProjectMemoryRecord> {
    if (this.table === undefined) throw new Error('Project Memory service is not started yet')
    return this.table
  }

  private requireCandidateTable(): KvTable<string, ProjectMemoryCandidateRecord> {
    if (this.candidateTable === undefined) throw new Error('Project Memory candidate service is not started yet')
    return this.candidateTable
  }

  private clearWorkspaceSidecars(workspaceId: WorkspaceId): Promise<void> {
    return this.enqueue(async () => {
      await this.requireTable().delete(workspaceId)
      const candidateTable = this.requireCandidateTable()
      for (const [id, record] of candidateTable.entries()) {
        if (record.workspaceId === workspaceId) await candidateTable.delete(id)
      }
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.mutationAdmissionOpen) {
      return Promise.reject(new Error('Project Memory service is shutting down'))
    }
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => {}, () => {})
    return result
  }
}

export default ProjectMemoryService