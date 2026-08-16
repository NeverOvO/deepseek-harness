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

function memoryContextHarness(path = '/projects/one') {
  const ctx = new Context()
  const id = WorkspaceId(`workspace-${path.replaceAll('/', '-')}`)
  const workspace = { id, path, title: 'one', sessionIds: [] }
  const get = vi.fn((workspaceId: typeof id) => workspaceId === id ? memory(id) : undefined)
  ctx.provide('workspaceRegistry', {
    list: () => [workspace],
    resolveByPath: vi.fn(),
  } as never)
  ctx.provide('projectMemory', { get } as never)
  return { ctx, id, workspace, get }
}

describe('appendProjectMemoryContext', () => {
  it('appends the current workspace memory while preserving existing contexts', async () => {
    const { ctx } = memoryContextHarness()

    const result = await appendProjectMemoryContext(ctx, baseAssembly('/projects/one'), 'standard')
    expect(result.contexts).toEqual([
      { name: 'existing', text: 'existing context' },
      {
        name: 'yanami:project-memory',
        text: expect.stringContaining('## Architecture\nHost -> Runtime -> UI'),
      },
    ])
  })

  it('is context-only and preserves the upstream prompt, tool catalog, and model variables', async () => {
    const { ctx } = memoryContextHarness('/projects/upstream')

    const assembly = baseAssembly('/projects/upstream')
    assembly.sections.push({ name: 'upstream:persona', text: 'Original DSH system prompt' })
    assembly.tools.push({ name: 'upstream_tool' } as never)
    assembly.variables.model = 'deepseek-v4'
    const sections = assembly.sections
    const tools = assembly.tools
    const variables = assembly.variables

    const result = await appendProjectMemoryContext(ctx, assembly, 'standard')

    expect(result.sections).toBe(sections)
    expect(result.tools).toBe(tools)
    expect(result.variables).toBe(variables)
    expect(result.sections).toEqual([{ name: 'upstream:persona', text: 'Original DSH system prompt' }])
    expect(result.tools).toEqual([{ name: 'upstream_tool' }])
    expect(result.variables).toEqual({ cwd: '/projects/upstream', model: 'deepseek-v4' })
    expect(result.contexts.at(-1)?.name).toBe('yanami:project-memory')
  })

  it('returns the exact upstream assembly in Minimal without even reading Project Memory', async () => {
    const { ctx, get } = memoryContextHarness('/projects/minimal')
    const assembly = baseAssembly('/projects/minimal')
    assembly.sections.push({ name: 'upstream:minimal-persona', text: 'Exact upstream minimal prompt' })
    assembly.tools.push({ name: 'bash' } as never, { name: 'str_replace_editor' } as never)
    assembly.variables.model = 'deepseek-v4'

    await expect(appendProjectMemoryContext(ctx, assembly, 'minimal')).resolves.toBe(assembly)
    expect(get).not.toHaveBeenCalled()
    expect(assembly).toEqual({
      sections: [{ name: 'upstream:minimal-persona', text: 'Exact upstream minimal prompt' }],
      contexts: [{ name: 'existing', text: 'existing context' }],
      tools: [{ name: 'bash' }, { name: 'str_replace_editor' }],
      variables: { cwd: '/projects/minimal', model: 'deepseek-v4' },
    })
  })

  it('fails closed for a future upstream preset until Yanami explicitly maps it', async () => {
    const { ctx, get } = memoryContextHarness('/projects/future')
    const assembly = baseAssembly('/projects/future')

    await expect(appendProjectMemoryContext(ctx, assembly, 'future-dsh-preset')).resolves.toBe(assembly)
    expect(get).not.toHaveBeenCalled()
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

    const result = await appendProjectMemoryContext(ctx, baseAssembly('/alias/project'), 'standard')
    expect(resolveByPath).toHaveBeenCalledWith('/alias/project')
    expect(result.contexts.at(-1)?.name).toBe('yanami:project-memory')
  })

  it('leaves the assembly untouched without cwd, services, workspace, or memory', async () => {
    const emptyCtx = new Context()
    const noCwd = baseAssembly()
    await expect(appendProjectMemoryContext(emptyCtx, noCwd, 'standard')).resolves.toBe(noCwd)

    const ctx = new Context()
    ctx.provide('workspaceRegistry', {
      list: () => [],
      resolveByPath: async () => undefined,
    } as never)
    ctx.provide('projectMemory', { get: () => undefined } as never)
    const unmatched = baseAssembly('/missing')
    await expect(appendProjectMemoryContext(ctx, unmatched, 'standard')).resolves.toBe(unmatched)
  })
})
