import { describe, expect, it } from 'vitest'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import {
  ProjectMemoryController,
  type ProjectMemoryRemote,
} from '../src/client/project-memory/service.ts'

const WORKSPACE = 'workspace-1' as WorkspaceId

function fakeRemote() {
  let architecture = ''
  const calls: string[] = []
  const memory = () => architecture === '' ? null : {
    workspaceId: WORKSPACE,
    sections: {
      architecture,
      commands: '',
      conventions: '',
      decisions: '',
      knownIssues: '',
      definitionOfDone: '',
    },
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
  }
  const remote = {
    get: async () => {
      calls.push('get')
      return { ok: true, value: { ok: true, value: { memory: memory() } } }
    },
    setSection: async (request: { text: string }) => {
      calls.push('setSection')
      architecture = request.text
      return { ok: true, value: { ok: true, value: { memory: memory() } } }
    },
    replace: async () => {
      calls.push('replace')
      return { ok: true, value: { ok: true, value: { memory: memory() } } }
    },
    clear: async () => {
      calls.push('clear')
      architecture = ''
      return { ok: true, value: { ok: true, value: { cleared: true } } }
    },
  } as unknown as ProjectMemoryRemote
  return { remote, calls }
}

describe('ProjectMemoryController', () => {
  it('loads once, commits section edits, and clears the host-backed cache', async () => {
    const { remote, calls } = fakeRemote()
    const controller = new ProjectMemoryController(remote, WORKSPACE)

    expect(controller.getSnapshot()).toEqual({ state: 'cold', memory: null, error: null })
    await expect(controller.ensure()).resolves.toEqual({ ok: true })
    await expect(controller.ensure()).resolves.toEqual({ ok: true })
    expect(calls).toEqual(['get'])

    await expect(controller.setSection('architecture', 'Host -> Runtime -> UI'))
      .resolves.toEqual({ ok: true })
    expect(controller.getSnapshot()).toMatchObject({
      state: 'ready',
      memory: { sections: { architecture: 'Host -> Runtime -> UI' } },
    })

    await expect(controller.clear()).resolves.toEqual({ ok: true })
    expect(controller.getSnapshot()).toEqual({ state: 'ready', memory: null, error: null })
    expect(calls).toEqual(['get', 'setSection', 'clear'])
  })

  it('invalidates on demand and repulls on the next ensure', async () => {
    const { remote, calls } = fakeRemote()
    const controller = new ProjectMemoryController(remote, WORKSPACE)
    await controller.ensure()

    controller.invalidate()
    expect(controller.getSnapshot().state).toBe('cold')
    await controller.ensure()
    expect(calls).toEqual(['get', 'get'])
  })

  it('publishes stable business failures without throwing', async () => {
    const remote = {
      get: async () => ({
        ok: true,
        value: {
          ok: false,
          error: { code: 'workspace-not-found', workspaceId: WORKSPACE },
        },
      }),
    } as unknown as ProjectMemoryRemote
    const controller = new ProjectMemoryController(remote, WORKSPACE)

    await expect(controller.ensure()).resolves.toEqual({
      ok: false,
      code: 'workspace-not-found',
      message: 'this workspace is no longer registered',
    })
    expect(controller.getSnapshot()).toEqual({
      state: 'error',
      memory: null,
      error: 'this workspace is no longer registered',
    })
  })
})
