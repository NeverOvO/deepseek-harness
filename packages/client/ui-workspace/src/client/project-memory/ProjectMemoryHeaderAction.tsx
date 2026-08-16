/** Session-header Project Memory trigger, editor, and candidate review queue. */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
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

function candidateSourceLabel(source: string): WorkspaceKey {
  if (source === 'session') return 'memory.candidates.source.session'
  if (source === 'mission') return 'memory.candidates.source.mission'
  if (source === 'automatic') return 'memory.candidates.source.automatic'
  return 'memory.candidates.source.manual'
}

function candidateRelationLabel(relation: string): WorkspaceKey {
  if (relation === 'duplicate') return 'memory.candidates.relation.duplicate'
  if (relation === 'merge') return 'memory.candidates.relation.merge'
  if (relation === 'supersedes') return 'memory.candidates.relation.supersedes'
  if (relation === 'conflict') return 'memory.candidates.relation.conflict'
  return 'memory.candidates.relation.new'
}

function candidateRelationHelp(relation: string): WorkspaceKey {
  if (relation === 'duplicate') return 'memory.candidates.relationHelp.duplicate'
  if (relation === 'merge') return 'memory.candidates.relationHelp.merge'
  if (relation === 'supersedes') return 'memory.candidates.relationHelp.supersedes'
  if (relation === 'conflict') return 'memory.candidates.relationHelp.conflict'
  return 'memory.candidates.relationHelp.new'
}

/** Exact additive result the Host will persist when a merge candidate is accepted. */
function candidateMergeSuggestion(current: string, candidate: string, relation: string): string | null {
  if (relation !== 'merge') return null
  const text = candidate.trim()
  if (text === '') return null
  if (current.trim() === '') return text
  return `${current.trimEnd()}\n\n${text}`
}

/** Header trigger owns the always-on lightweight candidate-count subscription. */
function ProjectMemoryTrigger({
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
  const review = useSyncExternalStore(
    controller.subscribeCandidates,
    controller.getCandidateSnapshot,
    controller.getCandidateSnapshot,
  )

  useEffect(() => {
    void controller.ensureCandidates()
  }, [controller])

  const count = review.state === 'ready' ? review.candidates.length : 0
  return (
    <button
      type="button"
      className={css.trigger}
      aria-expanded={open}
      onClick={onToggle}
    >
      {t('memory.action')}
      {count > 0 && <span className={css.badge} aria-hidden="true">{count > 99 ? '99+' : count}</span>}
    </button>
  )
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
  const live = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const review = useSyncExternalStore(
    controller.subscribeCandidates,
    controller.getCandidateSnapshot,
    controller.getCandidateSnapshot,
  )
  const committed = live.memory?.sections ?? EMPTY_SECTIONS
  const [draft, setDraft] = useState<ProjectMemorySections>(committed)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [candidateSection, setCandidateSection] = useState<SectionKey>('decisions')
  const [candidateText, setCandidateText] = useState('')
  const [candidateBusy, setCandidateBusy] = useState<string | null>(null)

  useEffect(() => {
    if (live.state !== 'ready') return
    setDraft(live.memory?.sections ?? EMPTY_SECTIONS)
  }, [controller, live.state, live.memory?.updatedAt])

  useEffect(() => {
    void controller.ensure()
    void controller.ensureCandidates()
  }, [controller])

  const dirty = useMemo(() => !sameSections(draft, committed), [draft, committed])
  const close = (): void => {
    if (!saving && candidateBusy === null) onClose()
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
  const stageCandidate = (): void => {
    const text = candidateText.trim()
    if (text === '' || candidateBusy !== null) return
    setCandidateBusy('new')
    setActionError(null)
    void controller.proposeCandidate(candidateSection, text).then((result) => {
      setCandidateBusy(null)
      if (!result.ok) {
        setActionError(result.message)
        return
      }
      setCandidateText('')
    })
  }
  const reviewCandidate = (candidateId: string, accept: boolean): void => {
    if (candidateBusy !== null || (accept && dirty)) return
    setCandidateBusy(candidateId)
    setActionError(null)
    const operation = accept
      ? controller.acceptCandidate(candidateId)
      : controller.rejectCandidate(candidateId)
    void operation.then((result) => {
      setCandidateBusy(null)
      if (!result.ok) setActionError(result.message)
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
          <Button variant="outline" disabled={saving || candidateBusy !== null} onClick={close}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={saving || candidateBusy !== null || live.state !== 'ready' || !dirty}
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
          <div className={css.sections}>
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
          </div>

          <section className={css.candidates} aria-label={t('memory.candidates.title')}>
            <div className={css.candidateHeading}>
              <div>
                <div className={css.label}>{t('memory.candidates.title')}</div>
                <div className={css.help}>{t('memory.candidates.description')}</div>
              </div>
            </div>

            <div className={css.candidateComposer}>
              <select
                className={css.select}
                value={candidateSection}
                disabled={candidateBusy !== null}
                aria-label={t('memory.candidates.title')}
                onChange={(event) => { setCandidateSection(event.target.value as SectionKey) }}
              >
                {SECTION_ROWS.map(({ key, label }) => (
                  <option key={key} value={key}>{t(label)}</option>
                ))}
              </select>
              <textarea
                className={css.candidateTextarea}
                value={candidateText}
                disabled={candidateBusy !== null}
                placeholder={t('memory.candidates.placeholder')}
                onChange={(event) => { setCandidateText(event.target.value); setActionError(null) }}
              />
              <Button
                variant="outline"
                disabled={candidateBusy !== null || candidateText.trim() === ''}
                onClick={stageCandidate}
              >
                {t('memory.candidates.add')}
              </Button>
            </div>

            {review.state === 'loading' || review.state === 'cold' ? (
              <div className={css.status} role="status">{t('memory.candidates.loading')}</div>
            ) : review.state === 'error' ? (
              <div>
                <div className={css.error} role="alert">{review.error ?? t('memory.error')}</div>
                <Button variant="outline" onClick={() => { void controller.refreshCandidates() }}>
                  {t('memory.retry')}
                </Button>
              </div>
            ) : review.candidates.length === 0 ? (
              <div className={css.status}>{t('memory.candidates.empty')}</div>
            ) : (
              <div className={css.candidateList}>
                {review.candidates.map(candidate => {
                  const row = SECTION_ROWS.find(item => item.key === candidate.section)
                  const busy = candidateBusy === candidate.id
                  const suggestion = candidateMergeSuggestion(
                    committed[candidate.section],
                    candidate.text,
                    candidate.relation,
                  )
                  const conflicts = candidate.relation === 'conflict'
                  return (
                    <article className={css.candidateCard} key={candidate.id}>
                      <div className={css.candidateMeta}>
                        <span>{t(row?.label ?? 'memory.section.decisions')}</span>
                        <span>·</span>
                        <span>{t(candidateSourceLabel(candidate.source))}</span>
                        <span>·</span>
                        <span>{t(candidateRelationLabel(candidate.relation))}</span>
                      </div>
                      <div className={css.candidateText}>{candidate.text}</div>
                      <div className={css.help}>{t(candidateRelationHelp(candidate.relation))}</div>
                      {candidate.supersedesText !== null && candidate.supersedesText.trim() !== '' && (
                        <div>
                          <div className={css.help}>{t('memory.candidates.supersedesTarget')}</div>
                          <div className={css.candidateText}>{candidate.supersedesText}</div>
                        </div>
                      )}
                      {suggestion !== null && (
                        <div>
                          <div className={css.help}>{t('memory.candidates.mergeSuggestion')}</div>
                          <div className={css.candidateText}>{suggestion}</div>
                        </div>
                      )}
                      {candidate.rationale !== null && candidate.rationale.trim() !== '' && (
                        <div className={css.help}>{candidate.rationale}</div>
                      )}
                      <div className={css.candidateActions}>
                        <Button
                          variant="outline"
                          disabled={candidateBusy !== null}
                          onClick={() => { reviewCandidate(candidate.id, false) }}
                        >
                          {t('memory.candidates.reject')}
                        </Button>
                        <Button
                          variant="primary"
                          disabled={candidateBusy !== null || dirty || conflicts}
                          onClick={() => { reviewCandidate(candidate.id, true) }}
                        >
                          {t('memory.candidates.accept')}
                        </Button>
                      </div>
                      {dirty && !busy && (
                        <div className={css.help}>{t('memory.candidates.saveFirst')}</div>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
          </section>

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
      <ProjectMemoryTrigger
        controller={controller}
        open={open}
        onToggle={() => { setOpen(value => !value) }}
        t={t}
      />
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