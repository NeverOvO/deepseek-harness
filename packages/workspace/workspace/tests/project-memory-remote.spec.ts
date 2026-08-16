import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import WorkspaceRegistry, { WorkspaceId } from '../src/index.ts'
import ProjectMemoryService from '../src/project-memory.ts'

async function harness() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  ctx.provide('sessionPersistence', { list: async () => [] } as never)
  const workspaceFiber = await ctx.plugin(WorkspaceRegistry)
  const memoryFiber = await ctx.plugin(ProjectMemoryService)
  return { ctx, workspaceFiber, memoryFiber }
}

let base: string | undefined

async function makeDir(name: string): Promise<string> {
  base ??= await realpath(await mkdtemp(join(tmpdir(), 'dsh-project-memory-remote-')))
  const path = join(base, name)
  await mkdir(path, { recursive: true })
  return path
}

afterEach(async () => {
  if (base !== undefined) await rm(base, { recursive: true, force: true })
  base = undefined
})

describe('ProjectMemoryService Remote surface', () => {
  it('reads, mutates, replaces, and clears through stable WorkspaceId requests', async () => {
    const result = await harness()
    const workspace = await result.ctx.workspaceRegistry.create(await makeDir('remote'))

    await expect(result.ctx.projectMemory.remoteGet({ workspaceId: workspace.id })).resolves.toEqual({
      ok: true,
      value: { memory: null },
    })

    const first = await result.ctx.projectMemory.remoteSetSection({
      workspaceId: workspace.id,
      section: 'architecture',
      text: 'Host -> Runtime -> UI',
    })
    expect(first).toMatchObject({
      ok: true,
      value: {
        memory: {
          workspaceId: workspace.id,
          sections: { architecture: 'Host -> Runtime -> UI' },
        },
      },
    })

    const replaced = await result.ctx.projectMemory.remoteReplace({
      workspaceId: workspace.id,
      sections: {
        architecture: 'Host -> Runtime -> UI',
        commands: 'pnpm run build',
        conventions: '',
        decisions: 'WorkspaceId is stable.',
        knownIssues: '',
        definitionOfDone: 'All gates green.',
      },
    })
    expect(replaced).toMatchObject({
      ok: true,
      value: {
        memory: {
          sections: {
            commands: 'pnpm run build',
            decisions: 'WorkspaceId is stable.',
            definitionOfDone: 'All gates green.',
          },
        },
      },
    })

    await expect(result.ctx.projectMemory.remoteClear({ workspaceId: workspace.id })).resolves.toEqual({
      ok: true,
      value: { cleared: true },
    })
    await expect(result.ctx.projectMemory.remoteGet({ workspaceId: workspace.id })).resolves.toEqual({
      ok: true,
      value: { memory: null },
    })

    await result.memoryFiber.dispose()
    await result.workspaceFiber.dispose()
  })

  it('stages candidates outside committed context and reviews them explicitly', async () => {
    const result = await harness()
    const workspace = await result.ctx.workspaceRegistry.create(await makeDir('review'))

    const proposed = await result.ctx.projectMemory.remoteProposeCandidate({
      workspaceId: workspace.id,
      section: 'commands',
      text: 'pnpm run constraints',
      source: 'manual',
      sourceRef: null,
    })
    expect(proposed).toMatchObject({
      ok: true,
      value: {
        memory: null,
        candidates: [{
          workspaceId: workspace.id,
          section: 'commands',
          text: 'pnpm run constraints',
          source: 'manual',
          supersedesText: null,
        }],
      },
    })
    if (!proposed.ok) throw new Error('candidate proposal failed')
    const candidateId = proposed.value.candidates[0]?.id
    if (candidateId === undefined) throw new Error('candidate id missing')

    await expect(result.ctx.projectMemory.remoteGet({ workspaceId: workspace.id })).resolves.toEqual({
      ok: true,
      value: { memory: null },
    })

    const accepted = await result.ctx.projectMemory.remoteAcceptCandidate({
      workspaceId: workspace.id,
      candidateId,
    })
    expect(accepted).toMatchObject({
      ok: true,
      value: {
        memory: { sections: { commands: 'pnpm run constraints' } },
        candidates: [],
      },
    })

    const second = await result.ctx.projectMemory.remoteProposeCandidate({
      workspaceId: workspace.id,
      section: 'knownIssues',
      text: 'Windows Desktop not verified',
      source: 'session',
      sourceRef: 'session-1',
    })
    if (!second.ok) throw new Error('second candidate proposal failed')
    const secondId = second.value.candidates[0]?.id
    if (secondId === undefined) throw new Error('second candidate id missing')

    const rejected = await result.ctx.projectMemory.remoteRejectCandidate({
      workspaceId: workspace.id,
      candidateId: secondId,
    })
    expect(rejected).toMatchObject({
      ok: true,
      value: {
        memory: { sections: { commands: 'pnpm run constraints' } },
        candidates: [],
      },
    })

    await result.memoryFiber.dispose()
    await result.workspaceFiber.dispose()
  })

  it('returns candidate-conflict and preserves the queue when safe acceptance becomes stale', async () => {
    const result = await harness()
    const workspace = await result.ctx.workspaceRegistry.create(await makeDir('conflict'))
    await result.ctx.projectMemory.setSection(workspace.id, 'decisions', 'Use paths as the durable key.')

    const proposed = await result.ctx.projectMemory.remoteProposeCandidate({
      workspaceId: workspace.id,
      section: 'decisions',
      text: 'Use WorkspaceId as the durable key.',
      source: 'automatic',
      sourceRef: 'session-1',
      reviewHint: 'supersedes',
      supersedesText: 'Use paths as the durable key.',
      rationale: 'The durable key changed.',
    })
    if (!proposed.ok) throw new Error('supersede proposal failed')
    const candidateId = proposed.value.candidates[0]?.id
    if (candidateId === undefined) throw new Error('candidate id missing')
    expect(proposed.value.candidates[0]).toMatchObject({
      relation: 'supersedes',
      supersedesText: 'Use paths as the durable key.',
    })

    await result.ctx.projectMemory.setSection(workspace.id, 'decisions', 'Use canonical WorkspaceId values.')
    await expect(result.ctx.projectMemory.remoteAcceptCandidate({
      workspaceId: workspace.id,
      candidateId,
    })).resolves.toEqual({
      ok: false,
      error: {
        code: 'candidate-conflict',
        workspaceId: workspace.id,
        candidateId,
      },
    })
    expect(result.ctx.projectMemory.get(workspace.id)?.sections.decisions).toBe('Use canonical WorkspaceId values.')
    expect(result.ctx.projectMemory.candidates(workspace.id)).toMatchObject([{
      id: candidateId,
      relation: 'conflict',
    }])

    await result.memoryFiber.dispose()
    await result.workspaceFiber.dispose()
  })

  it('keeps unknown Workspace and candidate ids inside business failure unions', async () => {
    const result = await harness()
    const workspaceId = WorkspaceId('missing')

    await expect(result.ctx.projectMemory.remoteGet({ workspaceId })).resolves.toEqual({
      ok: false,
      error: { code: 'workspace-not-found', workspaceId },
    })
    await expect(result.ctx.projectMemory.remoteSetSection({
      workspaceId,
      section: 'knownIssues',
      text: 'must not persist',
    })).resolves.toEqual({
      ok: false,
      error: { code: 'workspace-not-found', workspaceId },
    })
    await expect(result.ctx.projectMemory.remoteClear({ workspaceId })).resolves.toEqual({
      ok: false,
      error: { code: 'workspace-not-found', workspaceId },
    })
    await expect(result.ctx.projectMemory.remoteListCandidates({ workspaceId })).resolves.toEqual({
      ok: false,
      error: { code: 'workspace-not-found', workspaceId },
    })

    const workspace = await result.ctx.workspaceRegistry.create(await makeDir('candidate-missing'))
    await expect(result.ctx.projectMemory.remoteAcceptCandidate({
      workspaceId: workspace.id,
      candidateId: 'missing-candidate',
    })).resolves.toEqual({
      ok: false,
      error: {
        code: 'candidate-not-found',
        workspaceId: workspace.id,
        candidateId: 'missing-candidate',
      },
    })

    await result.memoryFiber.dispose()
    await result.workspaceFiber.dispose()
  })
})