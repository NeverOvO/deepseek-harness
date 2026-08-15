/** Session-header Project Memory trigger and six-section editor. */

import { useEffect, useMemo, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ProjectMemoryController, ProjectMemoryState } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkspaceKey } from '../locales.ts'
import type { ProjectMemoryHeaderActionProps } from './slots.ts'
import css from './ProjectMemoryHeaderAction.module.css'

type ProjectMemorySections = NonNullable<ProjectMemoryState['memory']>['sections']
type SectionKey = keyof ProjectMemorySections

const EMPTY_SECTIONS: ProjectMemorySections = Object.freeze({
  architecture: '',
  commands: '',
  conventions: '',
  decisions: '',
  knownIssues: '',
  definitionOfDone: '',
})

const SECTION_ROWS: readonly { key: SectionKey; label: WorkspaceKey }[] = [
  { key: 'architecture', label: 'memory.section.architecture' },
  { key: 'commands', label: 'memory.section.commands' },
  { key: 'conventions', label: 'memory.section.conventions' },
  { key: 'decisions', label: 'memory.section.decisions' },
  { key: 'knownIssues', label: 'memory.section.knownIssues' },
  { key: 'definitionOfDone', label: 'memory.section.definitionOfDone' },
]

function sameSections(left: ProjectMemorySections, right: ProjectMemorySections): boolean {
  return SECTION_ROWS.every(({ key }) => left[key] === right[key])
}

/** Editor body separated from the trigger so controller hooks never become conditional. */
function ProjectMemoryEditor({
  controller,
  workspaceName,
  onClose,
  t,
}: {
  controller: ProjectMemoryController
  workspaceName: string
  onClose: () => void
  t: ProjectMemoryHeaderActionProps['t']
}) {
  const state = controller.getSnapshot()
  // ProjectMemoryController is a bare external store; the injected hook
  // machinery is unnecessary here because this editor owns exactly one
  // controller for its modal lifetime.
  const [, rerender] = useState(0)
  useEffect(() => controller.subscribe(() => { rerender(value => value + 1) }), [controller])
  const live = controller.getSnapshot()
  const committed = live.memory?.sections ?? EMPTY_SECTIONS
  const [draft, setDraft] = useState<ProjectMemorySections>(committed)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (live.state !== 'ready') return
    setDraft(live.memory?.sections ?? EMPTY_SECTIONS)
  }, [controller, live.state, live.memory?.updatedAt])

  useEffect(() => {
    void controller.ensure()
  }, [controller])

  const dirty = useMemo(() => !sameSections(draft, committed), [draft, committed])
  const close = (): void => {
    if (!saving) onClose()
  }
  const save = (): void => {
    if (saving || live.state !== 'ready' || !dirty) return
    setSaving(true)
    setActionError(null)
    void controller.replace(draft).then((result) => {
      setSaving(false)
      if (!result.ok) {
        setActionError(result.message)
        return
      }
      onClose()
    })
  }

  return (
    <Modal
      open
      onClose={close}
      closeLabel={t('close')}
      title={t('memory.title', { name: workspaceName })}
      description={t('memory.description')}
      footer={(
        <>
          <Button variant="outline" disabled={saving} onClick={close}>{t('cancel')}</Button>
          <Button
            variant="primary"
            disabled={saving || live.state !== 'ready' || !dirty}
            onClick={save}
          >
            {t('memory.save')}
          </Button>
        </>
      )}
    >
      {live.state === 'loading' || live.state === 'cold' ? (
        <div className={css.status} role="status">{t('memory.loading')}</div>
      ) : live.state === 'error' ? (
        <div>
          <div className={css.error} role="alert">{live.error ?? t('memory.error')}</div>
          <Button
            variant="outline"
            onClick={() => { setActionError(null); void controller.refresh() }}
          >
            {t('memory.retry')}
          </Button>
        </div>
      ) : (
        <div className={css.editor}>
          {SECTION_ROWS.map(({ key, label }) => (
            <label className={css.section} key={key}>
              <span className={css.label}>{t(label)}</span>
              <textarea
                className={css.textarea}
                value={draft[key]}
                disabled={saving}
                placeholder={t('memory.section.placeholder')}
                onChange={(event) => {
                  const text = event.target.value
                  setDraft(current => ({ ...current, [key]: text }))
                  setActionError(null)
                }}
              />
            </label>
          ))}
          {actionError !== null && <div className={css.error} role="alert">{actionError}</div>}
        </div>
      )}
    </Modal>
  )
}

/** Additive session-header control: hidden when the Session is not accounted to a Workspace. */
export function ProjectMemoryHeaderAction({
  useProjectWorkspace,
  controllerFor,
  t,
}: ProjectMemoryHeaderActionProps) {
  const workspace = useProjectWorkspace(value => value)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setOpen(false)
  }, [workspace?.workspaceId])

  if (workspace === null) return null
  const controller = controllerFor(workspace.workspaceId)

  return (
    <>
      <button
        type="button"
        className={css.trigger}
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
      >
        {t('memory.action')}
      </button>
      {open && (
        <ProjectMemoryEditor
          key={workspace.workspaceId}
          controller={controller}
          workspaceName={workspace.title}
          onClose={() => { setOpen(false) }}
          t={t}
        />
      )}
    </>
  )
}
