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
  const remote = {
    get: async () => ({
      ok: true,
      value: { ok: true, value: { memory: null } },
    }),
    setSection: async () => ({
      ok: true,
      value: { ok: true, value: { memory: null } },
    }),
    replace: async (request: { sections: Record<string, string> }) => {
      replaces.push(request)
      return {
        ok: true,
        value: {
          ok: true,
          value: {
            memory: {
              workspaceId: WORKSPACE_ID,
              sections: request.sections,
              createdAt: '2026-08-15T00:00:00.000Z',
              updatedAt: '2026-08-15T00:00:01.000Z',
            },
          },
        },
      }
    },
    clear: async () => ({
      ok: true,
      value: { ok: true, value: { cleared: true } },
    }),
  } as unknown as ProjectMemoryRemote
  return { controller: new ProjectMemoryController(remote, WORKSPACE_ID), replaces }
}

function props(
  workspace: ProjectMemoryWorkspace | null,
  controller: ProjectMemoryController,
): ProjectMemoryHeaderActionProps {
  return {
    useProjectWorkspace: selector => selector(workspace),
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
})
