import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets, { COMPOSITION_FILE } from '@deepseek-ai/dsh-agent-presets'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'

async function writePackage(
  root: string,
  name: string,
  manifest: Record<string, unknown>,
  files: Record<string, string>,
): Promise<void> {
  const dir = join(root, 'node_modules', ...name.split('/'))
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name, type: 'module', ...manifest }))
  await Promise.all(Object.entries(files).map(async ([file, content]) => {
    await writeFile(join(dir, file), content)
  }))
}

async function runtime(
  profileBaseUrl: string,
  preferredBareModuleBaseUrl: string,
  presetRoot: string,
): Promise<Context> {
  const ctx = new Context()
  ctx.baseUrl = profileBaseUrl
  await ctx.plugin(Loader, { preferredBareModuleBaseUrl })
  ctx.loader.builtins.include = Include
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentPresets, {
    default: 'resolved',
    roots: [{ path: presetRoot, trust: 'user' }],
    includeUserRoot: false,
  })
  return ctx
}

describe('preset bare-module resolution', () => {
  it('uses the current Harness before a stale profile copy and still falls back for profile-only plugins', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-preset-module-resolution-'))
    const profile = join(root, 'profile')
    const harness = join(root, 'harness')
    const presets = join(root, 'presets')
    const preset = join(presets, 'resolved')
    await Promise.all([
      mkdir(profile, { recursive: true }),
      mkdir(harness, { recursive: true }),
      mkdir(preset, { recursive: true }),
    ])

    // Stale profile-local in-box package: the main export exists but the new
    // Yanami subpath does not. Using this copy reproduces the Desktop failure.
    await writePackage(profile, '@fixture/host-shadow', {
      exports: { '.': './index.mjs' },
    }, {
      'index.mjs': 'export function apply() {}\n',
    })

    // Current Harness copy with the newly-added subpath.
    await writePackage(harness, '@fixture/host-shadow', {
      exports: {
        '.': './index.mjs',
        './yanami': './yanami.mjs',
      },
    }, {
      'index.mjs': 'export function apply() {}\n',
      'yanami.mjs': 'export function apply() {}\n',
    })

    // A genuine profile-only plugin must remain loadable after the host miss.
    await writePackage(profile, 'profile-only', {
      exports: './index.mjs',
    }, {
      'index.mjs': 'export function apply() {}\n',
    })

    await writeFile(join(preset, COMPOSITION_FILE), [
      '- id: yanami-mode',
      "  name: '@fixture/host-shadow/yanami'",
      '- id: profile-only',
      '  name: profile-only',
      '',
    ].join('\n'))

    const profileBaseUrl = pathToFileURL(profile).href + '/'
    const preferredBaseUrl = pathToFileURL(join(harness, '__installation-anchor__.mjs')).href
    let ctx: Context | undefined
    try {
      ctx = await runtime(profileBaseUrl, preferredBaseUrl, presets)
      const imported = vi.spyOn(ctx.loader.internal!, 'import')
      const handle = await ctx.agents.create({
        sessionId: SessionId('session-module-resolution'),
        setup: async agentCtx => void await ctx!.agentPresets.mount(agentCtx),
      })
      try {
        expect(imported).toHaveBeenCalledWith('@fixture/host-shadow/yanami', preferredBaseUrl, {})
        expect(imported).toHaveBeenCalledWith('profile-only', profileBaseUrl, {})
      } finally {
        await handle.dispose()
      }
    } finally {
      await ctx?.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
