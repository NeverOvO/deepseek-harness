/**
 * Workspace plugin, browser half. Two primary registrations share this package:
 * WorkspaceBrowser fills the sidebar shell's `sidebar.workspaces` hole (the
 * whole browsing region), and WorkspacePicker fills the conversation hero's
 * picker hole (`conversation.hero.workspace` — both hero forms). A third,
 * additive session-header entry exposes Project Memory for the Workspace that
 * owns the current Session. Data stays in Client Runtime/Host storage; this
 * package owns only the Workbench presentation.
 */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the conversation service/SlotMap merges used by the
// lifecycle-bound Project Memory header contribution below.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { WorkspaceBrowserInjected, WorkspacePickerInjected } from './contract/slots.ts'
import { createWorkspaceViewStore } from './stores.ts'
import { WorkspaceBrowser } from './WorkspaceBrowser.tsx'
import { WorkspacePicker } from './WorkspacePicker.tsx'
import { ProjectMemoryHeaderAction } from './project-memory/ProjectMemoryHeaderAction.tsx'
import type { ProjectMemoryHeaderInjected } from './project-memory/slots.ts'
import { en, zh, type WorkspaceKey } from './locales.ts'

export type {
  DirectoryFlowOwnerProps, DirectoryFlowSlotName, DirectoryPickingHooks, DirectoryPickingInjected,
  WorkspaceBrowserInjected, WorkspaceBrowserProps, WorkspacePickerInjected, WorkspacePickerProps,
} from './contract/slots.ts'
export type {
  ProjectMemoryHeaderActionProps, ProjectMemoryHeaderInjected, ProjectMemoryWorkspace,
} from './project-memory/slots.ts'
export type { WorkspaceKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The workspace browsing region, pick/create flow, and Project Memory copy. */
    workspace: WorkspaceKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'workspace'
const PROJECT_MEMORY_HEADER_DIAG = '[yanami/project-memory-header]'

/**
 * Required services (cordis fiber inject). Sidebar/picker seats may arrive in
 * either order, so those surfaces follow declaration lifetimes through
 * `slots.inject()`. Project Memory is guarded twice below: first by the real
 * conversation service lifetime, then by the current header-action declaration
 * lifetime. This covers startup-order changes and conversation/header HMR.
 */
export const inject = ['slots', 'sessions', 'workspaces', 'projectMemories', 'locale']

/**
 * Register the browser, picker, and Project Memory action.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  console.info(PROJECT_MEMORY_HEADER_DIAG, 'workspace-plugin-apply')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-workspace: dictionaries')
  ctx.effect(() => ctx.slots.onEntryError((key, entry, error, info) => {
    if (key !== 'conversation.session.header.actions') return
    console.error(PROJECT_MEMORY_HEADER_DIAG, 'slot-entry-error', {
      id: entry.options.id ?? null,
      registrant: entry.registrant ?? null,
      abdicated: info.abdicated,
      error,
    })
  }), 'ui-workspace: Project Memory header diagnostics')

  const searchSessions: WorkspaceBrowserInjected['searchSessions'] = async (query, signal) => {
    const result = await ctx.sessions.search(query, signal)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }

  // Stable per-surface occupancy sources (the renderer's hook cache keys by
  // source identity): true while the surface's directory-flow hole is filled.
  const flowSource = (hole: 'sidebar.workspaces.directoryFlow' | 'conversation.hero.workspace.directoryFlow'): HostObservable<boolean> => ({
    getSnapshot: () => ctx.slots.entries(hole).length > 0,
    subscribe: listener => ctx.slots.subscribe(hole, listener),
  })
  const browserFlowSource = flowSource('sidebar.workspaces.directoryFlow')
  const pickerFlowSource = flowSource('conversation.hero.workspace.directoryFlow')
  const browserInjected = (): WorkspaceBrowserInjected => ({
    // Explicit group actions keep their target; unscoped New Session inherits
    // the current Session Workspace before the recent-Workspace fallback.
    startSession: (workspaceId) => { ctx.workspaces.startSession(workspaceId) },
    open: (sessionId) => { ctx.sessions.open(sessionId) },
    searchSessions,
    searchResultLimit: ctx.sessions.searchResultLimit,
    renameSession: async (sessionId, title) => {
      // Row → session-face hop: rename is a per-session verb (ISession), not
      // a list-service verb; the binding resolves any listed session.
      const session = ctx.sessions.binding(sessionId)?.session
      if (session === undefined) throw new Error(`unknown session "${sessionId}"`)
      const result = await session.rename(title)
      if (!result.ok) throw new Error(result.error.message)
    },
    forkSession: (sessionId) => {
      ctx.sessions.fork({ sessionId, increaseTitle: true })
        .then((childId) => { ctx.sessions.open(childId) })
        .catch(() => {
          // Fork or child-rename failure keeps the current selection.
        })
    },
    renameWorkspace: async (workspaceId, title) => { await ctx.workspaces.rename(workspaceId, title) },
    deleteWorkspace: async (workspaceId) => { await ctx.workspaces.delete(workspaceId) },
    insertWorkspaceBefore: async (workspaceId, beforeWorkspaceId) => {
      await ctx.workspaces.insertBefore(workspaceId, beforeWorkspaceId)
    },
    archiveSession: async (sessionId) => { await ctx.workspaces.archiveSession(sessionId) },
    insertSessionBefore: async (workspaceId, sessionId, beforeSessionId) => {
      await ctx.workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId)
    },
    createWorkspace: input => ctx.workspaces.create(input),
    hooks: { directoryFlow: browserFlowSource },
  })
  const pickerInjected = (): WorkspacePickerInjected => ({
    createWorkspace: input => ctx.workspaces.create(input),
    hooks: { directoryFlow: pickerFlowSource },
  })

  // Dual lifecycle guard for the production session-header contribution:
  // 1) wait for ui-conversation's service, which is provided only after its
  //    real header tree has been assembled for that plugin epoch;
  // 2) within that conversation epoch, follow the actual action-row
  //    declaration so late declaration, teardown, or HMR recreates this entry
  //    against the current Slot declaration rather than stranding it on an old
  //    one. The Project Memory controller remains lazy until the user opens it.
  ctx.inject(['slots', 'conversation', 'projectMemories', 'workspaces'], (scope: ClientContext) => {
    console.info(PROJECT_MEMORY_HEADER_DIAG, 'conversation-services-ready', {
      headerDeclared: scope.slots.spec('conversation.session.header.actions') !== undefined,
      rawHeaderEntries: scope.slots.entries('conversation.session.header.actions').map(entry => entry.options.id ?? null),
    })
    return scope.slots.inject('conversation.session.header.actions', () => {
      console.info(PROJECT_MEMORY_HEADER_DIAG, 'header-slot-live', {
        rawHeaderEntriesBefore: scope.slots.entries('conversation.session.header.actions').map(entry => entry.options.id ?? null),
      })
      const dispose = scope.slots.register({
        name: 'conversation.session.header.actions',
        id: 'project-memory',
        order: 30,
        locale: NS,
        inject: (sessionId?: SessionId): ProjectMemoryHeaderInjected => {
          if (sessionId !== undefined) {
            const state = scope.workspaces.list.getSnapshot()
            const matched = state.items.find(item => item.sessionIds.includes(sessionId)) ?? null
            console.info(PROJECT_MEMORY_HEADER_DIAG, 'renderer-entry-inject', {
              sessionId,
              workspaceCount: state.items.length,
              matchedWorkspaceId: matched?.workspaceId ?? null,
              componentWillReturnNull: matched === null,
              memberships: state.items.map(item => ({
                workspaceId: item.workspaceId,
                title: item.title,
                containsSession: item.sessionIds.includes(sessionId),
                sessionCount: item.sessionIds.length,
              })),
            })
          } else {
            console.info(PROJECT_MEMORY_HEADER_DIAG, 'entry-inject-without-session')
          }
          return {
            controllerFor: workspaceId => scope.projectMemories.forWorkspace(workspaceId),
          }
        },
      }, ProjectMemoryHeaderAction)
      console.info(PROJECT_MEMORY_HEADER_DIAG, 'header-entry-registered', {
        rawHeaderEntriesAfter: scope.slots.entries('conversation.session.header.actions').map(entry => entry.options.id ?? null),
        winningHeaderEntries: scope.slots.entriesOfSlot('conversation.session.header.actions').map(entry => entry.options.id ?? null),
      })
      return () => {
        console.info(PROJECT_MEMORY_HEADER_DIAG, 'header-entry-disposed')
        dispose()
      }
    })
  })

  // Each registration declares its directory-flow child in the same call;
  // slot injection follows both the owner and declaration HMR lifetimes.
  ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register(
    {
      name: 'sidebar.workspaces',
      children: { 'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' } },
      store: createWorkspaceViewStore(),
      inject: browserInjected,
      locale: NS,
    },
    WorkspaceBrowser,
  ))
  ctx.slots.inject('conversation.hero.workspace', () => ctx.slots.register(
    {
      name: 'conversation.hero.workspace',
      children: { 'conversation.hero.workspace.directoryFlow': { kind: 'single', scope: 'root' } },
      inject: pickerInjected,
      locale: NS,
    },
    WorkspacePicker,
  ))
}