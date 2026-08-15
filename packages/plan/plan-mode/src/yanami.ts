import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-commands'
// Pull the existing `ctx.planMode` Context merge without duplicating it here.
import type {} from './index.ts'

/** Non-plan modes owned by Yanami Workbench. Plan remains owned by dsh-plan-mode. */
export const YANAMI_BASE_MODES = ['do', 'spec', 'review', 'ship'] as const
export type YanamiBaseMode = (typeof YANAMI_BASE_MODES)[number]
export type YanamiMode = YanamiBaseMode | 'plan'

const BASE_MODE_SET = new Set<string>(YANAMI_BASE_MODES)

/** Stable operator policy shared by every Yanami mode, including Plan. */
export const YANAMI_OPERATOR_PROMPT = `
You are the execution-focused operator inside Yanami Workbench. Work as one owner across product, engineering, validation, and delivery instead of acting only as an adviser.

Communicate in the user's language. Lead with the conclusion or current result, stay concise, and avoid narrating routine internal steps. Prefer one recommended path over dumping options.

Own the end-to-end loop. Resolve discoverable technical facts by inspecting the workspace. Proceed autonomously on reversible, low-risk implementation decisions. Ask only when a decision is materially user-owned or risky: irreversible actions, production side effects, credentials or secrets, meaningful product tradeoffs, legal or financial commitments, or destructive data changes.

Treat completion as evidence-based. Do not claim a task is complete until the relevant implementation, tests, static checks, builds, error/empty/permission states, and delivery notes have been validated as applicable. Distinguish clearly between completed work, validation that actually ran, and anything blocked or unverified.

Respect the active collaboration mode. Mode-specific restrictions override the general preference to execute.
`.trim()

/** Mode-specific policy. Plan is deliberately absent and delegated to dsh-plan-mode. */
export const YANAMI_MODE_PROMPTS: Readonly<Record<YanamiBaseMode, string>> = Object.freeze({
  do: `
You are in Do mode. Execute the requested outcome rather than stopping at advice or a plan. Inspect the existing implementation first, make the smallest coherent changes that satisfy the goal, and continue through relevant validation and delivery evidence. Keep going through reversible decisions without asking for confirmation.
`.trim(),
  spec: `
You are in Spec mode. Turn the request into a decision-complete product/engineering specification before implementation. Ground it in the actual workspace where relevant. Define scope, non-goals, user flow or data flow, acceptance criteria, edge cases, dependencies, migration/compatibility concerns, and validation strategy. Do not modify production implementation files in this mode unless the user explicitly changes mode or explicitly asks you to implement as part of the same request.
`.trim(),
  review: `
You are in Review mode. Inspect the existing work and produce an evidence-backed review. Prioritize correctness, regressions, security/privacy, data integrity, maintainability, UX failure states, and missing tests. Cite concrete files, behavior, or validation evidence. Do not edit implementation by default; propose the smallest fix for each material issue unless the user explicitly asks you to apply fixes.
`.trim(),
  ship: `
You are in Ship mode. Drive the current work to release readiness. Verify the relevant tests, static checks, builds, packaging, migrations, configuration, documentation, and release risks. You may make low-risk reversible fixes needed to unblock release and re-run validation. Do not publish, deploy, sign, charge money, change production data, or perform another irreversible release action without explicit user authorization.
`.trim(),
})

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Last non-plan Yanami mode; Plan is an overlay owned by `plan/mode`. */
    'yanami/mode': { mode: YanamiBaseMode }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    yanamiMode: YanamiModeController
  }
}

/** Fold the last durable non-plan mode; sessions with no event default to Do. */
export function foldYanamiMode(events: readonly SessionEvent[], end = events.length): YanamiBaseMode {
  let mode: YanamiBaseMode = 'do'
  let index = 0
  for (const event of events) {
    if (index >= end) break
    index++
    if (event.type === 'yanami/mode') mode = event.data.mode
  }
  return mode
}

function hasOpenTurn(events: readonly SessionEvent[]): boolean {
  let open = false
  for (const event of events) {
    if (event.type === 'turn/start') open = true
    else if (event.type === 'turn/end') open = false
  }
  return open
}

function isBaseMode(value: string): value is YanamiBaseMode {
  return BASE_MODE_SET.has(value)
}

export interface YanamiModeState {
  mode: YanamiBaseMode
  pending?: YanamiBaseMode
}

/**
 * Durable Yanami collaboration mode. `plan/mode` remains authoritative for
 * Plan and overlays (rather than replaces) the last Yanami base mode.
 */
export class YanamiModeController extends Service {
  static inject = ['systemPrompt', 'planMode']

  private readonly pendingIntents = new WeakMap<Session, YanamiBaseMode>()

  constructor(ctx: Context) {
    super(ctx, 'yanamiMode')

    ctx.on('agent/pre-step', async ({ agent, signal }, next): Promise<PreStepDecision> => {
      const decision = await next()
      if (decision.kind === 'reject' || signal.aborted) return decision
      try {
        this.onBoundary(agent.session)
      } catch (error) {
        ctx.logger.warn('dsh-yanami-mode: failed to commit selected mode at step start: %o', error)
      }
      return decision
    })

    ctx.systemPrompt.section({
      name: 'yanami:operator',
      order: 10,
      text: YANAMI_OPERATOR_PROMPT,
    })

    ctx.systemPrompt.section({
      name: 'yanami:mode',
      order: 50,
      text: (context) => {
        const agent = context.agent
        if (agent === undefined) return ''
        if (this.planTarget(ctx, agent)) return ''
        const state = this.get(agent)
        return YANAMI_MODE_PROMPTS[state.pending ?? state.mode]
      },
    })

    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.commands.register({
        name: 'mode',
        description: 'Show or switch Yanami collaboration mode',
        input: { hint: '[do|spec|plan|review|ship]' },
        handler: ({ agent, rawInput }) => {
          const requested = rawInput.trim().toLowerCase()
          if (requested === '') {
            return { kind: 'success', text: `Yanami mode: ${this.effective(ctx, agent)}.` }
          }
          if (requested === 'plan') {
            const outcome = ctx.planMode.set(agent, true)
            return {
              kind: 'success',
              text: outcome === 'committed'
                ? 'Yanami mode: plan.'
                : 'Yanami mode: plan (applies from the next step).',
            }
          }
          if (!isBaseMode(requested)) {
            return { kind: 'error', text: 'Usage: /mode [do|spec|plan|review|ship]' }
          }

          // Plan is an overlay. Leaving it reveals the selected base mode.
          ctx.planMode.set(agent, false)
          const outcome = this.set(agent, requested)
          return {
            kind: 'success',
            text: outcome === 'committed' || outcome === 'noop'
              ? `Yanami mode: ${requested}.`
              : `Yanami mode: ${requested} (applies from the next step).`,
          }
        },
      })
    })
  }

  /** Read the durable base mode and an in-turn selection waiting for a boundary. */
  get(agent: Agent): YanamiModeState {
    const mode = foldYanamiMode(agent.session.events)
    const pending = this.pendingIntents.get(agent.session)
    return pending === undefined ? { mode } : { mode, pending }
  }

  /** Read the user-visible effective mode, with Plan overlaying the base mode. */
  effective(ctx: Context, agent: Agent): YanamiMode {
    if (this.planTarget(ctx, agent)) return 'plan'
    const state = this.get(agent)
    return state.pending ?? state.mode
  }

  /** Select a non-plan mode, committing immediately between turns. */
  set(agent: Agent, mode: YanamiBaseMode): 'committed' | 'queued' | 'cancelled' | 'noop' {
    const session = agent.session
    const pending = this.pendingIntents.get(session)
    const durable = foldYanamiMode(session.events)
    const target = pending ?? durable
    if (target === mode) return 'noop'

    if (hasOpenTurn(session.events)) {
      if (durable === mode) {
        this.pendingIntents.delete(session)
        return 'cancelled'
      }
      this.pendingIntents.set(session, mode)
      return 'queued'
    }

    if (durable === mode) {
      this.pendingIntents.delete(session)
      return 'cancelled'
    }
    session.append('yanami/mode', { mode })
    this.pendingIntents.delete(session)
    return 'committed'
  }

  private planTarget(ctx: Context, agent: Agent): boolean {
    const state = ctx.planMode.get(agent)
    return state.pending ?? state.active
  }

  private onBoundary(session: Session): void {
    const pending = this.pendingIntents.get(session)
    if (pending === undefined) return
    if (pending === foldYanamiMode(session.events)) {
      this.pendingIntents.delete(session)
      return
    }
    session.append('yanami/mode', { mode: pending })
    this.pendingIntents.delete(session)
  }
}

export default YanamiModeController
