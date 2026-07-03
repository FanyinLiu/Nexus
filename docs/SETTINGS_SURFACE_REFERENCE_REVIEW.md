# Settings Surface Reference Review

Last checked: 2026-06-28.

This note records the focused settings review generated from:

```sh
npm run ui:references:audit -- --surface=settings --pro-prompt
```

It is a design-planning record, not a source-code dump. It uses the public reference manifest and the Pro review summary to keep future settings work grounded in Nexus-specific behavior instead of another product's skin.

For the fuller cross-surface comparison, see `docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md`.

## Source References

| Reference | Borrow | Avoid |
| --- | --- | --- |
| LibreChat | Provider, agent, tool, file, and admin boundaries as capability taxonomy. | Multi-user admin navigation, role/group matrices, provider marketplace, agent marketplace, or generic platform settings. |
| Cherry Studio | Dense provider and settings organization through predictable sections. | Dashboard card stacks, provider-studio chrome, or feature density inside Image4. |
| AnythingLLM | Memory, source context, and agent capability boundaries made inspectable. | Workspace/document management density, knowledge-base dashboards, or turning desktop awareness into a data-source console. |
| shadcn/ui | Component grammar, state discipline, form/dialog/button/tabs composition. | Default demo skin, card-heavy examples, or imported radius/color language. |
| Radix UI Primitives | Accessible focus behavior, controlled primitives, keyboard interaction semantics. | Headless abstraction churn where Nexus simple controls are already stable. |

## Pro Review Summary

Settings should be treated as a companion behavior tuning surface and high-trust control panel, not as a generic configuration dashboard. The drawer can be dense and structured, but it must not read like an admin panel, developer tool, provider-first control center, model workbench, or workspace console.

The main judgment is not whether settings can fit more controls. The main judgment is whether the user still feels they are tuning a companion experience instead of managing a system. That means compact form rhythm, predictable sections, and quiet primitive behavior matter more than card layouts or decorative polish.

The bounded Pro takeaway is that settings must answer four user questions quickly: what Nexus can see, what Nexus will remember, when Nexus may act, and how the user can pause, revoke, disable, or clear those abilities.

## Settings Surface Contract

- Settings is a high-trust companion control surface, not a feature inventory.
- Grouping follows user trust boundaries: trust/safety, memory/context, desktop awareness, permissions/integrations, and appearance/interaction.
- Provider, agent, tool, file, and admin concepts may be used only as boundary vocabulary; default settings must not become a platform backend.
- Rows stay compact and repeated: label, optional description, control, optional status or validation.
- High-trust settings must expose disable, clear, inspectable, or ask-every-time affordances where relevant.
- Settings must not inherit Image4 rhythm variables, dial chrome, speaking animation, or decorative companion effects.
- Manual review owns perceived polish; source audits own deterministic contracts.

## Settings State Model

Use these states as the review vocabulary before adding visual changes:

| State | Role | Allowed visual behavior |
| --- | --- | --- |
| `idle` | Scannable control surface with low visual noise. | Compact rows, stable section rhythm, no hero spacing. |
| `focused` | One active setting is being edited or inspected. | Clear focus ring, predictable tab order, no row movement. |
| `dirty` | A setting has changed locally before persistence or confirmation. | Local state affordance only; no global dashboard alert chrome. |
| `disabled` | A setting is unavailable because of dependency or mode. | Muted label/control relationship, visible reason text when needed. |
| `high-trust` | A setting controls memory, desktop awareness, external action, or destructive cleanup. | Boundary copy plus explicit control; no warning-heavy dashboard treatment. |

## Structure Model

Settings should use a section graph, not cards. Review settings as five trust groups:

| Group | Purpose | Examples |
| --- | --- | --- |
| Trust & Safety | User control over logs, history, cleanup, and risky states. | Diagnostics, history actions, destructive confirmations. |
| Memory & Context | What Nexus remembers and how context is inspected or cleared. | Long-term memory, daily memory, lorebooks. |
| Desktop Awareness | What Nexus can infer from desktop state and when it may proactively check in. | Window behavior, autonomy, voice presence. |
| Permissions & Integrations | External connections and actions. | Model providers, MCP/integrations, tools, ask/allow/deny posture. |
| Appearance & Interaction | How the companion presents itself. | Companion identity, theme, language, motion, letters. |

This keeps settings structured without copying Cherry Studio's provider-studio chrome or turning Nexus into a dashboard.

## Implementation Route

1. Define the settings graph before changing visuals: `trustSafety`, `memoryContext`, `desktopAwareness`, `permissionsIntegrations`, and `appearanceInteraction`.
2. Introduce or normalize a single SettingRow primitive: label, optional description, control, optional status, and optional validation.
3. Keep control alignment predictable. Labels and descriptions own the left side; switches, selects, inputs, sliders, and buttons own the right side.
4. Use progressive disclosure only at row or section level. Do not add dashboard grids, nested cards, or modal-only settings flows.
5. Keep focus and keyboard behavior primitive-first. Focus order remains predictable, and focus restoration should follow drawer/dialog semantics.
6. Keep Image4 visual language out of settings. Form rows stay compact and repeated; no Image4 rhythm variables, decorative companion effects, dial chrome, or speaking-state animation should leak into settings.
7. For high-trust sections, prefer short boundary copy: what Nexus can use, what it does not store, and how the user can disable or clear it.
8. Compress LibreChat-style capability boundaries into Nexus user controls: provider connection, companion behavior, tool permission, user-provided file/context, and no default admin area.

## Automatic Checks

These are suitable for source audits or deterministic tests:

- SettingRow primitive usage remains the preferred path for repeated settings controls.
- Form rows stay compact and repeated instead of becoming one-off cards.
- Focus order remains predictable when sections, dialogs, menus, or collapsible groups are added.
- Settings CSS does not depend on Image4 rhythm variables or decorative companion selectors; `npm run settings:surface:audit` rejects `--image4`, `image4-`, `panel-window--image4`, `panel-companion`, dial, signal, wave, and rhythm leaks in settings source.
- Hover and focus states do not use transform, scale, row lift, or layout-changing animation.
- Controlled input state stays explicit where a setting changes persistent behavior.
- The source-visible trust groups remain present before visual regrouping.
- High-trust settings preserve disable, clear, inspectable, or ask-every-time affordances.
- History, memory, and external-tool settings keep source-visible export, clear, disable/remove, and confirmation controls.
- Default settings do not introduce admin dashboard, provider-studio, workspace-management, agent-marketplace, or knowledge-base dashboard chrome.

## Human Review Checks

These require visual review:

- Settings still feels like a companion behavior tuning surface, not a system configuration dashboard.
- Dense provider/tool settings do not become the visual identity of Nexus.
- Section grouping helps scanning without making the drawer feel like a SaaS admin panel.
- Form descriptions are useful and quiet; they do not create paragraph-heavy rows.
- The surface does not copy Cherry Studio, shadcn/ui, Radix UI Primitives, or any other reference skin.

## Open Source UI Comparison - 2026-06-29

Source-checked references:

- [LibreChat](https://github.com/danny-avila/LibreChat): broad provider, agent, tool, code-interpreter, and file-handling boundaries.
- [Cherry Studio](https://github.com/CherryHQ/cherry-studio): desktop AI productivity studio with smart chat, autonomous agents, many assistants, and frontier model access.
- [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm): local-first agent experience with automatic/user-managed memories, scheduled tasks, tools, agent builder, MCP compatibility, and workspace-style controls.
- [Open WebUI](https://github.com/open-webui/open-webui): user-friendly Ollama/OpenAI-compatible interface with clear model/API connection setup.

Nexus should borrow the boundary model, not the product chrome:

- Provider setup belongs in a quiet `model` section. Model/provider cards should show selection without saturated side bars, large badges, or provider-studio weight.
- Memory, desktop awareness, tools, and autonomy belong in high-trust sections with short boundary copy and explicit controls.
- Tool and external-action settings should stay permission-led: enable, ask, revoke, clear, export, inspect.
- Desktop companion settings should feel like behavior tuning, not workspace administration.
- The chat surface remains the visual source of truth: shallow buttons, low-contrast selected states, compact rows, no heavy admin cards.

## Deep Section Alignment - 2026-06-29

The warm-day settings drawer now has a narrow chat-aligned override layer for section-level polish. This layer exists to make settings feel consistent with the Image4/chat control language without importing Image4's rhythm grid, dial, signal, or companion animation.

Apply these rules when reviewing or extending deep settings pages:

- Deep settings controls use a soft system-row rhythm: 34-36px control height, 10px ordinary row radius, warm low-contrast borders, and no hover lift or scale.
- Deep settings row radius follows the chat suggestion grammar: 10px for ordinary rows, toggles, fields, chips, and section-level action buttons.
- Toggles, action rows, history metrics, history empty states, letter empty states, updater panels, and autonomy status badges should share the same lightweight boundary treatment.
- Deep settings sections should not read as cards inside the drawer. Keep the section wrapper transparent and let the individual rows carry the minimum necessary boundary.
- Inputs and selects should stay readable but low-weight: shallow translucent fill, one thin border, no gradient slab, and no top-highlight inset.
- Native selects need enough internal height and label width for Chinese text. Prefer a slightly wider label lane over clipping terms such as VAD sensitivity, provider names, or voice IDs.
- Voice and speech native selects use a 34px internal control height with normal line-height so Chinese option text does not look vertically clipped.
- Console observability details should follow the same lightweight diagnostic-list shell as the other self-check rows. Do not present memory/token/status details as a raised dashboard card inside settings.
- Memory transparency copy should explain local storage, pause behavior, and privacy boundaries in user-facing language. Avoid leaking implementation names such as renderer storage layers or database backends into the default companion settings view.
- The model section should open the current provider detail first. The provider list is a secondary browse action, not the default empty-feeling landing state.
- Model provider detail headers and fields follow the flat SettingRow rhythm: transparent section wrapper, thin row separators, 42px-ish field rows, and 32px native-safe inputs/selects. Do not return to nested raised provider cards.
- Model provider detail command buttons stay as a quiet 28px command strip with transparent button floors. Do not present provider actions as two raised full-width button boxes.
- Memory transparency summaries should read as one compact status list, not a two-column dashboard tile grid. Keep them transparent, 36px-ish per row, and separated by thin list lines.
- Chat-section community/source links should use stable two-column row buttons at narrow drawer width. Do not force three-column link clouds that clip source names.
- Chat-section pet model helper copy can wrap to two lines. Do not force single-line truncation for companion/model descriptions that explain what the user is choosing.
- Chat-section pet model option descriptions should stay readable in the compact list. Use a slightly taller 46px row and medium-muted copy instead of compressing descriptions into pale 42px rows.
- Disabled rows should stay in the same visual family as enabled rows. Use muted text/control state instead of making the whole row brighter or heavier.
- Selected deep cards, such as model providers or choice cards, use a shallow warm fill and thin inset outline. Do not use saturated side bars or heavy selected borders.
- Enabled toggles use a shallow warm track with a thin inset outline. Do not use saturated warm/brown switch tracks that read as heavy buttons.
- Disabled action buttons keep the same footprint and radius as enabled buttons, with muted color and background instead of shrinking or becoming a different component.
- Action rows can wrap when content requires it, but short history-style actions should stay on one row when the drawer width allows.
- This is a settings primitive alignment rule, not a companion-field visual rule. Do not use Image4 variables, dial chrome, speaking animations, orbit elements, scan lights, or decorative companion effects in settings.

Current local visual evidence:

- `docs/ui-qa/2026-06-29-settings-chat-unification/32-settings-voice-deep-sample.png`
- `docs/ui-qa/2026-06-29-settings-chat-unification/32-settings-autonomy-deep-sample.png`
- `docs/ui-qa/2026-06-29-settings-chat-unification/32-settings-letters-deep-sample.png`
- `docs/ui-qa/2026-06-29-settings-chat-unification/34-settings-history-disabled-radius.png`
- `docs/ui-qa/2026-06-29-settings-chat-unification/49-settings-model-selected-after.png`
- `docs/ui-qa/2026-06-29-settings-chat-unification/50-settings-desktop-toggle-after.png`
- `docs/ui-qa/2026-06-29-settings-chat-unification/53-settings-desktop-field-label-after.png`
- `docs/ui-qa/2026-06-29-settings-chat-unification/65-settings-desktop-section-cardless-after.png`
- `docs/ui-qa/2026-06-29-settings-chat-unification/66-settings-desktop-disabled-row-muted-after.png`
- `docs/ui-qa/2026-06-29-settings-chat-unification/69-settings-deep-10px-radius-after.png`
- `docs/ui-qa/live-settings-chat-compare/12-settings-model-default-detail-flat.png`
- `docs/ui-qa/live-settings-chat-compare/14-settings-voice-vad-label-width-after.png`
- `docs/ui-qa/2026-07-01-settings-continuation/07-settings-model-provider-header-flat-after.png`
- `docs/ui-qa/2026-07-01-settings-continuation-2/07-memory-transparency-list-radius-after.png`
- `docs/ui-qa/2026-07-01-settings-continuation-2/08-chat-community-links-two-column-after.png`
- `docs/ui-qa/2026-07-01-settings-continuation-2/09-chat-pet-model-helper-wrap-after.png`
- `docs/ui-qa/2026-07-01-settings-continuation-2/10-voice-vad-select-native-safe-after.png`
- `docs/ui-qa/2026-07-01-settings-continuation-2/11-console-observability-list-after.png`
- `docs/ui-qa/2026-07-02-settings-continuation-3/04-role-pet-model-options-scrolled-after.png`
- `docs/ui-qa/2026-07-02-settings-continuation-3/05-model-detail-quiet-command-strip-after.png`
- `docs/ui-qa/2026-07-02-settings-continuation-3/06-memory-storage-note-user-facing-after.png`

## Home Surface Alignment - 2026-06-29

The warm-day settings home should borrow the chat surface's quiet button grammar. Version hints, theme controls, and save actions can be visible, but they should not become marketing cards, announcement banners, or thick standalone controls.

Apply these rules when reviewing the settings home:

- The top title bar stays transparent and compact; window tools are small icon buttons without a shared pill background.
- Codex-app-style means low-noise application chrome: thin separators, a quiet 12px title line with even title/section weight, small 24px tool buttons with no visible default button floor, and a shallow hover floor only.
- The drawer base can stay warm and lightly frosted, but it must be opaque enough that underlying chat text is not readable through the settings content.
- The release hint uses the same low-contrast left trace as normal settings rows, not a saturated accent stripe.
- The release hint should read as a compact status row. Keep version and title visible, hide explanatory prose by default, and do not let it become a tall announcement card.
- Release actions are lightweight command buttons: transparent by default, shallow hover floor only, no solid orange/red primary button on the home surface.
- The theme segmented control should sit at row level: low shadow, compact height, and a shallow selected state.
- Theme selection must stay in the current settings palette. Do not inherit blue/system accent borders into the warm selected state.
- Settings rows remain the dominant repeated grammar: compact height, thin list boundaries, subdued right-side state, and quiet glyphs.
- Home row glyphs belong in a small leading lane, not as faint right-side marks. This keeps settings closer to the chat action-row scan pattern without copying Image4 rhythm.
- Deep settings rows should avoid nested input boxes when the control is a simple value choice. Keep window-scene selects as compact row values with only hover/focus emphasis.
- Home rows should not look like stacked cards. Prefer transparent or low-alpha fills, one faint bottom boundary, and a very low-alpha left trust trace over gradient slabs and inset top highlights.
- Footer actions should read like a lightweight bottom tool strip, not a second card. Use a thin top separator, no outer footer fill/shadow, compact 30px buttons, transparent cancel, and a shallow warm save action.

Current local visual evidence:

- `docs/ui-qa/2026-06-29-settings-chat-unification/40-settings-top-header-icon-contrast.png`
- `docs/ui-qa/2026-06-29-settings-chat-unification/42-chat-home-reference.png`
- `docs/ui-qa/2026-06-29-settings-chat-unification/45-settings-home-release-theme-after-open.png`
- `docs/ui-qa/2026-06-29-settings-chat-unification/51-settings-top-title-before.png`
- `docs/ui-qa/2026-06-29-settings-chat-unification/52-settings-top-title-codex-style-after.png`
- `docs/ui-qa/2026-06-29-settings-chat-unification/55-chat-composer-action-area-before.png`
- `docs/ui-qa/2026-06-29-settings-chat-unification/56-settings-footer-action-area-before.png`
- `docs/ui-qa/2026-06-29-settings-chat-unification/57-settings-footer-action-area-after.png`
- `docs/ui-qa/2026-06-29-settings-chat-unification/58-settings-section-footer-action-area-after.png`
- `docs/ui-qa/2026-06-29-settings-chat-unification/64-settings-codex-app-list-after-trace-muted.png`
- `docs/ui-qa/2026-06-29-settings-chat-unification/71-settings-codex-app-top-release-after.png`
- `docs/ui-qa/2026-06-29-settings-chat-unification/74-settings-opaque-drawer-after.png`
- `docs/ui-qa/2026-06-29-settings-chat-unification/78-settings-desktop-current-reference.png`
- `docs/ui-qa/2026-06-29-settings-chat-unification/79-settings-window-fields-flattened-after.png`
- `docs/ui-qa/2026-06-29-settings-chat-unification/80-settings-window-fields-before-after.png`
- `docs/ui-qa/2026-06-29-settings-chat-unification/81-settings-codex-app-topbar-after.png`
- `docs/ui-qa/2026-06-29-settings-chat-unification/82-settings-light-command-buttons-after.png`
- `docs/ui-qa/2026-06-29-settings-chat-unification/84-settings-theme-accent-clean-after.png`
- `docs/ui-qa/2026-06-29-settings-chat-unification/85-settings-release-status-row-after.png`
- `docs/ui-qa/live-settings-chat-compare/04-settings-home-left-glyph.png`

Local Pro follow-up entrypoint:

```sh
npm run ui:references:audit -- --surface=settings --questions
```

Use the generated questions to challenge architecture and polish decisions before broad settings redesign work. Do not send source, screenshots, logs, or private runtime data to Pro unless the user confirms that action at the time.

## Pro Follow-Up - 2026-06-30

The 2026-06-30 Pro follow-up confirmed the current settings direction:

- Settings should feel like a low-noise companion control surface, not an admin dashboard.
- The top title should visually read as `设置` only. The companion name already belongs to the chat identity layer, and `星绘 · 设置` reads like product-module chrome.
- The theme control should stay as a settings row. The active state should use text emphasis or a warm underline, not a thick pill, tile, glow, or selected-card background.
- Settings home should group by user meaning instead of implementation modules: appearance and experience, companion behavior, memory and context, model and connections, and maintenance. History, diagnostics, and onboarding stay together as low-frequency recovery controls instead of two separate home groups.
- Deep settings pages should converge on a compact SettingRow grammar: label, optional description, right-aligned control or status, optional detail affordance, danger or disabled state where needed.
- Manual screenshot review should judge warmth, noise, and companion continuity. Automated audits should protect header identity, row density, no-card/no-elevation rules, no thick theme pill, focus grammar, and dangerous-action confirmation boundaries.

Current local visual evidence:

- `docs/ui-qa/2026-06-30-settings-top-control/03-after-titlebar-and-theme-row.png`
- `docs/ui-qa/2026-06-30-settings-top-control/05-project-restored-settings-open.png`

## Guardrail

The safe interpretation is:

```text
settings = companion behavior tuning surface
```

More specifically:

```text
settings = trust boundary map + quick control panel
```

It is not:

```text
settings = system configuration dashboard
```

Future settings changes should link back to this note when they touch section structure, SettingRow primitive behavior, provider/tool configuration density, focus management, disclosure behavior, or cross-surface CSS variables.
