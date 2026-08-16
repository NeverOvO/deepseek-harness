import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  harnessModeForAgentPreset,
  yanamiHarnessPolicyForAgentPreset,
} from '../src/harness-mode.ts'
import { internals } from '../src/project-memory-proposal.ts'

describe('DSH Harness mode compatibility', () => {
  it('maps the shipped preset ids to the official product modes', () => {
    expect(harnessModeForAgentPreset('standard')).toBe('standard')
    expect(harnessModeForAgentPreset('code')).toBe('ptc')
    expect(harnessModeForAgentPreset('minimal')).toBe('minimal')
    expect(harnessModeForAgentPreset('cordis')).toBe('creative')
  })

  it('keeps absent and custom presets backward-compatible with Standard behavior', () => {
    expect(harnessModeForAgentPreset(undefined)).toBe('standard')
    expect(harnessModeForAgentPreset(null)).toBe('standard')
    expect(harnessModeForAgentPreset('my-team-preset')).toBe('standard')

    expect(yanamiHarnessPolicyForAgentPreset('my-team-preset')).toMatchObject({
      mode: 'standard',
      projectMemoryProposalTool: true,
      projectMemoryProposalPrompt: true,
      projectMemoryTurnReview: true,
    })
  })

  it('adds no Project Memory model surface or per-turn model call in Minimal', () => {
    expect(yanamiHarnessPolicyForAgentPreset('minimal')).toEqual({
      mode: 'minimal',
      projectMemoryProposalTool: false,
      projectMemoryProposalPrompt: false,
      projectMemoryTurnReview: false,
    })

    for (const preset of ['standard', 'code', 'cordis'] as const) {
      expect(yanamiHarnessPolicyForAgentPreset(preset)).toMatchObject({
        projectMemoryProposalTool: true,
        projectMemoryProposalPrompt: true,
        projectMemoryTurnReview: true,
      })
    }
  })

  it('does not steer a Minimal turn at the automatic Project Memory review boundary', async () => {
    const ctx = new Context()
    ctx.provide('workspaceRegistry', {
      list: () => [{
        id: 'workspace-1',
        path: '/projects/one',
        sessionIds: ['session-minimal'],
      }],
    } as never)

    const steer = vi.fn()
    const agent = {
      id: 'session-minimal',
      session: {
        header: { cwd: '/projects/one', agentPreset: 'minimal' },
        events: [
          { type: 'turn/start', data: { turn: 1 } },
          { type: 'assistant/message', data: { turn: 1 } },
        ],
      },
      steer,
    } as never

    internals.installAutomaticReviewTrigger(ctx, new Map())
    await ctx.serial('agent/turn-stopping', {
      agent,
      turn: 1,
      signal: new AbortController().signal,
    } as never)

    expect(steer).not.toHaveBeenCalled()
  })

  it('preserves the existing automatic review behavior in Standard', async () => {
    const ctx = new Context()
    ctx.provide('workspaceRegistry', {
      list: () => [{
        id: 'workspace-1',
        path: '/projects/one',
        sessionIds: ['session-standard'],
      }],
    } as never)

    const steer = vi.fn()
    const agent = {
      id: 'session-standard',
      session: {
        header: { cwd: '/projects/one', agentPreset: 'standard' },
        events: [
          { type: 'turn/start', data: { turn: 1 } },
          { type: 'assistant/message', data: { turn: 1 } },
        ],
      },
      steer,
    } as never

    internals.installAutomaticReviewTrigger(ctx, new Map())
    await ctx.serial('agent/turn-stopping', {
      agent,
      turn: 1,
      signal: new AbortController().signal,
    } as never)

    expect(steer).toHaveBeenCalledTimes(1)
  })
})
