# Yanami Workbench UI Improvement Backlog

This backlog operationalizes `UI_VISUAL_AND_PRODUCT_CONSTRAINTS.md`. Keep it current as work lands.

## Delivery cadence

Yanami UI work is delivered in coherent milestones, not screenshot-by-screenshot micro-tuning. A milestone should combine visual normalization, real interaction wiring, responsive/empty/error states, and CI evidence before asking for manual visual acceptance. Manual testing is reserved for milestone gates rather than every commit.

## P0 — structural correctness

- [x] Settings overlay renders at viewport scope, never inside sidebar width/stacking context.
- [x] Settings panel remains readable at desktop widths with a stable two-column shell.
- [x] Project Memory editor uses an editor-grade modal instead of the default compact dialog width.
- [x] Project Memory fields have predictable internal scrolling and no cramped textareas.
- [x] Temporary Project Memory slot diagnostics have been removed from production console output.
- [ ] Check other overlays for sidebar/container clipping.

## P1 — visual normalization

- [x] Add a first desktop-density pass for Home, Settings and Project Memory so 1440–1728 wide Electron windows do not feel zoomed or oversized.
- [x] Establish reusable surface/card spacing and radius rules across Workbench home.
- [x] Normalize Do / Spec / Plan / Review / Ship cards and selected states.
- [x] Normalize header chips/buttons between Home and Conversation; Workspace and Agent Preset now share the same 28px compact control geometry as active-session header actions while read-only session context keeps the same rhythm without false interaction.
- [x] Improve workspace/sidebar hierarchy: section labels, current workspace, current session, actions.
- [x] Normalize Project Memory, Mission Cockpit and Evidence surfaces to one card language.
- [x] Carry the Yanami surface language into Settings, Project Memory editor and active transcript chrome.
- [ ] Improve empty/loading/error states so they feel intentional rather than raw technical states.
- [x] Validate the Home + resident composer composition at common Electron viewport heights (760 / 820 / 900 CSS px) without immediate unnecessary scrolling.

## P1.5 — functional dashboard convergence

The home dashboard must progressively become an operational surface instead of remaining a static concept card set. Cross-package behavior must use existing services or explicit slot contracts; no DOM querying, global custom-event shortcuts, or duplicate persistence paths.

- [x] Do / Spec / Plan / Review / Ship cards switch the real Yanami mode rather than only changing presentation.
- [x] Mission Cockpit consumes the live Goal projection when a mission exists.
- [x] Project Memory is a real Workspace-level durable editor in the conversation header, including candidate review.
- [x] Give the Home / New Session surface a first-class route into the same durable Project Memory editor without duplicating transport or state.
- [x] Promote the Home Project Memory card itself into a richer status/action surface; it now renders durable section coverage, pending candidate count, loading/empty/error states, retry, and the same editor action through the existing Workspace slot.
- [ ] Replace static Evidence & Delivery placeholders with real test/build/risk evidence when the composed delivery service exposes it.
- [ ] Add recent-task / recent-activity summaries from durable session/workspace state rather than mock counters.
- [ ] Promote actionable smart suggestions only when they can execute or navigate to a real Workbench capability.
- [ ] Define intentional loading/empty/error states for every live dashboard surface.

## P2 — approved light visual direction

- [x] Make light theme the visual reference implementation for Yanami Workbench surfaces.
- [x] Introduce airy blue/white surface tokens and restrained glass treatment through `ui-theme`.
- [x] Normalize light Sidebar / app-frame / composer-adjacent surfaces through shared tokens.
- [x] Align Settings and Project Memory overlays with the same light glass language.
- [ ] Reduce remaining dark/heavy visual mass without sacrificing contrast.
- [ ] Refine remaining shadows/borders/radii at token level instead of page-local overrides.
- [ ] Add restrained companion illustration zones that do not interfere with functional content.

## P3 — interaction polish

- [ ] Consistent hover/focus/selected motion timing.
- [ ] Keyboard/focus pass for settings, dialogs, mode cards and Project Memory.
- [ ] Responsive pass at 1200 / 960 breakpoints.
- [ ] Validate dark-theme readability after light-theme redesign stabilizes.

## Milestone gates

### M1 — Workbench visual system
- Home, mode cards, Sidebar, app frame, Settings and Project Memory share one light-first surface language.
- Dark remains readable.
- Desktop density is stable.

### M2 — Operational Home
- Home / New Session has a direct route into the real durable Project Memory editor.
- Mission card is live.
- Evidence card is live where evidence services are composed.
- Recent work is derived from real session/workspace state.
- Empty/loading/error states are intentional.

### M3 — Reference-design convergence
- Companion/illustration zone is restrained and non-blocking.
- Home composition, typography, spacing and color hierarchy visually track the approved Yanami reference direction.
- Conversation and Settings feel like the same product, not separate plugin surfaces.

## Acceptance gates

A UI item is not complete until:
- it builds in repository CI;
- it has no horizontal/vertical text compression defects;
- modal/overlay placement is correct at desktop viewport scope;
- primary actions are always reachable;
- desktop-scale UI stays proportionate when usable viewport height is smaller than the concept-art canvas;
- light theme matches the Yanami visual constraint direction;
- dark theme remains readable;
- functional cards use durable services/slot contracts rather than presentation-only mocks where real data exists;
- no debug logging or temporary tracing is left behind.
