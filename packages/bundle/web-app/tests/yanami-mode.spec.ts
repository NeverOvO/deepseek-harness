import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  foldYanamiMode,
  YANAMI_MODE_PROMPTS,
  YANAMI_OPERATOR_PROMPT,
  yanamiModeEnabledForAgent,
} from '../src/yanami-mode.ts'

function agentPreset(agentPreset?: string): Pick<Agent, 'session'> {
  return {
    session: {
      header: agentPreset === undefined ? {} : { agentPreset },
    } as Agent['session'],
  }
}

describe('Yanami mode host compatibility', () => {
  it('opts in only the upstream Standard preset', () => {
    expect(yanamiModeEnabledForAgent(agentPreset())).toBe(true)
    expect(yanamiModeEnabledForAgent(agentPreset('standard'))).toBe(true)
    expect(yanamiModeEnabledForAgent(agentPreset('code'))).toBe(false)
    expect(yanamiModeEnabledForAgent(agentPreset('minimal'))).toBe(false)
    expect(yanamiModeEnabledForAgent(agentPreset('cordis'))).toBe(false)
    expect(yanamiModeEnabledForAgent(agentPreset('future-dsh-preset'))).toBe(false)
  })

  it('folds only durable Yanami base-mode events', () => {
    const events = [
      { type: 'yanami/mode', data: { mode: 'spec' } },
      { type: 'plan/mode', data: { active: true } },
      { type: 'yanami/mode', data: { mode: 'review' } },
    ]
    expect(foldYanamiMode([])).toBe('do')
    expect(foldYanamiMode(events)).toBe('review')
    expect(foldYanamiMode(events, 1)).toBe('spec')
  })

  it('ignores malformed or unknown mode records instead of widening the contract', () => {
    expect(foldYanamiMode([
      { type: 'yanami/mode', data: { mode: 'minimal' } },
      { type: 'yanami/mode', data: { mode: 42 } },
    ])).toBe('do')
  })

  it('keeps Plan upstream-owned and completion evidence in the Yanami policy only', () => {
    expect(Object.keys(YANAMI_MODE_PROMPTS)).toEqual(['do', 'spec', 'review', 'ship'])
    expect(YANAMI_OPERATOR_PROMPT).toContain('evidence-based')
    expect(YANAMI_OPERATOR_PROMPT).toContain('irreversible')
  })
})
