import { execFile } from 'node:child_process'
import { readdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { packager } from '@electron/packager'
import { rebuild } from '@electron/rebuild'

const execFileAsync = promisify(execFile)
const ELECTRON_VERSION = '43.2.0'
const APP_NAME = '八奈见工作台'
const EXECUTABLE_NAME = 'Yanami Workbench'
const BUNDLE_ID = 'com.yunyulai.yanami-workbench'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(scriptDir, '..')
const outDir = join(appDir, 'out')

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

async function run(command, args) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: appDir,
    maxBuffer: 16 * 1024 * 1024,
  })
  if (stdout !== '') process.stdout.write(stdout)
  if (stderr !== '') process.stderr.write(stderr)
}

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error('package-macos.mjs must run on macOS')
  }

  const arch = targetArch()
  await rm(outDir, { recursive: true, force: true })

  console.log(`[desktop] packaging ${APP_NAME} for darwin-${arch}`)
  const outputPaths = await packager({
    dir: appDir,
    name: APP_NAME,
    executableName: EXECUTABLE_NAME,
    platform: 'darwin',
    arch,
    electronVersion: ELECTRON_VERSION,
    out: outDir,
    overwrite: true,
    asar: false,
    prune: true,
    derefSymlinks: true,
    appBundleId: BUNDLE_ID,
    appCategoryType: 'public.app-category.developer-tools',
    afterCopy: [
      async ({ buildPath, electronVersion, arch: copiedArch }) => {
        console.log(`[desktop] rebuilding native modules for Electron ${electronVersion} (${copiedArch})`)
        await rebuild({
          buildPath,
          electronVersion,
          arch: copiedArch,
        })
      },
    ],
  })

  if (outputPaths.length !== 1) {
    throw new Error(`Expected one macOS package output, got ${outputPaths.length}`)
  }

  const outputDir = outputPaths[0]
  const appPath = await findAppBundle(outputDir)
  const zipPath = join(outDir, `Yanami-Workbench-macos-${arch}.zip`)
  const dmgPath = join(outDir, `Yanami-Workbench-macos-${arch}.dmg`)

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
