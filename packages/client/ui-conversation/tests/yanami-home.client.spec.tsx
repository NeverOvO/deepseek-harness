// @vitest-environment jsdom
// Yanami Workbench landing surface: Mission is a direct view of the durable
// goal projection. Round usage is intentionally presented as budget usage,
// never as invented completion progress.

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { GoalPhase, GoalProjection } from '@deepseek-ai/dsh-goal/client'
import { YanamiHome } from '../src/client/chat/YanamiHome.tsx'

afterEach(cleanup)

function mission(
  phase: GoalPhase,
  overrides: Partial<GoalProjection['goal']> = {},
  roundsStarted = 2,
): GoalProjection {
  return {
    goal: {
      id: 'goal-test' as GoalProjection['goal']['id'],
      revision: 3,
      objective: '完成八奈见工作台 Mission Cockpit',
      phase,
      maxGoalRounds: 8,
      ...overrides,
    },
    roundsStarted,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000,
  }
}

describe('YanamiHome Mission cockpit', () => {
  it('shows an intentional loading state before the goal projection arrives', () => {
    const view = render(<YanamiHome activeMode="do" />)

    expect(view.getByText('载入中')).toBeTruthy()
    expect(view.getByText('正在载入任务状态…')).toBeTruthy()
    expect(view.getByText('正在连接任务上下文')).toBeTruthy()
    expect(view.queryByRole('progressbar')).toBeNull()
  })

  it('distinguishes a settled empty projection from loading', () => {
    const view = render(<YanamiHome mission={null} activeMode="do" />)

    expect(view.getByText('待创建')).toBeTruthy()
    expect(view.getByText(/还没有 Goal/)).toBeTruthy()
    expect(view.getByRole('progressbar', { name: 'Goal 执行轮次预算使用率' })
      .getAttribute('aria-valuenow')).toBe('0')
  })

  it('renders an active goal and labels round consumption as budget usage', () => {
    const view = render(<YanamiHome mission={mission('active')} activeMode="do" />)

    expect(view.getByText('进行中')).toBeTruthy()
    expect(view.getByText('完成八奈见工作台 Mission Cockpit')).toBeTruthy()
    expect(view.getByText('执行轮次 2 / 8 · 25% 预算已用')).toBeTruthy()
    expect(view.getByRole('progressbar', { name: 'Goal 执行轮次预算使用率' })
      .getAttribute('aria-valuenow')).toBe('25')
  })

  it('surfaces the durable block reason instead of hiding the blocker', () => {
    const blocked = mission('blocked', {
      blockedReason: {
        code: 'needs-credential',
        message: '需要发布凭证后才能继续。',
      },
    }, 4)
    const view = render(<YanamiHome mission={blocked} />)

    expect(view.getByText('已阻塞')).toBeTruthy()
    expect(view.getByText(/需要发布凭证后才能继续/)).toBeTruthy()
    expect(view.getByText('执行轮次 4 / 8 · 50% 预算已用')).toBeTruthy()
  })

  it('distinguishes paused goals from active work', () => {
    const view = render(<YanamiHome mission={mission('paused', {}, 3)} />)

    expect(view.getByText('已暂停')).toBeTruthy()
    expect(view.getByText('执行轮次 3 / 8 · 38% 预算已用')).toBeTruthy()
  })

  it('only reports one hundred percent when the goal is actually complete', () => {
    const view = render(<YanamiHome mission={mission('complete', {}, 5)} />)

    expect(view.getByText('已完成')).toBeTruthy()
    expect(view.getByText('已完成 · 共启动 5 轮')).toBeTruthy()
    expect(view.getByRole('progressbar', { name: '任务完成度' })
      .getAttribute('aria-valuenow')).toBe('100')
  })

  it('composes the Workspace-owned memory surface inside the Project Memory card', () => {
    const view = render(
      <YanamiHome projectMemory={<div data-testid="live-project-memory">实时项目记忆</div>} />,
    )
    const memoryCard = view.getByText('项目记忆').closest('article')
    const live = view.getByTestId('live-project-memory')

    expect(memoryCard?.contains(live)).toBe(true)
    expect(view.queryByText(/后续绑定 Workspace 级长期记忆/)).toBeNull()
  })

  it('keeps a structural Project Memory fallback when the Workspace slot is absent', () => {
    const view = render(<YanamiHome />)

    expect(view.getByText('Architecture')).toBeTruthy()
    expect(view.getByText(/后续绑定 Workspace 级长期记忆/)).toBeTruthy()
  })

  it('renders real recent-session summaries supplied by the Workspace projection', () => {
    const view = render(<YanamiHome recentSessions={[
      { id: 'review', title: '复核发布候选', status: 'attention' },
      { id: 'build', title: '修复桌面打包', status: 'running' },
      { id: 'memory', title: '项目记忆接入', status: 'completed' },
    ]} />)

    expect(view.getByText('复核发布候选')).toBeTruthy()
    expect(view.getByText('需要确认')).toBeTruthy()
    expect(view.getByText('修复桌面打包')).toBeTruthy()
    expect(view.getByText('项目记忆接入')).toBeTruthy()
    expect(view.getByText('按更新时间显示最近 3 个会话')).toBeTruthy()
  })

  it('shows a settled recent-work empty state for a selected Workspace', () => {
    const view = render(<YanamiHome recentSessions={[]} />)

    expect(view.getByText(/还没有可恢复的历史会话/)).toBeTruthy()
    expect(view.getByText('暂无历史工作')).toBeTruthy()
  })
})
