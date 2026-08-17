/** Home-card Project Memory status plus the exact durable editor route. */

import { useEffect, useState, useSyncExternalStore } from 'react'
import type {
  ProjectMemoryController, ProjectMemoryState, WorkspaceId,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkspaceKey } from '../locales.ts'
import type { ProjectMemoryHeaderActionProps } from './slots.ts'
import { ProjectMemoryOpenPanel } from './ProjectMemoryHeaderAction.tsx'
import css from '../WorkspacePicker.module.css'

type ProjectMemorySections = NonNullable<ProjectMemoryState['memory']>['sections']
type SectionKey = keyof ProjectMemorySections

const SECTION_ROWS: readonly { key: SectionKey; label: WorkspaceKey }[] = [
  { key: 'architecture', label: 'memory.section.architecture' },
  { key: 'commands', label: 'memory.section.commands' },
  { key: 'conventions', label: 'memory.section.conventions' },
  { key: 'decisions', label: 'memory.section.decisions' },
  { key: 'knownIssues', label: 'memory.section.knownIssues' },
  { key: 'definitionOfDone', label: 'memory.section.definitionOfDone' },
]

function MemoryAction({
  open,
  onToggle,
  t,
}: {
  open: boolean
  onToggle: () => void
  t: ProjectMemoryHeaderActionProps['t']
}) {
  return (
    <button
      type="button"
      className={css.memoryAction}
      aria-expanded={open}
      onClick={onToggle}
    >
      <span className={css.memoryActionIcon} aria-hidden="true">▱</span>
      {t('memory.action')}
    </button>
  )
}

function ProjectMemorySummary({
  controller,
  open,
  onToggle,
  t,
}: {
  controller: ProjectMemoryController
  open: boolean
  onToggle: () => void
  t: ProjectMemoryHeaderActionProps['t']
}) {
  const live = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const review = useSyncExternalStore(
    controller.subscribeCandidates,
    controller.getCandidateSnapshot,
    controller.getCandidateSnapshot,
  )

  useEffect(() => {
    void controller.ensure()
    void controller.ensureCandidates()
  }, [controller])

  const populated = live.memory === null
    ? []
    : SECTION_ROWS.filter(({ key }) => live.memory?.sections[key].trim() !== '')
  const loading = (live.state === 'cold' || live.state === 'loading') && live.memory === null
  const unavailable = live.state === 'error' && live.memory === null
  const candidateCount = review.state === 'ready'
    ? String(review.candidates.length)
    : review.state === 'error' ? '—' : '…'

  const retry = (): void => {
    void controller.refresh()
    void controller.refreshCandidates()
  }

  return (
    <div
      className={css.memorySurface}
      data-memory-state={live.state}
      aria-busy={loading ? 'true' : undefined}
    >
      {loading && (
        <div className={css.memoryStatus} role="status">{t('memory.loading')}</div>
      )}

      {unavailable && (
        <>
          <div className={css.memoryError} role="alert">{live.error ?? t('memory.error')}</div>
          <button type="button" className={css.memoryRetry} onClick={retry}>
            {t('memory.retry')}
          </button>
        </>
      )}

      {!loading && !unavailable && (
        <>
          <div className={css.memorySummary}>
            <strong>{t('memory.action')} {populated.length}/6</strong>
            <span>{t('memory.candidates.title')} {candidateCount}</span>
          </div>
          {populated.length > 0 ? (
            <div className={css.memoryChips}>
              {populated.map(row => (
                <span className={css.memoryChip} key={row.key}>{t(row.label)}</span>
              ))}
            </div>
          ) : (
            <div className={css.memoryEmpty}>{t('memory.section.placeholder')}</div>
          )}
          {live.state === 'error' && live.error !== null && (
            <div className={css.memoryError} role="alert">{live.error}</div>
          )}
          {review.state === 'error' && review.error !== null && (
            <div className={css.memoryError} role="alert">{review.error}</div>
          )}
        </>
      )}

      <MemoryAction open={open} onToggle={onToggle} t={t} />
    </div>
  )
}

export interface ProjectMemoryHomeSurfaceProps {
  workspaceId: WorkspaceId
  workspaceName: string
  controllerFor: ProjectMemoryHeaderActionProps['controllerFor']
  onBeforeOpen: () => void
  t: ProjectMemoryHeaderActionProps['t']
}

/** Selected Workspace's live durable-memory summary, retry path, and editor action. */
export function ProjectMemoryHomeSurface({
  workspaceId,
  workspaceName,
  controllerFor,
  onBeforeOpen,
  t,
}: ProjectMemoryHomeSurfaceProps) {
  const [open, setOpen] = useState(false)
  let controller: ProjectMemoryController | null = null
  let resolutionError: string | null = null
  try {
    controller = controllerFor(workspaceId)
  } catch (error) {
    resolutionError = error instanceof Error ? error.message : String(error)
  }

  const toggle = (): void => {
    if (!open) onBeforeOpen()
    setOpen(value => !value)
  }

  return (
    <>
      {controller === null ? (
        <div className={css.memorySurface} data-memory-state="error">
          <div className={css.memoryError} role="alert">
            {resolutionError || t('memory.error')}
          </div>
          <MemoryAction open={open} onToggle={toggle} t={t} />
        </div>
      ) : (
        <ProjectMemorySummary controller={controller} open={open} onToggle={toggle} t={t} />
      )}
      {open && (
        <ProjectMemoryOpenPanel
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          controllerFor={controllerFor}
          onClose={() => { setOpen(false) }}
          t={t}
        />
      )}
    </>
  )
}
