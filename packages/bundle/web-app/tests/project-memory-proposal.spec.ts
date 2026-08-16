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

const durableArgs = {
  confidence: 'high' as const,
  durability: 'project-wide' as const,
}

describe('Project Memory proposal safety boundary', () => {
  it('resolves only an already-registered Workspace by attachment or exact cwd', () => {
    const ctx = new Context()
    ctx.provide('workspaceRegistry', { list: () => [workspace] } as never)

    expect(internals.workspaceForSession(ctx, 'session-attached', undefined)?.id).toBe(WORKSPACE_ID)
    expect(internals.workspaceForSession(ctx, 'session-new', '/projects/one')?.id).toBe(WORKSPACE_ID)
    expect(internals.workspaceForSession(ctx, 'session-new', '/projects/other')).toBeUndefined()
  })

  it('classifies one lifecycle review per completed model turn and prioritizes mission completion', () => {
    const ordinary = {
      session: {
        events: [
          { type: 'turn/start', data: { turn: 1 } },
          { type: 'assistant/message', data: { turn: 1 } },
        ],
      },
    } as never
    expect(internals.automaticReviewSource(ordinary, 1)).toBe('session')

    const mission = {
      session: {
        events: [
          { type: 'turn/start', data: { turn: 2 } },
          { type: 'goal/change', data: { operation: 'complete' } },
          { type: 'assistant/message', data: { turn: 2 } },
        ],
      },
    } as never
    expect(internals.automaticReviewSource(mission, 2)).toBe('mission')

    const alreadyProposed = {
      session: {
        events: [
          { type: 'turn/start', data: { turn: 3 } },
          { type: 'assistant/message', data: { turn: 3 } },
          { type: 'tool/call', data: { turn: 3, name: PROJECT_MEMORY_PROPOSE_TOOL } },
        ],
      },
    } as never
    expect(internals.automaticReviewSource(alreadyProposed, 3)).toBeUndefined()

    const noModelOutput = {
      session: { events: [{ type: 'turn/start', data: { turn: 4 } }] },
    } as never
    expect(internals.automaticReviewSource(noModelOutput, 4)).toBeUndefined()

    const message = internals.automaticReviewMessage('mission') as unknown as {
      readonly role: string
      readonly content: readonly { readonly type: string; readonly text: string }[]
      readonly source: { readonly kind: string; readonly form: string; readonly summary: string }
    }
    expect(message.role).toBe('user')
    expect(message.source).toMatchObject({ kind: 'plugin', form: 'notice', summary: 'Project Memory mission review' })
    expect(message.content[0]?.text).toContain(PROJECT_MEMORY_PROPOSE_TOOL)
    expect(message.content[0]?.text).toContain('mission-completion')
    expect(message.content[0]?.text).toContain('at most two')
    expect(message.content[0]?.text).toContain('low confidence is discarded')
    expect(message.content[0]?.text).toContain('supersedesText')
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
      supersedesText: string | null,
    ) => ({
      id: 'candidate-1',
      workspaceId,
      section,
      text,
      source,
      sourceRef,
      reviewHint,
      supersedesText,
      rationale,
      relation: 'new',
      createdAt: '2026-08-15T00:00:00.000Z',
    }))
    const ctx = new Context()
    ctx.provide('projectMemory', {
      proposeCandidate,
      candidates: () => [],
      get: () => undefined,
    } as never)

    const tool = internals.proposalTool(ctx, WORKSPACE_ID, 'session-1')
    expect(tool.name).toBe(PROJECT_MEMORY_PROPOSE_TOOL)
    expect(Object.keys((tool.parameters as { properties: Record<string, unknown> }).properties).sort())
      .toEqual(['confidence', 'durability', 'rationale', 'relationship', 'section', 'supersedesText', 'text'])
    expect(JSON.stringify(tool.parameters)).not.toContain('workspaceId')
    expect(tool.description).toContain('human review')
    expect(tool.description).toContain('never commits or replaces Project Memory')
    expect(internals.proposalPolicy).toContain('NEW durable project-wide fact')
    expect(internals.proposalPolicy).toContain('low-confidence and task-local proposals')
    expect(internals.proposalPolicy).toContain('near-duplicate pending candidates')
    expect(internals.proposalPolicy).toContain('secrets, credentials, personal data')
    expect(internals.proposalPolicy).toContain('supersedesText')
    expect(internals.proposalPolicy).toContain('pending human review')
    expect(internals.reviewHintFor('additive')).toBe('append')
    expect(internals.reviewHintFor('supersedes')).toBe('supersedes')
    expect(internals.reviewHintFor('conflicts')).toBe('conflict')

    await expect(tool.execute({
      section: 'decisions',
      text: 'WorkspaceId is the durable project key.',
      relationship: 'supersedes',
      supersedesText: 'Project path is the durable project key.',
      confidence: 'high',
      durability: 'project-wide',
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
      '[confidence: high] This decision replaces an older path-key assumption.',
      'Project path is the durable project key.',
    )

    const missionTool = internals.proposalTool(ctx, WORKSPACE_ID, 'session-1', () => 'mission')
    await missionTool.execute({
      section: 'definitionOfDone',
      text: 'Mission acceptance requires a green full test run.',
      relationship: 'additive',
      confidence: 'medium',
      durability: 'project-wide',
    }, {} as never)
    expect(proposeCandidate).toHaveBeenLastCalledWith(
      WORKSPACE_ID,
      'definitionOfDone',
      'Mission acceptance requires a green full test run.',
      'mission',
      'session-1',
      'append',
      '[confidence: medium]',
      null,
    )
  })

  it('requires supersedesText only for supersede proposals', async () => {
    const proposeCandidate = vi.fn()
    const ctx = new Context()
    ctx.provide('projectMemory', {
      proposeCandidate,
      candidates: () => [],
      get: () => undefined,
    } as never)
    const tool = internals.proposalTool(ctx, WORKSPACE_ID, 'session-1')

    await expect(tool.execute({
      section: 'decisions',
      text: 'Use WorkspaceId as the durable key.',
      relationship: 'supersedes',
      ...durableArgs,
    }, {} as never)).rejects.toThrow(/require exact supersedesText/)

    await expect(tool.execute({
      section: 'decisions',
      text: 'Use WorkspaceId as the durable key.',
      relationship: 'additive',
      supersedesText: 'Use paths as the durable key.',
      ...durableArgs,
    }, {} as never)).rejects.toThrow(/only valid when relationship is supersedes/)

    expect(proposeCandidate).not.toHaveBeenCalled()
  })

  it('filters low-confidence, task-local, and status-only facts before persistence', async () => {
    const proposeCandidate = vi.fn()
    const ctx = new Context()
    ctx.provide('projectMemory', {
      proposeCandidate,
      candidates: () => [],
      get: () => undefined,
    } as never)
    const tool = internals.proposalTool(ctx, WORKSPACE_ID, 'session-1')

    await expect(tool.execute({
      section: 'decisions',
      text: 'Use WorkspaceId as the durable key.',
      relationship: 'additive',
      confidence: 'low',
      durability: 'project-wide',
    }, {} as never)).resolves.toEqual({
      section: 'decisions',
      status: 'skipped-low-confidence',
    })

    await expect(tool.execute({
      section: 'decisions',
      text: 'Use this temporary branch for today.',
      relationship: 'additive',
      confidence: 'high',
      durability: 'task-local',
    }, {} as never)).resolves.toEqual({
      section: 'decisions',
      status: 'skipped-task-local',
    })

    await expect(tool.execute({
      section: 'definitionOfDone',
      text: 'All tests passed.',
      relationship: 'additive',
      confidence: 'high',
      durability: 'project-wide',
    }, {} as never)).resolves.toEqual({
      section: 'definitionOfDone',
      status: 'skipped-low-signal',
    })

    expect(internals.isLowSignalCandidate('knownIssues', '任务完成')).toBe(true)
    expect(internals.isLowSignalCandidate('definitionOfDone', 'Release requires all gates green.')).toBe(false)
    expect(internals.isLowSignalCandidate('commands', 'pnpm run build')).toBe(false)
    expect(proposeCandidate).not.toHaveBeenCalled()
  })

  it('suppresses committed duplicates and clusters conservative near-duplicate pending candidates', async () => {
    const proposeCandidate = vi.fn()
    const committedCtx = new Context()
    committedCtx.provide('projectMemory', {
      proposeCandidate,
      candidates: () => [],
      get: () => ({
        sections: {
          architecture: '', commands: '', conventions: '',
          decisions: 'WorkspaceId is the durable project key.',
          knownIssues: '', definitionOfDone: '',
        },
      }),
    } as never)
    const committedTool = internals.proposalTool(committedCtx, WORKSPACE_ID, 'session-1')

    await expect(committedTool.execute({
      section: 'decisions',
      text: ' WorkspaceId is the durable project key. ',
      relationship: 'additive',
      ...durableArgs,
    }, {} as never)).resolves.toEqual({
      section: 'decisions',
      status: 'skipped-already-recorded',
    })

    const pending = [{
      id: 'candidate-existing',
      workspaceId: WORKSPACE_ID,
      section: 'decisions',
      text: 'WorkspaceId is the durable project key.',
      source: 'session',
      sourceRef: 'session-old',
      createdAt: '2026-08-15T00:00:00.000Z',
      reviewHint: 'append',
      supersedesText: null,
      rationale: null,
      relation: 'new',
    }]
    const pendingCtx = new Context()
    pendingCtx.provide('projectMemory', {
      proposeCandidate,
      candidates: () => pending,
      get: () => undefined,
    } as never)
    const pendingTool = internals.proposalTool(pendingCtx, WORKSPACE_ID, 'session-2')

    await expect(pendingTool.execute({
      section: 'decisions',
      text: 'WorkspaceId is the stable durable project key.',
      relationship: 'additive',
      ...durableArgs,
    }, {} as never)).resolves.toEqual({
      candidateId: 'candidate-existing',
      section: 'decisions',
      status: 'already-pending',
    })

    expect(internals.candidateSimilarity(
      'decisions',
      'WorkspaceId is the durable project key.',
      'WorkspaceId is the stable durable project key.',
    )).toBeGreaterThanOrEqual(0.9)
    expect(internals.candidateSimilarity('commands', 'pnpm run build', 'pnpm run build --filter web')).toBe(0)
    expect(proposeCandidate).not.toHaveBeenCalled()
  })

  it('stops automatic additive growth at section and review-queue budgets without blocking supersede review', async () => {
    const proposeCandidate = vi.fn(async (...args: unknown[]) => ({
      id: 'candidate-supersede',
      workspaceId: args[0],
      section: args[1],
      text: args[2],
      source: args[3],
      sourceRef: args[4],
      reviewHint: args[5],
      rationale: args[6],
      supersedesText: args[7],
      relation: 'supersedes',
      createdAt: '2026-08-15T00:00:00.000Z',
    }))
    const fullSectionCtx = new Context()
    fullSectionCtx.provide('projectMemory', {
      proposeCandidate,
      candidates: () => [],
      get: () => ({
        sections: {
          architecture: '', commands: '', conventions: '', decisions: `Old durable fact.\n${'x'.repeat(11_995)}`,
          knownIssues: '', definitionOfDone: '',
        },
      }),
    } as never)
    const fullSectionTool = internals.proposalTool(fullSectionCtx, WORKSPACE_ID, 'session-1')
    await expect(fullSectionTool.execute({
      section: 'decisions',
      text: 'Another durable decision.',
      relationship: 'additive',
      ...durableArgs,
    }, {} as never)).resolves.toEqual({
      section: 'decisions',
      status: 'skipped-section-full',
    })
    await expect(fullSectionTool.execute({
      section: 'decisions',
      text: 'New durable fact.',
      relationship: 'supersedes',
      supersedesText: 'Old durable fact.',
      ...durableArgs,
    }, {} as never)).resolves.toEqual({
      candidateId: 'candidate-supersede',
      section: 'decisions',
      status: 'pending-review',
    })

    const perSectionCtx = new Context()
    perSectionCtx.provide('projectMemory', {
      proposeCandidate,
      candidates: () => Array.from({ length: 24 }, (_, index) => ({
        id: `candidate-${String(index)}`,
        section: 'knownIssues',
        text: `Distinct pending issue ${String(index)}`,
        reviewHint: 'append',
      })),
      get: () => undefined,
    } as never)
    const perSectionTool = internals.proposalTool(perSectionCtx, WORKSPACE_ID, 'session-1')
    await expect(perSectionTool.execute({
      section: 'knownIssues',
      text: 'Windows desktop still needs verification.',
      relationship: 'additive',
      ...durableArgs,
    }, {} as never)).resolves.toEqual({
      section: 'knownIssues',
      status: 'skipped-queue-full',
    })

    const workspaceQueueCtx = new Context()
    workspaceQueueCtx.provide('projectMemory', {
      proposeCandidate,
      candidates: () => Array.from({ length: 100 }, (_, index) => ({
        id: `candidate-${String(index)}`,
        section: index % 2 === 0 ? 'architecture' : 'conventions',
        text: `Distinct pending fact ${String(index)}`,
        reviewHint: 'append',
      })),
      get: () => undefined,
    } as never)
    const workspaceQueueTool = internals.proposalTool(workspaceQueueCtx, WORKSPACE_ID, 'session-1')
    await expect(workspaceQueueTool.execute({
      section: 'knownIssues',
      text: 'Windows desktop still needs verification.',
      relationship: 'additive',
      ...durableArgs,
    }, {} as never)).resolves.toEqual({
      section: 'knownIssues',
      status: 'skipped-queue-full',
    })
  })

  it('rejects empty, oversized, and credential-bearing candidate text, target, or rationale before persistence', async () => {
    const proposeCandidate = vi.fn()
    const ctx = new Context()
    ctx.provide('projectMemory', {
      proposeCandidate,
      candidates: () => [],
      get: () => undefined,
    } as never)
    const tool = internals.proposalTool(ctx, WORKSPACE_ID, 'session-1')

    await expect(tool.execute({
      section: 'commands', text: '   ', relationship: 'additive', ...durableArgs,
    }, {} as never)).rejects.toThrow(/must not be empty/)
    await expect(tool.execute({
      section: 'commands', text: 'x'.repeat(8_001), relationship: 'additive', ...durableArgs,
    }, {} as never)).rejects.toThrow(/exceeds 8000 characters/)
    await expect(tool.execute({
      section: 'commands', text: 'pnpm run build', relationship: 'supersedes', supersedesText: 'x'.repeat(8_001), ...durableArgs,
    }, {} as never)).rejects.toThrow(/supersedesText exceeds 8000 characters/)
    await expect(tool.execute({
      section: 'commands', text: 'pnpm run build', relationship: 'additive', rationale: 'x'.repeat(2_001), ...durableArgs,
    }, {} as never)).rejects.toThrow(/rationale exceeds 2000 characters/)
    await expect(tool.execute({
      section: 'commands', text: 'pnpm run build', relationship: 'additive', rationale: 'x'.repeat(1_990), ...durableArgs,
    }, {} as never)).rejects.toThrow(/after confidence metadata/)
    await expect(tool.execute({
      section: 'commands', text: 'API_KEY=sk-proj-abcdefghijklmnopqrstuv', relationship: 'additive', ...durableArgs,
    }, {} as never)).rejects.toThrow(/credential or secret/)
    await expect(tool.execute({
      section: 'commands', text: 'pnpm run build', relationship: 'supersedes', supersedesText: 'token: abcdefghijklmnop', ...durableArgs,
    }, {} as never)).rejects.toThrow(/credential or secret/)
    await expect(tool.execute({
      section: 'commands', text: 'pnpm run build', relationship: 'additive', rationale: 'token: abcdefghijklmnop', ...durableArgs,
    }, {} as never)).rejects.toThrow(/credential or secret/)
    expect(internals.containsSensitiveText('token: abcdefghijklmnop')).toBe(true)
    expect(internals.containsSensitiveText('Run pnpm run constraints after code changes.')).toBe(false)
    expect(internals.auditRationale('high', null)).toBe('[confidence: high]')
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
        supersedesText: null,
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