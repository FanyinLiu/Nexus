# Image4 UI Reference Patterns

> Historical design record — not the current UI contract. The July 2026
> Live2D-first migration removed the dial, greeting cards, suggestion-action
> row, and five-row layout described below. Current acceptance follows the live
> `PanelView.tsx` route, current Image4 contract checks, and the four-part presence / Live2D stage /
> conversation recap / composer structure. Do not restore retired elements from
> this document.

Last checked: 2026-06-28.

This note keeps Image4 UI borrowing deliberate. Nexus should learn from mature open-source AI interfaces without copying their product shells or losing the companion-first identity.

For the fuller cross-surface comparison, see `docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md`.

For the focused presence/dial companion-field review, see `docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md`.

## References

- [Open WebUI](https://github.com/open-webui/open-webui): self-hosted, offline-capable AI platform with responsive desktop/mobile surface and broad provider support.
- [Chatbox](https://github.com/chatboxai/chatbox): cross-platform desktop AI client with local data storage, dark-theme ergonomics, shortcuts, streaming replies, and practical install flow.
- [Cherry Studio](https://github.com/CherryHQ/cherry-studio): cross-platform desktop client with many providers, assistants, themes, transparent-window support, and dense utility workflows.
- [LobeHub / LobeChat lineage](https://github.com/lobehub/lobehub): modern AIGC product ecosystem with strong agent/workspace framing and a polished design-engineering culture.
- [Vercel AI Chatbot](https://github.com/vercel/ai-chatbot): open-source AI chat app reference for streaming-first chat composition and composer-first interaction.
- [shadcn/ui](https://github.com/shadcn-ui/ui) and [Radix UI](https://github.com/radix-ui/primitives): open-source component-system references for dialogs, drawers, forms, focus states, and accessible primitive composition.

## Visual Rhythm Grid

Image4 uses a visual rhythm grid so the companion panel can be tuned without arbitrary size drift. The grid is a layout contract and calibration overlay, not visible product chrome.

- Macro rhythm: five named rows in order: `presence`, `dial`, `greeting`, `actions`, and `composer`.
- Micro rhythm: `--image4-rhythm-unit: 8px` provides the debug baseline spacing.
- Row ownership: presence, dial, message list, greeting, actions, and composer each bind to explicit grid rows.
- Short-height behavior: the rhythm compresses below 760px and removes the dial row below 620px.
- Debug overlay: add `image4Grid=1` to the panel URL, usually with `?view=panel&image4Preview=1&image4Grid=1`.
- State preview: add `image4State=idle`, `image4State=attentive`, `image4State=speaking`, or `image4State=resting` when comparing the same layout across companion states.
- Snapshot rule: snapshot mode hides the overlay so reference captures do not include calibration marks.
- Scope rule: do not extend this grid to chat or settings. Those surfaces use density and hierarchy checks instead.

## Reference Matrix

| System | Borrow pattern | Avoid pattern | Nexus mapping |
| --- | --- | --- | --- |
| Open WebUI | Low-noise chat message density and restrained utility affordances. | Sidebar-heavy workbench chrome, full platform density, or admin-style configuration surfaces. | Chat density stays calm; Image4 remains a companion panel. |
| Chatbox | Compact composer ergonomics, practical desktop input affordances, local-first feel. | Floating action clusters that compete with the input. | Composer stays as one dock row with aligned input/send/attachment controls; voice controls remain in Settings. |
| Cherry Studio | Dense settings/provider information can stay organized when sections are predictable. | Dashboard density, stacked provider panels, or feature chrome inside the companion surface. | Settings/integrations borrow structure only; Image4 actions stay secondary and scan-friendly. |
| LobeHub / LobeChat lineage | Polished design-engineering culture, conversational spacing, agent/workspace mental model. | Avatar or agent chrome dominating the conversation surface. | Presence signal and dial support the companion identity without overpowering chat and input. |
| Vercel AI Chatbot | Streaming-first chat composition, composer as the primary action surface, clean tool/result boundaries. | Generic web-chat layout copied into a desktop companion panel. | Chat flow stays readable while the composer remains the strongest input affordance. |
| shadcn/ui + Radix UI | Accessible primitives, predictable focus, controlled form/dialog patterns. | Copying their default visual skin or card-heavy docs/examples styling. | Settings drawer borrows primitive behavior and spacing logic without becoming an Image4 grid. |

## Visual Weight Mapping

Image4 uses a strict rhythm grid, but the broader Nexus UI should align by attention weight rather than shared rows.

| Weight | Image4 mapping | Chat mapping | Settings mapping |
| --- | --- | --- | --- |
| Primary | Composer dock and current user input path. | Composer and active streaming input. | Focused control or active form row. |
| Secondary | Dial, message content, and readable companion state. | Message body and tool/result boundaries. | Section content and selected configuration group. |
| Tertiary | Prompt suggestions, status metadata, and helper labels. | Timestamps, hints, secondary actions. | Descriptions, helper text, inactive affordances. |

This is the bridge between the Image4-specific rhythm grid and the rest of the product: shared hierarchy, not shared layout.

Image4 also has a local visual weight budget. Dial and composer are allowed to be high-weight anchors, actions stay medium-low, and presence stays a quiet identity layer. Tune those states through Image4 scoped tokens before introducing new shadows, glow, blur, or wrapper effects.

For vertical rhythm, row containers use boundary isolation. Content should sit inside its row's buffer instead of using negative row-container transforms or margins to cross into adjacent rows.

For interaction states, Nexus uses a mutation budget. Hover clarifies, focus identifies, speaking animates signal bars, and containers stay structurally static. This follows the product-system pattern used by dense tools: state can change content expression, but it should not change the geometry or elevation of a layout container.

For reduced motion, Nexus uses a low-energy state model. System motion such as dial rotation and glow pulses stops; interaction transitions become instant; speaking identity remains readable through reduced signal-bar motion. This keeps accessibility preferences from turning the companion panel into a frozen dashboard.

## Surface Classification

| Surface | Level | Rule type | CI boundary |
| --- | --- | --- | --- |
| Image4 companion panel | Rhythm-critical | Hard structural contract plus soft visual report | `image4:contract:check` in `verify:pr` |
| Header controls | Rhythm-critical sub-surface | Utility-rail semantics and interaction checklist | Covered indirectly by soft audit and human review |
| Presence signal | Rhythm-critical sub-surface | Idle/speaking behavior and signal ownership | Hard component boundary, soft visual review |
| Dial | Rhythm-critical sub-surface | Live time/date/weather hierarchy and no decorative dots/orbs | Human review, no pixel CI |
| Suggestion actions | Rhythm-adjacent | Continuous suggestion flow and secondary action hierarchy | Human review only |
| Composer | Rhythm-critical input surface | One dock row, aligned controls, visible focus | Hard row ownership plus human review |
| Chat surface | Rhythm-adjacent | Streaming/message density and composer continuity | Human review only |
| Settings drawer | System surface | Form section rhythm, primitive behavior, focus order | Human review only |
| System modals, onboarding, OS/file integrations | Out of rhythm system | Follow task-specific platform patterns | No Image4 rhythm contract |

## Surface Checklist System

### Image4 Panel

- Borrow: LobeChat-style conversational spacing discipline, Open WebUI low-noise density, and Nexus's own companion-first identity.
- Avoid: dashboard card stacking, multi-panel workbench chrome, persistent debug visuals.
- Acceptance: the five named rows remain in order; `image4Grid=1` aligns to the same bounds as real content; `image4Snapshot=1` hides calibration marks.

### Header Controls

- Borrow: Codex-app-style compact tool buttons with equal icon hit areas, thin individual boundaries, and neutral default close color.
- Avoid: a shared glass tray, three unrelated floating icons, red close emphasis before hover/focus, text labels for familiar window controls, or enlarged button boxes.
- Acceptance: settings, collapse, and close read as one low-noise tool cluster; each button is identifiable without a heavy shared background, and hover/focus states do not move or resize controls.
- Current evidence: `docs/ui-qa/2026-06-29-settings-chat-unification/54-chat-top-controls-codex-toolbar-after.png`.

### Presence Signal

- Borrow: ambient status that is quiet at idle and more alive only when Starweave is speaking.
- Avoid: always-on equalizer energy, mismatched scan-light overlays, decorative leading orb before the name, wrapper glow, wrapper scale, or z-index elevation.
- Acceptance: idle state is visually calm; speaking state animates the existing signal bars; the signal stays in `Image4Signal` and remains a secondary identity layer.

### Dial

- Borrow: one calm time core with date and weather inside the instrument.
- Avoid: right-side decorative dots, date/weather clipping, fixed fake time, extra greeting icon above the dial.
- Acceptance: time is live; date/weather are separate rows; no text crosses the ring or escapes the dial.

### Suggestion Actions

- Borrow: continuous suggestion flow with weak secondary surfaces.
- Avoid: heavy cards, bright borders, large hover lift, outer hover shadow, or timeline decoration that competes with chat.
- Acceptance: actions remain scan-friendly inside the `actions` row and do not steal focus from the composer.

### Composer

- Borrow: Chatbox/Vercel-style composer primacy with obvious input affordance and aligned controls.
- Avoid: floating action clusters, oversized buttons, faint borders that make the input disappear.
- Acceptance: input, send, and attachment controls share one center line; focus is visible without layout shift; no voice button returns to the main composer.

### Chat Surface

- Borrow: Vercel AI Chatbot's streaming-first composition and clear message/tool-result boundaries.
- Avoid: bubble-heavy spacing explosion, separate chat shell inside the companion panel, card stacks for normal text.
- Acceptance: message density stays readable; the composer remains visually connected to the conversation; no hard Image4 grid CI or five-row rhythm model is added.

### Settings Drawer

- Borrow: shadcn/ui and Radix UI primitive behavior: accessible focus, predictable form rows, controlled toggles, dialog/drawer composition.
- Avoid: applying the Image4 rhythm grid to forms, using decorative companion visuals inside system settings, or enlarging controls beyond the existing drawer scale.
- Acceptance: sections, labels, inputs, toggles, and descriptions keep a consistent compact row rhythm; settings changes do not depend on Image4 CSS variables or Image4 visual rhythm rows.

## Design To Contract Mapping

| Design decision | Contract / audit source |
| --- | --- |
| Five-row visual rhythm grid | `named-rhythm-grid` in `image4:contract:check` |
| Explicit row ownership | `explicit-rhythm-row-placement` and `explicit-chat-row-placement` |
| Shared composer surface isolation | `npm run composer:surface:audit` |
| Composer anchoring state stability | `composer-primary-focus-anchor`, `image4-primary-focus-anchor`, `composer-actions-remain-secondary`, `image4-actions-remain-secondary`, and `send-disabled-tertiary-lock` in `npm run composer:surface:audit` |
| Short-height compression | `short-height-rhythm-collapse` |
| Signal bars isolated from `PanelView` | `signal-component-owns-64-bars` and `panel-view-keeps-image4-boundaries` |
| Presence/dial component boundary | `Image4PresenceHeader`, `Image4Dial`, and `image4-companion-field-component-boundary` in `npm run image4:visual-contract:audit` |
| Presence identity layer stability | `presence-non-primary-layer`, `signal-speaking-bars-only`, and `presenceWeightLeaks` in `npm run image4:visual-contract:audit` |
| Companion semantic field state | `deriveImage4CompanionState`, `image4-single-companion-state-driver`, and `image4-companion-state-contract` in `npm run image4:visual-contract:audit` |
| URL-gated state review | `getImage4StatePreviewSync`, `image4State`, `statePreview: image4StatePreview`, and `coerceImage4CompanionMode` in `npm run image4:visual-contract:audit` |
| Image4 visual contract maintainability | `scripts/image4-visual-contract-rules.mjs` owns rule definitions; `scripts/image4-visual-contract-audit.mjs` owns report execution |
| Coarse elapsed resting state | `elapsedBucket: image4ElapsedBucket`, `hasRestingElapsed`, and `data-companion-mode='resting'` checks in `npm run image4:visual-contract:audit` |
| Visual weight budget | `visual-weight-budget-tokens`, `actions-and-composer-boundary-budget`, and `visualWeightLeaks` in `npm run image4:visual-contract:audit` |
| Vertical boundary isolation | `actions-and-composer-boundary-budget` and `rowBoundaryLeaks` in `npm run image4:visual-contract:audit` |
| Interaction state normalization | `state-tokenized-top-controls`, `state-tokenized-chat-controls`, and `interactionStateLeaks` in `npm run image4:visual-contract:audit` |
| Reduced-motion accessibility | `reduced-motion-classification` in `npm run image4:visual-contract:audit` |
| Debug overlay stays out of product captures | `rhythm-overlay-does-not-cover-content` in the full local audit |
| Warm theme does not leak into unrelated controls | `warm-day-image4-specificity` and `warm-day-top-controls-specificity` in the full local audit |

## Open-source UI reference governance

Run `npm run ui:references:audit` when Image4 UI work changes the reference pool, borrow/avoid rules, surface mapping, decision matrix, or pinned remote evidence in `docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md`. The canonical reference data lives in `docs/open-source-ui-reference-manifest.json`; the markdown files are the human review layer. This audit is source-only and does not authorize live GitHub checks, pixel matching, reference color sampling, or copying another product's component skin.

## Borrow

- Keep controls low-noise. Header buttons should read as one utility rail, not three competing objects.
- Keep the composer clearly usable. Input, send, and attachment controls need visible alignment and focus affordance even when the design is quiet; voice controls remain in Settings.
- Keep theme overrides scoped. Global theme CSS should not accidentally recolor Image4 placeholders, buttons, or focus rings.
- Keep desktop density deliberate. Text rows, action suggestions, and utility controls should stay scan-friendly and stable across short viewports.
- Keep debug tooling separate from product UI. The rhythm grid is a calibration layer, not a permanent visual decoration.

## Do Not Borrow

- Do not copy full app chrome, sidebars, or dense productivity shells; Image4 is a companion panel, not a workbench.
- Do not add card-heavy UI just because other AI clients use cards. The current Image4 direction favors continuous suggestion flow.
- Do not add hover lift or scale effects to make controls feel interactive; those caused visual jump risk in this layout.
- Do not lock exact color, opacity, blur, or pixel values in CI while the visual language is still being tuned.
- Do not move settings drawer or generic chat surfaces into the hard Image4 grid contract; they need shared design semantics, not the same layout grid.

## Current Guardrails

`npm run image4:contract:check` is the PR-safe hard gate. It protects structural contracts only:

- Five named rhythm rows: presence, dial, greeting, actions, composer.
- Explicit row placement for presence, dial, messages, greeting, actions, and composer.
- Short-height compression at 760px and dial removal at 620px.
- `Image4Signal` owns the 64-bar signal generator.
- `PanelView` does not inline the 64-bar signal generator.

`npm run image4:visual-contract:audit` is the stricter local design audit. It also checks softer design-strategy drift:

- URL-gated preview, rhythm grid, and snapshot modes.
- URL-gated state preview keeps `idle`, `attentive`, `speaking`, and `resting` visual review deterministic without adding runtime settings.
- Warm-day selectors remain scoped back to Image4.
- Rhythm-grid labels stay in the right rail and do not cover content.
- The removed scan-light layer and hover/focus transform jumps do not return.
- Presence remains a non-interactive identity layer, and speaking motion stays on the existing bars instead of the signal wrapper.
- Presence, dial, and signal route through one Image4 companion state contract so they do not become separate widgets.
- Resting state is driven by coarse elapsed-time buckets and never by exact elapsed labels.
- Action hover does not add outer glow or shadow, and row containers do not use negative margin or vertical translate to fake alignment.
- Hover, focus, active, idle, and speaking state changes do not add one-off transform, z-index, filter, animation, or wrapper shadow outside the approved tokens and signal bars.
- Reduced-motion does not use blanket UI freeze: system motion turns off, interaction transitions become instant, and speaking signal bars keep a low-energy identity fallback.

`npm run image4:contract:report` summarizes hard failures and soft warnings without failing. Use it before visual tuning passes when the goal is to see drift without blocking design exploration.

`npm run composer:surface:audit` is a local source audit for the shared composer. It protects the Image4 dock and the normal companion composer from selector leakage, but it stays out of `verify:pr` so chat polish can keep moving.

## Release Boundary

- `image4:contract:check` belongs in `verify:pr` because it protects structural layout contracts.
- `image4:visual-contract:audit` stays as the stricter local design audit for visual tuning passes.
- `image4:contract:report` stays non-blocking so designers and contributors can inspect drift without freezing iteration.
- `composer:surface:audit` stays a manual design guard for shared composer changes.
- `distribution:audit` should not rerun Image4 contracts; distribution checks own packaging/release concerns, while Image4 contracts own companion UI structure.
- Chat and settings surfaces use the human checklist in `docs/DESIGN_REVIEW_CHECKLIST.md`; they do not get a hard rhythm-grid gate unless their structure becomes as deterministic as Image4.
