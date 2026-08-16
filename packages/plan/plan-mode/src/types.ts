/**
 * Pure types of the plan/collaboration domain. Plan remains upstream-owned;
 * the Yanami projection contract is kept here temporarily as a client-safe
 * compatibility face while the runtime implementation lives in dsh-web-app.
 *
 * @module @deepseek-ai/dsh-plan-mode/types
 */

/**
 * The plan projection's wire value. `active` is the logged state in force
 * (the last `plan/mode`, inactive before the first); `pending` is true while
 * a logged `/plan` selection (`command/run`) targets a state other than
 * `active` and no later `plan/mode` event has recorded that state. Capability
 * absence (plan-mode not composed) is the key's absence, never a value.
 */
export interface PlanProjection {
  active: boolean
  pending: boolean
}

/** Durable non-plan collaboration modes owned by Yanami Workbench. */
export type YanamiBaseMode = 'do' | 'spec' | 'review' | 'ship'

/** User-visible effective mode; Plan overlays rather than replaces the base mode. */
export type YanamiMode = YanamiBaseMode | 'plan'

/** Host-folded effective Yanami mode exposed to browser clients. */
export interface YanamiModeProjection {
  mode: YanamiMode
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Plan collaboration state folded from `command/run` (name `plan`) and `plan/mode` events. */
    plan: PlanProjection
    /** Yanami collaboration mode folded from DSH-owned command and Plan events. */
    yanamiMode: YanamiModeProjection
  }
}
