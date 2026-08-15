import { spawn, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { packager } from '@electron/packager'

const execFileAsync = promisify(execFile)
const ELECTRON_VERSION = '43.2.0'
const NODE_VERSION = '24.19.0'
const APP_NAME = '云屿来工作台'
const EXECUTABLE_NAME = 'Yunyulai Workbench'
const BUNDLE_ID = 'com.yunyulai.yanami-workbench'
const READY_PATTERN = /dsh web:\s+(http:\/\/127\.0\.0\.1:\d+)/
const RUNTIME_SMOKE_TIMEOUT_MS = 45_000

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(scriptDir, '..')
const repoRoot = resolve(appDir, '../..')
const outDir = join(appDir, 'out')
const stageRoot = join(appDir, '.stage')
const deployDir = join(stageRoot, 'app')
const nodeRuntimeDir = join(stageRoot, 'node-runtime')

function targetArch() {
  if (process.arch === 'arm64' || process.arch === 'x64') return process.arch
  throw new Error(`Unsupported macOS architecture: ${process.arch}`)
}

async function findAppBundle(outputDir) {
  const entries = await readdir(outputDir, { withFileTypes: true })
  const app = entries.find(entry => entry.isDirectory() && entry.name.endsWith('.app'))
  if (app === undefined) throw new Error(`Electron Packager produced no .app in ${outputDir}`)
  return join(outputDir, app.name)
}

async function run(command, args, cwd = appDir) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd,
    maxBuffer: 32 * 1024 * 1024,
  })
  if (stdout !== '') process.stdout.write(stdout)
  if (stderr !== '') process.stderr.write(stderr)
}

async function fetchBytes(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`)
  return Buffer.from(await response.arrayBuffer())
}

async function fetchText(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`)
  return response.text()
}

async function prepareBundledNode(arch) {
  const fileName = `node-v${NODE_VERSION}-darwin-${arch}.tar.gz`
  const baseUrl = `https://nodejs.org/dist/v${NODE_VERSION}`
  const checksumText = await fetchText(`${baseUrl}/SHASUMS256.txt`)
  const checksumLine = checksumText
    .split(/\r?\n/u)
    .find(line => line.trim().endsWith(`  ${fileName}`))
  if (checksumLine === undefined) {
    throw new Error(`Node ${NODE_VERSION} checksum does not contain ${fileName}`)
  }
  const expectedHash = checksumLine.trim().split(/\s+/u)[0]

  console.log(`[desktop] downloading Node ${NODE_VERSION} sidecar (${arch})`)
  const archive = await fetchBytes(`${baseUrl}/${fileName}`)
  const actualHash = createHash('sha256').update(archive).digest('hex')
  if (actualHash !== expectedHash) {
    throw new Error(`Node runtime checksum mismatch: expected ${expectedHash}, got ${actualHash}`)
  }

  const archivePath = join(stageRoot, fileName)
  await writeFile(archivePath, archive)
  await mkdir(nodeRuntimeDir, { recursive: true })
  await run('tar', [
    '-xzf', archivePath,
    '-C', nodeRuntimeDir,
    '--strip-components=1',
  ])

  const executable = join(nodeRuntimeDir, 'bin', 'node')
  if (!existsSync(executable)) throw new Error(`Extracted Node executable missing: ${executable}`)
  await run(executable, ['--version'])
  return nodeRuntimeDir
}

async function preparePortableApp() {
  console.log('[desktop] creating portable production deployment')
  await run('pnpm', [
    '--filter', '@deepseek-ai/dsh-desktop',
    '--prod',
    'deploy', '--legacy', deployDir,
  ], repoRoot)

  const mainEntry = join(deployDir, 'lib', 'main.js')
  if (!existsSync(mainEntry)) {
    throw new Error(`Desktop deployment is missing compiled main entry: ${mainEntry}`)
  }
}

/**
 * Ask the bundled standard Node runtime to resolve DSH from the deployed app.
 * This deliberately mirrors normal package resolution instead of assuming a
 * physical pnpm node_modules layout, which may contain links or a virtual store.
 */
async function resolveDshEntry(node, applicationRoot) {
  const resolver = [
    "const { createRequire } = require('node:module')",
    "const { dirname, join } = require('node:path')",
    "const root = process.env.YANAMI_APP_ROOT",
    "if (!root) throw new Error('YANAMI_APP_ROOT is missing')",
    "const requireFromApp = createRequire(join(root, 'package.json'))",
    "const manifest = requireFromApp.resolve('@deepseek-ai/dsh/package.json')",
    "process.stdout.write(join(dirname(manifest), 'lib', 'bin.js'))",
  ].join(';')

  const { stdout, stderr } = await execFileAsync(node, ['-e', resolver], {
    cwd: applicationRoot,
    env: {
      ...process.env,
      YANAMI_APP_ROOT: applicationRoot,
    },
    maxBuffer: 8 * 1024 * 1024,
  })
  if (stderr !== '') process.stderr.write(stderr)
  const entry = stdout.trim()
  if (entry === '' || !existsSync(entry)) {
    throw new Error(`Node resolved an invalid packaged DSH CLI path: ${entry || '<empty>'}`)
  }
  console.log(`[desktop] resolved packaged DSH CLI: ${entry}`)
  return entry
}

async function stopChild(child) {
  if (child.exitCode !== null || child.killed) return
  await new Promise(resolve => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(forceTimer)
      resolve()
    }
    const forceTimer = setTimeout(() => {
      child.kill('SIGKILL')
      finish()
    }, 5_000)
    child.once('exit', finish)
    child.kill('SIGTERM')
  })
}

async function smokePackagedRuntime(appPath) {
  const resources = join(appPath, 'Contents', 'Resources')
  const applicationRoot = join(resources, 'app')
  const node = join(resources, 'node-runtime', 'bin', 'node')
  if (!existsSync(node)) throw new Error(`Packaged Node sidecar missing: ${node}`)

  const smokeHome = join(stageRoot, 'smoke-home')
  await mkdir(smokeHome, { recursive: true })
  await run(node, ['--version'])
  const dshEntry = await resolveDshEntry(node, applicationRoot)

  console.log('[desktop] smoke-starting packaged DSH runtime')
  const child = spawn(node, [dshEntry, 'web', '--host', '127.0.0.1', '--port', '0'], {
    cwd: applicationRoot,
    env: {
      ...process.env,
      DSH_HOME: smokeHome,
      DSH_DESKTOP: '1',
      DSH_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')

  let stdout = ''
  let stderr = ''
  try {
    const url = await new Promise((resolve, reject) => {
      let settled = false
      const settle = callback => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        callback()
      }
      const timeout = setTimeout(() => {
        settle(() => reject(new Error(`Packaged DSH runtime timed out.${stderr === '' ? '' : `\n${stderr}`}`)))
      }, RUNTIME_SMOKE_TIMEOUT_MS)

      child.stdout.on('data', chunk => {
        stdout += chunk
        const match = READY_PATTERN.exec(stdout)
        if (match?.[1] !== undefined) settle(() => resolve(match[1]))
      })
      child.stderr.on('data', chunk => { stderr += chunk })
      child.once('error', error => settle(() => reject(error)))
      child.once('exit', (code, signal) => {
        settle(() => reject(new Error(
          `Packaged DSH runtime exited before ready (code=${String(code)}, signal=${String(signal)}).\n${stderr}`,
        )))
      })
    })

    const response = await fetch(url)
    if (!response.ok) throw new Error(`Packaged DSH HTTP smoke failed: ${response.status}`)
    const body = await response.text()
    if (!body.includes('<html') && !body.includes('<!doctype html')) {
      throw new Error('Packaged DSH HTTP smoke did not return the Web application shell')
    }
    console.log(`[desktop] packaged DSH runtime ready: ${url}`)
  } finally {
    await stopChild(child)
  }
}

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error('package-macos.mjs must run on macOS')
  }

  const arch = targetArch()
  await rm(outDir, { recursive: true, force: true })
  await rm(stageRoot, { recursive: true, force: true })
  await mkdir(stageRoot, { recursive: true })

  await preparePortableApp()
  const nodeRuntime = await prepareBundledNode(arch)

  console.log(`[desktop] packaging ${APP_NAME} for darwin-${arch}`)
  const outputPaths = await packager({
    dir: deployDir,
    name: APP_NAME,
    executableName: EXECUTABLE_NAME,
    platform: 'darwin',
    arch,
    electronVersion: ELECTRON_VERSION,
    out: outDir,
    overwrite: true,
    asar: false,
    // `pnpm deploy --prod` already produced the complete portable production
    // dependency tree. Packager must not reinterpret/prune pnpm's deploy graph.
    prune: false,
    derefSymlinks: true,
    extraResource: [nodeRuntime],
    appBundleId: BUNDLE_ID,
    appCategoryType: 'public.app-category.developer-tools',
    extendInfo: {
      CFBundleDisplayName: APP_NAME,
      CFBundleName: EXECUTABLE_NAME,
    },
  })

  if (outputPaths.length !== 1) {
    throw new Error(`Expected one macOS package output, got ${outputPaths.length}`)
  }

  const outputDir = outputPaths[0]
  const appPath = await findAppBundle(outputDir)
  await smokePackagedRuntime(appPath)

  const zipPath = join(outDir, `Yunyulai-Workbench-macos-${arch}.zip`)
  const dmgPath = join(outDir, `Yunyulai-Workbench-macos-${arch}.dmg`)

  console.log(`[desktop] creating ${zipPath}`)
  await run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, zipPath])

  console.log(`[desktop] creating ${dmgPath}`)
  await run('hdiutil', [
    'create',
    '-volname', APP_NAME,
    '-srcfolder', appPath,
    '-ov',
    '-format', 'UDZO',
    dmgPath,
  ])

  console.log('[desktop] package complete')
  console.log(`[desktop] app: ${appPath}`)
  console.log(`[desktop] zip: ${zipPath}`)
  console.log(`[desktop] dmg: ${dmgPath}`)
}

await main()
