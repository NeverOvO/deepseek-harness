# Agent Note: 八奈见工作台桌面壳

Status: implemented

## Problem

八奈见工作台的目标是成为日常使用的桌面工作环境，而不是一个需要用户先开终端、再打开浏览器标签页的 Web 页面。如果为了桌面化在另一套框架里重写 DeepSeek Harness 的 Agent Runtime，就会重复实现 Goal、Workflow、Jobs、Session、Workspace、工具、审批和持久化等能力；如果继续把 `dsh web` 直接暴露给用户，则安装和生命周期管理仍然是用户需要理解的事情。

第一版桌面实现需要先在 macOS 上可用，同时保留可信的 Windows 扩展路径；不能把 DSH Server 暴露到局域网；也不能因为把现有 Web UI 放进 Electron，就让 Renderer 自动获得不受限制的 Node.js 权限。

## Decision

`apps/desktop` 作为 **八奈见工作台 / Yanami Workbench** 的桌面应用边界。桌面壳选择 Electron，因为当前仓库和 DSH Runtime 已经是 Node.js/TypeScript 技术栈，Electron 可以直接管理现有构建后的 DSH CLI，不需要在桌面壳与 Harness 之间再增加第二种语言运行时。

v0.1 把构建后的 `@deepseek-ai/dsh` CLI 作为子进程运行。在源码 Checkout 中，优先使用包管理器通过 `npm_node_execpath` 继承进来的系统 Node，因此 DSH 的原生依赖继续使用安装时对应的 ABI。打包后的应用没有包管理器 Node，因此改为使用 Electron 自身可执行文件并设置 `ELECTRON_RUN_AS_NODE=1`；Forge 在打包阶段按 Electron ABI 重建原生依赖。`DSH_DESKTOP_NODE` 保留为诊断时显式覆盖 Runtime Node 的入口。

子进程以 `--host 127.0.0.1 --port 0` 启动 Web Profile。桌面壳会立即显示本地八奈见启动页，把现有的 `dsh web: http://127.0.0.1:<port>` 输出作为 Ready 边界，然后在同一个 `BrowserWindow` 中把启动页替换为该 Runtime URL。应用退出时先向 Runtime 发送 SIGTERM，只在限定时间内无法正常退出时升级为 SIGKILL。

Renderer 保持低权限：关闭 Node Integration，开启 Context Isolation 与 Sandbox，只允许导航到当前活动 Runtime Origin；Preload 当前只暴露一个只读的桌面身份对象。普通 HTTP(S) 链接交给系统默认浏览器打开，而不是新建 Electron Window。

macOS 是第一打包目标。`.app`/DMG 由 Electron Forge 负责；Main Process 和 Runtime Supervisor 保持平台无关，因此后续 Windows 只需要增加对应 Maker、图标、签名和生命周期验证，不需要改变 Runtime Contract。

Loopback Web Carrier 是第一阶段桌面传输方式，而不是永久架构要求。DSH 的 Connection Layer 已经抽象了 Browser 与 In-process Carrier，因此未来可以增加 Electron IPC/In-process Carrier，去掉内部 HTTP 跳转，同时保留 Workbench UI 与 Harness Runtime 的边界。

## Alternatives considered

**使用 Flutter 或 Swift 重写桌面应用，并重新实现 Harness 行为。** 不采用，因为这会把桌面化变成第二套 Agent Platform，并永久承担 Session、Tool、Workflow、Permission、Persistence 与 Plugin Evolution 的双端一致性成本。

**第一版使用 Tauri + Node Sidecar。** v0.1 不采用，因为 DSH 本身就是 Node.js Runtime，Electron 可以直接管理它。若后续应用体积或资源占用成为明确约束，Tauri 仍然可以重新评估。

**让 DSH Renderer 直接拥有完整 Node 权限。** 不采用，因为 Web/Plugin 内容会同步获得桌面进程能力。桌面权限必须通过显式 Preload/IPC Contract 暴露。

**让嵌入 Runtime 固定使用某个端口。** 不采用，因为其他本地服务、残留进程或多实例可能占用该端口。让操作系统分配 Loopback Port 可以消除这一类冲突。

## Consequences

桌面应用现在成为仓库中的正式 App，而不再只是 Browser UI 的换肤。后续用户可以像普通 macOS/Windows 软件一样启动八奈见工作台，同时现有 DSH Plugin/Runtime Stack 继续作为 Agent 行为的唯一事实来源。

第一版内部仍然通过私有 Loopback HTTP 承载 Web Profile。因为 Server 只绑定本机回环地址，并由 Electron 完整管理生命周期，所以 v0.1 可以接受这一点，但 Native IPC Carrier 仍然是后续优化方向。当前分发还没有达到生产发布状态：品牌应用图标、Apple Code Signing/Notarization、Windows Maker/Signing、自动更新、Packaged Build 验证，以及为新增 Electron/Forge 依赖重新生成 pnpm Lockfile 仍属于后续工作。
