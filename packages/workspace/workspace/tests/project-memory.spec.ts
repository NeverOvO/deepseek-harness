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
  renderProjectMemoryContext,
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

  it('persists pending candidates separately and never promotes them on restart', async () => {
    const pool = new MemoryMediaPool()
    const path = await makeDir('candidate-persistent')
    const first = await harness(pool)
    const workspace = await first.registry.create(path)
    await first.memory.proposeCandidate(
      workspace.id,
      'decisions',
      'Review before committing this decision.',
      'session',
      'session-1',
    )
    expect(first.memory.get(workspace.id)).toBeUndefined()
    expect(first.pool.media.get('project_memory_candidates')!.tables.get('candidates')!.size).toBe(1)
    await first.memoryFiber.dispose()
    await first.workspaceFiber.dispose()

    const second = await harness(pool)
    expect(second.memory.get(workspace.id)).toBeUndefined()
    expect(second.memory.candidates(workspace.id)).toMatchObject([{
      workspaceId: workspace.id,
      section: 'decisions',
      text: 'Review before committing this decision.',
      source: 'session',
      sourceRef: 'session-1',
      reviewHint: null,
      rationale: null,
      relation: 'new',
    }])

    await second.memoryFiber.dispose()
    await second.workspaceFiber.dispose()
  })

  it('deduplicates canonical pending text and classifies candidates against committed memory', async () => {
    const result = await harness()
    const workspace = await result.registry.create(await makeDir('relations'))
    await result.memory.setSection(
      workspace.id,
      'decisions',
      'WorkspaceId is the stable Project Memory key.\n\nKeep metadata outside repositories.',
    )

    const duplicate = await result.memory.proposeCandidate(
      workspace.id,
      'decisions',
      '  WorkspaceId is the stable Project Memory key.  ',
      'automatic',
      'session-1',
      'append',
      'Same durable key decision.',
    )
    expect(duplicate).toMatchObject({ relation: 'duplicate', reviewHint: 'append' })

    const samePending = await result.memory.proposeCandidate(
      workspace.id,
      'decisions',
      'WorkspaceId is the stable Project Memory key.',
      'automatic',
      'session-2',
      'conflict',
      'A later extraction must not duplicate the queue.',
    )
    expect(samePending.id).toBe(duplicate.id)
    expect(result.memory.candidates(workspace.id)).toHaveLength(1)

    const merge = await result.memory.proposeCandidate(
      workspace.id,
      'decisions',
      'Use Remote envelopes for Project Memory transport.',
      'automatic',
      'session-1',
      'append',
      'Additive transport decision.',
    )
    expect(merge.relation).toBe('merge')

    const conflict = await result.memory.proposeCandidate(
      workspace.id,
      'decisions',
      'Use project paths as the durable Project Memory key.',
      'automatic',
      'session-1',
      'conflict',
      'This contradicts the WorkspaceId decision.',
    )
    expect(conflict).toMatchObject({
      relation: 'conflict',
      reviewHint: 'conflict',
      rationale: 'This contradicts the WorkspaceId decision.',
    })

    const fresh = await result.memory.proposeCandidate(
      workspace.id,
      'commands',
      'pnpm run constraints',
      'manual',
      null,
    )
    expect(fresh.relation).toBe('new')

    await result.memoryFiber.dispose()
    await result.workspaceFiber.dispose()
  })

  it('accepting a duplicate clears review without duplicating committed text', async () => {
    const result = await harness()
    const workspace = await result.registry.create(await makeDir('duplicate-accept'))
    const original = 'pnpm run build\n\npnpm run constraints'
    await result.memory.setSection(workspace.id, 'commands', original)
    const candidate = await result.memory.proposeCandidate(
      workspace.id,
      'commands',
      ' pnpm run constraints ',
      'automatic',
      'session-1',
      'append',
      null,
    )
    expect(candidate.relation).toBe('duplicate')

    await result.memory.acceptCandidate(workspace.id, candidate.id)

    expect(result.memory.get(workspace.id)?.sections.commands).toBe(original)
    expect(result.memory.candidates(workspace.id)).toHaveLength(0)

    await result.memoryFiber.dispose()
    await result.workspaceFiber.dispose()
  })

  it('renders only populated sections in canonical model-context order', async () => {
    const result = await harness()
    const workspace = await result.registry.create(await makeDir('render'))
    const memory = await result.memory.replace(workspace.id, {
      ...result.memory.empty(),
      commands: 'pnpm run build',
      decisions: 'Keep Project Memory outside the repository.',
      definitionOfDone: 'All gates are green.',
    })
    expect(memory).toBeDefined()

    const rendered = renderProjectMemoryContext(memory!)
    expect(rendered).toContain('Yanami Project Memory')
    expect(rendered).toContain('## Commands\npnpm run build')
    expect(rendered).toContain('## Decisions\nKeep Project Memory outside the repository.')
    expect(rendered).toContain('## Definition of Done\nAll gates are green.')
    expect(rendered).not.toContain('## Architecture')
    expect(rendered.indexOf('## Commands')).toBeLessThan(rendered.indexOf('## Decisions'))
    expect(rendered.indexOf('## Decisions')).toBeLessThan(rendered.indexOf('## Definition of Done'))

    await result.memoryFiber.dispose()
    await result.workspaceFiber.dispose()
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

  it('cleans committed and pending sidecars when Workspace Core deletes their owner', async () => {
    const result = await harness()
    const workspace = await result.registry.create(await makeDir('delete-owner'))
    await result.memory.setSection(workspace.id, 'definitionOfDone', 'All gates green.')
    await result.memory.proposeCandidate(
      workspace.id,
      'knownIssues',
      'Candidate must disappear with its owner.',
      'manual',
      null,
    )
    expect(result.memory.get(workspace.id)).toBeDefined()
    expect(result.memory.candidates(workspace.id)).toHaveLength(1)

    await result.registry.delete(workspace.id)
    await vi.waitFor(() => {
      expect(result.memory.get(workspace.id)).toBeUndefined()
      expect(result.memory.candidates(workspace.id)).toHaveLength(0)
    })

    await result.memoryFiber.dispose()
    await result.workspaceFiber.dispose()
  })
})
