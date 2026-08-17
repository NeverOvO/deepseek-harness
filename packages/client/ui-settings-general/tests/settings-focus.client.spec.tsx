// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SettingsRootComponentProps } from '../src/client/shell-contract.ts'
import { SettingsRoot } from '../src/client/SettingsRoot.tsx'

afterEach(cleanup)

const ROWS = [
  { id: 'general', order: 0, label: 'General' },
  { id: 'models', order: 10, label: 'Models' },
] as const

const CONTENT: Record<string, string> = {
  'settings.trigger': 'Settings',
  'settings.header': 'Settings Title',
  'settings.action': 'Open configuration file',
  'settings.close': 'Close',
}

function mount() {
  const renderSlot = ((key: string, _owner: unknown, opts?: { only?: string }) => {
    if (key === 'settings.section') return <div data-testid={`section-${opts?.only ?? 'all'}`} />
    return CONTENT[key]
  }) as SettingsRootComponentProps['renderSlot']
  const props: SettingsRootComponentProps = {
    wide: true,
    useSections: select => select(ROWS),
    useOnboardingSteps: select => select([]),
    useSessions: ((select: (state: unknown) => unknown) => select({
      phase: 'ready',
      current: 'active-session',
      byId: { 'active-session': { blank: false } },
    })) as never,
    useWorkspaces: (() => { throw new Error('unused by SettingsRoot') }) as never,
    renderSlot,
  }
  return render(<SettingsRoot {...props} />)
}

describe('SettingsPanel focus containment', () => {
  it('wraps Tab inside the dialog and restores the opener when closed', () => {
    mount()
    const trigger = screen.getByRole('button', { name: 'Settings' })
    trigger.focus()
    fireEvent.click(trigger)

    const close = screen.getByRole('button', { name: 'Close' })
    const general = screen.getByRole('button', { name: 'General' })
    expect(document.activeElement).toBe(close)

    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(general)

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(close)

    fireEvent.click(close)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
