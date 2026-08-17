# Agent Note：八奈见紧凑型 Header 控件统一

Status: implemented

## 问题

八奈见 Home 与活动 Conversation Header 明明都在表达同一套工作台上下文，却使用了明显不同的控件语言。Home 的 Workspace 选择器是较重的玻璃胶囊，Home 的 Agent Preset 是更轻的无边框胶囊，进入活动会话后 Agent Preset 又缩成 22px 标签，而 Project Memory 已经采用 28px 的紧凑 Header 操作。用户从 Home 进入会话时，仍处于同一产品，却会感觉密度和 chrome 突然换了一套系统。

## 决策

空白会话 Home 与活动 Conversation Header 的工作台上下文控件统一采用 28px 紧凑视觉语言。可交互控件共享高度、9px 圆角、12px 字号、克制的蓝色倾向边框、hover/expanded 反馈与明确的键盘 focus ring；只读的会话上下文沿用相同几何尺寸，但使用更安静的表面，不伪装成可点击控件。

这是一项视觉契约，不新增共享组件或跨包 API。Workspace、Agent Preset 与 Project Memory 仍由原有插件独立拥有，并继续通过已有 slot 组合。

## 实现

`HeroShell` 的 Workspace 选择器从完整胶囊/卡片处理收敛为紧凑 Header 几何。`AgentPresetSeat` 使用同一套可交互几何，同时保留菜单、暂存选择、introduce 动画、reduced-motion 与 disabled 语义。活动会话 Header 中的 `AgentPresetLabel` 现在与相邻 Header actions 共用 28px 节奏，同时仍然严格保持只读标签属性。

所有控件只使用现有 `--dsw-*` 语义 token。没有新增字面产品色、全局 CSS 依赖、共享 React 组件、slot、service 或持久化路径。

## 结果

从 Home 进入 Conversation 后，工作台 chrome 的视觉密度保持连续。交互控件与只读信息通过真实行为而不是互不相关的尺寸体系来区分。本次也为 Home 两个选择器补上明确的 `:focus-visible` 表现，但不会因此把更广泛的键盘/focus backlog 项标记为完成。

## 验证

本次仅修改 CSS，不改变现有可访问 DOM、菜单所有权、slot 注册与业务状态。现有组件测试与真实组合测试继续承担行为回归保护，完整 GUI/replay CI 继续作为组装后的视觉集成门禁。
