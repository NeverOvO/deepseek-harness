import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  resolveSessionPreset,
  serviceForAgent,
  standingMountFor,
} from '@deepseek-ai/dsh-agent-presets'

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

interface PlanModeState {
  readonly active: boolean
  readonly pending?: boolean
}
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
  readonly pendingModeCommands: Readonly<Record<string, string>>
}
interface ProjectionFacade {
  register(definition: {
    key: string
    schema: { parse(value: unknown): { mode: YanamiMode } }
    init(): YanamiProjectionState
    apply(state: YanamiProjectionState, event: unknown): YanamiProjectionState
    view(state: YanamiProjectionState): { mode: YanamiMode }
    stateVersion: number
  }): unknown
}
interface EventRecord {
  readonly type: string
  readonly data: unknown
}

function eventRecord(value: unknown): EventRecord | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as { readonly type?: unknown; readonly data?: unknown }
  return typeof candidate.type === 'string'
    ? { type: candidate.type, data: candidate.data }
    : undefined
}

function objectData(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null
    ? value as Readonly<Record<string, unknown>>
    : undefined
}

function isBaseMode(value: string): value is YanamiBaseMode {
  return BASE_MODE_SET.has(value)
}

/**
 * Resolve the DSH preset the live agent actually runs.
 *
 * The standing mount is authoritative for live agents. `resolveSessionPreset`
 * is the durable fallback and already folds DSH's own `agent-preset/selected`
 * event, so Yanami never invents a second preset state machine.
 */
export function resolvedPresetForAgent(agent: Pick<Agent, 'session'> & Partial<Pick<Agent, 'ctx'>>): string | undefined {
  const mounted = agent.ctx === undefined ? undefined : standingMountFor(agent.ctx)?.presetId
  return mounted ?? resolveSessionPreset(agent.session)
}

/** Standard is the only shipped DSH preset that currently opts into Yanami collaboration modes. */
export function yanamiModeEnabledForAgent(agent: Pick<Agent, 'session'> & Partial<Pick<Agent, 'ctx'>>): boolean {
  return resolvedPresetForAgent(agent) === 'standard'
}

/**
 * Fold Yanami's durable base mode exclusively from DSH-owned command lifecycle records.
 * No Yanami-specific SessionEvent is written, so a pure/upgraded DSH reader can
 * always reconstruct the log using only its own event vocabulary.
 */
export function foldYanamiMode(events: readonly unknown[], end = events.length): YanamiBaseMode {
  let mode: YanamiBaseMode = 'do'
  const pending = new Map<string, string>()
  let index = 0
  for (const raw of events) {
    if (index >= end) break
    index += 1
    const event = eventRecord(raw)
    if (event === undefined) continue
    const data = objectData(event.data)
    if (data === undefined) continue

    if (event.type === 'command/run') {
      if (data.name !== 'mode' || typeof data.commandId !== 'string' || typeof data.args !== 'string') continue
      pending.set(data.commandId, data.args)
      continue
    }
    if (event.type !== 'command/done' || typeof data.commandId !== 'string') continue
    const args = pending.get(data.commandId)
    pending.delete(data.commandId)
    if (args === undefined || data.kind !== 'success') continue
    const requested = args.trim().toLowerCase()
    if (isBaseMode(requested)) mode = requested
  }
  return mode
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

const yanamiProjectionSchema = {
  parse(value: unknown): { mode: YanamiMode } {
    const data = objectData(value)
    const mode = data?.mode
    if (typeof mode !== 'string' || (!isBaseMode(mode) && mode !== 'plan')) {
      throw new Error('invalid Yanami mode projection')
    }
    return { mode }
  },
}

function applyProjection(state: YanamiProjectionState, raw: unknown): YanamiProjectionState {
  const event = eventRecord(raw)
  if (event === undefined) return state
  const data = objectData(event.data)
  if (data === undefined) return state

  if (event.type === 'plan/mode') {
    if (typeof data.active !== 'boolean' || data.active === state.plan) return state
    return { ...state, plan: data.active }
  }

  if (event.type === 'command/run') {
    if (data.name !== 'mode' || typeof data.commandId !== 'string' || typeof data.args !== 'string') return state
    return {
      ...state,
      pendingModeCommands: { ...state.pendingModeCommands, [data.commandId]: data.args },
    }
  }

  if (event.type !== 'command/done' || typeof data.commandId !== 'string') return state
  const args = state.pendingModeCommands[data.commandId]
  if (args === undefined) return state
  const pendingModeCommands = { ...state.pendingModeCommands }
  delete pendingModeCommands[data.commandId]
  if (data.kind !== 'success') return { ...state, pendingModeCommands }
  const requested = args.trim().toLowerCase()
  return isBaseMode(requested)
    ? { ...state, base: requested, pendingModeCommands }
    : { ...state, pendingModeCommands }
}

/**
 * Host-plane Yanami collaboration controller.
 *
 * DSH owns preset composition, model routing, Plan, Agent loop, Session events,
 * and tool presentation. Yanami only listens through public prompt/command/
 * projection seams, and it persists base-mode choices by reusing DSH's own
 * command lifecycle log. Non-Standard presets are model-input transparent.
 */
export class YanamiModeController extends Service {
  static inject = ['systemPrompt']

  constructor(ctx: Context) {
    super(ctx, 'yanamiMode')

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
        return YANAMI_MODE_PROMPTS[foldYanamiMode(agent.session.events)]
      },
    })

    injectWhenAvailable(ctx, ['sessionProjections'], (projectionCtx) => {
      const projections = contextService<ProjectionFacade>(projectionCtx, 'sessionProjections')
      if (projections === undefined) return
      projections.register({
        key: 'yanamiMode',
        schema: yanamiProjectionSchema,
        init: () => ({ base: 'do', plan: false, pendingModeCommands: {} }),
        apply: applyProjection,
        view: state => ({ mode: state.plan ? 'plan' : state.base }),
        stateVersion: 3,
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

          // The command's own DSH command/run + command/done pair persists the
          // selected base mode. Plan remains upstream-owned and is simply left.
          planMode?.set(agent, false)
          return { kind: 'success', text: `Yanami mode: ${requested}.` }
        },
      })
    })
  }

  effective(ctx: Context, agent: Agent): YanamiMode {
    if (this.planTarget(ctx, agent)) return 'plan'
    return foldYanamiMode(agent.session.events)
  }

  private planTarget(ctx: Context, agent: Agent): boolean {
    const planMode = internals.resolvePlanMode(ctx, agent)
    if (planMode === undefined) return false
    const state = planMode.get(agent)
    return state.pending ?? state.active
  }
}

export default YanamiModeController
