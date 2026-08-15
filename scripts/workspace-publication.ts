/** Workspace package publication classification shared by constraints and release discovery. */

/** Native applications that are packaged for an operating system instead of published to npm. */
const privateNativeApplications: Readonly<Record<string, string>> = {
  'apps/desktop': '@deepseek-ai/dsh-desktop',
}

/** Publication role assigned to one workspace package. */
export type WorkspacePublicationClass = 'npm-release-member' | 'private-native-application' | 'private-workspace'

/** Directories whose packages this repository publishes: one release member each. */
const npmReleaseMemberDirectory = /^(?:packages\/[^/]+\/[^/]+|apps\/[^/]+|vendor\/[^/]+)$/

/**
 * Classify a workspace package without treating every `apps/*` package as an npm artifact.
 * @param directory - repository-relative package directory.
 * @param name - package name from its manifest.
 * @returns The package's publication role.
 */
export function classifyWorkspacePublication(directory: string, name: string | undefined): WorkspacePublicationClass {
  if (name !== undefined && privateNativeApplications[directory] === name) return 'private-native-application'
  if (npmReleaseMemberDirectory.test(directory)) return 'npm-release-member'
  return 'private-workspace'
}
