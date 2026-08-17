# Agent Note: Yanami Home Project Memory status surface

Status: implemented

## Problem

The durable Workspace Project Memory editor already had two real entry points: the active conversation header and the Home / New Session workspace route. The Home dashboard card itself, however, was still static concept copy. The real Workspace action rendered outside the card, so the dashboard could not communicate whether durable memory existed, which sections were populated, whether review candidates were pending, or whether loading had failed.

That split was also an architectural risk. Filling the card by reading Project Memory from `ui-conversation` would duplicate ownership across plugin boundaries, while adding a second public slot before placement actually diverged would expand the contract surface unnecessarily.

## Decision

The Home Project Memory card becomes the first-class status/action surface for the selected Workspace while reusing the existing `conversation.hero.workspace` slot and the existing `projectMemoryFor(workspaceId)` controller.

`ui-conversation` continues to own only the dashboard frame and placement. The existing Workspace slot result is composed into the Project Memory card as foreign React content. `ui-workspace` remains the owner of durable-memory state, subscriptions, retry behavior, candidate counts, and the exact editor route.

## Implementation

`ConversationRoot` now renders the existing workspace slot once, passes that result into `HeroShell`, and keeps only the Workspace selector chip plus agent-preset control in the row below the dashboard. `HeroShell` forwards its foreign content into `YanamiHome`, and `YanamiHome` renders it inside the Project Memory card. The original static card content remains as a structural fallback when the Workspace slot is not composed.

`WorkspacePicker` now mounts `ProjectMemoryHomeSurface` for the selected Workspace. That surface resolves the same stable `ProjectMemoryController` used by the editor, subscribes to committed memory and candidate snapshots, and ensures both streams as soon as the selected Workspace is represented on Home.

The card reports committed section coverage, names the populated canonical sections, shows the pending candidate count, and has explicit loading, empty, hard-error, stale-error, and retry behavior. Its action opens `ProjectMemoryOpenPanel`, so editing still uses the exact durable editor and persistence path already shared with the session header.

No second Project Memory cache, transport, DOM query, custom event, or Conversation-owned service access was introduced.

## Alternatives considered

**Add `conversation.hero.projectMemory` immediately.** Rejected because the existing Workspace slot already owns the selected Workspace plus the injected durable-memory controller. A second slot would duplicate the same dependency without an independent placement requirement.

**Fetch Project Memory directly in `ui-conversation`.** Rejected because it would cross the client plugin ownership boundary and create a second state path for a Workspace-owned capability.

**Keep the real action outside the dashboard and only improve the placeholder copy.** Rejected because the backlog explicitly calls for an operational Home surface and because static copy cannot truthfully represent loading, empty, candidate, or failure states.

## Consequences

Selecting a Workspace on Home now starts durable Project Memory and candidate reads before the user explicitly opens the editor. This is intentional: the Home card is now a live dashboard surface rather than a passive launcher. The active-session header remains controller-free until its modal opens; only the Home status surface opts into eager reads.

The public slot contract remains unchanged. If Project Memory later needs to render independently of Workspace picking, or appears in multiple simultaneous placements, a dedicated slot can be introduced then with an actual placement-driven requirement.

## Validation

Component coverage now checks Home card composition and fallback behavior, plus Project Memory loading, populated summary, candidate count, editor routing, error surfacing, retry, and empty state. Repository GUI and replay-web suites remain the acceptance path for viewport and composed-plugin regressions.
