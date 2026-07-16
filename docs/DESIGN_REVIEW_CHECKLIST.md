# Nexus Design Review Checklist

Last checked: 2026-06-28.

This checklist is the human review layer for Nexus UI changes. It complements source audits, but it is not a CI gate. Use it when a change affects Image4, chat, settings, theme behavior, motion, or the panel's perceived size.

Use `docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md` when a change borrows from external UI patterns. That document maps open-source references to Nexus surfaces; this checklist verifies the local result.

## Review Boundary

| Surface | Review mode | Blocking rule |
| --- | --- | --- |
| Image4 companion panel | Source contract plus human visual review | Structural failures in `image4:contract:check` block PR/release. |
| Header controls, presence signal, dial, composer | Human visual review plus existing Image4 soft audit | Visible clipping, misalignment, or interaction jumps must be fixed before handoff. |
| Chat surface and suggestion actions | Human visual review | Do not add hard grid CI; preserve density, alignment, and composer continuity. |
| Settings drawer | Human visual review | Do not couple settings layout to Image4 rhythm variables. |
| System modals, onboarding, file pickers, OS permissions | Task-specific review | Do not apply Image4 rhythm-grid rules. |

## Before Review

1. Open the current panel state that matches the change.
2. For Image4 calibration, use `?view=panel&image4Preview=1&image4Grid=1`.
3. For a specific Image4 state, add `image4State=idle`, `image4State=attentive`, `image4State=speaking`, or `image4State=resting`.
4. For clean screenshots, use `?view=panel&image4Preview=1&image4Snapshot=1`.
5. For active chat screenshots, use `?view=panel&image4Preview=1&image4ChatPreview=1`.
6. Compare at least the normal panel height and one short-height state if the change touches vertical rhythm.
7. Run `npm run image4:contract:report` when Image4 is touched.
8. Run `npm run composer:surface:audit` when a change touches the normal chat composer, Image4 composer, or shared composer DOM.
9. Run `npm run chat:surface:audit` when a change touches active chat, message bubbles, message states, or chat persistence boundaries.
10. Run `npm run ui:references:audit` when UI work adds or changes open-source reference guidance.
11. Run `npm run ui:references:audit -- --review-runbook` when planning a batch of 0.4 UI review work.
12. Run `npm run ui:references:audit -- --surface=<surface> --pro-answer-quality` after Pro replies and before filling intake.
13. Run `npm run ui:references:audit -- --surface=<surface> --implementation-brief` after Pro intake when a recommendation is ready to become a local UI change.
14. Run `npm run ui:references:audit -- --surface=<surface> --implementation-readiness` before implementing Pro-shaped UI work; it should pass only after the local intake decision is accepted.
15. Run `npm run settings:surface:audit`, `npm run forms:surface:audit`, and `npm run focus:surface:audit` when settings layout, controls, focus behavior, or settings theme CSS changes.

## Image4 Panel

- The four current regions read as header, Live2D stage, conversation recap, and composer.
- Live2D is the main visual anchor; recap and composer support it without restoring a dial, greeting card, or suggestion-action row.
- The rhythm-grid rail stays outside the content plane and never covers text.
- Snapshot mode hides debug calibration marks.
- Short-height views compress before clipping while the Live2D stage and composer remain reachable.
- The Image4 rhythm grid does not expand into chat or settings surfaces.
- Row content uses the Image4 boundary buffer instead of negative row-container transforms.
- Visual weight changes are made through Image4 scoped tokens, not one-off shadows or glow.
- Presence, Live2D expression, and signal derive from one Image4 companion state driver; they should not behave like independent widgets.
- Resting state comes from coarse elapsed-time buckets and should never show exact minutes or seconds.
- URL state preview is only for visual review and must still route through the shared Image4 state driver.

## Header Controls

- Settings, collapse, and close read as one utility rail.
- Close is neutral by default and only becomes danger-tinted during hover/focus.
- Icon hit areas are equal and do not resize on hover.
- Familiar controls use icons, not text labels.
- Hover only improves clarity; focus uses the shared Image4 focus ring.

## Presence Signal

- The visible name stays concise.
- There is no leading decorative orb before the name.
- The presence area remains a non-interactive identity layer, not a widget.
- Idle signal is calm, mostly static, and visually lower than the dial.
- Speaking state animates the existing bars without introducing wrapper glow, shadow, scale, z-index, or scan-light layers.
- Speaking state does not change row, wrapper, or panel geometry.
- Reduced-motion keeps speaking state readable through low-energy signal bars instead of freezing the identity layer completely.
- The signal does not overpower the dial or composer.

## Dial

- Time is live, not fixed preview copy.
- Date and weather are separate enough to avoid clipping.
- No right-side decorative dot returns.
- No text crosses the ring or sits half-inside an orbit.
- Warm and cool accents support the panel background instead of appearing pasted on.

## Suggestion Actions

- Actions read as one continuous suggestion flow, not three heavy cards.
- Icons and text align to a clear scan axis.
- Borders and shadows stay secondary to the composer.
- Hover/focus states do not lift, scale, or shift rows.
- Hover may improve clarity, but it must not add outer shadow or glow.
- Focus uses the shared state ring and must not introduce a second elevation style.

## Composer

- Input, mic, send, and attachment controls share the same center line.
- The textarea has enough boundary to be recognizable in every theme.
- Disabled send state remains visibly disabled during hover.
- Focus ring is visible but does not change layout size.
- Composer stays inside the panel bottom with enough safety margin.
- Image4 composer CSS does not leak into the normal companion composer, active-message CSS stays in `panel-companion-messages.css`, and collapsed shell CSS stays outside `panel-companion-chat.css`.
- Focus state reinforces the textarea as the primary anchor instead of elevating action buttons.
- Disabled send remains visually inert and does not read as an available action.
- Composer action hover/focus states do not add lift, scale, or elevation over the input.
- Composer shadow and focus weight stay on the textarea token budget, not the row wrapper.
- Secondary composer buttons use shared hover/focus state tokens.

## Chat Surface

- Message density stays readable without card-heavy spacing.
- Streaming/tool results have clear boundaries without becoming a second workbench UI.
- Composer remains visually connected to the conversation.
- Short and long Image4 active-chat messages should be checked with `?view=panel&image4Preview=1&image4ChatPreview=density`.
- Normal chat changes do not require Image4 rhythm-grid CI.
- Chat uses an interaction density model, not the Image4 voice-first four-part rhythm.

## Settings Drawer

- Settings sections use compact, repeated rows instead of nested cards.
- Labels, descriptions, and controls align consistently.
- Toggles, segmented choices, and text fields keep predictable focus and disabled states.
- System settings do not import Image4 rhythm variables or decorative panel effects.
- Settings source must not reference `--image4`, `image4-`, `panel-window--image4`, `panel-companion`, dial, signal, wave, or rhythm selectors.
- Text fits inside controls at narrow drawer widths.
- Settings use form-row density and hierarchy rules, not Image4 visual rhythm rows.

## Visual Weight

- Primary weight is reserved for the current action anchor: composer, focused input, or active setting control.
- Secondary weight belongs to readable content and state anchors: message body, dial, or settings section content.
- Tertiary weight belongs to helper copy, prompt suggestions, timestamps, hints, and metadata.
- Idle state lets secondary presence/content dominate while tertiary support stays quiet.
- Presence identity may become livelier during speaking, but it must not become the primary layer.
- Focus state lets primary controls dominate without resizing or moving nearby UI.
- Streaming state can raise message/tool-result weight while keeping the composer stable and reachable.
- System state suppresses tertiary support so warnings, permissions, and errors remain clear.
- Image4 row hierarchy uses a visual weight budget: dial and composer are high-weight anchors, actions stay medium-low, and presence remains a quiet identity layer.
- Image4 vertical rhythm uses boundary isolation: row containers do not use negative margin or translate offsets to fake alignment.
- Image4 interaction states use a mutation budget: hover clarifies, focus identifies, speaking animates bars, and containers stay structurally static.
- Interaction should change leaf-level content or a shared state token, not create new per-component elevation.
- Do not solve cross-surface consistency by forcing one shared layout grid; align attention and hierarchy instead.

## Next UI Priorities

1. Composer anchoring consistency: keep input as the primary action anchor across Image4 and normal chat without changing DOM hierarchy.
2. Presence identity stabilization: keep the signal as a non-interruptive identity layer; idle stays quiet and speaking becomes alive only through the existing bars.
3. Companion State Contract: keep dial, presence, and signal tied to `idle`, `attentive`, `speaking`, and `resting` semantics before adding new motion or tone. Resting should make the field quieter after a longer session without adding a timer badge, extra widget, or dashboard row.
4. Cross-surface visual weight: align primary, secondary, and tertiary attention across Image4, chat, and settings without sharing a layout grid.

## Theme And Motion

- Theme overrides are scoped to the surface they are meant to affect.
- Warm-day colors do not leak into unrelated placeholders, buttons, or focus rings.
- Motion communicates state, not decoration.
- Hover/focus states do not use scale or lift unless a component already has a proven interaction pattern for it.
- Reduced-motion turns off system motion such as dial rotation, arc sweep, glow pulse, and interaction transitions.
- Reduced-motion preserves low-energy identity state only where it communicates companion presence, primarily speaking signal bars.

## Evidence To Record

- URL/state reviewed.
- Viewport or panel size.
- Screenshot path if one was captured.
- Commands run.
- Any Pro review summary used for the decision.
- Review runbook command used, if the work is part of a multi-surface 0.4 UI batch.
- Pro answer quality result, if Pro advice shaped the change.
- Implementation brief command used, if a Pro/open-source recommendation shaped the change.
- Implementation readiness result, if Pro/open-source advice shaped the change.
- Known limits, especially items that need live interaction or accessibility testing beyond screenshot review.
