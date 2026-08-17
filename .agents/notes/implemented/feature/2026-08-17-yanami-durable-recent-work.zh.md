# Agent Note：八奈见真实最近工作

Status: implemented

## 问题

Home Dashboard 的第四张卡仍然是装饰性的“今日小记”，但 Workbench 已经拥有能够描述真实最近工作的 durable Session 与 Workspace 状态。M2 backlog 明确要求 recent-task / recent-activity summary 来自真实 session/workspace state，而不是 mock counter。

## 决策

把装饰卡替换成 Workspace scoped 的“最近工作”，只使用 `ui-conversation` 已经拥有的标准 Session 与 Workspace projection。不要新增 service、Host RPC、持久化路径、DOM 查询或跨插件自定义事件。

投影保持最小：选中的 Workspace 提供 `sessionIds`，标准 `SessionSummary` 行提供 durable `displayTitle`、`updatedAt`、`blank`、`running`、`pendingInteraction` 与 completion reminder 状态。Blank draft session 属于准备状态而不是历史工作，因此排除；剩余行按 durable `updatedAt` 排序，最多取三条，再映射成纯 JSON Home view model。

## 实现

`recent-work.ts` 独立负责纯 Workspace/session 投影，并有独立单元测试。`ConversationRoot` 读取已有 session-row snapshot，对当前选中或 pending Workspace 进行投影，再通过 `HeroShell` 把纯 recent-work view model 传给 `YanamiHome`。

Home 卡展示真实标题和诚实状态：存在 pending interaction →“需要确认”，running →“进行中”，completion reminder →“已完成”，其余 →“最近更新”。同时明确区分“尚未选择 Workspace”和“已经选择 Workspace 但没有历史会话”。原有装饰性的“今日小记”卡被移除。

## 结果

Home Dashboard 又增加了一个由 durable 项目状态驱动的 operational surface。目前不会伪装成可恢复/可跳转入口；只有在真实且正确 scoped 的 action 被明确暴露后，才应该增加 resume/navigation 行为。因此本次推进 M2，同时没有让 presentation 直接依赖 session-domain method。

## 验证

纯投影测试覆盖 durable 更新时间排序、blank session 排除、状态优先级与三条上限。Yanami Home 组件测试覆盖 populated 与 settled-empty 最近工作状态。现有 Conversation 组合测试与仓库 GUI/replay CI 继续作为未改变 slot/service 边界的集成门禁。
