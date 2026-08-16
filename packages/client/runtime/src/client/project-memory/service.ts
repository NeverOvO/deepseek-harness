/**
 * Client-side Project Memory object layer. Host storage remains authoritative;
 * this service owns only per-Workspace observable caches and mutation ordering.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  ProjectMemoryCandidateQueueResult,
  ProjectMemoryCandidateSource,
  ProjectMemoryCandidateView,
  ProjectMemoryClearResult,
  ProjectMemoryReadResult,
  ProjectMemorySection,
  ProjectMemorySectionsView,
  ProjectMemoryView,
  WorkspaceId,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ObservableSnapshot, SnapshotStore } from '../contract/store.ts'
import { createSnapshotStore } from '../contract/store.ts'

/** Typed Remote subset required by the Project Memory client object layer. */
export interface ProjectMemoryRemote {
  get(request: { workspaceId: WorkspaceId }): Promise<RemoteResult<ProjectMemoryReadResult>>
  setSection(request: {
    workspaceId: WorkspaceId
    section: ProjectMemorySection
    text: string
  }): Promise<RemoteResult<ProjectMemoryReadResult>>
  replace(request: {
    workspaceId: WorkspaceId
    sections: ProjectMemorySectionsView
  }): Promise<RemoteResult<ProjectMemoryReadResult>>
  clear(request: { workspaceId: WorkspaceId }): Promise<RemoteResult<ProjectMemoryClearResult>>
  listCandidates(request: { workspaceId: WorkspaceId }): Promise<RemoteResult<ProjectMemoryCandidateQueueResult>>
  proposeCandidate(request: {
    workspaceId: WorkspaceId
    section: ProjectMemorySection
    text: string
    source: ProjectMemoryCandidateSource
    sourceRef: string | null
  }): Promise<RemoteResult<ProjectMemoryCandidateQueueResult>>
  acceptCandidate(request: {
    workspaceId: WorkspaceId
    candidateId: string
  }): Promise<RemoteResult<ProjectMemoryCandidateQueueResult>>
  rejectCandidate(request: {
    workspaceId: WorkspaceId
    candidateId: string
  }): Promise<RemoteResult<ProjectMemoryCandidateQueueResult>>
}

/** Lifecycle of one Workspace's client-side Project Memory cache. */
export type ProjectMemoryLoadState = 'cold' | 'loading' | 'ready' | 'error'

/** Immutable UI projection for one Workspace's committed Project Memory. */
export interface ProjectMemoryState {
  readonly state: ProjectMemoryLoadState
  readonly memory: ProjectMemoryView | null
  readonly error: string | null
}

/** Immutable UI projection for one Workspace's pending review queue. */
export interface ProjectMemoryCandidateState {
  readonly state: ProjectMemoryLoadState
  readonly candidates: readonly ProjectMemoryCandidateView[]
  readonly error: string | null
}

/** Settled action shape shared by reads and mutations. */
export type ProjectMemoryActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string; readonly message: string }

const OK: ProjectMemoryActionResult = Object.freeze({ ok: true })

function failure(code: string, message: string): ProjectMemoryActionResult {
  return Object.freeze({ ok: false, code, message })
}

function businessMessage(code: string): string {
  if (code === 'workspace-not-found') return 'this workspace is no longer registered'
  if (code === 'candidate-not-found') return 'this Project Memory candidate is no longer pending'
  if (code === 'candidate-conflict') {
    return 'this Project Memory candidate no longer has one safe acceptance target; review the current memory and try again'
  }
  return code
}

/**
 * Per-Workspace observable controller. Committed memory and pending candidate
 * queue use independent snapshots while every mutation shares one operation
 * tail, so accepting a candidate cannot race an editor save.
 */
export class ProjectMemoryController implements ObservableSnapshot<ProjectMemoryState> {
  private readonly store: SnapshotStore<ProjectMemoryState> = createSnapshotStore({
    state: 'cold',
    memory: null,
    error: null,
  })
  private readonly candidateStore: SnapshotStore<ProjectMemoryCandidateState> = createSnapshotStore({
    state: 'cold',
    candidates: Object.freeze([]),
    error: null,
  })
  private loadPromise: Promise<ProjectMemoryActionResult> | null = null
  private candidateLoadPromise: Promise<ProjectMemoryActionResult> | null = null
  private operationTail: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(
    private readonly remote: ProjectMemoryRemote,
    readonly workspaceId: WorkspaceId,
  ) {}

  getSnapshot = (): ProjectMemoryState => this.store.getSnapshot()
  subscribe = (listener: () => void): (() => void) => this.store.subscribe(listener)
  getCandidateSnapshot = (): ProjectMemoryCandidateState => this.candidateStore.getSnapshot()
  subscribeCandidates = (listener: () => void): (() => void) => this.candidateStore.subscribe(listener)

  /** Load committed memory once unless reconnect invalidated the cache. */
  ensure(): Promise<ProjectMemoryActionResult> {
    if (this.store.getSnapshot().state === 'ready') return Promise.resolve(OK)
    return this.refresh()
  }

  /** Load the candidate queue once unless reconnect invalidated it. */
  ensureCandidates(): Promise<ProjectMemoryActionResult> {
    if (this.candidateStore.getSnapshot().state === 'ready') return Promise.resolve(OK)
    return this.refreshCandidates()
  }

  /** Re-read Host-authoritative committed memory, collapsing concurrent loads. */
  refresh(): Promise<ProjectMemoryActionResult> {
    if (this.loadPromise !== null) return this.loadPromise
    if (this.disposed) return Promise.resolve(failure('disposed', 'Project Memory controller is disposed'))
    const current = this.store.getSnapshot()
    this.store.set({ state: 'loading', memory: current.memory, error: null })
    const pending = this.load()
    this.loadPromise = pending
    return pending.finally(() => { this.loadPromise = null })
  }

  /** Re-read the Host-authoritative pending candidate queue. */
  refreshCandidates(): Promise<ProjectMemoryActionResult> {
    if (this.candidateLoadPromise !== null) return this.candidateLoadPromise
    if (this.disposed) return Promise.resolve(failure('disposed', 'Project Memory controller is disposed'))
    const current = this.candidateStore.getSnapshot()
    this.candidateStore.set({ state: 'loading', candidates: current.candidates, error: null })
    const pending = this.loadCandidates()
    this.candidateLoadPromise = pending
    return pending.finally(() => { this.candidateLoadPromise = null })
  }

  /** Replace one canonical section after seeding current Host state. */
  setSection(section: ProjectMemorySection, text: string): Promise<ProjectMemoryActionResult> {
    return this.mutate(async () => this.commitRead(await this.remote.setSection({
      workspaceId: this.workspaceId,
      section,
      text,
    })))
  }

  /** Replace all six sections atomically on the Host. */
  replace(sections: ProjectMemorySectionsView): Promise<ProjectMemoryActionResult> {
    return this.mutate(async () => this.commitRead(await this.remote.replace({
      workspaceId: this.workspaceId,
      sections,
    })))
  }

  /** Remove the durable committed Project Memory row for this Workspace. */
  clear(): Promise<ProjectMemoryActionResult> {
    return this.mutate(async () => {
      const carried = await this.remote.clear({ workspaceId: this.workspaceId })
      if (!carried.ok) return failure(carried.error.code, carried.error.message)
      if (!carried.value.ok) {
        const code = carried.value.error.code
        return failure(code, businessMessage(code))
      }
      this.store.set({ state: 'ready', memory: null, error: null })
      return OK
    })
  }

  /** Stage a candidate for human review without changing committed memory. */
  proposeCandidate(
    section: ProjectMemorySection,
    text: string,
    source: ProjectMemoryCandidateSource = 'manual',
    sourceRef: string | null = null,
  ): Promise<ProjectMemoryActionResult> {
    return this.mutateCandidates(async () => this.commitCandidateQueue(await this.remote.proposeCandidate({
      workspaceId: this.workspaceId,
      section,
      text,
      source,
      sourceRef,
    })))
  }

  /** Accept one candidate into durable memory. */
  acceptCandidate(candidateId: string): Promise<ProjectMemoryActionResult> {
    return this.mutateCandidates(async () => this.commitCandidateQueue(await this.remote.acceptCandidate({
      workspaceId: this.workspaceId,
      candidateId,
    })))
  }

  /** Reject one candidate without touching durable memory. */
  rejectCandidate(candidateId: string): Promise<ProjectMemoryActionResult> {
    return this.mutateCandidates(async () => this.commitCandidateQueue(await this.remote.rejectCandidate({
      workspaceId: this.workspaceId,
      candidateId,
    })))
  }

  /** Mark all Host-derived snapshots stale after connection generation replacement. */
  invalidate(): void {
    if (this.disposed) return
    const current = this.store.getSnapshot()
    this.store.set({ state: 'cold', memory: current.memory, error: null })
    const candidates = this.candidateStore.getSnapshot()
    this.candidateStore.set({ state: 'cold', candidates: candidates.candidates, error: null })
  }

  dispose(): void {
    this.disposed = true
  }

  private async load(): Promise<ProjectMemoryActionResult> {
    try {
      return await this.commitRead(await this.remote.get({ workspaceId: this.workspaceId }))
    } catch (error) {
      if (this.disposed) return OK
      const message = error instanceof Error ? error.message : 'Project Memory load failed'
      const current = this.store.getSnapshot()
      this.store.set({ state: 'error', memory: current.memory, error: message })
      return failure('transport', message)
    }
  }

  private async loadCandidates(): Promise<ProjectMemoryActionResult> {
    try {
      return await this.commitCandidateQueue(await this.remote.listCandidates({ workspaceId: this.workspaceId }))
    } catch (error) {
      if (this.disposed) return OK
      const message = error instanceof Error ? error.message : 'Project Memory candidate load failed'
      const current = this.candidateStore.getSnapshot()
      this.candidateStore.set({ state: 'error', candidates: current.candidates, error: message })
      return failure('transport', message)
    }
  }

  private commitRead(carried: RemoteResult<ProjectMemoryReadResult>): ProjectMemoryActionResult {
    if (this.disposed) return OK
    if (!carried.ok) {
      const current = this.store.getSnapshot()
      this.store.set({ state: 'error', memory: current.memory, error: carried.error.message })
      return failure(carried.error.code, carried.error.message)
    }
    if (!carried.value.ok) {
      const code = carried.value.error.code
      const message = businessMessage(code)
      const current = this.store.getSnapshot()
      this.store.set({ state: 'error', memory: current.memory, error: message })
      return failure(code, message)
    }
    this.store.set({ state: 'ready', memory: carried.value.value.memory, error: null })
    return OK
  }

  private commitCandidateQueue(
    carried: RemoteResult<ProjectMemoryCandidateQueueResult>,
  ): ProjectMemoryActionResult {
    if (this.disposed) return OK
    if (!carried.ok) {
      const current = this.candidateStore.getSnapshot()
      this.candidateStore.set({ state: 'error', candidates: current.candidates, error: carried.error.message })
      return failure(carried.error.code, carried.error.message)
    }
    if (!carried.value.ok) {
      const code = carried.value.error.code
      const message = businessMessage(code)
      const current = this.candidateStore.getSnapshot()
      this.candidateStore.set({ state: 'error', candidates: current.candidates, error: message })
      return failure(code, message)
    }
    this.store.set({ state: 'ready', memory: carried.value.value.memory, error: null })
    this.candidateStore.set({
      state: 'ready',
      candidates: Object.freeze([...carried.value.value.candidates]),
      error: null,
    })
    return OK
  }

  private mutate(operation: () => Promise<ProjectMemoryActionResult>): Promise<ProjectMemoryActionResult> {
    const guarded = async (): Promise<ProjectMemoryActionResult> => {
      if (this.disposed) return failure('disposed', 'Project Memory controller is disposed')
      const seeded = await this.ensure()
      if (!seeded.ok) return seeded
      if (this.disposed) return failure('disposed', 'Project Memory controller is disposed')
      try {
        return await operation()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Project Memory mutation failed'
        return failure('transport', message)
      }
    }
    const result = this.operationTail.then(guarded, guarded)
    this.operationTail = result.then(() => undefined, () => undefined)
    return result
  }

  private mutateCandidates(operation: () => Promise<ProjectMemoryActionResult>): Promise<ProjectMemoryActionResult> {
    const guarded = async (): Promise<ProjectMemoryActionResult> => {
      if (this.disposed) return failure('disposed', 'Project Memory controller is disposed')
      const seeded = await this.ensureCandidates()
      if (!seeded.ok) return seeded
      if (this.disposed) return failure('disposed', 'Project Memory controller is disposed')
      try {
        return await operation()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Project Memory candidate mutation failed'
        return failure('transport', message)
      }
    }
    const result = this.operationTail.then(guarded, guarded)
    this.operationTail = result.then(() => undefined, () => undefined)
    return result
  }
}

/** Workspace-keyed Project Memory cache owner used by Workbench feature UI. */
export class ProjectMemoryRuntime {
  private readonly controllers = new Map<WorkspaceId, ProjectMemoryController>()

  constructor(ctx: Context, private readonly remote: ProjectMemoryRemote) {
    ctx.reflect.provide('projectMemories', this, undefined)
    ctx.on('connection/reset', () => { this.invalidateAll() })
  }

  /** Stable controller identity for one Workspace during this client runtime. */
  forWorkspace(workspaceId: WorkspaceId): ProjectMemoryController {
    let controller = this.controllers.get(workspaceId)
    if (controller === undefined) {
      controller = new ProjectMemoryController(this.remote, workspaceId)
      this.controllers.set(workspaceId, controller)
    }
    return controller
  }

  /** Invalidate all Host-derived snapshots after reconnect. */
  invalidateAll(): void {
    for (const controller of this.controllers.values()) controller.invalidate()
  }

  dispose(): void {
    for (const controller of this.controllers.values()) controller.dispose()
    this.controllers.clear()
  }
}