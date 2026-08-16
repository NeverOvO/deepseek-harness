/**
 * Yanami compatibility policy for the agent presets shipped by DSH.
 *
 * The preset id is persisted on SessionHeader.agentPreset. Yanami consumes
 * that upstream identity rather than inventing a second mode selector. Unknown
 * or custom presets retain the historical Standard-compatible behavior until
 * DSH exposes richer capability metadata for arbitrary presets.
 */

/** Product-facing DSH Harness modes. */
export type DshHarnessMode = 'standard' | 'ptc' | 'minimal' | 'creative'

/** Built-in preset ids shipped under apps/cli/config/agent-presets. */
export type DshBuiltInAgentPreset = 'standard' | 'code' | 'minimal' | 'cordis'

/**
 * Model-facing Yanami enhancements allowed for one Harness mode.
 *
 * Host-side Project Memory storage, candidate review, and Workbench UI are
 * deliberately outside this policy: Minimal keeps those host capabilities
 * while Yanami adds nothing to its model-facing two-tool agent composition.
 */
export interface YanamiHarnessPolicy {
  readonly mode: DshHarnessMode
  /** Whether Yanami may register project_memory_propose in the Agent scope. */
  readonly projectMemoryProposalTool: boolean
  /** Whether Yanami may add the Project Memory proposal policy prompt section. */
  readonly projectMemoryProposalPrompt: boolean
  /** Whether Yanami may steer an extra model step at agent/turn-stopping. */
  readonly projectMemoryTurnReview: boolean
}

const STANDARD_POLICY: YanamiHarnessPolicy = Object.freeze({
  mode: 'standard',
  projectMemoryProposalTool: true,
  projectMemoryProposalPrompt: true,
  projectMemoryTurnReview: true,
})

const PTC_POLICY: YanamiHarnessPolicy = Object.freeze({
  mode: 'ptc',
  projectMemoryProposalTool: true,
  projectMemoryProposalPrompt: true,
  projectMemoryTurnReview: true,
})

const MINIMAL_POLICY: YanamiHarnessPolicy = Object.freeze({
  mode: 'minimal',
  projectMemoryProposalTool: false,
  projectMemoryProposalPrompt: false,
  projectMemoryTurnReview: false,
})

const CREATIVE_POLICY: YanamiHarnessPolicy = Object.freeze({
  mode: 'creative',
  projectMemoryProposalTool: true,
  projectMemoryProposalPrompt: true,
  projectMemoryTurnReview: true,
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
 * `standard`, an absent preset, and custom/unknown preset ids intentionally use
 * the legacy Standard behavior. This is fail-open for compatibility, while the
 * one upstream preset with a strict minimality contract is fail-closed.
 */
export function yanamiHarnessPolicyForAgentPreset(
  agentPreset: string | null | undefined,
): YanamiHarnessPolicy {
  const mode = harnessModeForAgentPreset(agentPreset)
  if (mode === 'ptc') return PTC_POLICY
  if (mode === 'minimal') return MINIMAL_POLICY
  if (mode === 'creative') return CREATIVE_POLICY
  return STANDARD_POLICY
}
