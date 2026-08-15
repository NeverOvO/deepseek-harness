/**
 * Typed Remote facade for Project Memory. The facade exposes only stable
 * WorkspaceId-addressed operations; storage and lifecycle stay owned by the
 * host-only ProjectMemoryService.
 * @module @deepseek-ai/dsh-workspace/project-memory-remote
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  ProjectMemoryUnknownWorkspaceError,
  type ProjectMemory,
} from './project-memory.ts'
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

/** Freeze one host snapshot before it crosses the Remote boundary. */
function snapshot(memory: ProjectMemory): ProjectMemoryView {
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

/** Successful Remote business result. */
function success<T>(value: T): ProjectMemorySuccess<T> {
  return Object.freeze({ ok: true, value })
}

/** Stable missing-Workspace branch shared by every public operation. */
function workspaceMissing(workspaceId: ProjectMemoryGetRequest['workspaceId']): ProjectMemoryRejected {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code: 'workspace-not-found', workspaceId }),
  })
}

/** Convert an optional host row into the public null-explicit read shape. */
function readValue(memory: ProjectMemory | undefined): ProjectMemoryReadValue {
  return Object.freeze({ memory: memory === undefined ? null : snapshot(memory) })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Remote-only facade; durable state remains on `ctx.projectMemory`. */
    projectMemoryRemote: ProjectMemoryRemoteService
  }
}

/**
 * Trusted Workbench Remote surface for the Project Memory sidecar.
 * Business absence stays inside the result union; infrastructure failures are
 * left to Typert's carrier failure branch.
 */
export class ProjectMemoryRemoteService extends TypertRemoteService {
  static inject = ['projectMemory', 'workspaceRegistry']

  /** @param ctx - Host context carrying Workspace Core and Project Memory. */
  constructor(ctx: Context) {
    super(ctx, 'projectMemoryRemote')
  }

  /** Read one registered Workspace's current Project Memory. */
  @Remote('get')
  async get(request: ProjectMemoryGetRequest): Promise<ProjectMemoryReadResult> {
    if (this.ctx.workspaceRegistry.get(request.workspaceId) === undefined) {
      return workspaceMissing(request.workspaceId)
    }
    return success(readValue(this.ctx.projectMemory.get(request.workspaceId)))
  }

  /** Replace one canonical Project Memory section. */
  @Remote('setSection')
  async setSection(request: ProjectMemorySetSectionRequest): Promise<ProjectMemoryReadResult> {
    try {
      const memory = await this.ctx.projectMemory.setSection(
        request.workspaceId,
        request.section,
        request.text,
      )
      return success(readValue(memory))
    } catch (error: unknown) {
      if (error instanceof ProjectMemoryUnknownWorkspaceError) {
        return workspaceMissing(error.workspaceId)
      }
      throw error
    }
  }

  /** Replace all six sections in one durable operation. */
  @Remote('replace')
  async replace(request: ProjectMemoryReplaceRequest): Promise<ProjectMemoryReadResult> {
    try {
      return success(readValue(await this.ctx.projectMemory.replace(request.workspaceId, request.sections)))
    } catch (error: unknown) {
      if (error instanceof ProjectMemoryUnknownWorkspaceError) {
        return workspaceMissing(error.workspaceId)
      }
      throw error
    }
  }

  /** Remove one known Workspace's Project Memory row idempotently. */
  @Remote('clear')
  async clear(request: ProjectMemoryClearRequest): Promise<ProjectMemoryClearResult> {
    if (this.ctx.workspaceRegistry.get(request.workspaceId) === undefined) {
      return workspaceMissing(request.workspaceId)
    }
    return success(Object.freeze({ cleared: await this.ctx.projectMemory.clear(request.workspaceId) }))
  }
}

export default ProjectMemoryRemoteService
