import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const READY_PATTERN = /dsh web:\s+(http:\/\/127\.0\.0\.1:\d+)/
const START_TIMEOUT_MS = 45_000
const STOP_TIMEOUT_MS = 5_000

export interface DesktopRuntime {
  readonly url: string
  readonly process: ChildProcessWithoutNullStreams
}

interface RuntimeLauncher {
  readonly executable: string
  readonly environment: NodeJS.ProcessEnv
}

function resolveDshCliEntry(): string {
  const require = createRequire(import.meta.url)
  const manifest = require.resolve('@deepseek-ai/dsh/package.json')
  return join(dirname(manifest), 'lib', 'bin.js')
}

/**
 * In a checkout, prefer pnpm/npm's system Node so native DSH dependencies keep
 * the ABI they were installed for. A packaged app has no package-manager Node,
 * so it reuses Electron's executable in ELECTRON_RUN_AS_NODE mode; Forge
 * rebuilds packaged native dependencies for that Electron ABI.
 */
function runtimeLauncher(): RuntimeLauncher {
  const configured = process.env.DSH_DESKTOP_NODE
  const inheritedNode = process.env.npm_node_execpath
  const executable = configured ?? inheritedNode ?? process.execPath
  const electronAsNode = executable === process.execPath

  return {
    executable,
    environment: {
      ...process.env,
      DSH_DESKTOP: '1',
      ...(electronAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    },
  }
}

/** Extract the canonical loopback URL from accumulated DSH stdout. */
export function parseRuntimeReadyUrl(output: string): string | undefined {
  return READY_PATTERN.exec(output)?.[1]
}

/**
 * Start a private loopback-only DSH Web runtime and resolve only after the
 * runtime prints its canonical ready URL. Aborting startup terminates the
 * child so quitting during the splash screen never leaves an orphan runtime.
 */
export async function startDesktopRuntime(signal?: AbortSignal): Promise<DesktopRuntime> {
  signal?.throwIfAborted()
  const entry = resolveDshCliEntry()
  const launcher = runtimeLauncher()
  const child = spawn(
    launcher.executable,
    [entry, 'web', '--host', '127.0.0.1', '--port', '0'],
    {
      env: launcher.environment,
      stdio: 'pipe',
      ...(signal === undefined ? {} : { signal }),
    },
  )
  child.stdin.end()

  let stdout = ''
  let stderr = ''

  const ready = new Promise<string>((resolve, reject) => {
    let settled = false
    const settle = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      callback()
    }

    const timeout = setTimeout(() => {
      settle(() => {
        reject(new Error(
          `Timed out waiting for DSH runtime readiness.${stderr === '' ? '' : `\n${stderr.trim()}`}`,
        ))
      })
    }, START_TIMEOUT_MS)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      process.stdout.write(`[dsh] ${chunk}`)
      const url = parseRuntimeReadyUrl(stdout)
      if (url !== undefined) settle(() => { resolve(url) })
      if (stdout.length > 32_768) stdout = stdout.slice(-16_384)
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
      process.stderr.write(`[dsh] ${chunk}`)
      if (stderr.length > 32_768) stderr = stderr.slice(-16_384)
    })

    child.once('error', (error) => {
      settle(() => { reject(error) })
    })

    child.once('exit', (code, exitSignal) => {
      settle(() => {
        reject(new Error(
          `DSH runtime exited before readiness (code=${String(code)}, signal=${String(exitSignal)}).`
          + `${stderr === '' ? '' : `\n${stderr.trim()}`}`,
        ))
      })
    })
  })

  try {
    const url = await ready
    return { url, process: child }
  } catch (error) {
    if (!child.killed) child.kill('SIGTERM')
    throw error
  }
}

/** Gracefully stop a runtime process, then force-kill it if teardown stalls. */
export async function stopDesktopRuntime(runtime: DesktopRuntime | undefined): Promise<void> {
  if (runtime === undefined || runtime.process.exitCode !== null || runtime.process.killed) return

  await new Promise<void>((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(forceTimer)
      resolve()
    }
    const forceTimer = setTimeout(() => {
      runtime.process.kill('SIGKILL')
      finish()
    }, STOP_TIMEOUT_MS)

    runtime.process.once('exit', finish)
    runtime.process.kill('SIGTERM')
  })
}
