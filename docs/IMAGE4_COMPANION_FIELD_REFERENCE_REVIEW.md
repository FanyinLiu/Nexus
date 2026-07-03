# Image4 Companion Field Reference Review

Last checked: 2026-06-28.

This note records the focused Image4 presence and dial review generated from:

```sh
npm run ui:references:audit -- --surface=image4-presence --pro-prompt
npm run ui:references:audit -- --surface=dial --pro-prompt
```

It is a design-planning record, not a source-code dump. It uses the public reference manifest, Nexus-specific product requirements, and the Pro review summary to keep future Image4 work grounded in companion behavior instead of widget styling.

For the fuller cross-surface comparison, see `docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md`.

## Source References

| Reference | Borrow | Avoid |
| --- | --- | --- |
| LobeHub / LobeChat lineage | Calm agent identity, conversational spacing discipline, and companion hierarchy. | Avatar chrome, multi-agent workforce framing, or product shell mimicry. |

## Product Requirements

- The identity label is only `星绘`; do not restore `星绘在身边`.
- Do not add a leading orb before `星绘`.
- Do not add the small right-side orbit dot beside the ring.
- Voice bars animate only while Xinghui is speaking.
- Voice-bar highlights must share the surface color temperature instead of reading as a detached white scan light.
- Warm color should remain configurable through Nexus tokens, not through copied reference colors.
- Date and weather may live inside the dial, but not on one colliding horizontal line.
- The ring needs distinct inner content and surrounding-track ownership without becoming a gauge.

## Companion Palette Contract

The accepted warm companion palette is a tokenized system, not a one-off color pass. In warm-day Image4, the outer panel, dial, message bubbles, composer field, and embedded controls should share these roles:

| Token | Role |
| --- | --- |
| `--image4-companion-bg` | Warm off-white page base. |
| `--image4-companion-surface` | Main readable surface for panel, bubbles, and composer. |
| `--image4-companion-surface-strong` | Slightly warmer surface depth for user bubbles and soft inner dial gradients. |
| `--image4-companion-primary` / `--image4-companion-primary-soft` | Peach/apricot emotional accent for warmth and speaking energy. |
| `--image4-companion-secondary` | Sage blue-green trust accent for focus, send-ready, online state, and calm support. |
| `--image4-companion-text` / `--image4-companion-muted` | Long-read text and secondary text colors. |

Do not reintroduce a cold blue-gray base for warm-day controls. Blue-green is allowed as the stabilizing support accent; it should not take over the whole surface. The browser-verified baseline after tokenization is `docs/ui-qa/2026-06-28-main-dialog-audit/22-companion-token-palette-final.png`.

## Companion Color Strategy

The companionship palette should read as a calm presence system, not as a dashboard theme. Use warm off-white and soft cream as the dominant base, peach/apricot as the emotional warmth accent, and sage blue-green as the stabilizing trust accent. Text should stay warm dark brown or warm charcoal rather than pure black.

Avoid large areas of cold blue-gray, high-saturation orange/red, neon purple, or dark morning surfaces. Warm-day must remain visibly light and companion-like even when the chat has active messages; controls may use blue-green for focus, send-ready, online, and calm-support states, but the overall field should still feel warm.

## Companion Palette Time-Of-Day Model

The companion palette should change emotional temperature by time state, not collapse into one always-dark or always-bright skin. The model is a three-state review lens: morning warmth, daytime calm, and night low-light.

| Time state | Palette role | Must avoid |
| --- | --- | --- |
| Morning | Soft warm off-white, cream, and restrained apricot so a morning greeting reads bright and present. | Dark workbench defaults, cold blue-gray shells, or dramatic night imagery. |
| Daytime | Similar warm-day base with slightly quieter sage or mist-blue support for focus and trust. | High-saturation orange/red floods or decorative mood lighting detached from state. |
| Night | Intentional low-light mode with warm dark brown or charcoal, still keeping text and controls readable. | Treating night/dark as the default mood for morning or daytime companionship. |

Morning and normal daytime use the warm-day palette. Night/dark themes are intentional low-light states, not the default companion mood.

## Companion Color Research Basis

This color direction is grounded in color-emotion research and accessibility rules, not only visual taste. A 2025 Psychonomic Bulletin & Review systematic review of 132 peer-reviewed articles reports that light colors skew positive, while blue, green, blue-green, and white are associated with positive low-arousal emotions such as comfort and relaxation. It also warns that yellow/orange tend toward higher arousal, so Nexus should use peach/apricot as a restrained emotional accent instead of a broad high-energy theme.

For controls, the W3C non-text contrast guidance is the guardrail: available UI controls and meaningful icons need enough adjacent contrast to be identifiable, while inactive controls can stay quieter. In Image4 warm-day this means embedded plus, mic, send-ready, focus, and speaking cues should be legible through companion tokens before adding tiles, shadows, or larger button boxes.

References:

- Jonauskaite, D. & Mohr, C. (2025), "Do we feel colours? A systematic review of 128 years of psychological research linking colours and emotions", Psychonomic Bulletin & Review: https://link.springer.com/article/10.3758/s13423-024-02615-z
- W3C WCAG 2.1 Understanding SC 1.4.11 Non-text Contrast: https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html

## Pro Review Summary

Image4 presence and dial should be treated as one companion semantic field, not as separate widgets. Presence is a system heartbeat indicator. Dial is an environment lens. Together they should make the user feel that the system is present, not that the UI is showing a voice component and a time dashboard.

The core judgment is component de-emphasis. Presence and dial may be polished, but they must reduce their own affordance and avoid looking clickable, dashboard-like, or mascot-like.

Follow-up Pro review on 2026-06-28 sharpened this into a Companion State Contract: dial and presence should move from two components to one state organism. The risky failure mode is semantic split, where time, weather, identity, and voice signal each behave like separate widgets. The implementation response is a single Image4 state driver with `idle`, `attentive`, `speaking`, and `resting` modes, plus shared intensity, tone, dial emphasis, and presence pulse values.

The `resting` mode is tied to Nexus's coarse elapsed-time buckets, not to precise timers. When there is no speaking, listening, or active assistant work and the panel has been open for about an hour or more, Image4 can settle into a lower-energy companion field without exposing exact elapsed minutes.

For visual review, use the URL-gated `image4State` preview to inspect `idle`, `attentive`, `speaking`, and `resting` without waiting for real voice or elapsed-time triggers. The preview must still route through `deriveImage4CompanionState`; it is not a parallel styling switch.

The rendered field is split at the component boundary as `Image4PresenceHeader`, `Image4Dial`, and `Image4Signal`. `PanelView` should pass the shared state and labels into those components, not re-own the presence markup or dial layers. This follows the reference-review rule that the companion field behaves as one organism while keeping the main panel file from becoming the visual implementation surface.

The accepted Pro review for `image4-presence` further narrows the rule: presence should become less component-like, not more component-like. Treat it as a state grammar layer that modulates the companion field. It may express availability, attention, speaking, and rest, but it must not become a clickable control, avatar container, title badge, audio visualizer, or independent widget.

The accepted abstraction is:

```text
presence = ambient identity field + state-to-expression mapping
```

It is not:

```text
presence = interactive widget + waveform component
```

The implementation consequence is intentionally small: idle bars explicitly remain non-animated, and `Image4PresenceHeader` stays non-interactive. Speaking can animate the existing bars; idle, attentive, and resting states should communicate through lower-noise opacity, tone, and dial emphasis rather than new elements or interaction affordances.

The accepted Pro review for `dial` narrows the dial role in the same direction: dial is an ambient environment lens, not an information widget or dashboard. It may answer "what environment are we in right now" through time, date, and weather, but it must not start answering richer weather or system-status questions. Time stays the anchor, date and weather stay secondary, and the ring is a soft boundary plus slow time-flow cue rather than a gauge.

The accepted abstraction is:

```text
dial = environment time-flow lens + soft boundary ring
```

It is not:

```text
dial = weather widget + gauge + forecast dashboard
```

The implementation consequence is intentionally small: dial metadata remains a clipped two-line inner stack, ring/tick motion stays slow, and Image4 source audits reject forecast, humidity, gauge, chart, satellite, and weather-card details inside the dial. Short-height degradation keeps time first, compresses date and weather second, and drops decorative ring detail before changing the companion hierarchy.

## Presence And Dial State Model

Use these states as the review vocabulary before adding visual changes:

| State | Role | Allowed visual behavior |
| --- | --- | --- |
| `idle` | The companion is available without performing. | Static or near-static presence, quiet dial, no scan light. |
| `speaking` | Xinghui is actively producing voice. | Voice bars may animate through one motion dimension only. |
| `resting` | The panel has been open for about an hour or more with no active exchange. | Lower presence pulse and calmer dial emphasis; no new widget, badge, or exact timer. |
| `ambient` | Time, date, and weather provide environment context. | Dial content stays inside the ring as layered text, not a horizontal status row. |
| `warm` | User-selected warm visual temperature is active. | Shared warmth scalar affects dial, bars, and secondary text together. |
| `reduced-motion` | Motion should be low-energy. | Speaking remains readable through static or minimal bar variation. |

## Structure Model

Review Image4 presence and dial as one field with two roles:

| Role | Purpose | Must not do |
| --- | --- | --- |
| Dial | Stable layout anchor and environment lens. | Become a gauge, radial progress chart, avatar frame, or dashboard widget. |
| Presence | Non-layout-affecting state layer and system heartbeat indicator. | Become a separate audio player, equalizer widget, or animated title module. |

This keeps Image4 companion-first without making the surface feel like a dashboard widget panel.

## Implementation Route

0. Route dial, presence, and signal through `deriveImage4CompanionState` before adding new visual states. Presence and dial must not make independent state decisions.
0.1. Feed the shared state driver with coarse elapsed-time buckets so `resting` is a real semantic mode, not a decorative idle synonym.
1. Define dial as the layout anchor before changing visuals. Ring size, inner text stack, and track ownership should be stable across idle and speaking states.
2. Define presence as a non-layout-affecting state layer. Voice bars should not change row height, dial geometry, or surrounding spacing.
3. Move date and weather into a two-line semantic stack when they live inside the dial. Do not use a horizontal multi-column layout inside dial.
4. Tie dial stroke, presence bars, secondary text, and highlights to one warmth scalar. Speaking can increase brightness slightly, but it should not introduce a detached glow color.
5. Limit speaking motion to one dimension. Prefer bar height modulation; do not combine height, opacity, blur, color shift, and scale in one speaking state.
6. Remove component cues around identity. No leading orb, no right-side dot, no independent title badge, and no card-like boundary between presence and dial.

## Automatic Checks

These are suitable for source audits or deterministic tests:

- `npm run image4:color:audit` verifies that the warm companionship tokens stay light, low-noise, and readable enough for text, embedded tools, send-ready, focus, and speaking cues.
- Presence remains a non-layout-affecting state layer and does not own row height.
- Presence, dial, and signal use one companion state driver instead of separate state checks.
- Resting derives from coarse elapsed buckets such as about an hour or two hours or more, never from exact minute/second labels.
- URL state preview is accepted only through the shared state driver and known state names.
- Dial remains the layout anchor and does not animate in response to speaking.
- Speaking animation dimension stays limited to one primary visual dimension.
- Voice-bar keyframes do not use blur, detached scan-light filters, or strong color-shift animation.
- Dial inner content avoids horizontal multi-column layout inside dial.
- Dial metadata stays clipped to an inner stack with ellipsis behavior so long weather text cannot become a dashboard row.
- Dial ring and arc animation stay slow enough to read as time-flow ambience, not a gauge.
- Warm-day palette uses the shared `--image4-companion-*` tokens across shell, dial, chat bubbles, and composer controls.
- Warm-day embedded composer controls do not fall back to the old blue-gray disabled/processing colors.
- Image4 source does not add forecast, humidity, wind-detail, gauge, chart, weather-card, or satellite dial elements.
- Image4 source does not restore `星绘在身边`, a leading identity orb, or a right-side orbit dot.
- Presence does not add click, pointer, mouse, keyboard, button-role, or tab-stop affordances.
- Idle signal bars explicitly declare `animation: none`; only speaking state may animate the existing bars.

## Human Review Checks

These require visual review:

- Image4 feels like one companion semantic field, not separate presence and time widgets.
- Presence does not steal the visual center from dial or composer.
- Presence reads as an ambient identity field rather than a UI component.
- Dial reads as an environment lens, not as a dashboard gauge or avatar frame.
- Weather remains an ambient token and does not compete with the time anchor.
- Ring motion gives time-flow rhythm without pulling attention away from presence, greeting, or composer.
- In short-height views, time remains legible before date/weather and decorative ring detail.
- Warm color feels shared across the field instead of applied as a separate overlay.
- The surface does not copy LobeHub, LobeChat, or any other reference skin.

## Guardrail

The safe interpretation is:

```text
image4 = companion semantic field
```

It is not:

```text
image4 = dashboard widget panel
```

Future Image4 changes should link back to this note when they touch presence text, voice bars, speaking animation, dial ring geometry, date/weather placement, warm color tokens, or the relationship between presence and dial.

Code-level state work should link to the Companion State Contract in `src/app/views/image4CompanionState.ts` and the `image4-single-companion-state-driver` / `image4-companion-state-contract` checks in `npm run image4:visual-contract:audit`.
