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
      events: [],
    } as unknown as Agent['session'],
  }
}

function command(commandId: string, args: string, kind: 'success' | 'error' = 'success') {
  return [
    { type: 'command/run', data: { commandId, name: 'mode', args, source: { kind: 'user' } } },
    { type: 'command/done', data: { commandId, kind } },
  ]
}

describe('Yanami mode host compatibility', () => {
  it('opts in only an explicitly resolved upstream Standard preset', () => {
    expect(yanamiModeEnabledForAgent(agentPreset())).toBe(false)
    expect(yanamiModeEnabledForAgent(agentPreset('standard'))).toBe(true)
    expect(yanamiModeEnabledForAgent(agentPreset('code'))).toBe(false)
    expect(yanamiModeEnabledForAgent(agentPreset('minimal'))).toBe(false)
    expect(yanamiModeEnabledForAgent(agentPreset('cordis'))).toBe(false)
    expect(yanamiModeEnabledForAgent(agentPreset('future-dsh-preset'))).toBe(false)
  })

  it('folds durable base mode only from successful DSH command lifecycle pairs', () => {
    const events = [
      ...command('c1', ' spec'),
      ...command('c2', 'plan'),
      ...command('c3', 'review'),
    ]
    expect(foldYanamiMode([])).toBe('do')
    expect(foldYanamiMode(events)).toBe('review')
    expect(foldYanamiMode(events, 2)).toBe('spec')
  })

  it('ignores failed, dangling, unrelated, and unknown mode commands', () => {
    expect(foldYanamiMode([
      ...command('c1', 'spec', 'error'),
      { type: 'command/run', data: { commandId: 'c2', name: 'mode', args: 'ship', source: { kind: 'user' } } },
      ...command('c3', 'minimal'),
      { type: 'command/run', data: { commandId: 'c4', name: 'compact', args: '', source: { kind: 'user' } } },
      { type: 'command/done', data: { commandId: 'c4', kind: 'success' } },
    ])).toBe('do')
  })

  it('requires no Yanami-specific durable SessionEvent vocabulary', () => {
    const events = [...command('c1', 'ship')]
    expect(events.some(event => event.type.startsWith('yanami/'))).toBe(false)
    expect(foldYanamiMode(events)).toBe('ship')
  })

  it('keeps Plan upstream-owned and completion evidence in the Yanami policy only', () => {
    expect(Object.keys(YANAMI_MODE_PROMPTS)).toEqual(['do', 'spec', 'review', 'ship'])
    expect(YANAMI_OPERATOR_PROMPT).toContain('evidence-based')
    expect(YANAMI_OPERATOR_PROMPT).toContain('irreversible')
  })
})
