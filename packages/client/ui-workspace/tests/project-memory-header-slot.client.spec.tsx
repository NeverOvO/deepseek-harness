// @vitest-environment jsdom
/** Real slot-renderer regression for the Project Memory session-header entry. */
import type { ComponentType, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  SlotCore,
  type PropsRenderSlots,
  type SlotRendererHost,
} from '@deepseek-ai/dsh-client-ui-slots'
import { createSlotRenderer } from '@deepseek-ai/dsh-client-web-react'
import type { WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { ProjectMemoryHeaderAction } from '../src/client/project-memory/ProjectMemoryHeaderAction.tsx'
import { zh } from '../src/client/locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'spec.project-memory.session': { kind: 'single'; scope: 'session'; owner: Record<string, never> }
  }
}

const SESSION_ID = 'session-slot-test'
const WORKSPACE_ID = 'workspace-slot-test'

type RootFrameProps = PropsRenderSlots<'spec.project-memory.session'> & {
  SessionProvider: ComponentType<{
    empty?: (() => ReactNode) | undefined
    children: (sessionId: string) => ReactNode
  }>
}

type SessionFrameProps = PropsRenderSlots<'conversation.session.header.actions'>

function t(key: string, params?: Record<string, unknown>): string {
  const shared: Record<string, string> = { close: '关闭', cancel: '取消' }
  let value = (zh as Record<string, string>)[key] ?? shared[key] ?? key
  for (const [name, replacement] of Object.entries(params ?? {})) {
    value = value.replace(`{${name}}`, String(replacement))
  }
  return value
}

function hostOver(core: SlotCore, workspaces: WorkspaceListState): SlotRendererHost {
  const provideInfo = {
    sessionId: SESSION_ID,
    hooks: {},
    props: {},
  }
  return {
    subscribe: (key, fn) => core.subscribe(key, fn),
    getVersion: key => core.getVersion(key),
    entriesOf: key => core.entries(key),
    entriesOfSlot: key => core.entriesOfSlot(key),
    reportEntryError: (key, entry, error, info) => { core.reportEntryError(key, entry, error, info) },
    specOf: key => core.specDynamic(key),
    isLive: entry => core.isLive(entry),
    storeOf: () => undefined,
    sessions: {
      list: { getSnapshot: () => ({}), subscribe: () => () => {} },
      provideInfo: { getSnapshot: () => provideInfo, subscribe: () => () => {} },
    },
    workspaces: {
      list: { getSnapshot: () => workspaces, subscribe: () => () => {} },
    },
    locale: {
      getSnapshot: () => ({ revision: 0 }),
      subscribe: () => () => {},
      bind: () => t,
    },
  }
}

describe('Project Memory header through the real slot renderer', () => {
  it('renders the trigger from the standard Session/Workspace seats without resolving the controller', () => {
    const core = new SlotCore()
    const controllerFor = vi.fn(() => { throw new Error('controller must stay lazy') })
    const workspaces: WorkspaceListState = {
      items: [{
        workspaceId: WORKSPACE_ID as never,
        path: '/projects/slot-test',
        title: 'Slot Test',
        sessionIds: [SESSION_ID as never],
        createdAt: '2026-08-16T00:00:00.000Z',
        updatedAt: '2026-08-16T00:00:00.000Z',
      }],
      archivedSessionIds: [],
      state: 'idle',
      phase: 'ready',
      error: null,
      baselinesReady: true,
      recentWorkspaceId: WORKSPACE_ID as never,
    }

    core.register({
      name: 'root',
      children: {
        'spec.project-memory.session': { kind: 'single', scope: 'session' },
      },
    } as never, (({ SessionProvider, renderSlot }: RootFrameProps) => (
      <SessionProvider>
        {() => renderSlot('spec.project-memory.session', {})}
      </SessionProvider>
    )) as never)

    core.register({
      name: 'spec.project-memory.session',
      children: {
        'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      },
    } as never, (({ renderSlot }: SessionFrameProps) => (
      <>{renderSlot('conversation.session.header.actions', {})}</>
    )) as never)

    core.register({
      name: 'conversation.session.header.actions',
      id: 'project-memory',
      order: 30,
      locale: 'workspace',
      inject: () => ({ controllerFor }),
    } as never, ProjectMemoryHeaderAction as never)

    render(<>{createSlotRenderer().renderRoot(hostOver(core, workspaces), {})}</>)

    expect(screen.getByRole('button', { name: '项目记忆' })).toBeTruthy()
    expect(controllerFor).not.toHaveBeenCalled()
  })
})
