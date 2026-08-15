import { describe, expect, it } from 'vitest'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import {
  ProjectMemoryController,
  type ProjectMemoryRemote,
} from '../src/client/project-memory/service.ts'

const WORKSPACE = 'workspace-1' as WorkspaceId

function fakeRemote() {
  let architecture = ''
  let candidates: Array<{
    id: string
    workspaceId: WorkspaceId
    section: 'architecture'
    text: string
    source: 'manual'
    sourceRef: null
    createdAt: string
  }> = []
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
  const queue = () => ({ memory: memory(), candidates: [...candidates] })
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
    listCandidates: async () => {
      calls.push('listCandidates')
      return { ok: true, value: { ok: true, value: queue() } }
    },
    proposeCandidate: async (request: { text: string }) => {
      calls.push('proposeCandidate')
      candidates = [{
        id: 'candidate-1',
        workspaceId: WORKSPACE,
        section: 'architecture',
        text: request.text,
        source: 'manual',
        sourceRef: null,
        createdAt: '2026-08-15T00:00:01.000Z',
      }]
      return { ok: true, value: { ok: true, value: queue() } }
    },
    acceptCandidate: async () => {
      calls.push('acceptCandidate')
      architecture = candidates[0]?.text ?? architecture
      candidates = []
      return { ok: true, value: { ok: true, value: queue() } }
    },
    rejectCandidate: async () => {
      calls.push('rejectCandidate')
      candidates = []
      return { ok: true, value: { ok: true, value: queue() } }
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

  it('keeps candidate review separate until acceptance updates committed memory', async () => {
    const { remote, calls } = fakeRemote()
    const controller = new ProjectMemoryController(remote, WORKSPACE)

    expect(controller.getCandidateSnapshot()).toEqual({ state: 'cold', candidates: [], error: null })
    await expect(controller.proposeCandidate('architecture', 'Host -> Runtime -> UI')).resolves.toEqual({ ok: true })
    expect(controller.getSnapshot()).toEqual({ state: 'ready', memory: null, error: null })
    expect(controller.getCandidateSnapshot()).toMatchObject({
      state: 'ready',
      candidates: [{ id: 'candidate-1', text: 'Host -> Runtime -> UI' }],
    })

    await expect(controller.acceptCandidate('candidate-1')).resolves.toEqual({ ok: true })
    expect(controller.getSnapshot()).toMatchObject({
      state: 'ready',
      memory: { sections: { architecture: 'Host -> Runtime -> UI' } },
    })
    expect(controller.getCandidateSnapshot()).toEqual({ state: 'ready', candidates: [], error: null })
    expect(calls).toEqual(['listCandidates', 'proposeCandidate', 'acceptCandidate'])
  })

  it('invalidates committed and candidate caches on demand', async () => {
    const { remote, calls } = fakeRemote()
    const controller = new ProjectMemoryController(remote, WORKSPACE)
    await controller.ensure()
    await controller.ensureCandidates()

    controller.invalidate()
    expect(controller.getSnapshot().state).toBe('cold')
    expect(controller.getCandidateSnapshot().state).toBe('cold')
    await controller.ensure()
    await controller.ensureCandidates()
    expect(calls).toEqual(['get', 'listCandidates', 'get', 'listCandidates'])
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
