import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { ProjectMemory } from '@deepseek-ai/dsh-workspace/project-memory'
import { appendProjectMemoryContext } from '../src/index.ts'

const baseAssembly = (cwd?: string): PromptAssembly => ({
  sections: [],
  contexts: [{ name: 'existing', text: 'existing context' }],
  tools: [],
  variables: cwd === undefined ? {} : { cwd },
})

function memory(workspaceId: ReturnType<typeof WorkspaceId>): ProjectMemory {
  return {
    workspaceId,
    sections: {
      architecture: 'Host -> Runtime -> UI',
      commands: '',
      conventions: '',
      decisions: 'Project Memory stays outside the repository.',
      knownIssues: '',
      definitionOfDone: '',
    },
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
  }
}

describe('appendProjectMemoryContext', () => {
  it('appends the current workspace memory while preserving existing contexts', async () => {
    const ctx = new Context()
    const id = WorkspaceId('workspace-1')
    const workspace = { id, path: '/projects/one', title: 'one', sessionIds: [] }
    ctx.provide('workspaceRegistry', {
      list: () => [workspace],
      resolveByPath: vi.fn(),
    } as never)
    ctx.provide('projectMemory', {
      get: (workspaceId: typeof id) => workspaceId === id ? memory(id) : undefined,
    } as never)

    const result = await appendProjectMemoryContext(ctx, baseAssembly('/projects/one'))
    expect(result.contexts).toEqual([
      { name: 'existing', text: 'existing context' },
      {
        name: 'yanami:project-memory',
        text: expect.stringContaining('## Architecture\nHost -> Runtime -> UI'),
      },
    ])
  })

  it('canonicalizes cwd only when the fast exact-path lookup misses', async () => {
    const ctx = new Context()
    const id = WorkspaceId('workspace-2')
    const workspace = { id, path: '/real/project', title: 'project', sessionIds: [] }
    const resolveByPath = vi.fn(async () => workspace)
    ctx.provide('workspaceRegistry', {
      list: () => [workspace],
      resolveByPath,
    } as never)
    ctx.provide('projectMemory', { get: () => memory(id) } as never)

    const result = await appendProjectMemoryContext(ctx, baseAssembly('/alias/project'))
    expect(resolveByPath).toHaveBeenCalledWith('/alias/project')
    expect(result.contexts.at(-1)?.name).toBe('yanami:project-memory')
  })

  it('leaves the assembly untouched without cwd, services, workspace, or memory', async () => {
    const emptyCtx = new Context()
    const noCwd = baseAssembly()
    await expect(appendProjectMemoryContext(emptyCtx, noCwd)).resolves.toBe(noCwd)

    const ctx = new Context()
    ctx.provide('workspaceRegistry', {
      list: () => [],
      resolveByPath: async () => undefined,
    } as never)
    ctx.provide('projectMemory', { get: () => undefined } as never)
    const unmatched = baseAssembly('/missing')
    await expect(appendProjectMemoryContext(ctx, unmatched)).resolves.toBe(unmatched)
  })
})
