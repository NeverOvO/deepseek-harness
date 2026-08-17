// Hero chrome for the blank-draft phase of ConversationRoot. The resident
// composer stays owned by ConversationRoot so its textarea survives the
// blank-home → active-conversation transition without remounting.

import { useId } from 'react'
import type { ReactNode, RefObject } from 'react'
import {
  IconChevronDownOutline14, IconFolderClose16, IconFolderOpen16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { workspaceTitleOf } from '@deepseek-ai/dsh-client-runtime/client'
import type { GoalProjection } from '@deepseek-ai/dsh-goal/client'
import type { YanamiMode } from '@deepseek-ai/dsh-plan-mode/client'
import type { ConversationSlotProps } from '../contract/slots.ts'
import { YanamiHome } from '../chat/YanamiHome.tsx'
import css from './HeroShell.module.css'

/** The owner's locale seat type, passed to hero chrome as a plain prop. */
type HeroTranslate = ConversationSlotProps['t']

/**
 * Basename label for the workspace chip (the shared derivation);
 * separator-only paths echo the raw cwd.
 */
export function workspaceLabel(cwd: string): string {
  const base = workspaceTitleOf(cwd)
  return base !== '' ? base : cwd
}

/** Workspace selector rendered above the blank-session composer. */
export function WorkspaceChip({ buttonRef, label, menuOpen = false, onClick, t }: {
  buttonRef?: RefObject<HTMLButtonElement>
  label?: string | undefined
  menuOpen?: boolean
  onClick?: () => void
  t: HeroTranslate
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={css.workspace}
      aria-label={t('hero.chooseWorkspace')}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      onClick={onClick}
    >
      {label === undefined
        ? <IconFolderClose16 className={css.folder} size={16} />
        : <IconFolderOpen16 className={css.folder} size={16} />}
      <span className={css.workspaceLabel}>{label ?? t('hero.chooseWorkspace')}</span>
      <IconChevronDownOutline14 className={css.chevron} size={12} />
    </button>
  )
}

/** Soft backdrop retained behind the composer for continuity with active UI. */
export function HeroGlow({ className }: { className?: string | undefined }) {
  const glowFilterId = `empty-glow-${useId().replace(/:/g, '')}`
  return (
    <svg className={className} viewBox="0 0 1051 468" fill="none" aria-hidden="true">
      <defs>
        <filter
          id={glowFilterId}
          x="0"
          y="0"
          width="1051"
          height="468"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur stdDeviation="50" result="effect1_foregroundBlur" />
        </filter>
      </defs>
      <g filter={`url(#${glowFilterId})`}>
        <ellipse cx="525.5" cy="234" rx="425.5" ry="134" fill="#7CB9E8" fillOpacity="0.09" />
      </g>
    </svg>
  )
}

export interface HeroShellProps {
  t: HeroTranslate
  children?: ReactNode
  cwd?: string
  sessionCount?: number
  activeMode?: YanamiMode
  switchingMode?: YanamiMode
  modeError?: string
  onModeSelect?: (mode: YanamiMode) => void
  mission?: GoalProjection | null
}

/**
 * Blank-session product home. ConversationRoot keeps workspace selection and
 * the real composer immediately below this surface. The foreign Workspace
 * slot content is composed into the Project Memory card rather than rendered
 * as a second dashboard row.
 */
export function HeroShell({
  children, cwd, sessionCount, activeMode, switchingMode, modeError, onModeSelect, mission,
}: HeroShellProps) {
  return (
    <div className={css.root}>
      <YanamiHome
        {...cwd === undefined ? {} : { cwd }}
        {...sessionCount === undefined ? {} : { sessionCount }}
        {...activeMode === undefined ? {} : { activeMode }}
        {...switchingMode === undefined ? {} : { switchingMode }}
        {...modeError === undefined ? {} : { modeError }}
        {...onModeSelect === undefined ? {} : { onModeSelect }}
        {...mission === undefined ? {} : { mission }}
        projectMemory={children}
      />
    </div>
  )
}
