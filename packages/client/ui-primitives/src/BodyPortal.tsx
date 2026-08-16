import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Render an overlay surface at document.body so ancestor transforms,
 * containment, overflow and stacking contexts cannot constrain viewport UI.
 *
 * Keep portal ownership in ui-primitives: presentation packages can request a
 * viewport overlay without declaring their own react-dom dependency.
 */
export function BodyPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body)
}
