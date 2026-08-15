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

function resolveDshCliEntry(): string {
  const require = createRequire(import.meta.url)
  const manifest = require.resolve('@deepseek-ai/dsh/package.json')
  return join(dirname(manifest), 'lib', 'bin.js')
}

function runtimeEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    DSH_DESKTOP: '1',
  }
}

/**
 * Start a private loopback-only DSH Web runtime and resolve only after the
 * runtime prints its canonical ready URL.
 */
export async function startDesktopRuntime(): Promise<DesktopRuntime> {
  const entry = resolveDshCliEntry()
  const child = spawn(
    process.execPath,
    [entry, 'web', '--host', '127.0.0.1', '--port', '0'],
    {
      env: runtimeEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  let stdout = ''
  let stderr = ''

  const ready = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(
        `Timed out waiting for DSH runtime readiness.${stderr === '' ? '' : `\n${stderr.trim()}`}`,
      ))
    }, START_TIMEOUT_MS)

    const settle = (callback: () => void): void => {
      clearTimeout(timeout)
      callback()
    }

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      process.stdout.write(`[dsh] ${chunk}`)
      const match = READY_PATTERN.exec(stdout)
      if (match?.[1] !== undefined) settle(() => { resolve(match[1]) })
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

    child.once('exit', (code, signal) => {
      settle(() => {
        reject(new Error(
          `DSH runtime exited before readiness (code=${String(code)}, signal=${String(signal)}).`
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
