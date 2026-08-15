/** Workspace publication classification regressions. */

import { describe, expect, it } from 'vitest'
import { classifyWorkspacePublication } from './workspace-publication.ts'

describe('workspace publication classification', () => {
  it('classifies only the allowlisted desktop package as a private native application', () => {
    expect(classifyWorkspacePublication('apps/desktop', '@deepseek-ai/dsh-desktop'))
      .toBe('private-native-application')
    expect(classifyWorkspacePublication('apps/desktop', '@deepseek-ai/dsh-other'))
      .toBe('npm-release-member')
  })

  it('keeps npm applications and packages in the release set', () => {
    expect(classifyWorkspacePublication('apps/cli', '@deepseek-ai/dsh')).toBe('npm-release-member')
    expect(classifyWorkspacePublication('apps/web', '@deepseek-ai/dsh-web-frontend')).toBe('npm-release-member')
    expect(classifyWorkspacePublication('packages/core/session', '@deepseek-ai/dsh-session'))
      .toBe('npm-release-member')
  })

  it('keeps unrelated private workspaces outside the npm release set', () => {
    expect(classifyWorkspacePublication('.', '@deepseek-ai/dsh-root')).toBe('private-workspace')
    expect(classifyWorkspacePublication('native/landlock-run', '@deepseek-ai/node-addon-landlock-run-workspace'))
      .toBe('private-workspace')
  })
})
