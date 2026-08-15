// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import {
  ProjectMemoryController,
  type ProjectMemoryRemote,
} from '@deepseek-ai/dsh-client-runtime/client'
import { ProjectMemoryHeaderAction } from '../src/client/project-memory/ProjectMemoryHeaderAction.tsx'
import type {
  ProjectMemoryHeaderActionProps, ProjectMemoryWorkspace,
} from '../src/client/project-memory/slots.ts'
import { zh } from '../src/client/locales.ts'

const WORKSPACE_ID = 'workspace-1' as WorkspaceId
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

function fakeController() {
  const replaces: unknown[] = []
  const candidateCalls: string[] = []
  let sections = { ...EMPTY }
  let updated = 0
  let candidates: Array<{
    id: string
    workspaceId: WorkspaceId
    section: keyof typeof EMPTY
    text: string
    source: 'manual'
    sourceRef: null
    createdAt: string
  }> = []
  const memory = () => Object.values(sections).every(value => value === '') ? null : {
    workspaceId: WORKSPACE_ID,
    sections: { ...sections },
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: `2026-08-15T00:00:0${updated}.000Z`,
  }
  const queue = () => ({ memory: memory(), candidates: [...candidates] })
  const remote = {
    get: async () => ({
      ok: true,
      value: { ok: true, value: { memory: memory() } },
    }),
    setSection: async () => ({
      ok: true,
      value: { ok: true, value: { memory: memory() } },
    }),
    replace: async (request: { sections: typeof EMPTY }) => {
      replaces.push(request)
      sections = { ...request.sections }
      updated += 1
      return {
        ok: true,
        value: { ok: true, value: { memory: memory() } },
      }
    },
    clear: async () => ({
      ok: true,
      value: { ok: true, value: { cleared: true } },
    }),
    listCandidates: async () => ({
      ok: true,
      value: { ok: true, value: queue() },
    }),
    proposeCandidate: async (request: { section: keyof typeof EMPTY; text: string }) => {
      candidateCalls.push('propose')
      candidates = [{
        id: 'candidate-1',
        workspaceId: WORKSPACE_ID,
        section: request.section,
        text: request.text,
        source: 'manual',
        sourceRef: null,
        createdAt: '2026-08-15T00:00:01.000Z',
      }]
      return { ok: true, value: { ok: true, value: queue() } }
    },
    acceptCandidate: async () => {
      candidateCalls.push('accept')
      const candidate = candidates[0]
      if (candidate !== undefined) {
        sections = { ...sections, [candidate.section]: candidate.text }
        updated += 1
      }
      candidates = []
      return { ok: true, value: { ok: true, value: queue() } }
    },
    rejectCandidate: async () => {
      candidateCalls.push('reject')
      candidates = []
      return { ok: true, value: { ok: true, value: queue() } }
    },
  } as unknown as ProjectMemoryRemote
  return {
    controller: new ProjectMemoryController(remote, WORKSPACE_ID),
    replaces,
    candidateCalls,
  }
}

function props(
  workspace: ProjectMemoryWorkspace | null,
  controller: ProjectMemoryController,
): ProjectMemoryHeaderActionProps {
  const useProjectWorkspace: ProjectMemoryHeaderActionProps['useProjectWorkspace'] = selector => selector(workspace)
  return {
    useProjectWorkspace,
    controllerFor: () => controller,
    t,
  } as unknown as ProjectMemoryHeaderActionProps
}

describe('ProjectMemoryHeaderAction', () => {
  it('stays absent for a Session outside every registered Workspace', () => {
    const { controller } = fakeController()
    render(<ProjectMemoryHeaderAction {...props(null, controller)} />)
    expect(screen.queryByRole('button', { name: '项目记忆' })).toBeNull()
  })

  it('loads the six-section editor and persists one atomic replacement', async () => {
    const { controller, replaces } = fakeController()
    const workspace: ProjectMemoryWorkspace = {
      workspaceId: WORKSPACE_ID,
      title: 'Yanami Test',
    }
    render(<ProjectMemoryHeaderAction {...props(workspace, controller)} />)

    fireEvent.click(screen.getByRole('button', { name: '项目记忆' }))
    const architecture = await screen.findByLabelText('架构')
    expect(screen.getByLabelText('命令')).toBeTruthy()
    expect(screen.getByLabelText('约定')).toBeTruthy()
    expect(screen.getByLabelText('决策')).toBeTruthy()
    expect(screen.getByLabelText('已知问题')).toBeTruthy()
    expect(screen.getByLabelText('完成标准')).toBeTruthy()

    fireEvent.change(architecture, { target: { value: 'Host -> Runtime -> UI' } })
    fireEvent.change(screen.getByLabelText('命令'), { target: { value: 'pnpm run build' } })
    fireEvent.click(screen.getByRole('button', { name: '保存记忆' }))

    await waitFor(() => { expect(replaces).toHaveLength(1) })
    expect(replaces[0]).toMatchObject({
      workspaceId: WORKSPACE_ID,
      sections: {
        architecture: 'Host -> Runtime -> UI',
        commands: 'pnpm run build',
        conventions: '',
        decisions: '',
        knownIssues: '',
        definitionOfDone: '',
      },
    })
    await waitFor(() => {
      expect(screen.queryByLabelText('架构')).toBeNull()
    })
  })

  it('stages a candidate outside committed memory and accepts it explicitly', async () => {
    const { controller, candidateCalls } = fakeController()
    const workspace: ProjectMemoryWorkspace = {
      workspaceId: WORKSPACE_ID,
      title: 'Yanami Test',
    }
    render(<ProjectMemoryHeaderAction {...props(workspace, controller)} />)

    fireEvent.click(screen.getByRole('button', { name: '项目记忆' }))
    await screen.findByLabelText('架构')
    const candidate = await screen.findByPlaceholderText('先暂存一条可能需要长期保留的信息…')
    fireEvent.change(candidate, { target: { value: 'WorkspaceId 作为稳定主键' } })
    fireEvent.click(screen.getByRole('button', { name: '加入候选' }))

    await screen.findByText('WorkspaceId 作为稳定主键')
    expect((screen.getByLabelText('决策') as HTMLTextAreaElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: '采纳' }))

    await waitFor(() => {
      expect((screen.getByLabelText('决策') as HTMLTextAreaElement).value)
        .toBe('WorkspaceId 作为稳定主键')
    })
    expect(screen.queryByText('WorkspaceId 作为稳定主键')).not.toBeNull()
    expect(candidateCalls).toEqual(['propose', 'accept'])
  })
})
