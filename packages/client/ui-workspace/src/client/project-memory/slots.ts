/** Project Memory header-action contract owned by ui-workspace. */

import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ProjectMemoryController, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls this package's `workspace` locale namespace seat.
import type {} from '../locales.ts'

/** Real Workspace context for the Session currently owning the header action. */
export type ProjectMemoryWorkspace = Pick<WorkspaceView, 'workspaceId' | 'title'>

/** Business share injected into one session-scoped Project Memory header action. */
export interface ProjectMemoryHeaderInjected {
  hooks: {
    /** Current Workspace account for this Session; null for an ungrouped Session. */
    projectWorkspace: HostObservable<ProjectMemoryWorkspace | null>
  }
  /** Resolve the stable Workspace-keyed Project Memory controller. */
  controllerFor: (workspaceId: WorkspaceId) => ProjectMemoryController
}

/** Full props of the additive Project Memory session-header action. */
export type ProjectMemoryHeaderActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & InjectFace<ProjectMemoryHeaderInjected>
  & PropsLocale<'workspace'>
