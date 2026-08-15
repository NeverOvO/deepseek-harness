/**
 * Agent-scoped Project Memory proposal tool for the Workbench surface.
 *
 * The model can only stage a candidate. It never receives a workspace id and
 * cannot commit durable Project Memory; the human review queue remains the
 * sole path from a model suggestion into committed memory.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Workspace, WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-workspace/project-memory'
import type { ProjectMemorySection } from '@deepseek-ai/dsh-workspace/project-memory-types'

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

const MAX_CANDIDATE_CHARS = 8_000

const PROPOSAL_POLICY = `Project Memory candidate policy: when the current work establishes a NEW durable project-wide fact that should guide future sessions, stage one concise candidate with \`${PROJECT_MEMORY_PROPOSE_TOOL}\`. Good candidates are stable architecture, repeatable project commands, conventions, explicit decisions, durable known issues, and definition-of-done criteria. Do not stage transient progress, temporary observations, unverified guesses, secrets, credentials, personal data, one-off task details, or facts already present in Project Memory. A proposal is only pending human review; never claim it was saved or committed until the user accepts it.`

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

/**
 * Build one proposal tool bound to an already resolved Workspace and Session.
 * The binding is closure-owned rather than model input, preventing cross-workspace writes.
 */
function proposalTool(ctx: Context, workspaceId: WorkspaceId, sessionId: string) {
  return defineTool({
    name: PROJECT_MEMORY_PROPOSE_TOOL,
    description:
      'Propose one durable project-wide fact for human review. Use this only for stable architecture, '
      + 'commands, conventions, decisions, known issues, or definition-of-done facts that should survive '
      + 'future sessions. Do not propose transient progress, temporary observations, secrets, credentials, '
      + 'personal data, or one-off task details. This tool only stages a candidate; it never commits Project Memory.',
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
      if (text.length === 0) throw new Error('Project Memory candidate text must not be empty')
      if (text.length > MAX_CANDIDATE_CHARS) {
        throw new Error(`Project Memory candidate text exceeds ${String(MAX_CANDIDATE_CHARS)} characters`)
      }
      const candidate = await ctx.projectMemory.proposeCandidate(
        workspaceId,
        args.section,
        text,
        'session',
        sessionId,
      )
      return {
        candidateId: candidate.id,
        section: candidate.section,
        status: 'pending-review' as const,
      }
    },
  })
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
    installCandidateChangeBridge(memoryCtx)
    memoryCtx.on('agent/created', ({ agent }) => {
      const workspace = workspaceForSession(memoryCtx, agent.id, agent.session.header.cwd)
      if (workspace === undefined) return
      agent.ctx.tools.register(proposalTool(memoryCtx, workspace.id, agent.id))
      agent.ctx.systemPrompt.section({
        name: 'yanami:project-memory-proposal-policy',
        order: 98,
        text: PROPOSAL_POLICY,
      })
    })
  })
}
