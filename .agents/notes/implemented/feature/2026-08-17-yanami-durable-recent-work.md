# Agent Note: Yanami durable recent work

Status: implemented

## Problem

The fourth Home dashboard card was still decorative “今日小记” content while the Workbench already had durable Session and Workspace state capable of describing real recent work. The M2 backlog explicitly requires recent-task / recent-activity summaries to come from real session/workspace state rather than mock counters.

## Decision

Replace the decorative card with a Workspace-scoped Recent Work surface derived only from the standard Session and Workspace projections already present in `ui-conversation`. No new service, Host RPC, persistence path, DOM query, or cross-plugin event is introduced.

The projection is deliberately small: the selected Workspace supplies `sessionIds`; standard `SessionSummary` rows supply durable `displayTitle`, `updatedAt`, `blank`, `running`, `pendingInteraction`, and completion-reminder state. Blank draft sessions are excluded because they represent setup rather than historical work. Remaining rows are sorted by durable `updatedAt`, capped at three, and mapped to a plain JSON Home view model.

## Implementation

`recent-work.ts` owns the pure Workspace/session projection and is independently unit tested. `ConversationRoot` reads the existing session-row snapshot, projects the currently selected or pending Workspace, and forwards the plain recent-work view model through `HeroShell` into `YanamiHome`.

The Home card renders titles plus honest status hints: pending interaction → “需要确认”, running → “进行中”, completion reminder → “已完成”, otherwise “最近更新”. It also distinguishes “no Workspace selected” from “selected Workspace with no historical sessions”. The prior decorative note card is removed.

## Consequences

The Home dashboard now contains another operational surface backed by durable project state. It does not claim navigation or resume actions yet; those should only be added when a real, correctly scoped action is deliberately exposed. The feature therefore advances M2 without coupling presentation to session-domain methods.

## Validation

A pure projection test covers durable update ordering, blank-session exclusion, status precedence, and the three-row limit. Yanami Home component tests cover populated and settled-empty recent-work surfaces. Existing Conversation composition tests and repository GUI/replay CI remain the integration gate for the unchanged slot/service boundaries.
