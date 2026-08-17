// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'

afterEach(cleanup)

describe('Modal focus management', () => {
  it('moves focus into the dialog and restores the trigger when closed', () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'Open'
    document.body.append(trigger)
    trigger.focus()

    const { rerender } = render(
      <Modal open onClose={() => {}} title="Editor" closeLabel="Close">
        <input aria-label="Name" />
      </Modal>,
    )

    expect(screen.getByRole('button', { name: 'Close' })).toBe(document.activeElement)
    rerender(<Modal open={false} onClose={() => {}} title="Editor" closeLabel="Close" />)
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('keeps Tab and Shift+Tab inside the dialog', () => {
    render(
      <Modal open onClose={() => {}} title="Editor" closeLabel="Close">
        <input aria-label="Name" />
      </Modal>,
    )

    const close = screen.getByRole('button', { name: 'Close' })
    const input = screen.getByRole('textbox', { name: 'Name' })

    input.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(close)

    close.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(input)
  })

  it('focuses the dialog itself when a headless modal has no focusable controls', () => {
    render(<Modal open headless onClose={() => {}} title="Status">No actions</Modal>)
    const dialog = screen.getByRole('dialog', { name: 'Status' })
    expect(document.activeElement).toBe(dialog)
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(dialog)
  })

  it('Escape remains a single close request while focus is contained', () => {
    const onClose = vi.fn()
    render(<Modal open onClose={onClose} title="Editor"><button type="button">Save</button></Modal>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
