# Composer Surface Reference Review

Last checked: 2026-06-28.

This note records the focused composer review generated from:

```sh
npm run ui:references:audit -- --surface=composer --pro-prompt
```

It is a design-planning record, not a source-code dump. It uses the public reference manifest and the Pro review summary to keep future composer work grounded in Nexus-specific behavior instead of another product's skin.

## Source References

| Reference | Borrow | Avoid |
| --- | --- | --- |
| Chatbox | Desktop composer ergonomics, local-first feel, persistent draft behavior, and a single input channel. | Floating action clusters, generic desktop-client chrome, or dense parallel toolbars. |
| Jan | Local-first desktop posture and quiet model/runtime trust signals. | Runtime dashboards, provider chrome, or status chips that crowd the input path. |
| assistant-ui | Explicit composer state grammar for input, submit, attachment, and assistant run states. | Library demo skin, generic chat-app chrome, or off-the-shelf state ownership. |
| LibreChat | Capability boundaries for agents, tools, files, MCP, and resumable streams. | ChatGPT-like input chrome, platform navigation, agent/preset/tool sidebars, or workspace density in the companion composer. |
| Vercel AI Chatbot | Streaming-first composition, clear submit-to-stream state, and tool/result boundaries. | Browser-page layout assumptions, full-width web chat framing, or mixing tool UI into the input surface. |

## Pro Review Summary

Pro accepted the composer direction as a single-surface intent gateway and streaming controller, not a normal chat input and not a toolbar. The bounded takeaway is hierarchy: textarea owns user intent, send becomes primary only when submit is available, attachment remains a secondary tool, and voice runtime controls stay in Settings.

The review explicitly rejected default provider, agent, preset, tool-market, and runtime-dashboard controls inside the companion composer layer. Those capabilities may have boundaries elsewhere, but they must not become default composer chrome.

The review also called out an implementation risk: do not change Image4 button dimensions to repair alignment. Alignment should come from shared control boxes, icon boxes, line height, padding tokens, and center-line rules.

The composer must remain the primary input anchor, but it must not become the center of the whole product. Presence, dial, and companion identity still define the ambient surface; composer owns intent capture.

## Composer Surface Contract

- Composer is a single-surface intent gateway, not a toolbar.
- Textarea is the primary intent area.
- Send is primary only when submit is available.
- Attachment is an embedded secondary tool.
- Voice runtime controls stay in Settings and out of the main composer.
- Runtime/model/streaming hints are tertiary.
- Image4 composer and normal chat composer must share alignment rhythm and control box rules.
- Hover/focus may reveal lightweight affordance, but default tool controls must not read as separate tiles.
- Do not add provider, agent, preset, tool-market, or runtime-dashboard controls to the default composer layer.
- Do not change Image4 button dimensions to repair alignment.

## Composer State Model

Use these states as the review vocabulary before adding visual changes:

| State | Role | Allowed visual behavior |
| --- | --- | --- |
| `idle` | Low-noise available input anchor. | Quiet boundary, stable affordance, no layout growth. |
| `drafting` | Active user intent capture. | Clear focus ring and input contrast. |
| `streaming` | Submitted intent is being answered. | Composer becomes a read-only context anchor; no layout shift. |
| `interrupted` | User is redirecting or stopping output. | Input regains focus and replaces the active streaming intent. |

## Embedded Tool Rule

Attachment and send are composer tools, not separate default tiles. In Image4 warm-day they should visually belong to the input: transparent default state, stable icon weight, and lightweight button feedback only on hover, focus, active, or enabled-send states. Voice runtime controls stay in Settings and out of the main composer.

This keeps the text area as the visible boundary while preserving discoverable controls. If the tools need more visibility, tune icon contrast, spacing, tooltip/focus behavior, or enabled state first; do not add persistent button backplates inside the composer by default. Warm-day embedded tools should get contrast from the companion muted/text palette, not from larger buttons, stronger shadows, or separate tiles.

## Final Composer Rhythm

The final Image4 composer layer owns the compact control rhythm. `panel-companion-composer.css` owns final attachment, send, textarea, focus, and state styling; `panel-companion-chat.css` only owns the dock/container, empty state, action prompts, and hint text.

- field text padding: `17px 51px 13px 52px`;
- attachment and send use a `29px control box`;
- icon glyphs use a `16px icon box`;
- attachment/send controls use a `2px control gap`;
- default embedded controls stay transparent and do not carry persistent backplates.

Do not use button resizing as an alignment fix. If alignment drifts, adjust the shared center line, reserved textarea padding, icon box, or state color before changing the control-box size.

## Implementation Route

1. Define the composer state machine before changing visuals: `idle`, `drafting`, `streaming`, and `interrupted`.
2. Keep exactly one primary input core. Attachment and send feed the same composer pipeline; voice runtime controls stay in Settings.
3. Keep tool entry collapsed by default. Do not add a persistent multi-button toolbar or default tool backplates that compete with the textarea.
4. During streaming, keep composer geometry stable. State may change affordance, focus, cursor, or read-only behavior, but not height or row ownership.
5. During interruption, return focus to the input path and treat the new input as a replacement intent, not a second parallel flow.
6. In idle or presence-active states, lower visual weight through tokens and state styling rather than moving or resizing the composer.

## Automatic Checks

These are suitable for source audits or deterministic tests:

- Composer height and row ownership stay constant across state selectors.
- Streaming state does not introduce wrapper elevation, row movement, or new layout containers.
- Tool entry stays one interaction layer deep and does not become a persistent toolbar.
- Embedded tools default to no separate tile/backplate; hover, focus, and enabled states provide the visible button feedback.
- Shared composer hooks remain isolated between Image4 and normal chat.
- Disabled send remains tertiary and cannot become visually active on hover.
- Focus styling uses shared state tokens instead of one-off shadows or scale.
- Default composer controls do not include provider, agent, preset, tool-market, or runtime-dashboard entries.
- Image4 does not carry dead three-button action-group rules.

## Human Review Checks

These require visual review:

- The composer still feels like a companion intent surface, not a generic web chat input.
- Tool affordances do not steal primary attention from text entry.
- Attachment and send feel embedded in the input instead of floating beside it or becoming a row of mini buttons.
- Streaming state reads as system behavior, not as a second message surface.
- The input remains obvious without forcing the dial, presence, or companion identity into the background.
- The surface does not copy Chatbox, Vercel AI Chatbot, or any other reference skin.

## Guardrail

The safe interpretation is:

```text
composer = intent gateway + streaming controller
```

It is not:

```text
composer = chat app center stage
```

Future composer changes should link back to this note when they touch state, streaming behavior, attachment/tool entry, disabled send, focus styling, or cross-surface composer selectors.
