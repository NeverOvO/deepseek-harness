// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import {
  ProjectMemoryController, type ProjectMemoryRemote,
} from '@deepseek-ai/dsh-client-runtime/client'
import { ProjectMemoryHomeSurface } from '../src/client/project-memory/ProjectMemoryHomeSurface.tsx'
import { zh } from '../src/client/locales.ts'

const WORKSPACE_ID = 'workspace-home-memory' as WorkspaceId
const EMPTY = {
  architecture: '',
  commands: '',
  conventions: '',
  decisions: '',
  knownIssues: '',
  definitionOfDone: '',
}

function t(key: string, params?: Record<string, unknown>): string {
  const shared: Record<string, string> = { close: '关闭', cancel: '取消' }
  let value = (zh as Record<string, string>)[key] ?? shared[key] ?? key
  for (const [name, replacement] of Object.entries(params ?? {})) {
    value = value.replace(`{${name}}`, String(replacement))
  }
  return value
}

function memory(sections: typeof EMPTY | null) {
  return sections === null ? null : {
    workspaceId: WORKSPACE_ID,
    sections,
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:01.000Z',
  }
}

function readResult(sections: typeof EMPTY | null) {
  return {
    ok: true,
    value: { ok: true, value: { memory: memory(sections) } },
  }
}

function queueResult(sections: typeof EMPTY | null, count = 0) {
  const candidates = Array.from({ length: count }, (_, index) => ({
    id: `candidate-${index + 1}`,
    workspaceId: WORKSPACE_ID,
    section: 'decisions' as const,
    text: `candidate ${index + 1}`,
    source: 'manual' as const,
    sourceRef: null,
    createdAt: '2026-08-17T00:00:02.000Z',
    reviewHint: null,
    supersedesText: null,
    rationale: null,
    relation: 'new' as const,
  }))
  return {
    ok: true,
    value: { ok: true, value: { memory: memory(sections), candidates } },
  }
}

function controllerWith(remote: Record<string, unknown>): ProjectMemoryController {
  return new ProjectMemoryController(remote as unknown as ProjectMemoryRemote, WORKSPACE_ID)
}

afterEach(cleanup)

describe('ProjectMemoryHomeSurface', () => {
  it('shows loading while both durable memory streams are unresolved', async () => {
    const controller = controllerWith({
      get: () => new Promise(() => {}),
      listCandidates: () => new Promise(() => {}),
    })

    render(
      <ProjectMemoryHomeSurface
        workspaceId={WORKSPACE_ID}
        workspaceName="Yanami"
        controllerFor={() => controller}
        onBeforeOpen={vi.fn()}
        t={t}
      />,
    )

    expect(await screen.findByText('正在读取项目记忆…')).toBeTruthy()
  })

  it('summarizes populated sections and pending candidates, then opens the exact editor', async () => {
    const sections = {
      ...EMPTY,
      architecture: 'Host -> Runtime -> UI',
      decisions: 'Workspace memory stays durable.',
    }
    const controller = controllerWith({
      get: async () => readResult(sections),
      listCandidates: async () => queueResult(sections, 1),
    })
    const onBeforeOpen = vi.fn()

    render(
      <ProjectMemoryHomeSurface
        workspaceId={WORKSPACE_ID}
        workspaceName="Yanami"
        controllerFor={() => controller}
        onBeforeOpen={onBeforeOpen}
        t={t}
      />,
    )

    expect(await screen.findByText('项目记忆 2/6')).toBeTruthy()
    expect(screen.getByText('候选记忆 1')).toBeTruthy()
    expect(screen.getByText('架构')).toBeTruthy()
    expect(screen.getByText('决策')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '项目记忆' }))
    expect(onBeforeOpen).toHaveBeenCalledTimes(1)
    expect(await screen.findByLabelText('架构')).toBeTruthy()
  })

  it('surfaces a load error and retries both durable memory streams', async () => {
    let getCalls = 0
    let candidateCalls = 0
    const controller = controllerWith({
      get: async () => {
        getCalls += 1
        if (getCalls === 1) throw new Error('memory transport unavailable')
        return readResult(null)
      },
      listCandidates: async () => {
        candidateCalls += 1
        if (candidateCalls === 1) throw new Error('candidate transport unavailable')
        return queueResult(null)
      },
    })

    render(
      <ProjectMemoryHomeSurface
        workspaceId={WORKSPACE_ID}
        workspaceName="Yanami"
        controllerFor={() => controller}
        onBeforeOpen={vi.fn()}
        t={t}
      />,
    )

    await waitFor(() => {
      const messages = screen.getAllByRole('alert').map(node => node.textContent)
      expect(messages).toContain('memory transport unavailable')
    })
    fireEvent.click(screen.getByRole('button', { name: '重试' }))

    await waitFor(() => {
      expect(getCalls).toBe(2)
      expect(candidateCalls).toBe(2)
    })
    expect(await screen.findByText('项目记忆 0/6')).toBeTruthy()
    expect(screen.getByText('记录需要跨会话保留、并供后续任务参考的信息…')).toBeTruthy()
  })
})
