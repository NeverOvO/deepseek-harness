# Agent Note：八奈见 Mission 状态语义

Status: implemented

## 问题

Mission Cockpit 之前把两种不同的投影状态合并成同一套表现。`mission === undefined` 表示 Goal 投影尚未到达 Home surface，而 `mission === null` 表示投影已经稳定，并且当前确实没有 Goal。两者此前都会显示“准备开始”、0 进度条和相同提示，因此短暂的加载过程会看起来像已经确认的空状态。

## 决策

Mission Cockpit 必须只表达投影真实证明的状态。没有投影值时属于 loading；已经稳定的 `null` 属于 empty；拿到 Goal projection 后才进入 live state，并继续展示真实生命周期、执行轮次预算、完成态与阻塞原因。

这里不新增虚构的超时或本地 retry 状态，因为当前 Goal projection contract 并没有向 Home 暴露 error/retry channel，UI 不应该自行编造。

## 实现

`YanamiHome` 现在把 `undefined` Mission 数据标记为“载入中”，在任务上下文到达前显示状态提示，并隐藏 progressbar，避免把 0 误表达成已测量的真实进度。已经稳定的 `null` Mission 标记为“待创建”，保留明确的 0 轮次预算条，并说明当前尚未创建 Goal。active、paused、blocked 与 complete 状态继续沿用原有真实投影行为。

Mission 卡片同时区分 `data-mission-phase="loading"` 与 `"empty"`，为后续样式提供明确 seam，而不把表现状态复制到其他数据层。

## 结果

目前两个 live Home dashboard surface 都具备明确状态语义：Mission 区分 loading、settled-empty、active/paused/blocked/complete；Project Memory 已通过 Workspace-owned controller 区分 loading、empty、error/stale-error、retry、正式记忆覆盖率与 candidate 状态。因此 dashboard 专项的状态定义 backlog 可以完成，但这并不意味着整个应用里的所有 loading/error surface 都已经统一。

## 验证

Yanami Home 组件测试现在分别验证 Mission loading 与 settled-empty 行为，包括 loading 时不展示虚假的 progressbar，以及空投影稳定后真实显示 0 预算状态。原有投影测试继续覆盖 active、blocked、paused 与 complete。
