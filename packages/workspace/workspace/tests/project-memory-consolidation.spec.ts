import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import WorkspaceRegistry from '../src/index.ts'
import ProjectMemoryService from '../src/project-memory.ts'

async function harness() {
  const ctx = new Context()
  const pool = new MemoryMediaPool()
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
  return { ctx, workspaceFiber, memoryFiber, registry: ctx.workspaceRegistry, memory: ctx.projectMemory }
}

let base: string | undefined

async function makeDir(name: string): Promise<string> {
  base ??= await realpath(await mkdtemp(join(tmpdir(), 'dsh-project-memory-consolidation-')))
  const path = join(base, name)
  await mkdir(path, { recursive: true })
  return path
}

afterEach(async () => {
  if (base !== undefined) await rm(base, { recursive: true, force: true })
  base = undefined
})

describe('Project Memory consolidation acceptance', () => {
  it('treats the full committed section as an exact compare-and-swap snapshot', async () => {
    const result = await harness()
    const workspace = await result.registry.create(await makeDir('exact-cas'))
    const before = 'Decision A keeps two trailing spaces.  \n\nDecision B stays on its own line.\n'
    const after = 'Decision A and Decision B are the durable consolidated decisions.'
    await result.memory.setSection(workspace.id, 'decisions', before)

    const candidate = await result.memory.proposeCandidate(
      workspace.id,
      'decisions',
      after,
      'automatic',
      'consolidation:session-1',
      'supersedes',
      'Full-section consolidation candidate.',
      before,
    )
    expect(candidate).toMatchObject({
      relation: 'supersedes',
      text: after,
      supersedesText: before,
      sourceRef: 'consolidation:session-1',
    })

    const whitespaceChanged = before.replace('spaces.  ', 'spaces. ')
    await result.memory.setSection(workspace.id, 'decisions', whitespaceChanged)
    expect(result.memory.candidates(workspace.id).find(item => item.id === candidate.id)?.relation).toBe('conflict')
    await expect(result.memory.acceptCandidate(workspace.id, candidate.id)).rejects.toThrow(/cannot safely accept/)
    expect(result.memory.get(workspace.id)?.sections.decisions).toBe(whitespaceChanged)
    expect(result.memory.candidates(workspace.id).some(item => item.id === candidate.id)).toBe(true)

    await result.memory.setSection(workspace.id, 'decisions', before)
    await result.memory.acceptCandidate(workspace.id, candidate.id)
    expect(result.memory.get(workspace.id)?.sections.decisions).toBe(after)
    expect(result.memory.candidates(workspace.id)).toHaveLength(0)

    await result.memoryFiber.dispose()
    await result.workspaceFiber.dispose()
  })
})