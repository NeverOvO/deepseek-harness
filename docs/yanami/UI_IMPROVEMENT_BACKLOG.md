# Yanami Workbench UI Improvement Backlog

This backlog operationalizes `UI_VISUAL_AND_PRODUCT_CONSTRAINTS.md`. Keep it current as work lands.

## P0 — structural correctness

- [x] Settings overlay renders at viewport scope, never inside sidebar width/stacking context.
- [x] Settings panel remains readable at desktop widths with a stable two-column shell.
- [x] Project Memory editor uses an editor-grade modal instead of the default compact dialog width.
- [x] Project Memory fields have predictable internal scrolling and no cramped textareas.
- [x] Temporary Project Memory slot diagnostics have been removed from production console output.
- [ ] Check other overlays for sidebar/container clipping.

## P1 — visual normalization

- [x] Add a first desktop-density pass for Home, Settings and Project Memory so 1440–1728 wide Electron windows do not feel zoomed or oversized.
- [ ] Establish reusable surface/card spacing and radius rules across Workbench home.
- [ ] Normalize Do / Spec / Plan / Review / Ship cards and selected states.
- [ ] Normalize header chips/buttons between Home and Conversation.
- [ ] Improve workspace/sidebar hierarchy: section labels, current workspace, current session, actions.
- [ ] Normalize Project Memory, Mission Cockpit and Evidence surfaces to one card language.
- [ ] Improve empty/loading/error states so they feel intentional rather than raw technical states.
- [ ] Validate the Home + resident composer composition at common Electron viewport heights (760 / 820 / 900 CSS px) without immediate unnecessary scrolling.

## P2 — approved light visual direction

- [ ] Make light theme the visual reference implementation for Yanami Workbench.
- [ ] Introduce airy blue/white surface tokens and restrained glass treatment through `ui-theme`.
- [ ] Reduce dark/heavy visual mass without sacrificing contrast.
- [ ] Refine shadows/borders/radii at token level instead of page-local overrides.
- [ ] Add restrained companion illustration zones that do not interfere with functional content.

## P3 — interaction polish

- [ ] Consistent hover/focus/selected motion timing.
- [ ] Keyboard/focus pass for settings, dialogs, mode cards and Project Memory.
- [ ] Responsive pass at 1200 / 960 breakpoints.
- [ ] Validate dark-theme readability after light-theme redesign stabilizes.

## Acceptance gates

A UI item is not complete until:
- it builds in repository CI;
- it has no horizontal/vertical text compression defects;
- modal/overlay placement is correct at desktop viewport scope;
- primary actions are always reachable;
- desktop-scale UI stays proportionate when usable viewport height is smaller than the concept-art canvas;
- light theme matches the Yanami visual constraint direction;
- dark theme remains readable;
- no debug logging or temporary tracing is left behind.
