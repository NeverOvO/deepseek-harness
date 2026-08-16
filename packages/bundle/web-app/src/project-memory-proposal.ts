/**
 * Agent-scoped Project Memory proposal tool for the Workbench surface.
 *
 * The model can only stage a candidate. It never receives a workspace id and
 * cannot commit durable Project Memory; the human review queue remains the
 * sole path from a model suggestion into committed memory.
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Workspace, WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-workspace/project-memory'
import type {
  ProjectMemoryCandidateReviewHint, ProjectMemoryCandidateSource, ProjectMemorySection,
} from '@deepseek-ai/dsh-workspace/project-memory-types'

/** Stable model-facing tool name. */
export const PROJECT_MEMORY_PROPOSE_TOOL = 'project_memory_propose'

const SECTION_NAMES = [
  'architecture',
  'commands',
  'conventions',
  'decisions',
  'knownIssues',
  'definitionOfDone',
] as const satisfies readonly ProjectMemorySection[]

const RELATIONSHIP_NAMES = ['additive', 'supersedes', 'conflicts'] as const

const MAX_CANDIDATE_CHARS = 8_000
const MAX_RATIONALE_CHARS = 2_000
const MAX_PENDING_CANDIDATES = 100
const SENSITIVE_PATTERNS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/u,
  /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/u,
  /\b(?:password|passwd|secret|token|api[_ -]?key|密码|密钥|令牌)\s*[:=]\s*["']?[^\s"']{8,}/iu,
] as const

const PROPOSAL_POLICY = `Project Memory candidate policy: when the current work establishes a NEW durable project-wide fact that should guide future sessions, stage one concise candidate with \`${PROJECT_MEMORY_PROPOSE_TOOL}\`. Good candidates are stable architecture, repeatable project commands, conventions, explicit decisions, durable known issues, and definition-of-done criteria. Before concluding each turn or marking a goal/mission complete, perform one final Project Memory check and stage any qualifying facts before the final response or completion action. Classify the candidate relationship as additive, supersedes, or conflicts relative to remembered Project Memory, and give a short rationale when useful. This relationship is only an advisory review hint: it never authorizes replacing committed memory. Do not stage transient progress, temporary observations, unverified guesses, secrets, credentials, personal data, one-off task details, or facts already present in Project Memory. A proposal is only pending human review; never claim it was saved or committed until the user accepts it.`

const AUTOMATIC_REVIEW_PROMPT = `Internal Project Memory lifecycle review. Inspect the work completed in the turn that is about to close. If it established any NEW durable project-wide fact that should guide future sessions, call \`${PROJECT_MEMORY_PROPOSE_TOOL}\` once per qualifying fact using the correct section and relationship. Do not propose transient progress, one-off task details, guesses, secrets, credentials, personal data, or facts already present in remembered Project Memory. This is an internal review step: do not repeat or revise the user-facing answer and do not add user-facing commentary. If nothing qualifies, make no tool call and finish.`

const AUTOMATIC_MISSION_REVIEW_PROMPT = `Internal Project Memory mission-completion review. A goal/mission completed during the turn that is about to close. Inspect the completed mission for NEW durable project-wide facts that should guide future sessions, especially stable decisions, architecture, conventions, repeatable commands, durable known issues, and definition-of-done criteria. Call \`${PROJECT_MEMORY_PROPOSE_TOOL}\` once per qualifying fact using the correct section and relationship. Do not propose transient progress, one-off task details, guesses, secrets, credentials, personal data, or facts already present in remembered Project Memory. This is an internal review step: do not repeat or revise the user-facing answer and do not add user-facing commentary. If nothing qualifies, make no tool call and finish.`

type AutomaticReviewSource = Extract<ProjectMemoryCandidateSource, 'session' | 'mission'>
type SteerMessage = Parameters<Agent['steer']>[0]

/** Resolve only already-registered Workspace ownership; never create one as a tool side effect. */
function workspaceForSession(
  ctx: Context,
  sessionId: string,
  cwd: string | undefined,
): Workspace | undefined {
  const workspaces = ctx.workspaceRegistry.list()
  return workspaces.find(workspace => workspace.sessionIds.some(id => id === sessionId))
    ?? (cwd === undefined ? undefined : workspaces.find(workspace => workspace.path === cwd))
}

/** Reject obvious credential-bearing text before it can enter durable candidate storage. */
function containsSensitiveText(text: string): boolean {
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(text))
}

function reviewHintFor(
  relationship: typeof RELATIONSHIP_NAMES[number],
): ProjectMemoryCandidateReviewHint {
  if (relationship === 'supersedes') return 'supersedes'
  if (relationship === 'conflicts') return 'conflict'
  return 'append'
}

/**
 * Build one proposal tool bound to an already resolved Workspace and Session.
 * The binding is closure-owned rather than model input, preventing cross-workspace writes.
 */
function proposalTool(
  ctx: Context,
  workspaceId: WorkspaceId,
  sessionId: string,
  source: () => ProjectMemoryCandidateSource = () => 'automatic',
) {
  return defineTool({
    name: PROJECT_MEMORY_PROPOSE_TOOL,
    description:
      'Propose one durable project-wide fact for human review. Use this only for stable architecture, '
      + 'commands, conventions, decisions, known issues, or definition-of-done facts that should survive '
      + 'future sessions. Do not propose transient progress, temporary observations, secrets, credentials, '
      + 'personal data, or one-off task details. Relationship hints are advisory only. This tool only stages '
      + 'a candidate; it never commits or replaces Project Memory.',
    parameters: {
      section: {
        type: 'string',
        enum: SECTION_NAMES,
        required: true,
        description: 'The canonical Project Memory section that should receive this fact if a human accepts it.',
      },
      text: {
        type: 'string',
        required: true,
        description: 'A concise self-contained durable fact. Do not include secrets or transient task progress.',
      },
      relationship: {
        type: 'string',
        enum: RELATIONSHIP_NAMES,
        required: true,
        description: 'Advisory relationship to remembered Project Memory: additive, supersedes, or conflicts. This never authorizes replacement.',
      },
      rationale: {
        type: 'string',
        description: 'Optional concise reason for the relationship classification. Never include secrets or personal data.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          candidateId: { type: 'string', required: true },
          section: { type: 'string', enum: SECTION_NAMES, required: true },
          status: { type: 'string', const: 'pending-review', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Project Memory candidate ${value.candidateId} is pending human review in ${value.section}. It is not committed memory yet.`,
      }],
    },
    async execute(args) {
      const text = args.text.trim()
      const rationale = args.rationale?.trim() ?? null
      if (text.length === 0) throw new Error('Project Memory candidate text must not be empty')
      if (text.length > MAX_CANDIDATE_CHARS) {
        throw new Error(`Project Memory candidate text exceeds ${String(MAX_CANDIDATE_CHARS)} characters`)
      }
      if (rationale !== null && rationale.length > MAX_RATIONALE_CHARS) {
        throw new Error(`Project Memory candidate rationale exceeds ${String(MAX_RATIONALE_CHARS)} characters`)
      }
      if (containsSensitiveText(text) || (rationale !== null && containsSensitiveText(rationale))) {
        throw new Error('Project Memory candidate looks like it contains a credential or secret')
      }
      if (ctx.projectMemory.candidates(workspaceId).length >= MAX_PENDING_CANDIDATES) {
        throw new Error(`Project Memory already has ${String(MAX_PENDING_CANDIDATES)} candidates pending review`)
      }
      const candidate = await ctx.projectMemory.proposeCandidate(
        workspaceId,
        args.section,
        text,
        source(),
        sessionId,
        reviewHintFor(args.relationship),
        rationale,
      )
      return {
        candidateId: candidate.id,
        section: candidate.section,
        status: 'pending-review' as const,
      }
    },
  })
}

/** Whether one open turn already staged Project Memory through the model-facing tool. */
function turnHasProposalCall(agent: Agent, turn: number): boolean {
  return agent.session.events.some(event => event.type === 'tool/call'
    && event.data.turn === turn
    && event.data.name === PROJECT_MEMORY_PROPOSE_TOOL)
}

/** Whether one open turn has any model output worth reviewing before it closes. */
function turnHasAssistantMessage(agent: Agent, turn: number): boolean {
  return agent.session.events.some(event => event.type === 'assistant/message' && event.data.turn === turn)
}

/**
 * Detect a completed Goal/Mission without importing the Goal host package into
 * this bundle. Goal's durable `goal/change` payload is intentionally inspected
 * structurally, bounded to the current open turn.
 */
function turnCompletedMission(agent: Agent, turn: number): boolean {
  const events = agent.session.events
  let start = -1
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'turn/start' && event.data.turn === turn) {
      start = index
      break
    }
  }
  if (start < 0) return false
  for (const event of events.slice(start + 1)) {
    const structural = event as unknown as { readonly type: string; readonly data: unknown }
    if (structural.type !== 'goal/change'
      || structural.data === null
      || typeof structural.data !== 'object') continue
    const data = structural.data as { readonly operation?: unknown }
    if (data.operation === 'complete') return true
  }
  return false
}

/** Decide whether lifecycle enforcement owes this turn one automatic review. */
function automaticReviewSource(agent: Agent, turn: number): AutomaticReviewSource | undefined {
  if (turnHasProposalCall(agent, turn) || !turnHasAssistantMessage(agent, turn)) return undefined
  return turnCompletedMission(agent, turn) ? 'mission' : 'session'
}

/** Build a plugin-notice steering message without adding a new runtime package edge. */
function automaticReviewMessage(source: AutomaticReviewSource): SteerMessage {
  const mission = source === 'mission'
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: mission ? AUTOMATIC_MISSION_REVIEW_PROMPT : AUTOMATIC_REVIEW_PROMPT }],
    source: {
      kind: 'plugin',
      plugin: 'web-app',
      form: 'notice',
      summary: mission ? 'Project Memory mission review' : 'Project Memory turn review',
    },
  } as unknown as SteerMessage
}

/**
 * Enforce one final model-side memory check at the true turn stop boundary.
 * The first stopping pass may steer exactly once; the second pass closes the
 * same turn and clears the temporary source tag, preventing recursive reviews.
 */
function installAutomaticReviewTrigger(
  ctx: Context,
  candidateSources: Map<string, ProjectMemoryCandidateSource>,
): void {
  const reviewedTurns = new WeakMap<Agent, number>()

  ctx.on('agent/turn-stopping', ({ agent, turn }) => {
    const workspace = workspaceForSession(ctx, agent.id, agent.session.header.cwd)
    if (workspace === undefined) return

    if (reviewedTurns.get(agent) === turn) {
      candidateSources.delete(agent.id)
      return
    }
    reviewedTurns.set(agent, turn)

    const source = automaticReviewSource(agent, turn)
    if (source === undefined) return
    candidateSources.set(agent.id, source)
    try {
      agent.steer(automaticReviewMessage(source))
    } catch (error: unknown) {
      candidateSources.delete(agent.id)
      ctx.logger.warn(
        `Project Memory automatic ${source} review could not steer agent '${agent.id}': ${String(error)}`,
      )
    }
  })

  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/end') candidateSources.delete(session.id)
  })
  ctx.on('agent/disposed', ({ agent }) => { candidateSources.delete(agent.id) })
}

/**
 * Forward durable candidate-domain changes as workspace-scoped invalidation
 * hints. The id→Workspace map is seeded from persisted candidates at boot so a
 * delete after restart still identifies its owner even though domain delete
 * tombstones intentionally carry no old value.
 */
function installCandidateChangeBridge(ctx: Context): void {
  const owners = new Map<string, WorkspaceId>()
  for (const workspace of ctx.workspaceRegistry.list()) {
    for (const candidate of ctx.projectMemory.candidates(workspace.id)) {
      owners.set(candidate.id, workspace.id)
    }
  }

  ctx.on('domain/changed', (change: DomainChanged) => {
    if (change.domain !== 'project_memory_candidates' || change.table !== 'candidates') return
    let workspaceId: WorkspaceId | undefined
    if (change.operation === 'put') {
      const value = change.value as { readonly workspaceId?: unknown }
      if (typeof value.workspaceId !== 'string') return
      workspaceId = value.workspaceId as WorkspaceId
      owners.set(change.key, workspaceId)
    } else {
      workspaceId = owners.get(change.key)
      owners.delete(change.key)
    }
    if (workspaceId !== undefined) ctx.emit('project-memory/candidates-changed', workspaceId)
  })
}

/** Narrow test seams for the safety decisions this module owns. */
export const internals = Object.freeze({
  workspaceForSession,
  proposalTool,
  proposalPolicy: PROPOSAL_POLICY,
  installCandidateChangeBridge,
  installAutomaticReviewTrigger,
  automaticReviewSource,
  automaticReviewMessage,
  containsSensitiveText,
  reviewHintFor,
})

/**
 * Register the proposal tool and its policy into each eligible Agent scope before
 * the first session-start/model request. Sessions outside registered Workspaces
 * receive neither. The same host scope also forwards candidate-domain changes
 * to browser consumers, so model-originated proposals update review UI without
 * polling. A cwd match is used as the creation-time fallback because the
 * Workspace session-id attachment may settle immediately after Agent publication.
 */
export function installProjectMemoryProposalTool(ctx: Context): void {
  ctx.inject(['workspaceRegistry', 'projectMemory'], (memoryCtx) => {
    const candidateSources = new Map<string, ProjectMemoryCandidateSource>()
    installCandidateChangeBridge(memoryCtx)
    installAutomaticReviewTrigger(memoryCtx, candidateSources)
    memoryCtx.on('agent/created', ({ agent }) => {
      const workspace = workspaceForSession(memoryCtx, agent.id, agent.session.header.cwd)
      if (workspace === undefined) return
      agent.ctx.tools.register(proposalTool(
        memoryCtx,
        workspace.id,
        agent.id,
        () => candidateSources.get(agent.id) ?? 'automatic',
      ))
      agent.ctx.systemPrompt.section({
        name: 'yanami:project-memory-proposal-policy',
        order: 98,
        text: PROPOSAL_POLICY,
      })
    })
  })
}
