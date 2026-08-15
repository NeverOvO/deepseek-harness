# Agent Note: Yanami Workbench desktop shell

Status: implemented

## Problem

Yanami Workbench is intended to become a daily desktop work environment rather than a browser tab that the user must start from a terminal. Reimplementing the DeepSeek Harness agent runtime in another desktop framework would duplicate Goal, Workflow, Jobs, Session, Workspace, tools, approval, and persistence behavior, while continuing to expose `dsh web` directly would keep installation and lifecycle management as user-facing concerns.

The first desktop implementation must work on macOS while preserving a credible path to Windows, must not expose the DSH server to the LAN, and must keep desktop renderer privileges narrow enough that existing Web content cannot gain unrestricted Node.js access merely because it is hosted inside Electron.

## Decision

`apps/desktop` is the desktop application boundary for **八奈见工作台 / Yanami Workbench**. Electron is used as the shell because the repository and DSH runtime are already Node.js/TypeScript based and Electron can supervise the existing built DSH CLI without introducing a second language runtime between the shell and Harness.

The v0.1 carrier runs the built `@deepseek-ai/dsh` CLI as a child process using Electron's executable with `ELECTRON_RUN_AS_NODE=1`. The child boots the Web profile with `--host 127.0.0.1 --port 0`. The desktop shell treats the existing `dsh web: http://127.0.0.1:<port>` line as the readiness boundary, then loads that URL into one `BrowserWindow`. Application shutdown sends SIGTERM to the runtime and escalates to SIGKILL only after a bounded teardown timeout.

The renderer remains unprivileged: Node integration is disabled, context isolation and sandboxing are enabled, external navigations are denied, and a preload exposes only a small read-only desktop identity object. Ordinary HTTP(S) links are delegated to the operating system browser rather than opening additional Electron windows.

macOS is the first packaging target. Electron Forge owns `.app`/DMG packaging, while the main-process and runtime-supervisor code stays platform-neutral so Windows can add its maker, icons, signing, and lifecycle verification without changing the runtime contract.

The loopback Web carrier is a first desktop transport, not a permanent architectural requirement. DSH's connection layer already abstracts browser and in-process carriers, so a future desktop-specific IPC/in-process carrier may remove the private HTTP hop while preserving the Workbench UI and Harness runtime boundaries.

## Alternatives considered

**Rewrite the desktop application in Flutter or Swift and reimplement Harness behavior.** Rejected because it would turn the desktop effort into a second agent platform and create permanent parity work across sessions, tools, workflows, permissions, persistence, and plugin evolution.

**Use Tauri with a Node sidecar for the first release.** Rejected for v0.1 because DSH is already a Node.js runtime and Electron can supervise it directly. Tauri remains technically viable if application-size or resource constraints later justify an additional Rust/sidecar boundary.

**Load the DSH renderer with unrestricted Node integration.** Rejected because Web/plugin content would inherit desktop process capabilities. Desktop privileges must cross explicit preload/IPC contracts instead.

**Bind the embedded runtime to a fixed port.** Rejected because multiple installations, stale processes, or unrelated local services can occupy the port. OS-assigned loopback ports remove that collision class.

## Consequences

The desktop application is now an explicit repository app rather than a browser-only skin. Users can eventually launch Yanami Workbench as a normal macOS or Windows application while the existing DSH plugin/runtime stack remains the source of truth for agent behavior.

The first implementation still carries the Web profile over a private loopback HTTP server internally. This is acceptable for v0.1 because the server is loopback-only and lifecycle-owned by Electron, but a native IPC carrier remains a future optimization. Release distribution is not yet production-ready: branded application icons, Apple code signing/notarization, Windows makers/signing, update delivery, and packaged-build verification remain follow-up work.
