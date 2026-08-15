/**
 * Durable Project Memory sidecar keyed by stable {@link WorkspaceId} values.
 * Project Memory deliberately lives in its own storage domain and never writes
 * metadata into a user's source tree.
 * @module @deepseek-ai/dsh-workspace/project-memory
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { DomainChanged, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type { WorkspaceId } from './types.ts'
import type { WorkspaceRegistry } from './index.ts'
import type {
  ProjectMemoryClearRequest,
  ProjectMemoryClearResult,
  ProjectMemoryGetRequest,
  ProjectMemoryReadResult,
  ProjectMemoryReadValue,
  ProjectMemoryRejected,
  ProjectMemoryReplaceRequest,
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

/** A write addressed a workspace that is not registered in Workspace Core. */
export class ProjectMemoryUnknownWorkspaceError extends Error {
  /**
   * @param workspaceId - Unknown stable workspace id.
   */
  constructor(readonly workspaceId: WorkspaceId) {
    super(`cannot write Project Memory for unknown workspace '${workspaceId}'`)
    this.name = 'ProjectMemoryUnknownWorkspaceError'
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

function hasContent(sections: ProjectMemorySections): boolean {
  return projectMemorySectionNames.some(section => sections[section].trim().length > 0)
}

function normalizeSectionText(text: string): string {
  return text.trim().length === 0 ? '' : text
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

/**
 * Render the model-facing Project Memory snapshot. Empty sections are omitted
 * to avoid wasting context tokens while the canonical section order remains stable.
 * @param memory - immutable workspace memory snapshot.
 * @returns durable context text, or an empty string when every section is empty.
 */
export function renderProjectMemoryContext(memory: ProjectMemory): string {
  const sections = projectMemorySectionNames.flatMap((section) => {
    const text = memory.sections[section]
    if (text.trim().length === 0) return []
    return [`## ${PROJECT_MEMORY_HEADINGS[section]}\n${text}`]
  })
  if (sections.length === 0) return ''
  return [
    'Yanami Project Memory — durable workspace context stored by DSH outside the user repository. '
      + 'Use it as remembered project guidance and verify it against current files when facts may have changed.',
    ...sections,
  ].join('\n\n')
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    projectMemory: ProjectMemoryService
    workspaceRegistry: WorkspaceRegistry
  }
}

/**
 * Host-side Project Memory storage service and typed Remote owner. It owns only
 * its sidecar domain; Workspace Core remains authoritative for workspace identity
 * and lifecycle. Remote methods are thin wrappers over the same durable methods,
 * so the browser never gains a second persistence path.
 */
export class ProjectMemoryService extends TypertRemoteService {
  static inject = ['storageDomain', 'workspaceRegistry']

  private table?: KvTable<WorkspaceId, ProjectMemoryRecord>
  private operationTail: Promise<void> = Promise.resolve()
  private mutationAdmissionOpen = true

  /**
   * @param ctx - Host context carrying storage-domain and Workspace Core.
   */
  constructor(ctx: Context) {
    super(ctx, 'projectMemory')
  }

  /** Open the independent Project Memory domain and bind workspace deletion cleanup. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(projectMemoryDomainSpec)
    this.table = domain.table('memories')

    this.ctx.on('domain/changed', (change: DomainChanged) => {
      if (change.domain !== 'workspace'
        || change.table !== 'workspaces'
        || change.operation !== 'deleted') return
      void this.clear(change.key as WorkspaceId).catch((error: unknown) => {
        this.ctx.logger.warn(
          `Project Memory cleanup failed for deleted workspace '${change.key}': ${String(error)}`,
        )
      })
    })

    this.ctx.effect(() => async () => {
      this.mutationAdmissionOpen = false
      await this.operationTail
      await domain.close()
    }, 'project-memory.domainClose')
  }

  /**
   * Read one workspace's durable Project Memory synchronously from the domain cache.
   * @param workspaceId - Stable workspace id.
   * @returns an immutable snapshot, or `undefined` when no memory has been written.
   */
  get(workspaceId: WorkspaceId): ProjectMemory | undefined {
    const record = this.requireTable().get(workspaceId)
    return record === undefined ? undefined : recordSnapshot(workspaceId, record)
  }

  /**
   * Return an empty six-section value for UI/editor initialization without
   * materializing a durable row.
   * @returns a frozen empty section object.
   */
  empty(): ProjectMemorySections {
    return EMPTY_SECTIONS
  }

  /**
   * Replace one section while preserving every other section atomically with
   * respect to other Project Memory writes in this service.
   * @param workspaceId - Stable workspace id.
   * @param section - Canonical section to replace.
   * @param text - New section text; whitespace-only input clears the section.
   * @returns the committed snapshot, or `undefined` when clearing the final non-empty section deletes the row.
   */
  setSection(
    workspaceId: WorkspaceId,
    section: ProjectMemorySection,
    text: string,
  ): Promise<ProjectMemory | undefined> {
    return this.enqueue(async () => {
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
    })
  }

  /**
   * Replace all six sections in one durable write. Empty payloads remove the
   * row instead of storing meaningless records.
   * @param workspaceId - Stable workspace id.
   * @param sections - Complete replacement payload.
   * @returns the committed snapshot, or `undefined` when the payload is empty.
   */
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

  /**
   * Remove one Project Memory record. This is intentionally idempotent and
   * also accepts a just-deleted workspace id so lifecycle cleanup can run.
   * @param workspaceId - Stable workspace id whose sidecar row should disappear.
   * @returns whether a durable row existed.
   */
  clear(workspaceId: WorkspaceId): Promise<boolean> {
    return this.enqueue(async () => await this.requireTable().delete(workspaceId))
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
      if (error instanceof ProjectMemoryUnknownWorkspaceError) {
        return remoteWorkspaceMissing(error.workspaceId)
      }
      throw error
    }
  }

  /** Atomically replace all six sections through `projectMemory.replace`. */
  @Remote('replace')
  async remoteReplace(request: ProjectMemoryReplaceRequest): Promise<ProjectMemoryReadResult> {
    try {
      return remoteSuccess(remoteReadValue(await this.replace(request.workspaceId, request.sections)))
    } catch (error: unknown) {
      if (error instanceof ProjectMemoryUnknownWorkspaceError) {
        return remoteWorkspaceMissing(error.workspaceId)
      }
      throw error
    }
  }

  /** Clear the sidecar through `projectMemory.clear`, only for a registered Workspace. */
  @Remote('clear')
  async remoteClear(request: ProjectMemoryClearRequest): Promise<ProjectMemoryClearResult> {
    if (this.ctx.workspaceRegistry.get(request.workspaceId) === undefined) {
      return remoteWorkspaceMissing(request.workspaceId)
    }
    return remoteSuccess(Object.freeze({ cleared: await this.clear(request.workspaceId) }))
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
