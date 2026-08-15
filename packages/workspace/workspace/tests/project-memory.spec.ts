import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import WorkspaceRegistry, { WorkspaceId } from '../src/index.ts'
import ProjectMemoryService, {
  ProjectMemoryUnknownWorkspaceError,
} from '../src/project-memory.ts'

async function harness(pool = new MemoryMediaPool()) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  ctx.provide('sessionPersistence', {
    list: async () => [],
    load: () => { throw new Error('Project Memory tests do not load session bodies') },
    inspect: () => { throw new Error('Project Memory tests do not inspect session bodies') },
  } as never)

  const workspaceFiber = await ctx.plugin(WorkspaceRegistry)
  const memoryFiber = await ctx.plugin(ProjectMemoryService)
  return {
    ctx,
    pool,
    workspaceFiber,
    memoryFiber,
    registry: ctx.workspaceRegistry,
    memory: ctx.projectMemory,
  }
}

let base: string | undefined

async function makeDir(name: string): Promise<string> {
  base ??= await realpath(await mkdtemp(join(tmpdir(), 'dsh-project-memory-')))
  const path = join(base, name)
  await mkdir(path, { recursive: true })
  return path
}

afterEach(async () => {
  if (base !== undefined) await rm(base, { recursive: true, force: true })
  base = undefined
})

describe('ProjectMemoryService', () => {
  it('stores six-section memory in a dedicated workspace-id keyed domain', async () => {
    const result = await harness()
    const workspace = await result.registry.create(await makeDir('alpha'))

    const first = await result.memory.setSection(workspace.id, 'architecture', 'Host -> Runtime -> UI')
    const second = await result.memory.setSection(workspace.id, 'commands', 'pnpm run build')

    expect(first?.workspaceId).toBe(workspace.id)
    expect(second).toMatchObject({
      workspaceId: workspace.id,
      sections: {
        architecture: 'Host -> Runtime -> UI',
        commands: 'pnpm run build',
      },
    })
    expect(second?.createdAt).toBe(first?.createdAt)
    expect(result.pool.media.get('workspace')!.tables.has('project_memory')).toBe(false)
    expect(result.pool.media.get('project_memory')!.tables.get('memories')!.get(workspace.id))
      .toMatchObject({
        sections: {
          architecture: 'Host -> Runtime -> UI',
          commands: 'pnpm run build',
        },
      })

    await result.memoryFiber.dispose()
    await result.workspaceFiber.dispose()
  })

  it('survives service restart without writing into the workspace directory', async () => {
    const pool = new MemoryMediaPool()
    const path = await makeDir('persistent')
    const first = await harness(pool)
    const workspace = await first.registry.create(path)
    await first.memory.replace(workspace.id, {
      ...first.memory.empty(),
      conventions: 'Keep DSH metadata outside the repository.',
      decisions: 'WorkspaceId is the stable Project Memory key.',
    })
    await first.memoryFiber.dispose()
    await first.workspaceFiber.dispose()

    const second = await harness(pool)
    expect(second.registry.get(workspace.id)?.path).toBe(path)
    expect(second.memory.get(workspace.id)).toMatchObject({
      workspaceId: workspace.id,
      sections: {
        conventions: 'Keep DSH metadata outside the repository.',
        decisions: 'WorkspaceId is the stable Project Memory key.',
      },
    })

    await second.memoryFiber.dispose()
    await second.workspaceFiber.dispose()
  })

  it('rejects writes to unknown workspaces and deletes empty records', async () => {
    const result = await harness()
    await expect(result.memory.setSection(
      WorkspaceId('missing'),
      'knownIssues',
      'should never persist',
    )).rejects.toBeInstanceOf(ProjectMemoryUnknownWorkspaceError)

    const workspace = await result.registry.create(await makeDir('empty-delete'))
    await result.memory.setSection(workspace.id, 'knownIssues', 'one issue')
    expect(result.memory.get(workspace.id)).toBeDefined()
    await expect(result.memory.setSection(workspace.id, 'knownIssues', '   ')).resolves.toBeUndefined()
    expect(result.memory.get(workspace.id)).toBeUndefined()
    expect(result.pool.media.get('project_memory')!.tables.get('memories')!.size).toBe(0)

    await result.memoryFiber.dispose()
    await result.workspaceFiber.dispose()
  })

  it('cleans the sidecar row when Workspace Core deletes its owner', async () => {
    const result = await harness()
    const workspace = await result.registry.create(await makeDir('delete-owner'))
    await result.memory.setSection(workspace.id, 'definitionOfDone', 'All gates green.')
    expect(result.memory.get(workspace.id)).toBeDefined()

    await result.registry.delete(workspace.id)
    await vi.waitFor(() => {
      expect(result.memory.get(workspace.id)).toBeUndefined()
    })

    await result.memoryFiber.dispose()
    await result.workspaceFiber.dispose()
  })
})
