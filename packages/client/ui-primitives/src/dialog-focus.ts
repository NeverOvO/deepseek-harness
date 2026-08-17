const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Return focusable descendants in DOM order, excluding intentionally hidden nodes. */
export function dialogFocusableChildren(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(element => (
    element.getAttribute('aria-hidden') !== 'true'
    && element.hidden !== true
  ))
}

/**
 * Move focus into a dialog without scrolling the surrounding workbench.
 * A preferred control may be supplied for shells whose visual chrome owns the
 * first focus target; otherwise the first focusable descendant (or the dialog
 * itself) is used.
 */
export function focusDialogEntry(root: HTMLElement, preferred?: HTMLElement | null): void {
  if (root.contains(document.activeElement)) return
  const target = preferred !== undefined && preferred !== null && root.contains(preferred)
    ? preferred
    : (dialogFocusableChildren(root)[0] ?? root)
  target.focus({ preventScroll: true })
}

/**
 * Contain one Tab key event inside a dialog. Returns true only when the event
 * needed to be intercepted (wrap-around or a dialog with no focusable child).
 */
export function containDialogTab(event: KeyboardEvent, root: HTMLElement): boolean {
  if (event.key !== 'Tab') return false
  const focusable = dialogFocusableChildren(root)
  if (focusable.length === 0) {
    event.preventDefault()
    root.focus({ preventScroll: true })
    return true
  }

  const first = focusable[0]
  const last = focusable.at(-1)
  if (first === undefined || last === undefined) return false
  const active = document.activeElement
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault()
    last.focus({ preventScroll: true })
    return true
  }
  if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault()
    first.focus({ preventScroll: true })
    return true
  }
  return false
}
