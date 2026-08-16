import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { internals, PROJECT_MEMORY_PROPOSE_TOOL } from '../src/project-memory-proposal.ts'

const WORKSPACE_ID = WorkspaceId('workspace-1')
const workspace = {
  id: WORKSPACE_ID,
  path: '/projects/one',
  title: 'one',
  sessionIds: ['session-attached'],
  status: 'active',
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
}

describe('Project Memory proposal safety boundary', () => {
  it('resolves only an already-registered Workspace by attachment or exact cwd', () => {
    const ctx = new Context()
    ctx.provide('workspaceRegistry', { list: () => [workspace] } as never)

    expect(internals.workspaceForSession(ctx, 'session-attached', undefined)?.id).toBe(WORKSPACE_ID)
    expect(internals.workspaceForSession(ctx, 'session-new', '/projects/one')?.id).toBe(WORKSPACE_ID)
    expect(internals.workspaceForSession(ctx, 'session-new', '/projects/other')).toBeUndefined()
  })

  it('does not expose workspace identity or commit operations to the model', async () => {
    const proposeCandidate = vi.fn(async (
      workspaceId: typeof WORKSPACE_ID,
      section: string,
      text: string,
      source: string,
      sourceRef: string,
      reviewHint: string,
      rationale: string | null,
    ) => ({
      id: 'candidate-1',
      workspaceId,
      section,
      text,
      source,
      sourceRef,
      reviewHint,
      rationale,
      relation: 'new',
      createdAt: '2026-08-15T00:00:00.000Z',
    }))
    const ctx = new Context()
    ctx.provide('projectMemory', { proposeCandidate, candidates: () => [] } as never)

    const tool = internals.proposalTool(ctx, WORKSPACE_ID, 'session-1')
    expect(tool.name).toBe(PROJECT_MEMORY_PROPOSE_TOOL)
    expect(Object.keys((tool.parameters as { properties: Record<string, unknown> }).properties).sort())
      .toEqual(['rationale', 'relationship', 'section', 'text'])
    expect(JSON.stringify(tool.parameters)).not.toContain('workspaceId')
    expect(tool.description).toContain('human review')
    expect(tool.description).toContain('never commits or replaces Project Memory')
    expect(internals.proposalPolicy).toContain('NEW durable project-wide fact')
    expect(internals.proposalPolicy).toContain('advisory review hint')
    expect(internals.proposalPolicy).toContain('secrets, credentials, personal data')
    expect(internals.proposalPolicy).toContain('pending human review')
    expect(internals.reviewHintFor('additive')).toBe('append')
    expect(internals.reviewHintFor('supersedes')).toBe('supersedes')
    expect(internals.reviewHintFor('conflicts')).toBe('conflict')

    await expect(tool.execute({
      section: 'decisions',
      text: 'WorkspaceId is the durable project key.',
      relationship: 'supersedes',
      rationale: 'This decision replaces an older path-key assumption.',
    }, {} as never)).resolves.toEqual({
      candidateId: 'candidate-1',
      section: 'decisions',
      status: 'pending-review',
    })
    expect(proposeCandidate).toHaveBeenCalledWith(
      WORKSPACE_ID,
      'decisions',
      'WorkspaceId is the durable project key.',
      'automatic',
      'session-1',
      'supersedes',
      'This decision replaces an older path-key assumption.',
    )
  })

  it('rejects empty, oversized, and credential-bearing candidate text or rationale before persistence', async () => {
    const proposeCandidate = vi.fn()
    const ctx = new Context()
    ctx.provide('projectMemory', { proposeCandidate, candidates: () => [] } as never)
    const tool = internals.proposalTool(ctx, WORKSPACE_ID, 'session-1')

    await expect(tool.execute({ section: 'commands', text: '   ', relationship: 'additive' }, {} as never))
      .rejects.toThrow(/must not be empty/)
    await expect(tool.execute({
      section: 'commands', text: 'x'.repeat(8_001), relationship: 'additive',
    }, {} as never)).rejects.toThrow(/exceeds 8000 characters/)
    await expect(tool.execute({
      section: 'commands', text: 'pnpm run build', relationship: 'additive', rationale: 'x'.repeat(2_001),
    }, {} as never)).rejects.toThrow(/rationale exceeds 2000 characters/)
    await expect(tool.execute({
      section: 'commands', text: 'API_KEY=sk-proj-abcdefghijklmnopqrstuv', relationship: 'additive',
    }, {} as never)).rejects.toThrow(/credential or secret/)
    await expect(tool.execute({
      section: 'commands', text: 'pnpm run build', relationship: 'additive', rationale: 'token: abcdefghijklmnop',
    }, {} as never)).rejects.toThrow(/credential or secret/)
    expect(internals.containsSensitiveText('token: abcdefghijklmnop')).toBe(true)
    expect(internals.containsSensitiveText('Run pnpm run constraints after code changes.')).toBe(false)
    expect(proposeCandidate).not.toHaveBeenCalled()
  })

  it('caps automatic pending candidates per Workspace', async () => {
    const proposeCandidate = vi.fn()
    const ctx = new Context()
    ctx.provide('projectMemory', {
      proposeCandidate,
      candidates: () => Array.from({ length: 100 }, (_, index) => ({ id: `candidate-${String(index)}` })),
    } as never)
    const tool = internals.proposalTool(ctx, WORKSPACE_ID, 'session-1')

    await expect(tool.execute({
      section: 'knownIssues',
      text: 'Windows desktop still needs verification.',
      relationship: 'additive',
    }, {} as never)).rejects.toThrow(/100 candidates pending review/)
    expect(proposeCandidate).not.toHaveBeenCalled()
  })

  it('forwards candidate puts and deletes to the owning Workspace, including persisted rows', () => {
    const ctx = new Context()
    ctx.provide('workspaceRegistry', { list: () => [workspace] } as never)
    ctx.provide('projectMemory', {
      candidates: () => [{
        id: 'persisted-candidate',
        workspaceId: WORKSPACE_ID,
        section: 'decisions',
        text: 'persisted',
        source: 'session',
        sourceRef: 'session-old',
        reviewHint: null,
        rationale: null,
        relation: 'new',
        createdAt: '2026-08-15T00:00:00.000Z',
      }],
    } as never)

    const changed: string[] = []
    ctx.on('project-memory/candidates-changed', workspaceId => { changed.push(workspaceId) })
    internals.installCandidateChangeBridge(ctx)

    ctx.emit('domain/changed', {
      domain: 'project_memory_candidates',
      table: 'candidates',
      key: 'new-candidate',
      operation: 'put',
      value: { workspaceId: WORKSPACE_ID },
    })
    ctx.emit('domain/changed', {
      domain: 'project_memory_candidates',
      table: 'candidates',
      key: 'new-candidate',
      operation: 'deleted',
    })
    ctx.emit('domain/changed', {
      domain: 'project_memory_candidates',
      table: 'candidates',
      key: 'persisted-candidate',
      operation: 'deleted',
    })

    expect(changed).toEqual([WORKSPACE_ID, WORKSPACE_ID, WORKSPACE_ID])
  })
})
