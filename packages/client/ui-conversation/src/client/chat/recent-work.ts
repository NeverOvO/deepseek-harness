import type { SessionId, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import type { YanamiRecentSession } from './YanamiHome.tsx'

/**
 * Project one Workspace's durable session membership into the compact Home
 * recent-work view model. Blank draft sessions are setup state, not activity.
 */
export function recentWorkspaceSessions(
  sessionIds: readonly SessionId[],
  byId: Readonly<Record<SessionId, SessionSummary>>,
  limit = 3,
): readonly YanamiRecentSession[] {
  return sessionIds
    .map(id => byId[id])
    .filter((session): session is SessionSummary => session !== undefined && !session.blank)
    .sort((left, right) => right.updatedAt - left.updatedAt || String(left.id).localeCompare(String(right.id)))
    .slice(0, Math.max(0, limit))
    .map(session => ({
      id: String(session.id),
      title: session.displayTitle,
      status: session.pendingInteraction !== undefined
        ? 'attention'
        : session.running
          ? 'running'
          : session.completed === true
            ? 'completed'
            : 'idle',
    }))
}
