/**
 * Yanami compatibility policy for the agent presets shipped by DSH.
 *
 * The preset id is persisted on SessionHeader.agentPreset. Yanami consumes
 * that upstream identity rather than inventing a second mode selector. Exact
 * shipped preset ids may opt into Yanami model-facing enhancements; unknown or
 * future preset ids fail closed so an upstream DSH update keeps its native
 * prompt, context, tool, and turn-stop behavior until Yanami explicitly reviews it.
 */

/** Product-facing DSH Harness modes. */
export type DshHarnessMode = 'standard' | 'ptc' | 'minimal' | 'creative'

/** Built-in preset ids shipped under apps/cli/config/agent-presets. */
export type DshBuiltInAgentPreset = 'standard' | 'code' | 'minimal' | 'cordis'

/**
 * Model-facing Yanami enhancements allowed for one Harness mode.
 *
 * Host-side Project Memory storage, candidate review, and Workbench UI are
 * deliberately outside this policy: disabling these switches leaves the DSH
 * model/agent composition untouched while those host capabilities remain.
 */
export interface YanamiHarnessPolicy {
  readonly mode: DshHarnessMode
  /** Whether Yanami may append durable Project Memory to the assembled model context. */
  readonly projectMemoryContext: boolean
  /** Whether Yanami may register project_memory_propose in the Agent scope. */
  readonly projectMemoryProposalTool: boolean
  /** Whether Yanami may add the Project Memory proposal policy prompt section. */
  readonly projectMemoryProposalPrompt: boolean
  /** Whether Yanami may steer an extra model step at agent/turn-stopping. */
  readonly projectMemoryTurnReview: boolean
}

const STANDARD_POLICY: YanamiHarnessPolicy = Object.freeze({
  mode: 'standard',
  projectMemoryContext: true,
  projectMemoryProposalTool: true,
  projectMemoryProposalPrompt: true,
  projectMemoryTurnReview: true,
})

const PTC_POLICY: YanamiHarnessPolicy = Object.freeze({
  mode: 'ptc',
  projectMemoryContext: true,
  projectMemoryProposalTool: true,
  projectMemoryProposalPrompt: true,
  projectMemoryTurnReview: true,
})

const MINIMAL_POLICY: YanamiHarnessPolicy = Object.freeze({
  mode: 'minimal',
  projectMemoryContext: false,
  projectMemoryProposalTool: false,
  projectMemoryProposalPrompt: false,
  projectMemoryTurnReview: false,
})

const CREATIVE_POLICY: YanamiHarnessPolicy = Object.freeze({
  mode: 'creative',
  projectMemoryContext: true,
  projectMemoryProposalTool: true,
  projectMemoryProposalPrompt: true,
  projectMemoryTurnReview: true,
})

/**
 * Compatibility fence for custom or newly introduced upstream presets.
 *
 * The display mode remains Standard-compatible, but Yanami adds no model-facing
 * prompt, context, tool, or lifecycle turn until that preset has been explicitly mapped.
 */
const UNMAPPED_UPSTREAM_POLICY: YanamiHarnessPolicy = Object.freeze({
  mode: 'standard',
  projectMemoryContext: false,
  projectMemoryProposalTool: false,
  projectMemoryProposalPrompt: false,
  projectMemoryTurnReview: false,
})

/** Resolve the official product mode from the persisted built-in preset id. */
export function harnessModeForAgentPreset(agentPreset: string | null | undefined): DshHarnessMode {
  if (agentPreset === 'code') return 'ptc'
  if (agentPreset === 'minimal') return 'minimal'
  if (agentPreset === 'cordis') return 'creative'
  return 'standard'
}

/**
 * Resolve Yanami model-facing behavior for one DSH Agent preset.
 *
 * The default/absent preset is the shipped Standard composition. Exact known
 * built-ins keep their reviewed Yanami behavior. Any custom or future upstream
 * preset is fail-closed so Yanami cannot silently alter a new DSH composition.
 */
export function yanamiHarnessPolicyForAgentPreset(
  agentPreset: string | null | undefined,
): YanamiHarnessPolicy {
  if (agentPreset === undefined || agentPreset === null || agentPreset === 'standard') return STANDARD_POLICY
  if (agentPreset === 'code') return PTC_POLICY
  if (agentPreset === 'minimal') return MINIMAL_POLICY
  if (agentPreset === 'cordis') return CREATIVE_POLICY
  return UNMAPPED_UPSTREAM_POLICY
}
