import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  foldYanamiMode,
  YANAMI_MODE_PROMPTS,
  YANAMI_OPERATOR_PROMPT,
} from '../src/yanami.ts'

function event(type: string, data: unknown): SessionEvent {
  return { type, data } as SessionEvent
}

describe('foldYanamiMode', () => {
  it('defaults to do when a session has no Yanami mode event', () => {
    expect(foldYanamiMode([])).toBe('do')
  })

  it('uses the last durable Yanami base mode', () => {
    const events = [
      event('yanami/mode', { mode: 'spec' }),
      event('turn/start', {}),
      event('yanami/mode', { mode: 'review' }),
    ]
    expect(foldYanamiMode(events)).toBe('review')
    expect(foldYanamiMode(events, 1)).toBe('spec')
  })

  it('ignores plan events because plan is an overlay owned by plan-mode', () => {
    const events = [
      event('yanami/mode', { mode: 'ship' }),
      event('plan/mode', { active: true }),
      event('plan/mode', { active: false }),
    ]
    expect(foldYanamiMode(events)).toBe('ship')
  })
})

describe('Yanami prompt contract', () => {
  it('keeps evidence-based completion in the stable operator layer', () => {
    expect(YANAMI_OPERATOR_PROMPT).toContain('evidence-based')
    expect(YANAMI_OPERATOR_PROMPT).toContain('irreversible')
  })

  it('keeps Plan out of the Yanami base policy map', () => {
    expect(Object.keys(YANAMI_MODE_PROMPTS)).toEqual(['do', 'spec', 'review', 'ship'])
  })
})
