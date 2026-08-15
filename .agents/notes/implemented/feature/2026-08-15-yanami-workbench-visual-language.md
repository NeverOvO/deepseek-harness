# Agent Note: Yanami Workbench visual language

Status: implemented

## Problem

The stock DeepSeek Harness web shell is optimized as a neutral product surface. This deployment needs a recognizable personal-workbench identity without forking the agent loop, tool runtime, session model, or feature packages into a separate UI system. The visual treatment also needs to remain compatible with the existing light/dark appearance preference and with feature packages that consume semantic theme aliases.

A palette-only restyle is not sufficient. The blank-session experience also needs to communicate the workbench model — modes, mission cockpit, project memory, and evidence delivery — while the active conversation must remain the dense execution surface that already works well for code, tools, logs, and long-running tasks.

## Decision

The web deployment is branded as **八奈见工作台 / Yanami Workbench**. Its visual language is implemented as an additional `ui-theme` stylesheet, `yanami-workbench.css`, imported by the web shell after the base design palette.

The layer keeps shared visual constants in `ui-theme` and exposes Yanami-specific semantic aliases for an airy summer palette: navy and sky blue are the primary identity, translucent white surfaces provide the glass treatment, mint is secondary support, and lemon yellow is reserved for small highlights. A dark "night study" variant overrides both the generic aliases changed by the layer and the Yanami-specific aliases so the existing appearance control remains valid.

`ui-layout` and `ui-sidebar` consume those aliases. They do not own a second palette. The shell background receives the soft summer gradient, the three-column frame uses translucent surfaces, and the sidebar replaces the stock wordmark with the bilingual Yanami Workbench label plus a compact `八` rail monogram. Browser and PWA product names are also changed to 八奈见工作台.

The blank-session hero is replaced with a bounded Yanami Workbench dashboard rather than another workflow runtime. It presents the five intended collaboration modes (Do / Spec / Plan / Review / Ship), Mission Cockpit, Project Memory, Evidence & Delivery, and a small Yanami-inspired mascot treatment. The real workspace selector and composer remain owned by `ConversationRoot` immediately below it, so starting work transitions into the existing active conversation tree instead of mounting a second task system.

The dashboard is intentionally shown only for a blank session. Once a task contains conversation content, DSH keeps the existing high-density execution layout. This preserves the code/tool/log ergonomics while making the new-session state feel like a distinct workbench rather than a recolored chat window.

Character artwork is deliberately not embedded as a global page background. Character presence belongs in bounded assistant, empty-state, or workbench surfaces where an asset can be changed without coupling the application shell to a specific illustration.

## Alternatives considered

**Restyle each feature package independently.** Rejected because it would duplicate literal colors across CSS modules, violate the theme ownership rules, and make future upstream merges harder.

**Replace the whole web shell with a bespoke dashboard.** Rejected because the current slot/layout/session infrastructure is valuable and active task execution benefits from the existing conversation surface. The dashboard is therefore scoped to the blank-session phase rather than replacing the execution UI.

**Show dashboard cards during every active conversation.** Rejected because permanent cards would compete with code, logs, tool output, and diffs for horizontal and vertical space. Workbench framing belongs before a task starts; execution content owns the screen after it starts.

**Use supplied character artwork as a full-screen wallpaper.** Rejected because it reduces text contrast, makes the product feel like a wallpaper skin rather than a work tool, and couples core layout geometry to one illustration. Character elements remain an optional bounded layer.

## Consequences

The deployment gains a distinct visual identity and a structurally different blank-session home while preserving the existing plugin architecture, layout semantics, composer lifecycle, and light/dark preference. Upstream feature packages continue to consume semantic aliases and therefore inherit the new look without private color forks.

The Do / Spec / Plan / Review / Ship cards currently describe the intended collaboration model; they are not yet the source of runtime mode state. Their behavior layer must be added separately before the cards become interactive controls. Mission, Project Memory, and Evidence panels are likewise product framing for the next capability phase rather than fake completion data.

The Yanami layer is currently deployment-oriented rather than a separately selectable theme in the Appearance control: selecting light or dark changes its palette variant but does not disable the Yanami overrides. If this repository later needs to ship multiple branded workbenches side by side, the layer should move behind a registered theme/profile instead of accumulating more global deployment CSS.
