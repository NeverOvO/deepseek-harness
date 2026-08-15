# 八奈见工作台 Desktop

`apps/desktop` is the native desktop shell for Yanami Workbench. It keeps the
DeepSeek Harness runtime as the execution engine and owns desktop lifecycle,
window chrome, startup/shutdown, and packaging.

## Architecture

The current v0.1 carrier is intentionally conservative:

1. Electron opens a local Yanami startup surface immediately.
2. In a checkout, the shell starts DSH with the package-manager Node inherited
   from `pnpm`; a packaged app uses Electron's Node mode after Forge rebuilds
   native dependencies for the packaged ABI.
3. DSH binds only to `127.0.0.1` and receives `--port 0`, so the OS chooses an
   unused port.
4. The desktop shell waits for DSH's canonical `dsh web: http://127.0.0.1:...`
   readiness line, then replaces the startup surface with the work area.
5. A hardened `BrowserWindow` keeps Node integration disabled, context
   isolation enabled, and a sandboxed preload.
6. App quit tears down the child runtime before Electron exits.

This gives the user a real desktop application without forking Goal, Workflow,
Jobs, Session, Workspace, tools, or the agent loop. A later desktop carrier may
replace loopback HTTP with an IPC/in-process transport without changing the
Workbench product layer.

## macOS development

From the repository root:

```sh
pnpm install
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop run dev
```

The first `pnpm run build` is required because the desktop runtime launches the
built `@deepseek-ai/dsh` CLI and the Web profile resolves the built frontend
dist.

## Build a macOS application

From the repository root:

```sh
pnpm install
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop run build
pnpm --filter @deepseek-ai/dsh-desktop run make:mac
```

Electron Forge writes packaged output under `apps/desktop/out/`. The initial
macOS makers generate an application archive and DMG. Code signing,
notarization, branded `.icns` assets, and auto-update are intentionally the
next release-hardening step; unsigned local builds are for development only.

## Windows direction

The main process and runtime supervisor contain no macOS-only execution path.
Windows support will add the corresponding Forge maker, icon/signing assets,
and Windows-specific lifecycle verification while retaining the same DSH child
runtime contract.

## Security posture

- Runtime bind is always loopback-only.
- The runtime chooses an ephemeral port to avoid collisions.
- Renderer `nodeIntegration` is disabled.
- `contextIsolation` and Electron sandboxing are enabled.
- New windows are denied; normal HTTP(S) links open in the system browser.
- Navigation outside the active private DSH runtime origin is blocked.
- The preload exposes only a tiny read-only desktop identity object today.
