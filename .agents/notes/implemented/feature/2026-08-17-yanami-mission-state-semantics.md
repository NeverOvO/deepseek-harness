# Agent Note: Yanami Mission state semantics

Status: implemented

## Problem

Mission Cockpit previously collapsed two different projection states into the same presentation. `mission === undefined` means the Goal projection has not reached the Home surface yet, while `mission === null` means the projection has settled and there is no Goal. Both rendered “准备开始”, a zero progress bar, and the same helper copy, so a transient loading state looked like a confirmed empty state.

## Decision

Mission Cockpit must express the state the projection actually proves. An absent projection value is a loading state; a settled `null` projection is an empty state; a Goal projection is live state and continues to expose its durable phase, round-budget use, completion, and blocker reason.

No synthetic timeout or local retry state is added because the Goal projection contract does not expose an error/retry channel here. The UI should not invent one.

## Implementation

`YanamiHome` now labels `undefined` Mission data as “载入中”, renders a status message while task context is arriving, and withholds the progressbar so zero is not misrepresented as measured progress. A settled `null` Mission is labeled “待创建”, retains an explicit zero round-budget bar, and explains that no Goal exists yet. Active, paused, blocked, and complete states keep their existing durable projection behavior.

The Mission card also publishes `data-mission-phase="loading"` versus `"empty"`, preserving a clean styling seam without creating presentation state elsewhere.

## Consequences

The two live Home dashboard surfaces now have intentional state semantics: Mission distinguishes loading, settled-empty, active/paused/blocked/complete; Project Memory already distinguishes loading, empty, error/stale-error, retry, populated coverage, and candidate state through its Workspace-owned controller. This completes the dashboard-specific state-definition backlog item without claiming that every loading/error surface across the whole application has been normalized.

## Validation

The Yanami Home component suite now separately asserts loading and settled-empty Mission behavior, including the absence of a false progressbar during loading and the real zero budget state after an empty projection settles. Existing projection tests continue to cover active, blocked, paused, and complete states.
