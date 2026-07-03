# Open-Source UI Reference Audit

Last checked: 2026-06-30.

This note turns external UI references into Nexus-specific design constraints. It does not authorize cloning another product's layout, palette, spacing, or component skin. The goal is to extract durable interaction models that help Nexus keep its own companion-first identity.

## Verified References

Each repository below was checked as reachable through its remote `HEAD` before this note was updated.

| Reference | Repository | Nexus use |
| --- | --- | --- |
| Open WebUI | https://github.com/open-webui/open-webui | Low-noise AI workspace density and responsive chat utility. |
| Chatbox | https://github.com/chatboxai/chatbox | Desktop AI-client composer ergonomics and local-first interaction expectations. |
| Jan | https://github.com/janhq/jan | Local-first desktop AI posture, quiet runtime/model state, and privacy-centered client expectations. |
| assistant-ui | https://github.com/assistant-ui/assistant-ui | Chat component state grammar for thread, composer, branch, streaming, and message actions. |
| LibreChat | https://github.com/danny-avila/LibreChat | Mature chat product boundaries for agents, MCP/tools, artifacts, resumable streams, presets, and search. |
| Cherry Studio | https://github.com/CherryHQ/cherry-studio | Dense desktop provider/settings workflows without turning every control into a card. |
| AnythingLLM | https://github.com/Mintplex-Labs/anything-llm | Source context, workspace memory, and agent capability boundaries for desktop-aware flows. |
| LobeHub / LobeChat lineage | https://github.com/lobehub/lobehub | Polished agent/workspace design engineering and conversational spacing discipline. |
| Vercel AI Chatbot | https://github.com/vercel/ai-chatbot | Streaming-first chat composition and composer-first interaction priority. |
| OpenHands | https://github.com/All-Hands-AI/OpenHands | Coding-agent activity boundaries without adopting an autonomous workbench. |
| Cline | https://github.com/cline/cline | Human-in-the-loop agent activity, approval, checkpoint, plan/act, and command-output boundaries without adopting an IDE shell. |
| shadcn/ui | https://github.com/shadcn-ui/ui | Component recipe discipline for forms, dialogs, buttons, tabs, and stateful controls. |
| Radix UI Primitives | https://github.com/radix-ui/primitives | Accessible headless primitives, focus behavior, and controlled component composition. |

## Remote Head Evidence

This is a pinned evidence snapshot, not a live CI dependency. Do not run live GitHub checks in CI or release gates. Refresh this table manually when a reference is added, removed, or intentionally re-baselined.

Manual refresh command pattern: run `git ls-remote <repository> <observed branch>` for each manifest reference, then update `docs/open-source-ui-reference-manifest.json` and this table in the same review change.

Convenience check: `npm run ui:references:audit -- --reference-refresh-check` reports remote head drift without changing files. Use it only during intentional reference refresh work, never as a default test or release gate.

`docs/open-source-ui-reference-manifest.json` is the machine-readable source of truth for the reference set, observed heads, surface mappings, and borrow/avoid summaries. Keep this table and the manifest synchronized.

`docs/open-source-ui-pro-review-registry.json` is the machine-readable source of truth for the Pro review workflow state. It tracks each surface's local status, decision, next action, and commands. It does not store Pro response text, secrets, private logs, credentials, memory contents, personal data, or unrelated source dumps.

| Reference | Branch observed | Commit observed | CI usage |
| --- | --- | --- | --- |
| Open WebUI | `refs/heads/main` | `b711935dd57dbc223ebbf410175a8bbe7e4efafb` | Evidence only |
| Chatbox | `refs/heads/main` | `8639c946c0baedfdd12bbc88ac10f5aa87431647` | Evidence only |
| Jan | `refs/heads/main` | `56ecb8b8ae98d703ee96f20f3078343bafd48c52` | Evidence only |
| assistant-ui | `refs/heads/main` | `148e438bd89e68a89bb728e2c3ddaf80d855f9f5` | Evidence only |
| LibreChat | `refs/heads/main` | `9e74cc0e57b395926122bd4062c1fcedc48ed465` | Evidence only |
| Cherry Studio | `refs/heads/main` | `4112ff3a2ce410d9b5d4ee783a5c8014c91fa394` | Evidence only |
| AnythingLLM | `refs/heads/master` | `548987c2ce8d00613b36448c397a66b972e90450` | Evidence only |
| LobeHub / LobeChat lineage | `refs/heads/canary` | `bd488dab060c26f9048247cfa83d2994c150a6cc` | Evidence only |
| Vercel AI Chatbot | `refs/heads/main` | `2becdb4a56e7683ae08aef927cec1c6c52dfad5e` | Evidence only |
| OpenHands | `refs/heads/main` | `6bbb4f3e1926766d1bed5fba4e2c7eeb01395ff5` | Evidence only |
| Cline | `refs/heads/main` | `dbe15202e1b7dc12b6bfd8c86b450d678f3ec33d` | Evidence only |
| shadcn/ui | `refs/heads/main` | `dbf9c5ebc430888ffae9baea9502c44c29b97304` | Evidence only |
| Radix UI Primitives | `refs/heads/main` | `baa70937f2a20ec34d59825130fcf0c5f24bcc28` | Evidence only |

## Reference Evidence Snapshot

This snapshot records why each reference stays in the comparison set. It is intentionally high-level; the references are used to shape Nexus review criteria, not to copy their UI skins.

| Reference | Current upstream signal | Nexus interpretation |
| --- | --- | --- |
| Open WebUI | Self-hosted AI platform with responsive desktop/laptop/mobile support and broad AI workflow features. | Borrow low-noise chat message density only; avoid importing its full workspace/admin breadth into the companion panel. |
| Chatbox | Cross-platform desktop AI client with local data storage, dark theme, keyboard shortcuts, and streaming replies. | Borrow desktop composer ergonomics, local-first feel, and clear progressive replies. |
| Jan | Open-source local-first desktop AI app with local model/runtime posture and privacy-centered client expectations. | Borrow quiet local-first trust signals and desktop app posture; avoid local-model workbench chrome inside the companion panel. |
| assistant-ui | Open-source React AI chat component library with thread, composer, branch, action, and streaming state primitives. | Borrow AI chat state grammar; avoid replacing Nexus-specific interaction ownership with library demo defaults. |
| LibreChat | Open-source general-purpose chat product with agents, tools/MCP, artifacts, presets, search, and resumable streams. | Borrow capability-boundary grammar for mature chat features; avoid ChatGPT-like skin, platform navigation, account/admin chrome, or making Nexus a generic chat app. |
| Cherry Studio | Desktop multi-provider AI client with 300+ assistants, multi-model conversations, documents/tools, themes, and transparent-window support. | Borrow structure and information organization only; avoid dashboard density or provider-studio chrome. |
| AnythingLLM | Open-source AI workspace with source context, memory, agent capability, and desktop-oriented workflows. | Borrow explicit context/capability boundaries; avoid document-workspace density or enterprise dashboard framing. |
| LobeHub | Agent-operation product with a design-engineering culture around modern AIGC components, agent identity, memory, and long-running collaboration. | Borrow companion identity and agent-presence hierarchy; avoid multi-agent workforce chrome. |
| Vercel Chatbot | Open-source AI chatbot template using AI SDK, shadcn/ui, Radix primitives, persistence, auth, and model-provider routing. | Borrow streaming/tool-result boundaries and composer-first chat flow; avoid browser-page shell assumptions. |
| OpenHands | Open-source coding-agent product with explicit task, observation, action, and progress surfaces. | Borrow activity-boundary grammar; avoid autonomous workbench chrome, terminal/task cockpit layouts, or issue-agent workflows. |
| Cline | Open-source coding-agent extension with plan/act modes, approvals, checkpoints, command/output observation, and explicit human-in-the-loop work. | Borrow approval/progress/checkpoint boundaries; avoid IDE shell, terminal/log chrome, file diff surfaces, and autonomous coding-agent framing. |
| shadcn/ui | Customizable, open-code component recipes intended to become the user's own component library. | Borrow component grammar and state discipline; avoid copying the default demo skin. |
| Radix UI Primitives | Low-level accessible primitives focused on customization and incremental adoption. | Borrow focus behavior and controlled interaction primitives; avoid abstraction churn where Nexus simple controls are stable. |

## Borrowing Rules

1. Borrow constraints, not skins.
2. Borrow interaction hierarchy, not visual chrome.
3. Borrow component behavior, not exact dimensions.
4. Map every borrowed idea to a Nexus surface before applying it.
5. Keep Image4 hard contracts narrow; use human review for chat/settings visual quality.
6. Treat reference projects as sources of observable behavior. If a borrowed idea cannot be reviewed in Nexus, it is still too abstract.

## Non-Open-Source Benchmarks

Linear and Raycast are useful product benchmarks for system UI density, command hierarchy, and keyboard-first action design, but they are not part of the verified open-source reference set in this audit. Codex is also a useful non-open-source benchmark for restrained dark side-panel hierarchy, clear utility controls, and calm agent activity visibility. Use these only as visual/product benchmarks when screenshots or explicit product notes are captured for a review; do not treat them as source-backed implementation references. Tauri is an engineering/runtime reference, not a UI reference, and should stay out of this design audit.

## Constraint Models

| Source | Constraint model to borrow | What Nexus must not copy | Best Nexus surface |
| --- | --- | --- | --- |
| Open WebUI | Low-noise chat message density where controls do not compete with the conversation. | Full sidebar/workbench density, platform chrome, or admin-style configuration layouts. | Chat density and global AI utility affordances. |
| Chatbox | Desktop composer ergonomics: input is obvious, aligned, and central to the task. | Floating action clusters, generic desktop-client chrome, or oversized shortcut bars. | Image4 composer, chat composer, attachment/mic/send alignment. |
| Jan | Desktop-local trust: model/runtime/privacy state can exist without becoming the main chrome. | Local-model workbench panels, runtime dashboards, or provider controls in the companion field. | Chat trust state, composer support metadata, local/privacy posture. |
| assistant-ui | AI chat component states stay explicit across thread, composer, branch, streaming, and message actions. | Demo skin, generic app shell, or replacing Nexus state ownership with library defaults. | Chat state grammar, composer state separation, streaming affordances. |
| LibreChat | Mature chat products keep agents, files, tools/MCP, artifacts, presets, search, and resumable streams discoverable by capability boundary. | ChatGPT-like skin, multi-user workspace chrome, account/admin panels, or treating Nexus as a generic chat platform. | Chat capability boundaries, composer advanced-input boundaries, settings capability grouping, streaming/tool context. |
| Cherry Studio | Dense desktop configuration can stay organized when sections are predictable and secondary actions stay quiet. | Enterprise dashboard card stacks, provider-studio chrome, or feature density inside the companion panel. | Settings/integrations structure only, with shadcn/Radix as the form-behavior source. |
| AnythingLLM | Context, memory, source, and agent capabilities become trustworthy when their boundaries are explicit. | Document-workspace density, enterprise knowledge-base navigation, or context dashboards as default chat chrome. | Desktop awareness, memory/source boundaries, high-trust settings. |
| LobeHub / LobeChat lineage | Conversational spacing and agent identity can feel polished without heavy card framing. | Avatar/agent chrome dominating the surface or turning Nexus into a generic workspace. | Image4 presence, dial hierarchy, suggestion/action rhythm. |
| Vercel AI Chatbot | Streaming-first chat: messages and tool/results need clear boundaries while composer remains primary. | Browser-first page layout copied into a desktop side panel. | Chat surface, message stream, future tool-call/result rendering. |
| OpenHands | Agent activity becomes understandable when observation, action, progress, and completion have separate states. | Coding-agent cockpit chrome, terminal/task panels, issue-agent workflows, or making Nexus look like a workbench. | Agent activity boundaries, desktop-awareness activity state, future check-in progress. |
| Cline | Human-in-the-loop agent work stays legible when plan/act, approval, command/output, checkpoint, and completion states are distinct. | IDE extension shell, terminal/log panels, file diff chrome, autonomous coding-agent framing, or task-board metaphors. | Desktop-awareness approval boundaries, companion progress language, future opt-in action confirmation. |
| shadcn/ui | Reusable component recipes with clear states and predictable visual grammar. | Default demo styling, card-heavy examples, or importing its look wholesale. | Settings drawer controls, segmented choices, tabs, buttons, popovers. |
| Radix UI Primitives | Accessible focus management, keyboard behavior, controlled dialogs/drawers/menus. | Headless abstraction churn where Nexus already has stable simple controls. | Settings drawer, modal behavior, menus, toggles, focus states. |

## Open-Source Pattern Matrix

Use this matrix before sending a Pro prompt. It turns each reference into a Nexus-specific abstract pattern so review does not drift into copying skins, exact spacing, colors, or product chrome.

| Surface | Reference pattern | Nexus mapping | Avoid |
| --- | --- | --- | --- |
| Image4 presence | LobeHub-style ambient agent hierarchy. | Presence stays a secondary semantic field that changes by state without becoming a mascot, avatar, or widget. | Avatar chrome, leading orbs, always-on equalizers, wrapper elevation. |
| Dial | LobeHub-style environment lens inside the companion field. | Time, date, and weather remain ambient signals inside the dial with separated lines and stable containment. | Dashboard widgets, ring/text collisions, orbit dots, decorative motion that competes with conversation. |
| Companion tone | LobeHub-style ambient identity plus Jan and Chatbox desktop-local restraint. | Morning warmth, daytime calm, and night low-light use warm off-white, peach/apricot warmth, and sage or mist-blue trust accents as emotional roles, not copied palettes. Night/dark modes stay intentional states instead of becoming the default companion mood. | Sampling reference colors, dark workbench defaults for morning/day, high-saturation purple-blue gradients, cold admin surfaces, or decorative mood lighting detached from companion state. |
| Composer | Chatbox desktop composer ergonomics, Jan desktop locality, assistant-ui composer state, LibreChat capability-entry boundaries, plus Vercel streaming priority. | Textarea, mic, send, and attachment controls share one center line; embedded tools default to icon-only inside the input and reveal button feedback on hover, focus, or enabled-send states. Advanced inputs stay discoverable without making the composer a platform toolbar. | Floating action clusters, persistent tool backplates inside the input, browser-page shell assumptions, ChatGPT-like input skin, library demo skin, and changing control sizes to fix alignment. |
| Chat | Open WebUI low-noise density, Jan local trust, assistant-ui thread state, AnythingLLM and LibreChat capability/context boundaries, plus Vercel tool/result layering. | Messages, tool results, source/context influence, agent/tool boundaries, and final responses have readable boundaries while composer priority remains intact. | Admin/workspace chrome, model dashboards, document-workspace framing, multi-panel shells, account navigation, normal messages becoming card stacks. |
| Settings | Cherry Studio section predictability, AnythingLLM and LibreChat capability boundaries, plus shadcn/Radix primitive discipline. | Safety, memory, desktop awareness, integrations, and provider-like settings group by user intent with compact repeated rows and clear capability boundaries. | Provider-studio chrome, nested cards, enterprise workspace navigation, admin-console hierarchy, default demo skin, Image4 rhythm variables. |
| Forms | shadcn-style form grammar. | Label, description, control, and validation rows stay compact and purpose-specific. | Text-button substitutes for binary/numeric/option controls and card-heavy examples. |
| Focus management | Radix keyboard predictability plus assistant-ui independent thread/message/composer focus. | Drawer navigation, section switching, modal-like flows, message actions, and dangerous actions preserve visible focus and clear exits. | Hover-only affordances, invisible focus, trapped scroll positions, focus states that elevate wrappers. |
| Streaming | Vercel append-only streaming, assistant-ui assistant-run state grammar, plus LibreChat resumable-stream/tool context boundaries. | Waiting, partial output, resumable output, tool result, branch/action affordance, and final answer states layer without hiding composer or breaking message continuity. | Loading animation as the main visual event, large branch selectors, artifact workspace chrome, or tool results overwhelming the conversation. |
| Agent activity | OpenHands observation/action/progress grammar, Cline approval/checkpoint grammar, LibreChat capability boundaries, plus Vercel run-state restraint. | Observation, processing, speaking, approval-needed, completion, and error states are understandable without implying Nexus is executing autonomous work. | Workbench chrome, task cockpit panels, file/terminal surfaces, IDE extension shell, or Codex-like product shell. |

## Reference Paradigm Axes

Use these axes when asking Pro questions or reviewing an implementation route. A reference can influence several surfaces, but each borrowed idea must still map to one axis and one Nexus surface before code changes.

| Axis | Useful references | Nexus use | Boundary |
| --- | --- | --- | --- |
| Companion identity | LobeHub / LobeChat lineage | Presence, dial, and suggestion rhythm feel alive without becoming mascot chrome. | No avatar dominance, leading orbs, wrapper glow, or always-on equalizer. |
| Companion color and emotional tone | LobeHub / LobeChat lineage, Jan, Chatbox | Color acts as companion state: morning stays warm and bright, daytime stays soft and low-arousal, night becomes an intentional low-light state; peach/apricot is a restrained warmth accent; sage or mist-blue supports trust and focus. | No sampled reference palette, dark utility default for morning/day, neon purple-blue theme, high-arousal orange/red flood, or detached mood-light overlay. |
| Input/composer | Chatbox, Vercel AI Chatbot, assistant-ui, Jan, LibreChat | Composer remains the primary action anchor while state, attachments, voice, runtime metadata, and advanced capability entry stay aligned and quiet. Embedded tools can be visible as icons without default tile backplates. | No floating action clusters, persistent mini-button rows inside the input, browser shell spacing, ChatGPT-like input skin, or control resizing as an alignment fix. |
| Chat density and thread state | Open WebUI, assistant-ui, Vercel AI Chatbot, LibreChat | Messages stay readable, actions remain secondary, capability boundaries stay named, and future branch/retry/edit states have a grammar. | No workbench shell, account navigation, message toolbar dominance, or normal messages becoming card stacks. |
| Streaming/tool boundaries | Vercel AI Chatbot, assistant-ui, LibreChat | Waiting, partial output, resumable output, tool/result, artifact/context influence, and assistant-run state can be reviewed as separate layers. | No loading animation as the main event, no artifact workspace chrome, and no wrapper elevation during streaming. |
| Agent activity boundaries | OpenHands, Cline, LibreChat, Vercel AI Chatbot | Desktop awareness and companion activity can expose observation, approval, progress, context-use, and completion state without becoming an autonomous agent cockpit. | No terminal/task workbench, IDE shell, issue-agent flow, or Codex-like product shell. |
| Desktop locality and privacy posture | Jan, Chatbox | Local/runtime/privacy signals build trust without becoming a dashboard. | No local-model workbench chrome in the companion panel. |
| Context and capability boundaries | AnythingLLM, Cherry Studio, LibreChat | Desktop awareness, memory, source context, integrations, tools, and high-trust settings expose what Nexus can see and do. | No enterprise knowledge-base navigation, account/admin console, or document workspace density. |
| Component and focus behavior | shadcn/ui, Radix UI Primitives, assistant-ui | Settings, forms, dialogs, message actions, and composer states keep predictable keyboard/focus behavior. | No hidden focus, hover-only affordances, or library demo skin. |

## Surface Acceptance Criteria

These checks are observable review criteria. Only the Image4 structural rows that are already covered by `image4:contract:check` belong in CI.

| Surface | Must remain true | Evidence |
| --- | --- | --- |
| Image4 panel | The five-row rhythm structure remains intact, the composer is not pushed outside the panel, and no new visual element competes above the dial. | `image4:contract:check`, `image4:contract:report`, `docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md`, clean and grid screenshots. |
| Header controls | Settings, collapse, and close read as one utility rail with equal hit areas and no hover/focus layout shift. | Human review, screenshot comparison, computed button boxes when needed. |
| Presence signal | Idle state is calm; speaking state animates existing bars; no scan-light, leading orb, wrapper glow, scale, z-index, or always-on equalizer returns. | `Image4Signal` ownership, `image4:visual-contract:audit`, `docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md`, plus human review. |
| Dial | Time/date/weather are live, separated, and contained inside the dial without text crossing the ring. | `docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md`, human review of normal and short-height panel states. |
| Companion tone | Warm-day remains visibly light, companion-like, and token-governed; trust accents support controls without taking over the whole field. | `npm run image4:color:audit`, `docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md`, and human review of morning/day/night state fit. |
| Suggestion actions | Actions read as one secondary flow and do not become heavy cards, glow panels, or primary visual anchors. | `image4:visual-contract:audit`, human review against `docs/DESIGN_REVIEW_CHECKLIST.md`. |
| Composer | Textarea, mic, send, and attachment controls share a center line; embedded tools feel inside the input by default; focus is visible and does not resize the row or elevate the row wrapper. | `composer:surface:audit`, `image4:visual-contract:audit`, human review, optional box alignment measurement. |
| Chat surface | Streaming messages and future tool/result blocks have clear boundaries without turning normal messages into cards. | Human review of active chat state; `docs/CHAT_SURFACE_REFERENCE_REVIEW.md`. |
| Agent activity | Observation, processing, speaking, completion, and error states are visible only where they clarify companion behavior. They must not imply Nexus is a coding agent or autonomous task executor. | `docs/AGENT_ACTIVITY_SURFACE_REFERENCE_REVIEW.md`, `npm run agent-activity:surface:audit`, human review of idle/activity states. |
| Settings drawer | Form rows, labels, toggles, and descriptions follow compact repeated structure and do not depend on Image4 CSS variables. | Human review of narrow and normal drawer widths; `docs/SETTINGS_SURFACE_REFERENCE_REVIEW.md`. |

## Cross-Surface Behavior Rules

- Composer behavior must stay recognizable between Image4 and the normal chat surface: text entry is primary, secondary actions are quieter, embedded tools do not require default backplates, and disabled send states remain clear.
- Shared composer DOM must stay isolated by surface hooks: normal companion rules live in `App.css`; Image4 empty/action rules live in `panel-companion-chat.css`; active-message rules live in `panel-companion-messages.css`; final composer polish lives in `panel-companion-composer.css`; collapsed shell rules live outside chat CSS.
- Focus rings, disabled states, hover states, and selected states should share the same interaction philosophy across chat, settings, and Image4 even when their visuals differ.
- Presence identity is allowed to feel alive only in-place; speaking state should move existing bars, not raise the wrapper into a primary object.
- Companion color is stateful and token-governed: warm-day should read as soft companionship, night/dark should read as an intentional time/theme state, and external references should influence emotional roles rather than exact colors.
- Image4 actions and composer use a visual weight budget: tune scoped tokens, icon contrast, hover/focus feedback, and enabled states before adding new shadows, glows, gradients, persistent backplates, or wrapper effects.
- Image4 rows use vertical boundary isolation: row containers should not rely on negative margin or vertical translate offsets to fake alignment.
- Image4 interaction states use one mutation budget: hover clarifies, focus identifies, speaking animates signal bars, and containers stay static.
- Reduced-motion is a low-energy state model: system motion stops, interaction transitions become instant, and companion identity remains readable through low-energy speaking bars.
- Settings controls should use system/form rhythm; they should not inherit Image4's visual rhythm grid or decorative companion effects.
- Chat and settings can share density and interaction semantics with Image4, but not its hard row contract.
- No surface may introduce hover lift, scale jumps, or motion that changes layout unless the interaction is explicitly reviewed and documented.
- Theme overrides must be scoped to the surface being changed and must not leak into composer placeholders, buttons, or focus rings elsewhere.

## Visual Rhythm And Density Model

Nexus uses different layout governance per surface. Image4 is an ambient companion panel, so it can use a strict visual rhythm grid. Chat and settings are task surfaces, so they use density and hierarchy rules instead of a shared grid.

| Surface | Governance model | Do not use |
| --- | --- | --- |
| Image4 | Strict five-row visual rhythm grid: presence, dial, greeting, actions, composer. | Generic dashboard grids or card stacks. |
| Chat | Interaction density model: readable messages, stable composer anchoring, clear streaming/tool boundaries. | Image4 row grid, ornamental dial/presence effects, or forced panel symmetry. |
| Settings | Structural density model: compact form rows, predictable section grouping, clear focus order. | Image4 rhythm variables, decorative companion effects, or hero-style spacing. |

Use a shared visual weight model across surfaces without forcing a shared layout:

| Weight | Role | Typical surfaces |
| --- | --- | --- |
| Primary | The user's current action anchor. | Composer, focused input, active setting control. |
| Secondary | The main readable content or state anchor. | Message body, dial, settings section content. |
| Tertiary | Supporting metadata and optional actions. | Prompt suggestions, hints, timestamps, helper copy. |

Add an interaction state overlay so the same weight can shift by context:

| State | Dominant weight | Review implication |
| --- | --- | --- |
| Idle | Secondary dominates; tertiary remains quiet. | Presence can be visible, but it should not read as an active control. |
| Focus | Primary dominates. | Composer, focused input, or active setting control becomes the clearest anchor. |
| Streaming | Secondary can temporarily rise. | Message/tool-result flow may become stronger, but composer remains stable and reachable. |
| System | Tertiary is suppressed. | Background metadata and helper copy should not compete with system states or warnings. |

This keeps Nexus visually coherent without turning every surface into the Image4 grid.

## Surface Mapping

### Image4 Companion Panel

- Primary references: LobeHub / LobeChat lineage, Open WebUI, Chatbox, Jan.
- Borrow: a calm agent identity, low-noise density, and composer-first hierarchy.
- Avoid: app workbench chrome, local-model dashboards, hard dashboards, card stacks, or avatar dominance.
- Evidence to check: `image4:contract:check`, `image4:contract:report`, `docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md`, and `docs/DESIGN_REVIEW_CHECKLIST.md`.

### Header Controls

- Primary references: Open WebUI, shadcn/ui.
- Borrow: one grouped utility rail with stable icon targets.
- Avoid: separate decorative glass buttons or red danger emphasis before intent.
- Evidence to check: equal hit areas, no hover shift, clear settings/collapse/close semantics.

### Presence Signal And Dial

- Primary references: LobeHub / LobeChat lineage plus Nexus-specific companion identity.
- Borrow: identity as atmosphere and rhythm, not mascot chrome.
- Avoid: fake always-on motion, decorative orbs, fixed time labels, and ring/text collisions.
- Evidence to check: `docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md`, idle vs speaking state, live time/date/weather, no scan-light layer.

### Companion Tone And Color

- Primary references: LobeHub / LobeChat lineage, Jan, Chatbox, plus Nexus-specific companion color research.
- Borrow: emotional color roles: warm daylight as soft presence, peach/apricot as restrained warmth, and sage or mist-blue as trust/focus support.
- Avoid: copying any reference palette, using a dark workbench as the default morning/day mood, or adding decorative color effects that are not tied to companion state.
- Evidence to check: `npm run image4:color:audit`, `docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md`, warm-day screenshots, and morning/day/night human review.

### Suggestion Actions

- Primary references: Open WebUI, LobeHub / LobeChat lineage, Cherry Studio, assistant-ui.
- Borrow: weak secondary action hierarchy and scan-friendly density.
- Avoid: heavy cards, bright borders, timeline decoration, message-action toolbars, or actions competing with composer.
- Evidence to check: actions stay in the `actions` row and remain visually secondary.

### Composer

- Primary references: Chatbox, Jan, assistant-ui, LibreChat, Vercel AI Chatbot, shadcn/ui.
- Borrow: composer as the primary action surface, with visible input, explicit run state, quiet local/runtime metadata, aligned controls, embedded tools that do not need default backplates, and advanced capability entry that stays subordinate.
- Avoid: floating action groups, faint input boundaries, persistent mini-button rows inside the input, ChatGPT-like input skin, generic library demo state, platform navigation, and changing control sizes to solve alignment.
- Evidence to check: `composer:surface:audit`, `docs/COMPOSER_SURFACE_REFERENCE_REVIEW.md`, mic/send/attachment centers align with the textarea, default tool state blends into the input, and focus does not shift layout.

### Chat Surface

- Primary references: Vercel AI Chatbot, Open WebUI, assistant-ui, Jan, AnythingLLM, LibreChat.
- Borrow: streaming-first message flow, clear tool/result/context/agent boundaries, practical density, local/privacy trust signals, and message action state grammar.
- Avoid: normal messages becoming cards, multi-panel shells inside the side panel, generic browser chat layout, account or workspace navigation, document-workspace framing, model dashboards, and Image4 visual rhythm rows.
- Evidence to check: `docs/CHAT_SURFACE_REFERENCE_REVIEW.md`, message density, composer continuity, and readable streaming/tool states.

### Agent Activity Boundary

- Primary references: OpenHands, Cline, LibreChat, Vercel AI Chatbot, plus Codex as a non-open-source visual benchmark only.
- Borrow: visible state grammar for observing, processing, approval-needed, context-used, speaking, completing, and error recovery.
- Avoid: coding-agent cockpit chrome, IDE extension shell, file/terminal surfaces, issue-agent workflows, account/workspace navigation, autonomous workbench framing, or making Nexus look like a Codex product shell.
- Evidence to check: `docs/AGENT_ACTIVITY_SURFACE_REFERENCE_REVIEW.md`, `npm run agent-activity:surface:audit`, desktop-awareness tests, and human review of idle/activity panel states.

### Settings Drawer

- Primary references: shadcn/ui, Radix UI Primitives, Cherry Studio, AnythingLLM, LibreChat.
- Borrow: accessible primitive behavior, compact repeated rows, predictable form/control states, Cherry-style information organization, and clear memory/context/tool/capability boundaries.
- Avoid: Image4 rhythm-grid coupling, decorative companion visuals, enterprise workspace navigation, admin-console hierarchy, nested cards, hero spacing, and oversized controls.
- Evidence to check: `docs/SETTINGS_SURFACE_REFERENCE_REVIEW.md`, focus order, narrow-width text fit, compact section rhythm, and no dependency on Image4 CSS variables.

## Surface Coverage Matrix

The manifest requires coverage for core Nexus surfaces so the reference pool does not drift into a generic inspiration list. A surface is covered when at least the configured number of references in `docs/open-source-ui-reference-manifest.json` list that surface.

| Surface | Minimum references | Current reference coverage | Review use |
| --- | ---: | --- | --- |
| `chat` | 2 | Open WebUI, Jan, assistant-ui, LibreChat, AnythingLLM, Vercel AI Chatbot, OpenHands | Message density, local trust, thread state, context/capability boundaries, readable tool/result areas. |
| `composer` | 2 | Chatbox, Jan, assistant-ui, LibreChat, Vercel AI Chatbot | Input primacy, state separation, runtime metadata restraint, mic/send/attachment alignment, advanced capability entry, progressive replies. |
| `settings` | 2 | LibreChat, Cherry Studio, AnythingLLM, shadcn/ui, Radix UI Primitives | Compact sections, capability boundaries, predictable form rows, dense provider organization without admin-console hierarchy. |
| `image4-presence` | 1 | LobeHub / LobeChat lineage | Agent identity as atmosphere, not mascot chrome. |
| `dial` | 1 | LobeHub / LobeChat lineage | Companion hierarchy around time/date/weather without text collisions. |
| `companion-tone` | 2 | Chatbox, Jan, LobeHub / LobeChat lineage | Warm, low-arousal companion color roles, local-first trust tone, and no copied palette or dark workbench default. |
| `forms` | 2 | shadcn/ui, Radix UI Primitives | Form grammar, label/control relationship, state discipline, controlled primitives, and keyboard-safe rows. |
| `focus-management` | 2 | assistant-ui, Cline, Radix UI Primitives | Keyboard behavior, focus visibility, message/composer action focus, controlled primitive semantics, approval focus boundaries. |
| `streaming` | 2 | assistant-ui, LibreChat, Vercel AI Chatbot, OpenHands, Cline | Streaming-first message flow, assistant-run state, resumable output, approval checkpoints, and future tool-result boundaries. |
| `agent-activity` | 3 | LibreChat, OpenHands, Cline | Observation, processing, context-use, approval, action, completion, and error-state boundaries without workbench chrome. |

## Decision Matrix

| Question | Yes | No |
| --- | --- | --- |
| Does the change affect Image4 row ownership or signal ownership? | It belongs in the hard Image4 contract or an existing hard-contract test. | Keep it out of hard CI. |
| Does the change affect presence/signal state? | Run `image4:visual-contract:audit`; presence must stay a secondary identity layer, not a widget. | No presence-specific audit required. |
| Does the change add shadows, glow, vertical transforms, negative margins, or wrapper effects in Image4? | Run `image4:visual-contract:audit`; it must respect visual weight and row-boundary budgets. | Keep the change in the existing surface review path. |
| Does the change affect hover, focus, active, idle, or speaking states? | Run `image4:visual-contract:audit`; states may clarify content but must not mutate container geometry or elevation. | Keep it in normal visual review. |
| Does the change affect animation, transitions, or reduced-motion behavior? | Run `image4:visual-contract:audit`; system motion must stop under reduced motion while identity state keeps a low-energy fallback. | Keep it in normal visual review. |
| Does the change affect visual polish, contrast, motion, or theme feel? | Use `image4:contract:report` plus human review. | No extra audit required. |
| Does the change affect warm-day companion color roles, trust accents, or morning/day/night emotional tone? | Run `npm run image4:color:audit`; borrow emotional roles from references, not palettes. | Do not sample reference colors or solve tone by adding decorative glow layers. |
| Does the change affect chat/settings layout? | Use the design checklist and surface mapping. | Do not add Image4 grid checks. |
| Does the change introduce observation, processing, context-use, approval-needed, progress, completion, or error activity UI? | Review `agent-activity` against OpenHands, Cline, LibreChat boundaries and Codex-like restraint; ask Pro before implementation. | Keep it as normal companion text or existing state if it does not change visible activity grammar. |
| Does the change affect the shared composer DOM or composer surface hooks? | Run `composer:surface:audit` and review alignment manually. | Keep it out of `verify:pr` unless the contract becomes release-critical. |
| Does the change affect composer focus, disabled send, or action hover/focus states? | Run `composer:surface:audit`; actions must stay secondary and disabled send must stay tertiary. Embedded tools should not require default backplates. | Do not solve this with size changes, persistent tool tiles, or action-button elevation. |
| Is the borrowed pattern a component behavior or accessibility primitive? | Map it to settings/chat behavior, likely from shadcn/Radix. | Do not import another product's skin. |
| Is the borrowed pattern exact spacing, color, blur, or radius? | Treat it as inspiration only. | Prefer Nexus tokens and existing CSS. |

## CI Boundary

| Layer | Belongs in CI | Stays out of CI |
| --- | --- | --- |
| Structure | Image4 row ownership, signal component ownership, short-height collapse, inline signal prohibition. | Generic visual density, reference mappings, copy tone, perceived polish. |
| Semantics | Existing source-only contracts that prevent clear architectural regressions. | Borrow/avoid philosophy, external project comparisons, interaction hierarchy prose. |
| Review | None unless it can be deterministically checked without freezing visual exploration. | Chat density, settings form rhythm, hover/focus feel, animation quality, exact colors, opacity, blur, radii, and spacing ratios. |
| Local design tools | `composer:surface:audit` may be run manually for composer isolation, but it is intentionally not a PR gate. | Pixel locking, screenshot diffing, and hard checks for perceived polish. |

`npm run ui:references:audit` is a source-only local guard for this document set. It verifies that the manifest, reference pool, pinned evidence, borrow rules, surface mapping, and cross-document links are present. It does not contact GitHub and does not make visual similarity, stars, palette, radius, or spacing a release gate.

The human-readable audit output includes a `surface coverage` section and a `Pro review registry` section. Use them before visual review to confirm the target surface has enough reference support, then read the matching rows in the Surface Coverage Matrix and Surface Mapping sections before making UI changes. The registry should move from `not-sent` only after the handoff is actually sent and the intake state is known.

For focused review, pass a surface name:

```sh
npm run ui:references:audit -- --surface=composer
```

Use the focused output to see only the references, borrow guidance, avoid guidance, and review rules for the surface being changed. Unknown surface names fail the audit so review prompts do not silently drift.

To generate a bounded prompt for Pro review, add `--pro-prompt`:

```sh
npm run ui:references:audit -- --surface=composer --pro-prompt
```

The generated prompt contains only the public reference set, surface rules, borrow/avoid guidance, and review questions. It is intended for design critique and implementation planning, not for sharing secrets, private logs, credentials, or unrelated source dumps.

For the normal Pro workflow, generate a complete handoff package:

```sh
npm run ui:references:audit -- --surface=composer --pro-handoff
```

The handoff package includes the Pro prompt, evidence boundary, source-backed pattern matrix, required questions, decision checks, and a record template for the answer. Use it when asking Pro to review a surface because it keeps the request and the follow-up record in one bounded artifact.

To inspect the critical questions before sending a Pro prompt, use `--questions`:

```sh
npm run ui:references:audit -- --surface=dial --questions
```

These questions keep the Pro review focused on the selected surface: what abstract pattern to borrow, what concrete skin/detail to avoid, which Nexus state or rhythm must be preserved, and which parts should stay human-reviewed versus audited.

To inspect every Pro question together with the matched reference projects, paradigm axes, borrow boundaries, registry state, and local commands, run:

```sh
npm run ui:references:audit -- --question-matrix
```

The question matrix sends nothing and does not update the registry. Use it before choosing which surface to ask Pro about next, especially when a change crosses composer, chat, settings, desktop awareness, or streaming behavior.

To inspect the source-backed abstract pattern matrix for a surface, use `--patterns`:

```sh
npm run ui:references:audit -- --surface=composer --patterns
```

The pattern output names the reference, the abstract UI pattern, the Nexus-specific mapping, and the concrete copy boundary. Pro prompts and record templates include this matrix automatically.

To inspect the full cross-surface pattern comparison before choosing a Pro target, run:

```sh
npm run ui:references:audit -- --pattern-comparison
```

The comparison lists every surface-to-reference mapping, groups the same ideas by paradigm axis, then inverts the data by open-source project so it is clear which references influence multiple Nexus surfaces and where each borrow boundary applies. `--paradigms` and `--reference-paradigms` are shorter aliases for this output.

When a Pro review needs current Nexus implementation boundaries, add `--evidence`:

```sh
npm run ui:references:audit -- --surface=image4-presence --pro-prompt --evidence
```

The evidence section is still source-only. It lists relevant public docs, source/style boundaries, local commands, and browser review checks for the selected surface. It intentionally excludes secrets, private logs, credentials, memory contents, and unrelated source dumps.

After Pro returns advice, generate a bounded record template for the same surface:

```sh
npm run ui:references:audit -- --surface=composer --record-template
```

The record template gives one place to capture Pro's key judgment, borrowed abstract patterns, do-not-copy boundaries, implementation route, manual review checks, automatic audit/test checks, decision outcome, and follow-up files or commands. It prints to stdout only; it does not write files or automatically accept Pro advice.

Before turning Pro advice into code, generate an intake template:

```sh
npm run ui:references:audit -- --surface=composer --review-intake-template
```

The intake template separates useful judgments, surface-mapped advice, too-broad advice, copy-risk advice, companion-first conflicts, follow-up questions, implementation decision, verification plan, and privacy confirmation. Use it to decide whether the Pro answer should be accepted, rejected, prototyped, or clarified.

After updating the registry, run:

```sh
npm run ui:references:audit
```

The audit fails if the registry is missing a required surface, uses an invalid or inconsistent status/decision pair, drifts from the queue commands, or violates the no-response/no-secret policy.

To inspect the allowed registry states and their next actions, run:

```sh
npm run ui:references:audit -- --pro-review-state-guide
```

The guide defines the valid status/decision pairs for `not-sent`, `sent`, `intake-needed`, `needs-follow-up`, `accepted-for-prototype`, `rejected`, and `recorded`. It is a local workflow reference only; it does not send anything to Pro or update the registry.

To pick the next actionable Pro review from the registry and queue, run:

```sh
npm run ui:references:audit -- --next-pro-review
```

The selector prefers surfaces that need follow-up or intake before opening a new review, then falls back to the highest-priority unsent surface. It prints the selected surface, current registry status, handoff command, intake command, record command, local check, and browser check.

When the Pro queue is complete and every surface is recorded, switch to the post-Pro implementation status:

```sh
npm run ui:references:audit -- --implementation-status
```

This prints every recorded surface in implementation order with its readiness gate, implementation brief command, local check, and browser/manual check. Use it before choosing the next local UI optimization after the Pro review queue has no pending default surface.

To output the full handoff package for that selected surface without manually copying the surface name, run:

```sh
npm run ui:references:audit -- --next-pro-handoff
```

This command does not send anything or update the registry. It only prints the bounded public handoff that should be sent to Pro.

Before sending the handoff, run the readiness check:

```sh
npm run ui:references:audit -- --pro-readiness
```

Readiness gathers the selected surface, registry status, evidence package, critical questions, surface pattern matrix, cross-surface pattern comparison, local check, browser check, and state-guide command into one pre-send checklist. It fails if any required piece is missing.

Before a browser send, refresh reference freshness manually when the current review depends on the latest open-source state:

```sh
npm run ui:references:audit -- --reference-refresh-check
```

This command checks remote heads only when intentionally run. It is pre-send evidence, not a default CI, release, lint, or build gate. If it reports drift, decide whether the snapshot needs a deliberate reference update before asking Pro.

To print the smallest payload intended for Pro, run:

```sh
npm run ui:references:audit -- --pro-send-payload
```

The payload includes only the focused prompt and bounded public evidence needed for Pro. It also prints the local after-send registry instruction: once the payload is actually sent, move that surface to `sent`/`pending`, run `npm run ui:references:audit`, and wait for Pro's answer before generating the intake template. Generating this payload is not proof that Pro has been asked. When using the browser, paste and send it only after user confirmation, keep `--reference-refresh-check` as the manual freshness check, then run the surface-specific transition command, for example `npm run ui:references:audit -- --surface=companion-tone --pro-registry-transition=sent`.

After Pro replies, check answer quality before filling the intake:

```sh
npm run ui:references:audit -- --surface=composer --pro-answer-quality
```

This output is a local review checklist, not a place to store Pro's answer. Use it to decide whether the answer is actionable, needs one focused follow-up, or should be rejected because it is generic, asks for unrelated rewrites, or drifts into copying exact reference skin. Without `--surface`, it uses the next actionable Pro review from the registry.

To print the exact local registry transition after the payload has actually been sent, run:

```sh
npm run ui:references:audit -- --pro-registry-transition=sent
```

The transition output does not edit `docs/open-source-ui-pro-review-registry.json`. It names the selected surface, current status/decision, target status/decision, next action, verification command, and the no-response/no-secret registry policy. It also prints a dry-run JSON entry patch for the selected registry surface, so the replacement fields are visible before any manual edit. When working from the batch runbook, include the surface explicitly, for example `npm run ui:references:audit -- --surface=composer --pro-registry-transition=sent`, so the transition cannot drift to the next queued surface.

After Pro's answer has been triaged through the intake template, generate the local implementation brief:

```sh
npm run ui:references:audit -- --surface=composer --implementation-brief
```

Without `--surface`, the brief uses the next actionable Pro review from the registry. The brief is the bridge from Pro/open-source review to local Nexus work: it restates the surface scope, accepted abstract patterns, source/style boundaries, critical questions, local commands, and browser checks. It is not an instruction to implement raw Pro output; the intake decision still has to name the smallest Nexus-specific change first.
When the queue is already complete, pass `--surface=<surface>` explicitly or use `--implementation-status` first to choose the next local surface.

Before implementing from that brief, check the implementation gate:

```sh
npm run ui:references:audit -- --surface=composer --implementation-readiness
```

This command is expected to fail while the registry is still `not-sent`, `sent`, `intake-needed`, `needs-follow-up`, or `rejected`. It passes only after the surface has an accepted local intake decision, either `accepted-for-prototype` or `recorded`. The failure is useful: it prevents raw Pro output from becoming UI code before the Nexus-specific decision is written down.

For a staged 0.4 UI review sequence, generate the local Pro review queue:

```sh
npm run ui:references:audit -- --queue
```

The queue orders surfaces by current Nexus review priority: Image4 companion identity first, then dial, companion tone, composer, chat, settings, forms, focus management, streaming, and agent activity. Each queue item includes the matching `--pro-prompt --evidence` command, the complete `--pro-handoff` command, the matching `--pro-send-payload` command, the matching `--questions` command, the matching `--patterns` command, the matching `--review-intake-template` command, the matching `--record-template` command, and the first local check to run before applying advice.

To see the full 0.4 UI review run order in one place, run:

```sh
npm run ui:references:audit -- --review-runbook
```

The runbook expands the queue into the full sequence for every surface: manual reference freshness check, handoff, pre-send payload, user-confirmed external send, sent-state transition, Pro answer quality check, intake, record, implementation readiness, implementation brief, local check, and browser/manual check. Use it when planning a batch of UI work so no surface skips the Pro quality or implementation gate.

After the queue is complete, switch from review planning to the local 0.4 implementation route in `docs/V0.4_UI_IMPLEMENTATION_ROUTE.md`. That route is the cross-surface gate for implementation order, guardrails, verification commands, and the rule that raw Pro output cannot become code.

## Interaction State References

Use interaction-state patterns from open-source and product references as behavior models only:

- Linear / Notion: hover and focus do not move layout containers.
- LobeChat-style AI surfaces: controls can clarify icon/text state without turning secondary actions into primary objects.
- Arc / Raycast-style command surfaces: one state axis dominates at a time, so focus, hover, and speaking do not all add elevation together.
- shadcn/ui / Radix-style primitive behavior: accessibility preferences change interaction behavior without requiring a separate visual skin.

## Review Cadence

- Refresh this audit when a new reference project is added or one of these repositories moves.
- Do not update this document for every visual tweak.
- Link any future UI PR description to the relevant source row and Nexus surface, not just to a screenshot.
- Before implementation work, pick one surface from this audit and one acceptance row; do not apply several external references to one change without stating the priority.
