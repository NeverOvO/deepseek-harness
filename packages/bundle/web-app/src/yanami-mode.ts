import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { serviceForAgent } from '@deepseek-ai/dsh-agent-presets'
import { z as zod } from 'zod'

/** Non-plan collaboration modes owned by Yanami Workbench. */
export type YanamiBaseMode = 'do' | 'spec' | 'review' | 'ship'
/** User-visible effective mode; upstream DSH Plan overlays the Yanami base mode. */
export type YanamiMode = YanamiBaseMode | 'plan'

export const YANAMI_BASE_MODES = ['do', 'spec', 'review', 'ship'] as const satisfies readonly YanamiBaseMode[]
const BASE_MODE_SET = new Set<string>(YANAMI_BASE_MODES)

/** Stable operator policy shared by every Yanami mode, including Plan. */
export const YANAMI_OPERATOR_PROMPT = `
You are the execution-focused operator inside Yanami Workbench. Work as one owner across product, engineering, validation, and delivery instead of acting only as an adviser.

Communicate in the user's language. Lead with the conclusion or current result, stay concise, and avoid narrating routine internal steps. Prefer one recommended path over dumping options.

Own the end-to-end loop. Resolve discoverable technical facts by inspecting the workspace. Proceed autonomously on reversible, low-risk implementation decisions. Ask only when a decision is materially user-owned or risky: irreversible actions, production side effects, credentials or secrets, meaningful product tradeoffs, legal or financial commitments, or destructive data changes.

Treat completion as evidence-based. Do not claim a task is complete until the relevant implementation, tests, static checks, builds, error/empty/permission states, and delivery notes have been validated as applicable. Distinguish clearly between completed work, validation that actually ran, and anything blocked or unverified.

Respect the active collaboration mode. Mode-specific restrictions override the general preference to execute.
`.trim()

/** Mode-specific policy. Plan is deliberately absent and delegated to upstream DSH plan-mode. */
export const YANAMI_MODE_PROMPTS: Readonly<Record<YanamiBaseMode, string>> = Object.freeze({
  do: 'You are in Do mode. Execute the requested outcome rather than stopping at advice or a plan. Inspect the existing implementation first, make the smallest coherent changes that satisfy the goal, and continue through relevant validation and delivery evidence. Keep going through reversible decisions without asking for confirmation.',
  spec: 'You are in Spec mode. Turn the request into a decision-complete product/engineering specification before implementation. Ground it in the actual workspace where relevant. Define scope, non-goals, user flow or data flow, acceptance criteria, edge cases, dependencies, migration/compatibility concerns, and validation strategy. Do not modify production implementation files in this mode unless the user explicitly changes mode or explicitly asks you to implement as part of the same request.',
  review: 'You are in Review mode. Inspect the existing work and produce an evidence-backed review. Prioritize correctness, regressions, security/privacy, data integrity, maintainability, UX failure states, and missing tests. Cite concrete files, behavior, or validation evidence. Do not edit implementation by default; propose the smallest fix for each material issue unless the user explicitly asks you to apply fixes.',
  ship: 'You are in Ship mode. Drive the current work to release readiness. Verify the relevant tests, static checks, builds, packaging, migrations, configuration, documentation, and release risks. You may make low-risk reversible fixes needed to unblock release and re-run validation. Do not publish, deploy, sign, charge money, change production data, or perform another irreversible release action without explicit user authorization.',
})

interface SessionLike {
  readonly header: { readonly agentPreset?: string }
  readonly events: readonly { type: string; data: unknown }[]
  append: (...args: never[]) => unknown
}
interface PlanModeState { readonly active: boolean; readonly pending?: boolean }
type PlanModeOutcome = 'committed' | 'queued' | 'cancelled' | 'noop'
interface PlanModeFacade {
  get(agent: Agent): PlanModeState
  set(agent: Agent, active: boolean): PlanModeOutcome
}
interface CommandFacade {
  register(definition: {
    name: string
    description: string
    input: { hint: string }
    handler(input: { agent: Agent; rawInput: string }): { kind: 'success' | 'error'; text: string }
  }): unknown
}
interface YanamiProjectionState {
  readonly base: YanamiBaseMode
  readonly plan: boolean
  readonly available: boolean
}
interface ProjectionFacade {
  register(definition: {
    key: string
    schema: unknown
    init(): YanamiProjectionState
    apply(state: YanamiProjectionState, event: { type: string; data: unknown }): YanamiProjectionState
    view(state: YanamiProjectionState): unknown
    stateVersion: number
  }): unknown
}

/** Standard is the only shipped DSH preset that currently opts into Yanami collaboration modes. */
export function yanamiModeEnabledForAgent(agent: Pick<Agent, 'session'>): boolean {
  const preset = agent.session.header.agentPreset
  return preset === undefined || preset === 'standard'
}

/** Fold the last durable non-plan mode; sessions with no event default to Do. */
export function foldYanamiMode(events: readonly { type: string; data: unknown }[], end = events.length): YanamiBaseMode {
  let mode: YanamiBaseMode = 'do'
  let index = 0
  for (const event of events) {
    if (index >= end) break
    index++
    if (event.type !== 'yanami/mode') continue
    const candidate = (event.data as { mode?: unknown }).mode
    if (typeof candidate === 'string' && isBaseMode(candidate)) mode = candidate
  }
  return mode
}

function hasOpenTurn(events: readonly { type: string }[]): boolean {
  let open = false
  for (const event of events) {
    if (event.type === 'turn/start') open = true
    else if (event.type === 'turn/end') open = false
  }
  return open
}
function isBaseMode(value: string): value is YanamiBaseMode { return BASE_MODE_SET.has(value) }
function appendMode(session: SessionLike, mode: YanamiBaseMode): void {
  const append = session.append as unknown as (type: string, data: unknown) => void
  append.call(session, 'yanami/mode', { mode })
}
function contextService<T>(ctx: Context, name: string): T | undefined {
  const get = ctx.get as unknown as (service: string) => unknown
  return get.call(ctx, name) as T | undefined
}
function injectWhenAvailable(ctx: Context, names: readonly string[], callback: (ctx: Context) => void): void {
  const inject = ctx.inject as unknown as (services: readonly string[], apply: (ctx: Context) => void) => void
  inject.call(ctx, names, callback)
}
function resolvePlanMode(ctx: Context, agent: Agent): PlanModeFacade | undefined {
  const lookup = serviceForAgent as unknown as (ctx: Context, agent: { ctx: Context }, name: string) => unknown
  return lookup(ctx, agent, 'planMode') as PlanModeFacade | undefined
}

/** Test seam for the one upstream preset-service lookup Yanami performs. */
export const internals = { resolvePlanMode }

export interface YanamiModeState { readonly mode: YanamiBaseMode; readonly pending?: YanamiBaseMode }

// `undefined` is intentional: session-projection serializes that as capability
// absence for non-Standard sessions, so Minimal/PTC/Creative never inherit a
// fake Yanami mode merely because the Host plugin is mounted process-wide.
const yanamiProjectionSchema = zod.object({
  mode: zod.enum(['do', 'spec', 'plan', 'review', 'ship']),
}).optional()

/**
 * Host-plane Yanami collaboration controller.
 *
 * DSH owns preset composition, model routing, Plan, Agent loop, and tool
 * presentation. Yanami only listens through public Agent/SystemPrompt seams
 * and reads the selected preset's isolated Plan service through the upstream
 * `serviceForAgent()` addressing seam. Non-Standard presets are transparent.
 */
export class YanamiModeController extends Service {
  static inject = ['systemPrompt']
  private readonly pendingIntents = new WeakMap<Agent['session'], YanamiBaseMode>()

  constructor(ctx: Context) {
    super(ctx, 'yanamiMode')

    ctx.on('agent/created', ({ agent }) => {
      if (!yanamiModeEnabledForAgent(agent)) return
      // The first durable base-mode event is also the projection capability marker.
      if (!agent.session.events.some(event => event.type === 'yanami/mode')) appendMode(agent.session as SessionLike, 'do')
    })

    ctx.on('agent/pre-step', async ({ agent, signal }, next): Promise<PreStepDecision> => {
      const decision = await next()
      if (decision.kind === 'reject' || signal.aborted || !yanamiModeEnabledForAgent(agent)) return decision
      try {
        this.onBoundary(agent.session as SessionLike)
      } catch (error) {
        ctx.logger.warn('yanami-mode: failed to commit selected mode at step start: %o', error)
      }
      return decision
    })

    ctx.systemPrompt.section({
      name: 'yanami:operator',
      order: 10,
      text: (context) => {
        const agent = context.agent
        return agent !== undefined && yanamiModeEnabledForAgent(agent) ? YANAMI_OPERATOR_PROMPT : ''
      },
    })
    ctx.systemPrompt.section({
      name: 'yanami:mode',
      order: 50,
      text: (context) => {
        const agent = context.agent
        if (agent === undefined || !yanamiModeEnabledForAgent(agent) || this.planTarget(ctx, agent)) return ''
        const state = this.get(agent)
        return YANAMI_MODE_PROMPTS[state.pending ?? state.mode]
      },
    })

    injectWhenAvailable(ctx, ['sessionProjections'], (projectionCtx) => {
      const projections = contextService<ProjectionFacade>(projectionCtx, 'sessionProjections')
      if (projections === undefined) return
      projections.register({
        key: 'yanamiMode',
        schema: yanamiProjectionSchema,
        init: () => ({ base: 'do', plan: false, available: false }),
        apply: (state, event) => {
          if (event.type === 'yanami/mode') {
            const candidate = (event.data as { mode?: unknown }).mode
            if (typeof candidate !== 'string' || !isBaseMode(candidate)) return state
            if (candidate === state.base && state.available) return state
            return { ...state, base: candidate, available: true }
          }
          if (event.type === 'plan/mode') {
            const active = (event.data as { active?: unknown }).active
            if (typeof active !== 'boolean' || active === state.plan) return state
            return { ...state, plan: active }
          }
          return state
        },
        view: state => state.available ? { mode: state.plan ? 'plan' : state.base } : undefined,
        stateVersion: 2,
      })
    })

    injectWhenAvailable(ctx, ['commands'], (commandCtx) => {
      const commands = contextService<CommandFacade>(commandCtx, 'commands')
      if (commands === undefined) return
      commands.register({
        name: 'mode',
        description: 'Show or switch Yanami collaboration mode',
        input: { hint: '[do|spec|plan|review|ship]' },
        handler: ({ agent, rawInput }) => {
          if (!yanamiModeEnabledForAgent(agent)) {
            return { kind: 'error', text: 'Yanami collaboration modes are available only with the DSH Standard preset.' }
          }
          const requested = rawInput.trim().toLowerCase()
          if (requested === '') return { kind: 'success', text: `Yanami mode: ${this.effective(ctx, agent)}.` }

          const planMode = internals.resolvePlanMode(ctx, agent)
          if (requested === 'plan') {
            if (planMode === undefined) return { kind: 'error', text: 'DSH Plan mode is unavailable for this Standard agent.' }
            const outcome = planMode.set(agent, true)
            return {
              kind: 'success',
              text: outcome === 'committed' ? 'Yanami mode: plan.' : 'Yanami mode: plan (applies from the next step).',
            }
          }
          if (!isBaseMode(requested)) return { kind: 'error', text: 'Usage: /mode [do|spec|plan|review|ship]' }

          // Plan remains upstream-owned; leaving it reveals the selected Yanami base mode.
          planMode?.set(agent, false)
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

  get(agent: Agent): YanamiModeState {
    const mode = foldYanamiMode(agent.session.events)
    const pending = this.pendingIntents.get(agent.session)
    return pending === undefined ? { mode } : { mode, pending }
  }

  effective(ctx: Context, agent: Agent): YanamiMode {
    if (this.planTarget(ctx, agent)) return 'plan'
    const state = this.get(agent)
    return state.pending ?? state.mode
  }

  set(agent: Agent, mode: YanamiBaseMode): 'committed' | 'queued' | 'cancelled' | 'noop' | 'unavailable' {
    if (!yanamiModeEnabledForAgent(agent)) return 'unavailable'
    const session = agent.session as SessionLike
    const pending = this.pendingIntents.get(agent.session)
    const durable = foldYanamiMode(session.events)
    const target = pending ?? durable
    if (target === mode) return 'noop'
    if (hasOpenTurn(session.events)) {
      if (durable === mode) {
        this.pendingIntents.delete(agent.session)
        return 'cancelled'
      }
      this.pendingIntents.set(agent.session, mode)
      return 'queued'
    }
    if (durable === mode) {
      this.pendingIntents.delete(agent.session)
      return 'cancelled'
    }
    appendMode(session, mode)
    this.pendingIntents.delete(agent.session)
    return 'committed'
  }

  private planTarget(ctx: Context, agent: Agent): boolean {
    const planMode = internals.resolvePlanMode(ctx, agent)
    if (planMode === undefined) return false
    const state = planMode.get(agent)
    return state.pending ?? state.active
  }

  private onBoundary(session: SessionLike): void {
    const typedSession = session as Agent['session']
    const pending = this.pendingIntents.get(typedSession)
    if (pending === undefined) return
    if (pending === foldYanamiMode(session.events)) {
      this.pendingIntents.delete(typedSession)
      return
    }
    appendMode(session, pending)
    this.pendingIntents.delete(typedSession)
  }
}

export default YanamiModeController
