import { describe, expect, it } from 'vitest'
import type { SessionId, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import { recentWorkspaceSessions } from '../src/client/chat/recent-work.ts'

function row(
  id: string,
  updatedAt: number,
  overrides: Partial<SessionSummary> = {},
): SessionSummary {
  return {
    id: id as SessionId,
    displayTitle: `会话 ${id}`,
    running: false,
    blank: false,
    updatedAt,
    ...overrides,
  }
}

describe('recentWorkspaceSessions', () => {
  it('sorts durable workspace sessions by update time and excludes blank drafts', () => {
    const a = row('a', 10)
    const b = row('b', 30, { running: true })
    const draft = row('draft', 40, { blank: true })
    const c = row('c', 20, { completed: true })
    const byId = { a, b, draft, c } as unknown as Record<SessionId, SessionSummary>

    expect(recentWorkspaceSessions(
      ['a', 'draft', 'b', 'c'].map(id => id as SessionId),
      byId,
    )).toEqual([
      { id: 'b', title: '会话 b', status: 'running' },
      { id: 'c', title: '会话 c', status: 'completed' },
      { id: 'a', title: '会话 a', status: 'idle' },
    ])
  })

  it('prioritizes pending interaction over other status hints and respects the limit', () => {
    const attention = row('attention', 50, {
      running: true,
      pendingInteraction: 'approval',
    })
    const second = row('second', 40)
    const byId = { attention, second } as unknown as Record<SessionId, SessionSummary>

    expect(recentWorkspaceSessions(
      ['second', 'attention'].map(id => id as SessionId),
      byId,
      1,
    )).toEqual([
      { id: 'attention', title: '会话 attention', status: 'attention' },
    ])
  })
})
