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
import { renderProjectMemoryContext } from '@deepseek-ai/dsh-workspace/project-memory'
import type {
  ProjectMemoryCandidateReviewHint,
  ProjectMemoryCandidateSource,
  ProjectMemoryCandidateView,
  ProjectMemorySection,
} from '@deepseek-ai/dsh-workspace/project-memory-types'
import { yanamiHarnessPolicyForAgentPreset } from './harness-mode.ts'

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

const RELATIONSHIP_NAMES = ['additive', 'supersedes', 'consolidates', 'conflicts'] as const
const CONFIDENCE_NAMES = ['high', 'medium', 'low'] as const
const DURABILITY_NAMES = ['project-wide', 'task-local'] as const

const MAX_CANDIDATE_CHARS = 8_000
const MAX_RATIONALE_CHARS = 2_000
const MAX_PENDING_CANDIDATES = 100
const MAX_PENDING_CANDIDATES_PER_SECTION = 24
const NEAR_DUPLICATE_THRESHOLD = 0.9
const CONSOLIDATION_SOURCE_PREFIX = 'consolidation:'
const SENSITIVE_PATTERNS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/u,
  /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/u,
  /\b(?:password|passwd|secret|token|api[_ -]?key|密码|密钥|令牌)\s*[:=]\s*["']?[^\s"']{8,}/iu,
] as const
const LOW_SIGNAL_PATTERNS = [
  /^(?:done|completed|finished|task complete|all green|all tests? passed|tests? passed|build passed|build succeeded|build successful|ci passed|ci green)[.!。！\s]*$/iu,
  /^(?:完成|已完成|任务完成|全部通过|全绿|测试通过|测试已通过|构建通过|构建已通过|构建成功)[。.!！\s]*$/u,
] as const

const PROPOSAL_POLICY = `Project Memory candidate policy: when the current work establishes a NEW durable project-wide fact that should guide future sessions, stage one concise candidate with \`${PROJECT_MEMORY_PROPOSE_TOOL}\`. Good candidates are stable architecture, repeatable project commands, conventions, explicit decisions, durable known issues, and definition-of-done criteria. Before concluding each turn or marking a goal/mission complete, perform one final Project Memory check and stage any qualifying facts before the final response or completion action. For every proposal, classify confidence as high, medium, or low and durability as project-wide or task-local; low-confidence and task-local proposals are intentionally discarded by the Host quality gate. Classify the candidate relationship as additive, supersedes, consolidates, or conflicts relative to remembered Project Memory, and give a short rationale when useful. If and only if relationship is supersedes, copy the exact existing Project Memory block or line being replaced into supersedesText; do not paraphrase the target. Never provide supersedesText for consolidates: consolidation replaces one entire section, and the Host captures the exact committed before-snapshot itself. When an additive proposal returns consolidation-required, use the same tool again in the same model step with relationship consolidates and produce one materially shorter full-section result that preserves the durable source facts while incorporating the new durable fact. Consolidation is allowed only while the entire source section is still visible under the existing Project Memory context budget; if the source is already truncated, the Host refuses automatic consolidation rather than guessing. A consolidation proposal is still only a candidate: the user sees full before/after, and acceptance performs byte-exact compare-and-swap against the original committed snapshot so any intervening change rejects the write. Prefer one compact candidate over several near-duplicates. Never stage transient progress such as a task merely being done, tests merely passing, or a build merely being green; a durable rule such as "release requires all gates green" is different and may qualify. The Host also suppresses committed duplicates, near-duplicate pending candidates, overfull review queues, and additive growth that would exceed the existing model-visible Project Memory budget. Relationship hints are advisory review metadata: no candidate can write until a human accepts it. Do not stage unverified guesses, secrets, credentials, personal data, one-off task details, or facts already present in Project Memory. A proposal is only pending human review; never claim it was saved or committed until the user accepts it.`

const AUTOMATIC_REVIEW_PROMPT = `Internal Project Memory lifecycle review. Inspect the work completed in the turn that is about to close. If it established NEW durable project-wide facts that should guide future sessions, call \`${PROJECT_MEMORY_PROPOSE_TOOL}\` for at most two strong candidates. Set durability to project-wide. Set confidence to high only for explicit durable facts, medium for strongly supported durable facts, and low when uncertain; low confidence is discarded. When a new fact truly replaces remembered Project Memory, set relationship to supersedes and copy the exact old remembered block or line into supersedesText. If an additive proposal returns consolidation-required, stay in this same review step and retry with relationship consolidates, no supersedesText, and one materially shorter full-section result that preserves the remembered durable facts while incorporating the new fact. If consolidation reports that the source is truncated, do not guess. Do not propose transient progress, a task merely being done, tests merely passing, a build merely being green, guesses, secrets, credentials, personal data, one-off task details, or facts already present in remembered Project Memory. Prefer one compact candidate that subsumes near-duplicate observations. This is an internal review step: do not repeat or revise the user-facing answer and do not add user-facing commentary. If nothing qualifies, make no tool call and finish.`

const AUTOMATIC_MISSION_REVIEW_PROMPT = `Internal Project Memory mission-completion review. A goal/mission completed during the turn that is about to close. Inspect the completed mission for NEW durable project-wide facts that should guide future sessions, especially stable decisions, architecture, conventions, repeatable commands, durable known issues, and definition-of-done criteria. Call \`${PROJECT_MEMORY_PROPOSE_TOOL}\` for at most two strong candidates. Set durability to project-wide. Set confidence to high only for explicit durable facts, medium for strongly supported durable facts, and low when uncertain; low confidence is discarded. When a new fact truly replaces remembered Project Memory, set relationship to supersedes and copy the exact old remembered block or line into supersedesText. If an additive proposal returns consolidation-required, stay in this same review step and retry with relationship consolidates, no supersedesText, and one materially shorter full-section result that preserves the remembered durable facts while incorporating the new fact. If consolidation reports that the source is truncated, do not guess. Do not propose the mere fact that the mission completed, transient progress, tests merely passing, a build merely being green, guesses, secrets, credentials, personal data, one-off task details, or facts already present in remembered Project Memory. Prefer one compact candidate that subsumes near-duplicate observations. This is an internal review step: do not repeat or revise the user-facing answer and do not add user-facing commentary. If nothing qualifies, make no tool call and finish.`

type AutomaticReviewSource = Extract<ProjectMemoryCandidateSource, 'session' | 'mission'>
type CandidateConfidence = typeof CONFIDENCE_NAMES[number]
type ProposalStatus =
  | 'pending-review'
  | 'already-pending'
  | 'consolidation-required'
  | 'skipped-low-confidence'
  | 'skipped-task-local'
  | 'skipped-low-signal'
  | 'skipped-already-recorded'
  | 'skipped-section-full'
  | 'skipped-consolidation-source-truncated'
  | 'skipped-queue-full'
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

/** Conservative deterministic filter for status-only facts that should not become durable memory. */
function isLowSignalCandidate(section: ProjectMemorySection, text: string): boolean {
  if (section === 'commands') return false
  const normalized = text.trim().replace(/\s+/gu, ' ')
  return LOW_SIGNAL_PATTERNS.some(pattern => pattern.test(normalized))
}

/** Stable comparison form used for exact block/line duplicate checks. */
function canonicalCandidateText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Exact/block/line containment, matching the committed-memory host policy. */
function committedContainsCandidate(current: string, candidate: string): boolean {
  const target = canonicalCandidateText(candidate)
  if (target.length === 0) return false
  const committed = canonicalCandidateText(current)
  if (committed === target) return true
  const blocks = current.split(/\n\s*\n/).map(canonicalCandidateText)
  if (blocks.includes(target)) return true
  const lines = current.split('\n').map(canonicalCandidateText).filter(Boolean)
  return lines.includes(target)
}

/** Unicode-aware compact form for conservative language-independent near-duplicate matching. */
function similarityText(text: string): string {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function trigrams(text: string): ReadonlySet<string> {
  if (text.length === 0) return new Set()
  if (text.length < 3) return new Set([text])
  const grams = new Set<string>()
  for (let index = 0; index <= text.length - 3; index += 1) {
    grams.add(text.slice(index, index + 3))
  }
  return grams
}

/** Sørensen-Dice trigram similarity; commands intentionally use exact matching only. */
function candidateSimilarity(
  section: ProjectMemorySection,
  left: string,
  right: string,
): number {
  if (section === 'commands') {
    return canonicalCandidateText(left) === canonicalCandidateText(right) ? 1 : 0
  }
  const leftText = similarityText(left)
  const rightText = similarityText(right)
  if (leftText === rightText && leftText.length > 0) return 1
  const leftGrams = trigrams(leftText)
  const rightGrams = trigrams(rightText)
  if (leftGrams.size === 0 || rightGrams.size === 0) return 0
  let overlap = 0
  for (const gram of leftGrams) {
    if (rightGrams.has(gram)) overlap += 1
  }
  return (2 * overlap) / (leftGrams.size + rightGrams.size)
}

/** Find a pending candidate close enough that another model proposal would only add review noise. */
function nearDuplicatePendingCandidate(
  candidates: readonly ProjectMemoryCandidateView[],
  section: ProjectMemorySection,
  text: string,
  reviewHint: ProjectMemoryCandidateReviewHint,
  supersedesText: string | null,
): ProjectMemoryCandidateView | undefined {
  const canonicalSupersedes = canonicalCandidateText(supersedesText ?? '')
  return candidates.find(candidate => candidate.section === section
    && (candidate.reviewHint === null || candidate.reviewHint === reviewHint)
    && (reviewHint !== 'supersedes'
      || canonicalCandidateText(candidate.supersedesText ?? '') === canonicalSupersedes)
    && candidateSimilarity(section, candidate.text, text) >= NEAR_DUPLICATE_THRESHOLD)
}

/** Consolidation dedupe must keep the exact before-snapshot; canonical whitespace equivalence is unsafe here. */
function nearDuplicateConsolidationCandidate(
  candidates: readonly ProjectMemoryCandidateView[],
  section: ProjectMemorySection,
  text: string,
  before: string,
): ProjectMemoryCandidateView | undefined {
  return candidates.find(candidate => candidate.section === section
    && candidate.reviewHint === 'supersedes'
    && candidate.sourceRef?.startsWith(CONSOLIDATION_SOURCE_PREFIX) === true
    && candidate.supersedesText === before
    && candidateSimilarity(section, candidate.text, text) >= NEAR_DUPLICATE_THRESHOLD)
}

function reviewHintFor(
  relationship: typeof RELATIONSHIP_NAMES[number],
): ProjectMemoryCandidateReviewHint {
  if (relationship === 'supersedes' || relationship === 'consolidates') return 'supersedes'
  if (relationship === 'conflicts') return 'conflict'
  return 'append'
}

/** Keep confidence auditable without migrating the already-shipped candidate storage schema. */
function auditRationale(confidence: Exclude<CandidateConfidence, 'low'>, rationale: string | null): string {
  const prefix = `[confidence: ${confidence}]`
  return rationale === null ? prefix : `${prefix} ${rationale}`
}

function skipped(status: Exclude<ProposalStatus, 'pending-review' | 'already-pending'>, section: ProjectMemorySection) {
  return { section, status }
}

/** Return whether a section is present in full under the existing model-facing context budget. */
function sectionIsFullyVisible(
  memory: NonNullable<ReturnType<Context['projectMemory']['get']>>,
  section: ProjectMemorySection,
  text: string,
): boolean {
  const normalized = text.trim()
  if (normalized.length === 0) return true
  const projected = {
    ...memory,
    sections: { ...memory.sections, [section]: text },
  }
  return renderProjectMemoryContext(projected).includes(normalized)
}

function additiveProjection(current: string, candidate: string): string {
  const normalized = candidate.trim()
  if (current.trim() === '') return normalized
  return `${current.trimEnd()}\n\n${normalized}`
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
      + 'future sessions. Classify confidence and durability explicitly. Low-confidence, task-local, transient, '
      + 'duplicate, near-duplicate, over-budget, and queue-saturating proposals are skipped. For supersedes, '
      + 'copy the exact old Project Memory block or line into supersedesText. If additive returns consolidation-required, '
      + 'retry in the same model step with relationship consolidates and a materially shorter full-section result; do not '
      + 'supply supersedesText because the Host captures the exact before-snapshot. Consolidation never commits by itself '
      + 'and acceptance rejects if the original snapshot changed. Do not propose secrets, credentials, personal data, or '
      + 'one-off task details. This tool only stages a candidate; it never commits or replaces Project Memory by itself.',
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
        description: 'A concise self-contained durable fact, or for consolidates the complete compressed replacement section. Do not include secrets or transient task progress.',
      },
      relationship: {
        type: 'string',
        enum: RELATIONSHIP_NAMES,
        required: true,
        description: 'Relationship to remembered Project Memory: additive, supersedes, consolidates, or conflicts. Human acceptance is always required.',
      },
      supersedesText: {
        type: 'string',
        description: 'Required only for supersedes: copy the exact existing Project Memory block or line to replace. Never set this for consolidates; the Host captures the full section snapshot.',
      },
      confidence: {
        type: 'string',
        enum: CONFIDENCE_NAMES,
        required: true,
        description: 'Confidence that this is a correct durable fact: high, medium, or low. Low-confidence proposals are discarded.',
      },
      durability: {
        type: 'string',
        enum: DURABILITY_NAMES,
        required: true,
        description: 'Whether the fact should guide future project sessions. Task-local proposals are discarded.',
      },
      rationale: {
        type: 'string',
        description: 'Optional concise evidence or reason for the relationship classification. Never include secrets or personal data.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          candidateId: { type: 'string' },
          section: { type: 'string', enum: SECTION_NAMES, required: true },
          status: {
            type: 'string',
            enum: [
              'pending-review',
              'already-pending',
              'consolidation-required',
              'skipped-low-confidence',
              'skipped-task-local',
              'skipped-low-signal',
              'skipped-already-recorded',
              'skipped-section-full',
              'skipped-consolidation-source-truncated',
              'skipped-queue-full',
            ],
            required: true,
          },
        },
      },
      render: (_args, value) => {
        if (value.status === 'pending-review') {
          return [{
            type: 'text',
            text: `Project Memory candidate ${value.candidateId ?? ''} is pending human review in ${value.section}. It is not committed memory yet.`,
          }]
        }
        if (value.status === 'already-pending') {
          return [{
            type: 'text',
            text: `A materially equivalent Project Memory candidate ${value.candidateId ?? ''} is already pending review in ${value.section}. No duplicate was staged.`,
          }]
        }
        if (value.status === 'consolidation-required') {
          return [{
            type: 'text',
            text: `Project Memory ${value.section} is approaching its existing model-visible budget. Do not append. In this same model step, call ${PROJECT_MEMORY_PROPOSE_TOOL} again with relationship consolidates, no supersedesText, and one materially shorter complete replacement section that preserves the durable remembered facts and incorporates the new fact. The Host will capture the exact committed before-snapshot for human review.`,
          }]
        }
        if (value.status === 'skipped-consolidation-source-truncated') {
          return [{
            type: 'text',
            text: `Project Memory ${value.section} is already truncated by the existing model context budget, so automatic consolidation was refused. Do not guess at omitted memory.`,
          }]
        }
        return [{
          type: 'text',
          text: `Project Memory proposal was not staged (${value.status}) for ${value.section}.`,
        }]
      },
    },
    async execute(args) {
      const text = args.text.trim()
      const requestedSupersedesText = args.supersedesText?.trim() ?? null
      const rationale = args.rationale?.trim() ?? null
      const consolidation = args.relationship === 'consolidates'
      if (text.length === 0) throw new Error('Project Memory candidate text must not be empty')
      if (text.length > MAX_CANDIDATE_CHARS) {
        throw new Error(`Project Memory candidate text exceeds ${String(MAX_CANDIDATE_CHARS)} characters`)
      }
      if (args.relationship === 'supersedes' && requestedSupersedesText === null) {
        throw new Error('Project Memory supersedes candidates require exact supersedesText')
      }
      if (consolidation && requestedSupersedesText !== null) {
        throw new Error('Project Memory consolidation captures the full supersedes snapshot from committed memory; do not provide supersedesText')
      }
      if (args.relationship !== 'supersedes' && !consolidation && requestedSupersedesText !== null) {
        throw new Error('Project Memory supersedesText is only valid when relationship is supersedes')
      }
      if (requestedSupersedesText !== null && requestedSupersedesText.length > MAX_CANDIDATE_CHARS) {
        throw new Error(`Project Memory supersedesText exceeds ${String(MAX_CANDIDATE_CHARS)} characters`)
      }
      if (rationale !== null && rationale.length > MAX_RATIONALE_CHARS) {
        throw new Error(`Project Memory candidate rationale exceeds ${String(MAX_RATIONALE_CHARS)} characters`)
      }
      if (containsSensitiveText(text)
        || (requestedSupersedesText !== null && containsSensitiveText(requestedSupersedesText))
        || (rationale !== null && containsSensitiveText(rationale))) {
        throw new Error('Project Memory candidate looks like it contains a credential or secret')
      }
      if (args.confidence === 'low') return skipped('skipped-low-confidence', args.section)
      if (args.durability === 'task-local') return skipped('skipped-task-local', args.section)
      if (isLowSignalCandidate(args.section, text)) return skipped('skipped-low-signal', args.section)

      const reviewHint = reviewHintFor(args.relationship)
      const pending = ctx.projectMemory.candidates(workspaceId)
      const currentMemory = ctx.projectMemory.get(workspaceId)
      const currentSection = currentMemory?.sections[args.section] ?? ''
      const currentFullyVisible = currentMemory === undefined
        ? currentSection.trim() === ''
        : sectionIsFullyVisible(currentMemory, args.section, currentSection)

      if (consolidation) {
        if (currentMemory === undefined || currentSection.trim() === '') {
          return skipped('skipped-section-full', args.section)
        }
        if (!currentFullyVisible) {
          return skipped('skipped-consolidation-source-truncated', args.section)
        }
        if (text.length >= currentSection.trim().length) {
          throw new Error('Project Memory consolidation must be materially shorter than the committed section it replaces')
        }
        if (!sectionIsFullyVisible(currentMemory, args.section, text)) {
          throw new Error('Project Memory consolidation result still exceeds the existing model-visible section budget')
        }
      } else if (committedContainsCandidate(currentSection, text)) {
        return skipped('skipped-already-recorded', args.section)
      }

      const supersedesText = consolidation ? currentSection : requestedSupersedesText
      const equivalent = consolidation
        ? nearDuplicateConsolidationCandidate(pending, args.section, text, currentSection)
        : nearDuplicatePendingCandidate(
            pending,
            args.section,
            text,
            reviewHint,
            supersedesText,
          )
      if (equivalent !== undefined) {
        return {
          candidateId: equivalent.id,
          section: equivalent.section,
          status: 'already-pending' as const,
        }
      }

      if (args.relationship === 'additive') {
        const projected = additiveProjection(currentSection, text)
        if (currentMemory === undefined) {
          if (projected.length > 4_000) return skipped('skipped-section-full', args.section)
        } else if (!sectionIsFullyVisible(currentMemory, args.section, projected)) {
          return skipped(
            currentFullyVisible ? 'consolidation-required' : 'skipped-consolidation-source-truncated',
            args.section,
          )
        }
      }

      if (pending.length >= MAX_PENDING_CANDIDATES
        || pending.filter(candidate => candidate.section === args.section).length >= MAX_PENDING_CANDIDATES_PER_SECTION) {
        return skipped('skipped-queue-full', args.section)
      }

      const auditedRationale = auditRationale(args.confidence, rationale)
      if (auditedRationale.length > MAX_RATIONALE_CHARS) {
        throw new Error(`Project Memory candidate rationale exceeds ${String(MAX_RATIONALE_CHARS)} characters after confidence metadata`)
      }
      const candidate = await ctx.projectMemory.proposeCandidate(
        workspaceId,
        args.section,
        text,
        source(),
        consolidation ? `${CONSOLIDATION_SOURCE_PREFIX}${sessionId}` : sessionId,
        reviewHint,
        auditedRationale,
        supersedesText,
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
    const harnessPolicy = yanamiHarnessPolicyForAgentPreset(agent.session.header.agentPreset)
    if (!harnessPolicy.projectMemoryTurnReview) {
      candidateSources.delete(agent.id)
      return
    }

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
  isLowSignalCandidate,
  candidateSimilarity,
  nearDuplicatePendingCandidate,
  nearDuplicateConsolidationCandidate,
  committedContainsCandidate,
  auditRationale,
  reviewHintFor,
  sectionIsFullyVisible,
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

      const harnessPolicy = yanamiHarnessPolicyForAgentPreset(agent.session.header.agentPreset)
      if (harnessPolicy.projectMemoryProposalTool) {
        agent.ctx.tools.register(proposalTool(
          memoryCtx,
          workspace.id,
          agent.id,
          () => candidateSources.get(agent.id) ?? 'automatic',
        ))
      }
      if (harnessPolicy.projectMemoryProposalPrompt) {
        agent.ctx.systemPrompt.section({
          name: 'yanami:project-memory-proposal-policy',
          order: 98,
          text: PROPOSAL_POLICY,
        })
      }
    })
  })
}
