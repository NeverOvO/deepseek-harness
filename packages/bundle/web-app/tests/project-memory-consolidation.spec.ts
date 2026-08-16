import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { internals } from '../src/project-memory-proposal.ts'

const WORKSPACE_ID = WorkspaceId('workspace-consolidation')
const durableArgs = {
  confidence: 'high' as const,
  durability: 'project-wide' as const,
}

function memoryWith(decisions: string) {
  return {
    workspaceId: WORKSPACE_ID,
    sections: {
      architecture: '',
      commands: '',
      conventions: '',
      decisions,
      knownIssues: '',
      definitionOfDone: '',
    },
    createdAt: '2026-08-16T00:00:00.000Z',
    updatedAt: '2026-08-16T00:00:00.000Z',
  }
}

describe('Project Memory consolidation proposal flow', () => {
  it('turns additive growth into a same-step consolidation request before model-visible truncation', async () => {
    const before = `Durable decisions:\n${'a'.repeat(3_760)}\n`
    const proposeCandidate = vi.fn()
    const ctx = new Context()
    ctx.provide('projectMemory', {
      get: () => memoryWith(before),
      candidates: () => [],
      proposeCandidate,
    } as never)
    const tool = internals.proposalTool(ctx, WORKSPACE_ID, 'session-1')

    await expect(tool.execute({
      section: 'decisions',
      text: `New durable decision ${'b'.repeat(300)}`,
      relationship: 'additive',
      ...durableArgs,
    }, {} as never)).resolves.toEqual({
      section: 'decisions',
      status: 'consolidation-required',
    })
    expect(proposeCandidate).not.toHaveBeenCalled()
    expect(internals.sectionIsFullyVisible(memoryWith(before) as never, 'decisions', before)).toBe(true)
  })

  it('stages a complete compressed section with the Host-captured exact before snapshot', async () => {
    const before = `Durable decisions:\n${'a'.repeat(3_760)}  \n`
    const after = `Consolidated durable decisions:\n${'c'.repeat(1_400)}`
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
      id: 'candidate-consolidation',
      workspaceId,
      section,
      text,
      source,
      sourceRef,
      reviewHint,
      supersedesText,
      rationale,
      relation: 'supersedes',
      createdAt: '2026-08-16T00:00:00.000Z',
    }))
    const ctx = new Context()
    ctx.provide('projectMemory', {
      get: () => memoryWith(before),
      candidates: () => [],
      proposeCandidate,
    } as never)
    const tool = internals.proposalTool(ctx, WORKSPACE_ID, 'session-1')

    await expect(tool.execute({
      section: 'decisions',
      text: after,
      relationship: 'consolidates',
      rationale: 'Compress the section before another durable decision is added.',
      ...durableArgs,
    }, {} as never)).resolves.toEqual({
      candidateId: 'candidate-consolidation',
      section: 'decisions',
      status: 'pending-review',
    })

    expect(proposeCandidate).toHaveBeenCalledWith(
      WORKSPACE_ID,
      'decisions',
      after,
      'automatic',
      'consolidation:session-1',
      'supersedes',
      '[confidence: high] Compress the section before another durable decision is added.',
      before,
    )
  })

  it('refuses automatic consolidation when the source section is already truncated', async () => {
    const before = `Durable decisions:\n${'a'.repeat(4_500)}`
    const proposeCandidate = vi.fn()
    const ctx = new Context()
    ctx.provide('projectMemory', {
      get: () => memoryWith(before),
      candidates: () => [],
      proposeCandidate,
    } as never)
    const tool = internals.proposalTool(ctx, WORKSPACE_ID, 'session-1')

    await expect(tool.execute({
      section: 'decisions',
      text: 'A compact replacement that would otherwise look valid.',
      relationship: 'consolidates',
      ...durableArgs,
    }, {} as never)).resolves.toEqual({
      section: 'decisions',
      status: 'skipped-consolidation-source-truncated',
    })
    expect(proposeCandidate).not.toHaveBeenCalled()
  })

  it('never lets the model supply the consolidation compare-and-swap snapshot', async () => {
    const before = `Durable decisions:\n${'a'.repeat(3_760)}`
    const ctx = new Context()
    ctx.provide('projectMemory', {
      get: () => memoryWith(before),
      candidates: () => [],
      proposeCandidate: vi.fn(),
    } as never)
    const tool = internals.proposalTool(ctx, WORKSPACE_ID, 'session-1')

    await expect(tool.execute({
      section: 'decisions',
      text: 'Compressed durable decisions.',
      relationship: 'consolidates',
      supersedesText: before,
      ...durableArgs,
    }, {} as never)).rejects.toThrow(/do not provide supersedesText/)
    expect(internals.reviewHintFor('consolidates')).toBe('supersedes')
    expect(internals.proposalPolicy).toContain('same model step')
    expect(internals.proposalPolicy).toContain('byte-exact compare-and-swap')
  })
})
