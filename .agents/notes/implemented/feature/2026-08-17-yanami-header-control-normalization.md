# Agent Note: Yanami compact header control normalization

Status: implemented

## Problem

Yanami Home and the active Conversation header exposed the same Workbench context through visibly different control languages. The Home Workspace selector used a large glass pill, the Home Agent Preset selector used a softer borderless pill, the active-session Agent Preset became a 22px badge, while Project Memory already used a compact 28px header action. Moving from Home into a session therefore changed density and chrome even though the user remained inside the same product.

## Decision

Workbench context controls use one compact 28px visual language across the blank-session Home and the active Conversation header. Interactive controls share height, 9px radius, 12px typography, restrained blue-tinted borders, hover/expanded feedback, and a visible keyboard focus ring. Read-only session context uses the same geometry with a quieter surface and no false interaction state.

This is a visual contract, not a new component or cross-package API. Workspace, Agent Preset, and Project Memory remain owned by their existing plugins and continue to compose through the existing slots.

## Implementation

`HeroShell`'s Workspace selector now uses compact header geometry instead of a full pill/card treatment. `AgentPresetSeat` mirrors that same interactive geometry while preserving its menu, staged-selection behavior, introduce animation, reduced-motion handling, and disabled state. `AgentPresetLabel` in the active session header now occupies the same 28px rhythm as adjacent header actions while remaining a non-interactive label by construction.

The controls use existing `--dsw-*` semantic tokens only. No literal product color, new global CSS dependency, shared React component, slot, service, or persistence path was introduced.

## Consequences

Home-to-Conversation transitions now preserve the perceived density of the Workbench chrome. Interactive and read-only elements are distinguishable by behavior rather than by unrelated size systems. The change also gives the two Home selectors an explicit `:focus-visible` treatment, improving keyboard legibility without claiming the broader keyboard/focus backlog item is complete.

## Validation

The change is CSS-only and leaves the existing accessible DOM, menu ownership, slot registrations, and business state untouched. Existing component and real-composition suites remain the behavioral guard; assembled GUI/replay CI remains the visual integration gate.
