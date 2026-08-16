# Yanami Workbench UI Improvement Backlog

This backlog operationalizes `UI_VISUAL_AND_PRODUCT_CONSTRAINTS.md`. Keep it current as work lands.

## P0 — structural correctness

- [ ] Settings overlay must render at viewport scope, never inside sidebar width/stacking context.
- [ ] Settings panel must remain readable at desktop widths with a stable two-column shell.
- [ ] Project Memory editor must use a wide editor-grade modal instead of the default compact dialog width.
- [ ] Project Memory fields must have predictable internal scrolling and no cramped textareas.
- [ ] Remove temporary Project Memory slot diagnostics from production console output.
- [ ] Check other overlays for sidebar/container clipping.

## P1 — visual normalization

- [ ] Establish reusable surface/card spacing and radius rules across Workbench home.
- [ ] Normalize Do / Spec / Plan / Review / Ship cards and selected states.
- [ ] Normalize header chips/buttons between Home and Conversation.
- [ ] Improve workspace/sidebar hierarchy: section labels, current workspace, current session, actions.
- [ ] Normalize Project Memory, Mission Cockpit and Evidence surfaces to one card language.
- [ ] Improve empty/loading/error states so they feel intentional rather than raw technical states.

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
- light theme matches the Yanami visual constraint direction;
- dark theme remains readable;
- no debug logging or temporary tracing is left behind.
