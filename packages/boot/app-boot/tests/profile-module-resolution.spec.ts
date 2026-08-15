import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { boot } from '../src/index.ts'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'dsh-profile-resolution-'))

function writePackage(
  root: string,
  name: string,
  manifest: Record<string, unknown>,
  files: Record<string, string>,
): void {
  const dir = join(root, 'node_modules', ...name.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, type: 'module', ...manifest }))
  for (const [file, content] of Object.entries(files)) writeFileSync(join(dir, file), content)
}

describe('profile module resolution', () => {
  it('prefers the Harness installation for an exported subpath and falls back to a profile-only plugin', async () => {
    const root = tmp()
    const profile = join(root, 'profile')
    const harness = join(root, 'harness')
    mkdirSync(profile, { recursive: true })
    mkdirSync(harness, { recursive: true })

    // Stale profile-local copy: it knows the package but not the newly-added
    // subpath. Resolving from the profile first would reproduce
    // ERR_PACKAGE_PATH_NOT_EXPORTED during a Harness upgrade.
    writePackage(profile, '@fixture/host-shadow', {
      exports: { '.': './index.mjs' },
    }, {
      'index.mjs': 'export function apply(ctx) { ctx.provide("shadowMainLoaded", true) }\n',
    })

    // Current Harness installation: same package, with the new subpath.
    writePackage(harness, '@fixture/host-shadow', {
      exports: {
        '.': './index.mjs',
        './project-memory': './project-memory.mjs',
      },
    }, {
      'index.mjs': 'export function apply(ctx) { ctx.provide("harnessMainLoaded", true) }\n',
      'project-memory.mjs': 'export function apply(ctx) { ctx.provide("projectMemorySource", "harness") }\n',
    })

    // A real profile plugin that the Harness installation does not own must
    // still resolve from the profile after the installation anchor misses it.
    writePackage(profile, 'profile-only', {
      exports: './index.mjs',
    }, {
      'index.mjs': 'export function apply(ctx) { ctx.provide("profileOnlyLoaded", true) }\n',
    })

    const config = join(profile, 'cordis.yml')
    writeFileSync(config, [
      '- id: project-memory',
      "  name: '@fixture/host-shadow/project-memory'",
      '- id: profile-only',
      '  name: profile-only',
      '',
    ].join('\n'))

    const harnessBaseUrl = pathToFileURL(join(harness, 'entry.mjs')).href
    let ctx
    try {
      ctx = await boot('dsh-test-bin', config, undefined, undefined, harnessBaseUrl)
      expect(ctx.get('projectMemorySource')).toBe('harness')
      expect(ctx.get('profileOnlyLoaded')).toBe(true)
      expect(ctx.get('shadowMainLoaded')).toBeUndefined()
    } finally {
      await ctx?.fiber.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
