# Yanami Workbench UI Visual and Product Constraints

Status: **long-term product constraint**. This document is normative for Yanami Workbench UI work on this branch and future continuations. New UI must conform unless this file is explicitly revised.

## 1. Product identity

Yanami Workbench is a personal AI workbench, not a generic admin console. The intended experience is calm, lightweight, warm, clear, focused and companion-like while remaining highly functional for sustained professional work.

Reference direction is the user-approved August 2026 concept set: bright summer daylight, airy blue/white surfaces, soft glass-like cards, gentle rounded geometry, restrained decorative illustrations, clear information hierarchy, and the five DSH modes as first-class work states.

Avoid: heavy enterprise-dashboard styling, dense control-panel appearance, cyber/neon aesthetics, excessive dark surfaces, sharp boxes, tiny compressed copy, temporary one-off component styling, and decorative art that competes with task content.

## 2. Primary visual direction

The primary design target is **light theme first**. Dark theme remains supported, but new visual decisions must be authored from the light composition first and then mapped through theme tokens.

Core palette behavior:
- base: warm white / mist white / very pale blue;
- brand: calm medium blue;
- accents: cyan, mint, soft gold, limited warm orange;
- borders: low-contrast and cool;
- shadows: wide, soft, low-opacity;
- masks: translucent with subtle blur;
- illustration: supportive, never structural.

All production colors should use existing/new DSW theme tokens rather than hardcoded page-local values whenever practical.

## 3. Stable product information architecture

The following are durable top-level concepts:
- Do — execution;
- Spec — scope/specification;
- Plan — planning;
- Review — verification/review;
- Ship — delivery.

Home/workbench should organize around:
- current workspace and current mode;
- mode switcher;
- Mission Cockpit;
- Project Memory;
- Evidence & Delivery;
- smart suggestions / inspiration;
- recent work when useful;
- a clear composer / task entry point.

Conversation keeps:
- workspace/sidebar context;
- session header with title, mode and Project Memory affordance;
- conversation stream;
- composer;
- optional overlays/panels that never collapse the main content into unusable widths.

## 4. Layout rules

Desktop is the primary surface. Optimize first for 1440–1728 px viewport widths, but do not assume concept-art canvas height. Electron windows commonly expose only ~760–900 CSS px of usable vertical space.

Spacing scale: `4 / 8 / 12 / 16 / 20 / 24 / 32 / 40`.

Mandatory rules:
- no text may be forced into vertical one-character columns by panel width;
- no modal/form editor may rely on content overflow to compensate for an undersized container;
- primary cards use stable grid alignment and consistent internal padding;
- major regions keep 24–32 px breathing room where space permits;
- page content must not visually stick to window edges;
- controls may compact responsively, but content readability has priority over preserving a multi-column layout;
- height-responsive density is required: reduce decorative mass, padding and card height before making a normal desktop window feel zoomed-in;
- do not use `transform: scale(...)` or browser zoom as a product-layout solution; component geometry must respond natively;
- at a normal 1440+ desktop width with ~820–900 px usable height, the blank Workbench should expose its hero, mode row, lower summary surfaces and resident composer with minimal initial scrolling when content permits.

Responsive targets:
- >= 1440: full desktop composition;
- 1200–1439: reduce secondary decoration before reducing content width;
- 960–1199: reduce card column count and secondary side content;
- < 960: prefer stacked/simplified layouts;
- <= 900 px usable height: apply a compact desktop-density pass without shrinking typography below readable product sizes.

## 5. Card/surface system

Use a small number of reusable surface archetypes rather than page-specific boxes:
- hero / summary surface;
- standard content card;
- statistic card;
- mode card;
- file/evidence card;
- form section card;
- empty-state card.

Surface characteristics:
- medium/large rounded corners;
- subtle border;
- soft elevation only when necessary;
- clear title/meta/body hierarchy;
- hover and selected states must be related, not independently invented.

## 6. Dialog, drawer and settings rules

Dialogs are part of the product, not implementation leftovers.

- simple confirmation/info dialog: ~380–520 px;
- ordinary form dialog: ~560–720 px;
- complex editor (Project Memory class): typically ~780–900 px or a dedicated page/panel;
- settings surface: typically ~900–980 px on a large desktop, with internal content scrolling instead of occupying nearly the entire viewport;
- complex settings must use a full-width centered settings surface or page, not a narrow sidebar-constrained floating column;
- long editors must have a bounded internal scroll region;
- footer actions remain visually stable and reachable;
- normal desktop dialogs should generally stay within roughly 80–84dvh where practical; short windows may expand toward the viewport with reduced outer padding;
- dialogs/overlays must portal to `document.body` (or equivalent root overlay host) so sidebar stacking/containment cannot clip them.

## 7. Typography and density

- page title > section title > card title > body > metadata;
- body copy should normally be 13–15 px with comfortable line-height;
- compact summary metadata may use 10–12 px when contrast and spacing remain sufficient;
- avoid long lines and dense microcopy walls;
- Chinese is the primary UI language; English is secondary labeling/context;
- English mode names may remain prominent, but must not overpower task content.

## 8. Illustration and character usage

Anime/companion art is allowed as a product identity element.

Constraints:
- illustration cannot block controls or meaningful content;
- functional information must remain usable with illustration hidden;
- use illustration primarily in hero, empty state, inspiration, onboarding and calm secondary spaces;
- do not turn every card into an illustrated card;
- preserve professional usability first.

## 9. Interaction behavior

- hover: subtle and immediate;
- selected state: clear brand-color reinforcement;
- animation: short, quiet, purposeful;
- no large bouncing or ornamental motion;
- every core surface must have loading, empty, normal, error and disabled behavior where applicable;
- focus and keyboard behavior must remain visible and usable.

## 10. Implementation constraints

Prefer shared primitives and tokens over page-local CSS.

Before introducing a new reusable visual pattern, first check whether it belongs in:
- `ui-primitives`;
- `ui-theme`;
- a shared layout/surface component.

Do not ship new UI that:
- hardcodes an arbitrary modal width incompatible with its content;
- relies on an ancestor sidebar for overlay positioning;
- introduces uncontrolled magic-number spacing sets;
- regresses text wrapping/overflow;
- bypasses theme tokens for large visual regions without a documented reason.

## 11. Required UI review for every meaningful change

Before considering a UI task complete, verify:
1. 1440+ desktop layout;
2. 760 / 820 / 900-ish usable-height behavior for large desktop widths;
3. no text overflow or vertical compression;
4. dialog/overlay viewport behavior;
5. scroll ownership and footer reachability;
6. hover/selected/focus states;
7. light-theme visual quality;
8. dark-theme readability (even if not visually final);
9. consistency with the five-mode product hierarchy;
10. consistency with Project Memory / Evidence / Mission Cockpit vocabulary;
11. no debug-only console output remains.

## 12. Direction of travel

Near-term priority is not a one-shot redesign. Improve in controlled passes:
1. eliminate broken/clipped layouts;
2. normalize dialog and settings surfaces;
3. normalize desktop scale, cards and spacing;
4. migrate the workbench toward the approved airy light visual system;
5. then add refined illustration, motion and secondary polish.
