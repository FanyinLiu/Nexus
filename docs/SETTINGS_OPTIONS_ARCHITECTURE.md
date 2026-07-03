# Settings Options Architecture

Last updated: 2026-06-30.

This note defines the settings content architecture used by `src/components/settingsHomeArchitecture.ts`.
It is about option placement and disclosure, not visual skin.

## References

- [Open WebUI](https://github.com/open-webui/open-webui): borrow low-noise AI workspace density and provider-agnostic setup boundaries.
- [LibreChat](https://github.com/danny-avila/LibreChat): borrow capability boundaries for agents, MCP/tools, artifacts, search, and model/provider features.
- [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm): borrow inspectable memory, context, agent, and tool boundaries.
- [Cherry Studio](https://github.com/CherryHQ/cherry-studio): borrow predictable dense desktop settings organization.
- [shadcn/ui](https://github.com/shadcn-ui/ui) and [Radix UI Primitives](https://github.com/radix-ui/primitives): borrow form state discipline and accessible primitive behavior.

## Nexus Model

Settings is a companion control surface, not a dashboard. The first screen should answer the questions the user needs in companion language, without making the drawer feel like a backend:

- How does Nexus present itself?
- How does the companion behave?
- What does Nexus remember or reuse?
- Which model, tool, or integration powers it?
- What can be cleared, revoked, or inspected?
- Where are diagnostics and setup recovery?

The home screen is grouped by user meaning, not implementation modules:

| Group | Sections | Reason |
| --- | --- | --- |
| Appearance & experience | theme row, chat, letters | Keeps presentation, companion identity, and lightweight interaction preferences together. |
| Companion behavior | voice, window, autonomy | Controls how Nexus speaks, sits on the desktop, and initiates contact. |
| Memory & context | memory, lorebooks | Controls what Nexus remembers and which background it may reuse. |
| Models & connections | model, tools, optional integrations | Keeps provider, tool, and external capability setup together without provider-studio chrome. |
| Maintenance | history, console, onboarding | Keeps records, cleanup, diagnostics, and setup recovery reachable without making low-frequency utilities read as primary companion settings. |

## Source Contract

- Home ordering lives in `src/components/settingsHomeArchitecture.ts`.
- The drawer renders from that architecture and should not hand-sort settings in JSX.
- New settings sections must choose one intent group before they appear on the home surface.
- Group headers stay lightweight text rows, not cards.
- The home screen may show all groups, but each group must stay summary-like: compact rows, subdued status text, and no nested dashboard cards.
- Low-frequency recovery utilities belong in `maintenance` together. Avoid splitting diagnostics, onboarding, and history into multiple home groups unless a trust requirement needs a dedicated boundary.
- High-trust rows stay reachable from the home screen without turning the home screen into a warning center.
