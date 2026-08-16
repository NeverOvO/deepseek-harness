// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import {
  ProjectMemoryController,
  type ProjectMemoryRemote,
} from '@deepseek-ai/dsh-client-runtime/client'
import { ProjectMemoryHeaderAction } from '../src/client/project-memory/ProjectMemoryHeaderAction.tsx'
import type {
  ProjectMemoryHeaderActionProps,
  ProjectMemoryWorkspace,
} from '../src/client/project-memory/slots.ts'
import { zh } from '../src/client/locales.ts'

const WORKSPACE_ID = 'workspace-consolidation-ui' as WorkspaceId
const BEFORE = 'Decision A preserves the current architecture.  \n\nDecision B preserves the reviewed release rule.\n'
const AFTER = 'Durable decisions: preserve the current architecture and reviewed release rule.'

function t(key: string, params?: Record<string, unknown>): string {
  const shared: Record<string, string> = { close: '关闭', cancel: '取消' }
  let value = (zh as Record<string, string>)[key] ?? shared[key] ?? key
  for (const [name, replacement] of Object.entries(params ?? {})) {
    value = value.replace(`{${name}}`, String(replacement))
  }
  return value
}

function consolidationController(): ProjectMemoryController {
  let sections = {
    architecture: '',
    commands: '',
    conventions: '',
    decisions: BEFORE,
    knownIssues: '',
    definitionOfDone: '',
  }
  let candidates = [{
    id: 'candidate-consolidation',
    workspaceId: WORKSPACE_ID,
    section: 'decisions',
    text: AFTER,
    source: 'automatic',
    sourceRef: 'consolidation:session-1',
    createdAt: '2026-08-16T00:00:01.000Z',
    reviewHint: 'supersedes',
    supersedesText: BEFORE,
    rationale: '[confidence: high] Compress durable decisions before further growth.',
    relation: 'supersedes',
  }]
  let updated = 0
  const memory = () => ({
    workspaceId: WORKSPACE_ID,
    sections: { ...sections },
    createdAt: '2026-08-16T00:00:00.000Z',
    updatedAt: `2026-08-16T00:00:0${updated}.000Z`,
  })
  const queue = () => ({ memory: memory(), candidates: [...candidates] })
  const remote = {
    get: async () => ({ ok: true, value: { ok: true, value: { memory: memory() } } }),
    setSection: async () => ({ ok: true, value: { ok: true, value: { memory: memory() } } }),
    replace: async () => ({ ok: true, value: { ok: true, value: { memory: memory() } } }),
    clear: async () => ({ ok: true, value: { ok: true, value: { cleared: true } } }),
    listCandidates: async () => ({ ok: true, value: { ok: true, value: queue() } }),
    proposeCandidate: async () => ({ ok: true, value: { ok: true, value: queue() } }),
    acceptCandidate: async () => {
      sections = { ...sections, decisions: AFTER }
      candidates = []
      updated += 1
      return { ok: true, value: { ok: true, value: queue() } }
    },
    rejectCandidate: async () => {
      candidates = []
      return { ok: true, value: { ok: true, value: queue() } }
    },
  } as unknown as ProjectMemoryRemote
  return new ProjectMemoryController(remote, WORKSPACE_ID)
}

function props(controller: ProjectMemoryController): ProjectMemoryHeaderActionProps {
  const workspace: ProjectMemoryWorkspace = {
    workspaceId: WORKSPACE_ID,
    title: 'Yanami Consolidation Test',
  }
  const useProjectWorkspace: ProjectMemoryHeaderActionProps['useProjectWorkspace'] = selector => selector(workspace)
  return {
    useProjectWorkspace,
    controllerFor: () => controller,
    t,
  } as unknown as ProjectMemoryHeaderActionProps
}

afterEach(() => { cleanup() })

describe('Project Memory consolidation review UI', () => {
  it('shows the complete before/after snapshot and only replaces it after explicit acceptance', async () => {
    const controller = consolidationController()
    render(<ProjectMemoryHeaderAction {...props(controller)} />)

    fireEvent.click(screen.getByRole('button', { name: '项目记忆' }))
    await screen.findByLabelText('决策')

    expect(screen.getByText('当前正式记忆快照（Before）')).toBeTruthy()
    expect(screen.getByText(BEFORE)).toBeTruthy()
    expect(screen.getByText('压缩后的候选结果（After）')).toBeTruthy()
    expect(screen.getByText(AFTER)).toBeTruthy()
    expect(screen.getByText('整理候选')).toBeTruthy()
    expect(screen.getByText('只有采纳才会替换正式记忆；采纳时 Host 会逐字重新校验 Before，期间有任何变化都会拒绝写入。')).toBeTruthy()
    expect((screen.getByLabelText('决策') as HTMLTextAreaElement).value).toBe(BEFORE)

    fireEvent.click(screen.getByRole('button', { name: '采纳' }))

    await waitFor(() => {
      expect((screen.getByLabelText('决策') as HTMLTextAreaElement).value).toBe(AFTER)
      expect(screen.queryByText('当前正式记忆快照（Before）')).toBeNull()
    })
  })
})
