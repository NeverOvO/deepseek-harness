/**
 * Agent-scoped Project Memory proposal tool for the Workbench surface.
 *
 * The model can only stage a candidate. It never receives a workspace id and
 * cannot commit durable Project Memory; the human review queue remains the
 * sole path from a model suggestion into committed memory.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
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
 * Register the proposal tool into each eligible Agent scope before its first
 * session-start/model request. Sessions outside registered Workspaces receive no
 * tool at all. A cwd match is used as the creation-time fallback because the
 * Workspace session-id attachment may settle immediately after Agent publication.
 */
export function installProjectMemoryProposalTool(ctx: Context): void {
  ctx.inject(['workspaceRegistry', 'projectMemory'], (memoryCtx) => {
    memoryCtx.on('agent/created', ({ agent }) => {
      const workspace = workspaceForSession(memoryCtx, agent.id, agent.session.header.cwd)
      if (workspace === undefined) return
      agent.ctx.tools.register(proposalTool(memoryCtx, workspace.id, agent.id))
    })
  })
}
