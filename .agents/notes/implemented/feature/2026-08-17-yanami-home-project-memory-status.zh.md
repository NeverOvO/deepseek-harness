# Agent Note：八奈见 Home Project Memory 状态面

Status: implemented

## 问题

Workspace 级持久 Project Memory 编辑器已经有两个真实入口：活动会话 Header，以及 Home / New Session 的 Workspace 路由。但 Home 仪表盘里的“项目记忆”卡片仍然只是静态概念文案，真正的 Workspace 操作则显示在卡片外，因此仪表盘无法说明持久记忆是否存在、哪些分区已有内容、是否存在待审候选，或者加载是否失败。

这种分离也带来架构风险。如果为了填充卡片而让 `ui-conversation` 直接读取 Project Memory，会跨插件边界重复能力所有权；如果在真实布局需求尚未分化前新增第二个公共 slot，又会无必要地扩大 contract 面。

## 决策

Home 的 Project Memory 卡片升级为所选 Workspace 的第一方状态/操作面，同时复用现有 `conversation.hero.workspace` slot 和现有 `projectMemoryFor(workspaceId)` controller。

`ui-conversation` 继续只负责仪表盘框架和布局位置。现有 Workspace slot 的结果作为外部 React 内容组合进 Project Memory 卡片；`ui-workspace` 继续独占持久记忆状态、订阅、重试、候选数量以及真实编辑器入口。

## 实现

`ConversationRoot` 现在只渲染一次现有 Workspace slot，并把结果传入 `HeroShell`；仪表盘下方的 Workspace 行只保留 Workspace 选择器 chip 和 agent preset 控件。`HeroShell` 再把这段外部内容传给 `YanamiHome`，由 `YanamiHome` 把它放进 Project Memory 卡片。若 Workspace slot 没有被组合，原来的静态卡片内容仍作为结构性 fallback 保留。

`WorkspacePicker` 现在会针对所选 Workspace 挂载 `ProjectMemoryHomeSurface`。该状态面解析与编辑器相同的稳定 `ProjectMemoryController`，订阅正式记忆和 candidate snapshot，并在 Home 表示该 Workspace 时主动确保两条数据流已加载。

卡片会显示正式记忆分区覆盖率、已填充的标准分区、待审候选数量，并明确处理 loading、empty、hard error、带旧数据的 error 以及 retry 状态。操作按钮继续打开 `ProjectMemoryOpenPanel`，因此编辑仍走与会话 Header 共用的同一套持久编辑器和存储路径。

没有新增第二套 Project Memory cache、transport、DOM query、自定义事件，也没有让 Conversation 直接访问 Workspace 业务 service。

## 备选方案

**立即新增 `conversation.hero.projectMemory`。** 拒绝。现有 Workspace slot 已经拥有当前 Workspace 以及注入的持久记忆 controller；在没有独立布局需求时再加一个 slot 只会重复同一依赖。

**在 `ui-conversation` 中直接读取 Project Memory。** 拒绝。这会跨越客户端插件所有权边界，并为 Workspace 能力制造第二条状态路径。

**继续把真实操作留在仪表盘外，只优化占位文案。** 拒绝。Backlog 明确要求 Home 逐步成为可操作界面，而静态文案无法真实表达 loading、empty、candidate 和 failure 状态。

## 结果

现在在 Home 选择 Workspace 后，会在用户显式打开编辑器之前读取持久 Project Memory 和 candidate queue。这是刻意设计：Home 卡片已经从被动 launcher 变成 live dashboard surface。活动会话 Header 仍保持“打开 modal 前不触碰 controller”的原行为；只有 Home 状态面选择 eager read。

公共 slot contract 没有扩张。只有当 Project Memory 未来需要脱离 Workspace picker 独立布局，或同时出现在多个独立位置时，才应基于真实布局需求新增专用 slot。

## 验证

组件测试覆盖 Home 卡片组合与 fallback，以及 Project Memory 的 loading、已填充摘要、候选数量、真实编辑器路由、错误显示、重试和 empty 状态。仓库 GUI 与 replay-web 测试仍然是 viewport 和完整插件组合回归的验收路径。
